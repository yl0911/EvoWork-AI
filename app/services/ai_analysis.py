"""AI 分析服务：复盘生成 + Skill 草稿生成。"""

from __future__ import annotations

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import period_start
from app.core.dependencies import get_llm_gateway
from app.gateways.base import LLMResponse
from app.models import AICache, WorkEvent
from app.services.insights import summarize_insights


SYSTEM_PROMPT = """你是 EvoWork AI 的个人工作与学习进化助手。
你的目标是帮助用户复盘工作学习过程、识别认知卡点、沉淀可复用 Skill。
请避免绩效考核、监控、评价员工价值这类表达。
请用中文，语气克制、具体、可执行。
如果信息不足，请明确说信息不足，并基于现有事件给出低风险建议。"""


def _load_period_events(db: Session, period: str) -> list[WorkEvent]:
    return list(
        db.execute(
            select(WorkEvent)
            .where(WorkEvent.started_at >= period_start(period))
            .order_by(WorkEvent.started_at.desc())
            .limit(40)
        ).scalars()
    )


def _event_line(event: WorkEvent) -> str:
    layer_label = {"habit": "习惯", "problem": "问题", "result": "结果"}.get(event.event_layer, event.event_layer)
    parts = [
        f"时间: {event.started_at.isoformat()}",
        f"标题: {event.title}",
        f"层级: {layer_label}",
        f"类型: {event.event_type}",
        f"来源: {event.source}",
        f"项目: {event.project or '未归属'}",
        f"时长: {event.duration_minutes} 分钟",
        f"结果: {event.outcome}",
        f"标签: {', '.join(event.tags or []) or '无'}",
        f"隐私级别: {event.privacy_level}",
    ]
    if event.ai_summary:
        parts.append(f"AI摘要: {event.ai_summary}")
    if event.privacy_level == "content" and event.content:
        parts.append(f"内容: {event.content}")
    elif event.privacy_level == "metadata" and event.content:
        parts.append("内容: 已按 metadata 隐私级别隐藏，仅使用标题、类型、标签和时长。")
    elif event.privacy_level == "private":
        parts.append("内容: private 隐私级别，未发送正文。")
    return "；".join(parts)


def _format_events(events: list[WorkEvent]) -> str:
    if not events:
        return "暂无事件。"
    return "\n".join(f"{index}. {_event_line(event)}" for index, event in enumerate(events, start=1))


