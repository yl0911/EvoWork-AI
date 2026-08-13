"""Skill 自动挖掘 — 检测事件模式并生成 Skill 候选。"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Skill, WorkEvent
from app.services.ai_analysis import generate_skill_draft

logger = logging.getLogger(__name__)

# ── Pattern detection ────────────────────────────────

class EventPattern:
    """一个反复出现的事件模式。"""

    def __init__(
        self,
        key: str,
        event_type: str,
        primary_tag: str | None,
        project: str | None,
        count: int,
        total_minutes: int,
        sample_titles: list[str],
    ):
        self.key = key
        self.event_type = event_type
        self.primary_tag = primary_tag
        self.project = project
        self.count = count
        self.total_minutes = total_minutes
        self.sample_titles = sample_titles

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "event_type": self.event_type,
            "primary_tag": self.primary_tag,
            "project": self.project,
            "count": self.count,
            "total_minutes": self.total_minutes,
            "sample_titles": self.sample_titles[:5],
        }


def detect_patterns(
    db: Session,
    days: int = 30,
    min_count: int = 3,
    max_patterns: int = 10,
) -> list[EventPattern]:
    """检测反复出现的事件模式。

    按 (event_type, primary_tag) 分组，统计频率和时长，
    返回出现次数 >= min_count 的模式。
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    stmt = (
        select(WorkEvent)
        .where(WorkEvent.started_at >= cutoff)
        .where(WorkEvent.source != "import")
        .order_by(WorkEvent.started_at.desc())
    )
    events = list(db.execute(stmt).scalars())

    # 按 (event_type, primary_tag) 分组
    groups: dict[str, dict] = defaultdict(lambda: {
        "count": 0,
        "total_minutes": 0,
        "titles": [],
        "event_type": "",
        "primary_tag": None,
        "project": None,
    })

    for ev in events:
        tags = ev.tags or []
        # 选择最有意义的 tag（排除通用 tag）
        _generic_tags = {"habit", "browser", "ide", "shell", "git", "activitywatch", "import", "manual"}
        meaningful_tags = [t for t in tags if t.lower() not in _generic_tags]
        primary_tag = meaningful_tags[0] if meaningful_tags else None

        key = f"{ev.event_type}:{primary_tag or 'general'}"
        g = groups[key]
        g["count"] += 1
        g["total_minutes"] += ev.duration_minutes or 0
        g["event_type"] = ev.event_type
        g["primary_tag"] = primary_tag
        if ev.project and not g["project"]:
            g["project"] = ev.project
        if ev.title and len(g["titles"]) < 10:
            g["titles"].append(ev.title[:120])

    # 过滤 + 排序
    patterns: list[EventPattern] = []
    for key, g in groups.items():
        if g["count"] >= min_count:
            patterns.append(EventPattern(
                key=key,
                event_type=g["event_type"],
                primary_tag=g["primary_tag"],
                project=g["project"],
                count=g["count"],
                total_minutes=g["total_minutes"],
                sample_titles=g["titles"],
            ))

    # 按 count × avg_duration 排序
    patterns.sort(
        key=lambda p: p.count * max(1, p.total_minutes / max(1, p.count)),
        reverse=True,
    )
    return patterns[:max_patterns]


# ── Mining pipeline ──────────────────────────────────

class MiningCandidate:
    """一个 Skill 挖掘候选项。"""

    def __init__(
        self,
        pattern: EventPattern,
        draft_content: str | None = None,
        draft_meta: dict | None = None,
    ):
        self.pattern = pattern
        self.draft_content = draft_content
        self.draft_meta = draft_meta or {}

    def to_dict(self) -> dict:
        return {
            "pattern": self.pattern.to_dict(),
            "draft": {
                "content": self.draft_content,
                **self.draft_meta,
            },
        }


def mine_skills(
    db: Session,
    days: int = 30,
    min_count: int = 3,
    max_candidates: int = 5,
    use_llm: bool = True,
) -> list[MiningCandidate]:
    """运行完整的挖掘流水线。

    1. 检测事件模式
    2. 过滤已有 Skill 覆盖的模式
    3. 为每个模式生成 Skill 草稿（可选 LLM）
    4. 返回候选列表
    """
    patterns = detect_patterns(db, days=days, min_count=min_count, max_patterns=max_candidates * 2)

    # 过滤已有 Skill 覆盖的模式
    existing_skills = list(db.execute(select(Skill).where(Skill.system_skill == False)).scalars())  # noqa: E712
    existing_triggers = set()
    for skill in existing_skills:
        if skill.trigger:
            existing_triggers.add(skill.trigger.lower().strip()[:60])

    candidates: list[MiningCandidate] = []
    for pattern in patterns:
        # 检查是否已有类似 Skill
        if _pattern_covered(pattern, existing_skills):
            continue

        draft_content = None
        draft_meta: dict = {}

        if use_llm and pattern.primary_tag:
            try:
                result = generate_skill_draft(db, period="month", tag=pattern.primary_tag)
                draft_content = result.get("content")
                draft_meta = {
                    "provider": result.get("provider"),
                    "model": result.get("model"),
                    "cached": result.get("cached", False),
                }
            except Exception as e:
                logger.warning(f"LLM draft failed for tag={pattern.primary_tag}: {e}")
                draft_content = _fallback_draft(pattern)
                draft_meta = {"provider": "fallback", "model": "rule-based"}
        else:
            draft_content = _fallback_draft(pattern)
            draft_meta = {"provider": "fallback", "model": "rule-based"}

        candidates.append(MiningCandidate(
            pattern=pattern,
            draft_content=draft_content,
            draft_meta=draft_meta,
        ))

        if len(candidates) >= max_candidates:
            break

    return candidates


def _pattern_covered(pattern: EventPattern, existing_skills: list[Skill]) -> bool:
    """检查一个模式是否已被现有 Skill 覆盖。"""
    for skill in existing_skills:
        # 检查 trigger 是否包含模式的 tag
        if pattern.primary_tag and skill.trigger:
            if pattern.primary_tag.lower() in skill.trigger.lower():
                return True
        # 检查 name 是否包含模式的 tag
        if pattern.primary_tag and skill.name:
            if pattern.primary_tag.lower() in skill.name.lower():
                return True
    return False


def _fallback_draft(pattern: EventPattern) -> str:
    """当 LLM 不可用时，基于规则生成简单草稿。"""
    tag = pattern.primary_tag or pattern.event_type
    return f"""Skill 名称: {tag.replace('-', ' ').title()} Skill
Skill 类型: 可复用型
触发条件: 遇到与 "{tag}" 相关的 {pattern.event_type} 事件时
适用场景: 当需要处理 {pattern.event_type} 类型的 "{tag}" 任务时
步骤:
1. 识别问题类型和上下文
2. 收集相关信息
3. 制定解决方案
4. 执行并验证
需要输入: 事件上下文、相关数据
输出产物: 解决方案文档
成功判断: 问题被解决，输出可复用
失败回退: 标记为待研究，记录失败原因
可由 Agent 辅助执行的部分: 信息收集和初步分析

---
此 Skill 基于 {pattern.count} 次 {pattern.event_type} 事件自动检测生成。
样本事件: {', '.join(pattern.sample_titles[:3])}"""


# ── Confirm / Persist ────────────────────────────────

def confirm_skill(
    db: Session,
    name: str,
    category: str,
    trigger: str,
    content: str,
    steps: list[str],
    pattern_key: str | None = None,
    methods: list[str] | None = None,
    success_criteria: str | None = None,
    failure_fallback: str | None = None,
    agent_assistable: bool = False,
) -> Skill:
    """将挖掘候选项确认为正式 Skill。"""
    skill = Skill(
        name=name,
        category=category,
        trigger=trigger,
        content=content,
        steps=steps,
        source="mined",
        methods=methods,
        success_criteria=success_criteria,
        failure_fallback=failure_fallback,
        agent_assistable=agent_assistable,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)

    # 索引新 Skill
    from app.services.indexing import index_skill
    index_skill(skill)

    logger.info(f"Mined skill confirmed: {skill.name} (id={skill.id})")
    return skill