def _fingerprint_events(
    events: list[WorkEvent], *, kind: str, period: str, tag: str | None, model: str
) -> str:
    payload = {
        "kind": kind,
        "period": period,
        "tag": tag or "",
        "model": model,
        "events": [
            {
                "id": event.id,
                "updated_at": event.updated_at.isoformat() if event.updated_at else "",
                "privacy_level": event.privacy_level,
            }
            for event in events
        ],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cache_key(
    *, kind: str, period: str, tag: str | None, provider: str, model: str, fingerprint: str
) -> str:
    payload = {
        "kind": kind,
        "period": period,
        "tag": tag or "",
        "provider": provider,
        "model": model,
        "fingerprint": fingerprint,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _get_cached(db: Session, cache_key: str) -> AICache | None:
    return db.execute(select(AICache).where(AICache.cache_key == cache_key)).scalar_one_or_none()


def _save_cache(
    db: Session,
    *,
    cache_key: str,
    kind: str,
    period: str,
    tag: str | None,
    provider: str,
    model: str,
    content: str,
    input_fingerprint: str,
) -> None:
    cached = _get_cached(db, cache_key)
    if cached:
        cached.content = content
        cached.provider = provider
        cached.model = model
        cached.input_fingerprint = input_fingerprint
    else:
        db.add(
            AICache(
                cache_key=cache_key,
                kind=kind,
                period=period,
                tag=tag,
                provider=provider,
                model=model,
                content=content,
                input_fingerprint=input_fingerprint,
            )
        )
    db.commit()


def _cached_response(cached: AICache) -> dict:
    return {
        "provider": cached.provider,
        "model": cached.model,
        "period": cached.period,
        "tag": cached.tag,
        "content": cached.content,
        "cached": True,
        "cache_key": cached.cache_key,
        "created_at": cached.created_at.isoformat(),
        "updated_at": cached.updated_at.isoformat(),
    }


def build_chat_context(db: Session, period: str = "week") -> str:
    """构建 AI 聊天的系统上下文（事件 + 统计 + Skills + 分析数据）。"""
    events = _load_period_events(db, period)
    insights = summarize_insights(db, period=period)

    # 加载用户 Skills 概要
    skills_context = ""
    try:
        from app.models import Skill
        user_skills = list(
            db.execute(
                select(Skill).where(Skill.system_skill == False).order_by(Skill.updated_at.desc()).limit(20)  # noqa: E712
            ).scalars()
        )
        if user_skills:
            skill_lines = []
            for s in user_skills:
                eff_str = f", 效果{round(s.avg_effectiveness * 100)}%" if s.avg_effectiveness else ""
                usage_str = f"使用{s.usage_count}次" if s.usage_count else "未使用"
                skill_lines.append(f"- {s.name} ({s.category}, {usage_str}{eff_str})")
            skills_context = "--- 用户 Skill 库 ---\n" + "\n".join(skill_lines)
    except Exception:
        pass

    analytics_context = ""
    try:
        from app.core.dependencies import get_analytics_engine
        engine = get_analytics_engine()
        shell_data = engine.shell_commands(period)
        patterns_data = engine.work_patterns(period)

        shell_lines = []
        if shell_data.get("total_commands", 0) > 0:
            shell_lines.append(f"Shell 命令总数: {shell_data['total_commands']}")
            shell_lines.append(f"Shell 错误率: {shell_data['error_rate']}%")
            if shell_data.get("type_distribution"):
                dist = ", ".join(f"{k}: {v}" for k, v in shell_data["type_distribution"].items())
                shell_lines.append(f"Shell 命令类型分布: {dist}")
            if shell_data.get("top_commands"):
                top = ", ".join(f"{c['command']}({c['count']})" for c in shell_data["top_commands"][:8])
                shell_lines.append(f"高频命令 Top: {top}")
            if shell_data.get("error_commands"):
                errs = ", ".join(f"{c['command']}({c['count']})" for c in shell_data["error_commands"][:5])
                shell_lines.append(f"频繁失败命令: {errs}")

        pattern_lines = []
        if patterns_data.get("total_events", 0) > 0:
            pattern_lines.append(f"活跃天数: {patterns_data['active_days']}")
            pattern_lines.append(f"项目切换次数: {patterns_data['project_switches']}")
            if patterns_data.get("hourly_distribution"):
                hourly = patterns_data["hourly_distribution"]
                peak_hours = sorted(hourly.items(), key=lambda x: x[1], reverse=True)[:3]
                peak_str = ", ".join(f"{h}时({c}次)" for h, c in peak_hours)
                pattern_lines.append(f"高峰时段: {peak_str}")

        if shell_lines or pattern_lines:
            parts = ["--- 量化分析数据 ---"]
            if shell_lines:
                parts.append("[终端活动]\n" + "\n".join(shell_lines))
            if pattern_lines:
                parts.append("[工作节奏]\n" + "\n".join(pattern_lines))
            analytics_context = "\n\n".join(parts)
    except Exception:
        pass

    sections = [
        f"统计信息:\n{insights}",
    ]
    if skills_context:
        sections.append(skills_context)
    if analytics_context:
        sections.append(analytics_context)
    sections.append(f"事件列表:\n{_format_events(events)}")

    return "\n\n".join(sections)


def generate_period_review(db: Session, period: str = "week", refresh: bool = False) -> dict:
    events = _load_period_events(db, period)
    insights = summarize_insights(db, period=period)
    gateway = get_llm_gateway()

    # 获取额外分析数据
    analytics_context = ""
    try:
        from app.core.dependencies import get_analytics_engine
        engine = get_analytics_engine()
        shell_data = engine.shell_commands(period)
        patterns_data = engine.work_patterns(period)

        shell_lines = []
        if shell_data.get("total_commands", 0) > 0:
            shell_lines.append(f"Shell 命令总数: {shell_data['total_commands']}")
            shell_lines.append(f"Shell 错误率: {shell_data['error_rate']}%")
            if shell_data.get("type_distribution"):
                dist = ", ".join(f"{k}: {v}" for k, v in shell_data["type_distribution"].items())
                shell_lines.append(f"Shell 命令类型分布: {dist}")
            if shell_data.get("top_commands"):
                top = ", ".join(f"{c['command']}({c['count']})" for c in shell_data["top_commands"][:8])
                shell_lines.append(f"高频命令 Top: {top}")
            if shell_data.get("error_commands"):
                errs = ", ".join(f"{c['command']}({c['count']})" for c in shell_data["error_commands"][:5])
                shell_lines.append(f"频繁失败命令: {errs}")

        pattern_lines = []
        if patterns_data.get("total_events", 0) > 0:
            pattern_lines.append(f"活跃天数: {patterns_data['active_days']}")
            pattern_lines.append(f"项目切换次数: {patterns_data['project_switches']}")
            if patterns_data.get("hourly_distribution"):
                hourly = patterns_data["hourly_distribution"]
                peak_hours = sorted(hourly.items(), key=lambda x: x[1], reverse=True)[:3]
                peak_str = ", ".join(f"{h}时({c}次)" for h, c in peak_hours)
                pattern_lines.append(f"高峰时段: {peak_str}")

        if shell_lines or pattern_lines:
            parts = ["--- 量化分析数据 ---"]
            if shell_lines:
                parts.append("[终端活动]\n" + "\n".join(shell_lines))
            if pattern_lines:
                parts.append("[工作节奏]\n" + "\n".join(pattern_lines))
            analytics_context = "\n\n".join(parts)
    except Exception:
        pass  # analytics 数据获取失败不影响主流程

    fingerprint = _fingerprint_events(events, kind="period-review", period=period, tag=None, model=gateway.model)
    cache_key = _cache_key(
        kind="period-review",
        period=period,
        tag=None,
        provider=gateway.provider,
        model=gateway.model,
        fingerprint=fingerprint,
    )
    if not refresh:
        cached = _get_cached(db, cache_key)
        if cached:
            return _cached_response(cached)

    prompt = f"""请基于下面的 WorkEvent、统计信息和量化分析数据，生成一个个人复盘。

统计信息:
{insights}

{analytics_context}

事件列表:
{_format_events(events)}

输出格式:
1. 本周期工作/学习概览
2. 观察到的习惯模式（结合终端活动和工作节奏数据）
3. 可能的认知卡点或技术壁垒（特别关注频繁失败的命令和重复问题）
4. 建议沉淀的 Skill（从高频操作和重复问题中提炼可复用流程）
5. 下一步 3 个行动

要求:
- 不要使用监控、考核、排名语气。
- 优先指出能帮助用户自主学习和突破问题的建议。
- 如果某个判断只是推测，请标注"推测"。
- 结合终端命令数据指出工作流优化机会（如频繁手动操作可以脚本化）。
- 结合工作节奏数据给出时间管理建议（如高峰时段适合深度工作）。
- 使用 Markdown 输出，但不要使用横线分隔。
- 每个小节控制在 2-4 个短段或列表项，避免整段过长。
- 列表项优先使用短句，适合仪表盘阅读。"""

    result = gateway.chat(system_prompt=SYSTEM_PROMPT, user_prompt=prompt)
    _save_cache(
        db,
        cache_key=cache_key,
        kind="period-review",
        period=period,
        tag=None,
        provider=result.provider,
        model=result.model,
        content=result.content,
        input_fingerprint=fingerprint,
    )
    return {
        "provider": result.provider,
        "model": result.model,
        "period": period,
        "tag": None,
        "content": result.content,
        "cached": False,
        "cache_key": cache_key,
    }


def generate_skill_draft(
    db: Session, period: str = "week", tag: str | None = None, refresh: bool = False
) -> dict:
    events = _load_period_events(db, period)
    if tag:
        events = [event for event in events if tag in (event.tags or [])]
    elif events:
        tag_counts: dict[str, int] = {}
        for event in events:
            for item in event.tags or []:
                tag_counts[item] = tag_counts.get(item, 0) + 1
        if tag_counts:
            tag = max(tag_counts.items(), key=lambda item: item[1])[0]
            events = [event for event in events if tag in (event.tags or [])]

    gateway = get_llm_gateway()
    fingerprint = _fingerprint_events(events, kind="skill-draft", period=period, tag=tag, model=gateway.model)
    cache_key = _cache_key(
        kind="skill-draft",
        period=period,
        tag=tag,
        provider=gateway.provider,
        model=gateway.model,
        fingerprint=fingerprint,
    )
    if not refresh:
        cached = _get_cached(db, cache_key)
        if cached:
            return _cached_response(cached)

    prompt = f"""请基于下面的事件，生成一个 Skill 草稿。

目标主题: {tag or '请从事件中选择最适合沉淀的主题'}

事件列表:
{_format_events(events)}

输出格式:
Skill 名称:
Skill 类型: 思路型 / 可复用型 / 开源区候选
触发条件:
适用场景:
步骤:
需要输入:
输出产物:
成功判断:
失败回退:
可由 Agent 辅助执行的部分:

要求:
- 这个 Skill 是为个人学习和工作辅助服务，不是管理评价。
- 步骤要具体，可复用。
- 不要编造事件中没有的事实；不足之处可以写"待补充"。"""

    result = gateway.chat(system_prompt=SYSTEM_PROMPT, user_prompt=prompt)
    _save_cache(
        db,
        cache_key=cache_key,
        kind="skill-draft",
        period=period,
        tag=tag,
        provider=result.provider,
        model=result.model,
        content=result.content,
        input_fingerprint=fingerprint,
    )
    return {
        "provider": result.provider,
        "model": result.model,
        "period": period,
        "tag": tag,
        "content": result.content,
        "cached": False,
        "cache_key": cache_key,
    }