def parse_draft_to_fields(draft_content: str) -> dict:
    """解析 LLM 生成的 Skill 草稿文本为结构化字段。"""
    fields: dict = {
        "name": "",
        "category": "reusable",
        "trigger": "",
        "content": "",
        "steps": [],
        "methods": [],
        "success_criteria": "",
        "failure_fallback": "",
    }

    if not draft_content:
        return fields

    lines = draft_content.strip().split("\n")
    current_section = None
    steps_buffer: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # 检测 section headers
        if stripped.startswith("Skill 名称:") or stripped.startswith("Skill名称:"):
            fields["name"] = stripped.split(":", 1)[-1].strip()
            current_section = "name"
        elif stripped.startswith("Skill 类型:") or stripped.startswith("Skill类型:"):
            type_text = stripped.split(":", 1)[-1].strip()
            if "思路" in type_text:
                fields["category"] = "thinking"
            elif "开源" in type_text:
                fields["category"] = "open_source"
            else:
                fields["category"] = "reusable"
            current_section = "type"
        elif stripped.startswith("触发条件:"):
            fields["trigger"] = stripped.split(":", 1)[-1].strip()
            current_section = "trigger"
        elif stripped.startswith("适用场景:"):
            fields["content"] = stripped.split(":", 1)[-1].strip()
            current_section = "content"
        elif stripped.startswith("步骤:"):
            current_section = "steps"
        elif stripped.startswith("需要输入:"):
            current_section = "inputs"
        elif stripped.startswith("输出产物:"):
            current_section = "outputs"
        elif stripped.startswith("成功判断:"):
            fields["success_criteria"] = stripped.split(":", 1)[-1].strip()
            current_section = "success"
        elif stripped.startswith("失败回退:"):
            fields["failure_fallback"] = stripped.split(":", 1)[-1].strip()
            current_section = "fallback"
        elif stripped.startswith("可由 Agent"):
            current_section = "agent"
        elif stripped.startswith("---"):
            current_section = None
        elif current_section == "steps" and (
            stripped[0].isdigit() or stripped.startswith("-") or stripped.startswith("•")
        ):
            # Step line: "1. Do something" or "- Do something"
            step_text = stripped.lstrip("0123456789.-•) ").strip()
            if step_text:
                steps_buffer.append(step_text)

    fields["steps"] = steps_buffer if steps_buffer else ["待补充"]
    return fields


@lru_cache(maxsize=1)
def get_skill_miner():
    return SkillMinerService()


class SkillMinerService:
    """Skill 挖掘服务 — 面向 API 层的高级接口。"""

    def mine(
        self,
        db: Session,
        days: int = 30,
        max_candidates: int = 5,
        use_llm: bool = True,
    ) -> list[dict]:
        candidates = mine_skills(
            db, days=days, max_candidates=max_candidates, use_llm=use_llm,
        )
        return [c.to_dict() for c in candidates]

    def confirm(
        self,
        db: Session,
        draft_content: str | None = None,
        name: str | None = None,
        category: str | None = None,
        trigger: str | None = None,
        content: str | None = None,
        steps: list[str] | None = None,
        pattern_key: str | None = None,
        **kwargs,
    ) -> dict:
        """确认一个挖掘候选项为正式 Skill。

        可以直接传结构化字段，也可以传 draft_content 自动解析。
        """
        if draft_content and not name:
            fields = parse_draft_to_fields(draft_content)
        else:
            fields = {
                "name": name or "Untitled Skill",
                "category": category or "reusable",
                "trigger": trigger or "",
                "content": content or "",
                "steps": steps or ["待补充"],
            }

        skill = confirm_skill(
            db,
            name=fields["name"],
            category=fields.get("category", "reusable"),
            trigger=fields.get("trigger", ""),
            content=fields.get("content", ""),
            steps=fields.get("steps", ["待补充"]),
            pattern_key=pattern_key,
            methods=kwargs.get("methods"),
            success_criteria=kwargs.get("success_criteria"),
            failure_fallback=kwargs.get("failure_fallback"),
            agent_assistable=kwargs.get("agent_assistable", False),
        )
        return {
            "id": skill.id,
            "name": skill.name,
            "category": skill.category,
            "source": skill.source,
        }
