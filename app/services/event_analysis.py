"""AI 事件分析服务 — 将原始事件转化为结构化任务记录。

分层分析架构:
- Week: 直接分析原始事件（事件→会话→LLM→AnalyzedTask）
- Month: 聚合 Week 级任务，按项目合并为月度任务（1 次 LLM 调用）
- Year: 聚合 Month 级任务，提炼年度主题（1 次 LLM 调用）
- 回退: Month/Year 在底层数据不足时自动降级为直接分析
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func, delete
from sqlalchemy.orm import Session

from app.core.constants import period_start, calendar_period_key
from app.core.dependencies import get_llm_gateway
from app.models import WorkEvent
from app.models.analyzed_task import AnalyzedTask
from app.models.analysis_run import AnalysisRun
from app.services.ai_analysis import (
    _filter_meaningful_events,
    _build_activity_sessions,
    _load_period_events,
)


# Week 直接分析最大会话数
_MAX_WEEK_SESSIONS = 60

# Month/Year 聚合分析: 底层任务数量低于此值时降级为直接分析
_MIN_TASKS_FOR_CONSOLIDATION = 10

ANALYSIS_SYSTEM_PROMPT = """你是 EvoWork AI 的工作事件分析引擎。
你的任务是将一组工作会话（每个会话包含多个来自不同来源的事件）分析为结构化的任务记录。
请从"用户在做一件事"的角度分析，不要逐条分析命令或事件。
用中文输出，语气具体、可执行。"""


def _build_batch_prompt(sessions_data: list[dict]) -> str:
    """构建批量分析的 LLM prompt。"""
    lines = []
    for i, s in enumerate(sessions_data, 1):
        lines.append(f"--- 会话 {i} ---")
        lines.append(f"类型: {s['type']} | 项目: {s['project']}")
        lines.append(f"时间: {s['start']} ~ {s['end']} ({s['duration_min']}min)")
        lines.append(f"来源: {s['sources']} | 结果: {s['outcome']}")
        lines.append(f"动作数: {s['event_count']}")
        if s.get("key_actions"):
            lines.append("关键动作:")
            for a in s["key_actions"][:5]:
                lines.append(f"  · {a}")
        # 如果有事件详情
        if s.get("event_details"):
            lines.append("事件详情:")
            for e in s["event_details"][:8]:
                lines.append(f"  - {e}")
        lines.append("")

    sessions_text = "\n".join(lines)

    return f"""请分析下面的 {len(sessions_data)} 个工作会话，为每个会话生成一条结构化任务记录。

{sessions_text}

输出格式：返回一个 JSON 数组，每个元素包含以下字段：
```json
[
  {{
    "title": "一句话概括这个任务（不超过 40 字）",
    "problem_description": "用户在解决什么问题或做什么事（2-3 句话）",
    "actions_taken": ["动作1", "动作2", "动作3"],
    "solution": "采用了什么方法/方案解决（如果适用）",
    "result": "resolved 或 partial 或 unresolved 或 abandoned",
    "result_detail": "结果的补充说明（1-2 句话）",
    "reference_theory": "相关的知识点、理论或方法论（如果有，格式：理论名 — 一句话说明）。如无则为 null",
    "efficiency_score": 3,
    "activity_type": "编码开发 或 调试修复 或 问题排查 或 学习调研 或 部署运维 或 文档写作 或 浏览阅读",
    "tags": ["标签1", "标签2"]
  }}
]
```

效率评分说明（1-5）：
- 5：极其高效，用时远低于预期
- 4：高效，流程顺畅
- 3：正常，无明显低效
- 2：较低效，有明显可优化空间
- 1：低效，存在严重问题

要求：
1. 数组长度必须等于会话数量（{len(sessions_data)} 个）。
2. 如果某个会话信息不足以判断某些字段，使用合理推测并标注。
3. reference_theory 字段很重要：如果发现用户遇到了认知盲区或知识短板，请给出相关理论/知识点帮助用户突破。
4. actions_taken 列出 3-6 个关键动作，概括而非罗列所有命令。
5. 只输出 JSON 数组，不要输出其他内容。"""


def _parse_llm_response(content: str, session_count: int) -> list[dict]:
    """从 LLM 响应中解析任务列表，支持多种回退策略。"""
    # 策略 1: 直接 JSON 解析
    try:
        result = json.loads(content)
        if isinstance(result, list) and len(result) > 0:
            return result
    except json.JSONDecodeError:
        pass

    # 策略 2: 从 markdown code block 中提取
    json_match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?```', content)
    if json_match:
        try:
            result = json.loads(json_match.group(1))
            if isinstance(result, list) and len(result) > 0:
                return result
        except json.JSONDecodeError:
            pass

    # 策略 3: 找到第一个 [ 和最后一个 ] 之间的内容
    start = content.find('[')
    end = content.rfind(']')
    if start != -1 and end > start:
        try:
            result = json.loads(content[start:end + 1])
            if isinstance(result, list) and len(result) > 0:
                return result
        except json.JSONDecodeError:
            pass

    # 全部失败
    print(f"[EventAnalysis] Failed to parse LLM response ({session_count} sessions)")
    return []


def _enrich_sessions_with_events(
    sessions: list[dict],
    events: list[WorkEvent],
) -> list[dict]:
    """为每个会话补充关联的事件详情摘要。"""
    # 按时间排序事件
    sorted_events = sorted(events, key=lambda e: e.started_at)

    for session in sessions:
        session_start_str = session["start"]  # "MM-DD HH:MM"
        session_end_str = session["end"]
        event_details = []

        for ev in sorted_events:
            # 简单匹配：项目相同且来源匹配
            ev_project = ev.project or "未归属"
            if ev_project != session["project"] and session["project"] != "未归属":
                continue
            # 检查来源是否在会话的 sources 中
            if ev.source not in session["sources"]:
                continue
            # 构建事件摘要
            detail = f"[{ev.source}] {ev.title}"
            if ev.duration_minutes:
                detail += f" ({ev.duration_minutes}min)"
            if ev.ai_summary:
                detail += f" — {ev.ai_summary[:60]}"
            event_details.append(detail)

        session["event_details"] = event_details[:10]  # 限制数量

    return sessions


# ── 聚合分析（Month/Year）───────────────────────────────

CONSOLIDATION_SYSTEM_PROMPT = """你是 EvoWork AI 的工作任务聚合引擎。
你的任务是将一批已分析的细粒度工作任务合并为更高层次的综合性任务记录。
不要逐条罗列，而是按项目和主题聚合，提炼出有代表性的综合性任务。
每个综合性任务应概括同一项目/主题下的多个相关任务。
用中文输出，语气具体、概括性强。"""


def _load_tasks_in_range(db: Session, source_period: str, since: datetime) -> list[AnalyzedTask]:
    """加载指定时间范围内的分析任务。"""
    return list(db.execute(
        select(AnalyzedTask)
        .where(AnalyzedTask.period == source_period)
        .where(AnalyzedTask.created_at >= since)
        .order_by(AnalyzedTask.created_at.desc())
    ).scalars())


def _build_consolidation_prompt(tasks: list[AnalyzedTask], period_label: str) -> str:
    """构建聚合分析的 LLM prompt。"""
    by_project: dict[str, list[AnalyzedTask]] = {}
    for t in tasks:
        key = t.project or "未归属"
        by_project.setdefault(key, []).append(t)

    lines = [f"以下是 {period_label} 内已分析的 {len(tasks)} 个任务，按项目分组：\n"]

    for project, group in sorted(by_project.items(), key=lambda x: len(x[1]), reverse=True):
        resolved = sum(1 for t in group if t.result == "resolved")
        avg_eff = (
            round(sum(t.efficiency_score for t in group if t.efficiency_score) /
                  sum(1 for t in group if t.efficiency_score), 1)
            if any(t.efficiency_score for t in group) else 0
        )
        type_dist: dict[str, int] = {}
        for t in group:
            type_dist[t.activity_type] = type_dist.get(t.activity_type, 0) + 1
        type_summary = ", ".join(f"{k}({v})" for k, v in sorted(type_dist.items(), key=lambda x: x[1], reverse=True))

        lines.append(f"### {project} ({len(group)} 个任务, 完成 {resolved}, 均效 {avg_eff}/5)")
        lines.append(f"类型: {type_summary}")
        for t in group[:10]:
            eff_str = f"效率{t.efficiency_score}" if t.efficiency_score else ""
            result_map = {"resolved": "✓", "partial": "◐", "unresolved": "✗", "abandoned": "⊘"}
            r = result_map.get(t.result, "?")
            desc = (t.problem_description or "")[:80]
            theory = f" | 知识点: {t.reference_theory[:40]}" if t.reference_theory else ""
            lines.append(f"  - [{r}] {t.title} ({t.activity_type}, {eff_str}){theory}")
            if desc:
                lines.append(f"    {desc}")
        if len(group) > 10:
            lines.append(f"  … 还有 {len(group) - 10} 个任务")
        lines.append("")

    max_tasks = min(len(by_project) + 5, 30)

    return f"""请分析下面 {period_label} 的工作任务，将同一项目/主题下的多个任务合并为综合性任务记录。

{chr(10).join(lines)}

输出格式：返回一个 JSON 数组，每个元素包含：
```json
[
  {{
    "title": "综合性任务标题（概括该项目/主题的核心工作，不超过 40 字）",
    "problem_description": "该项目/主题下主要在处理什么问题（3-4 句话概括，涵盖多个任务的共性）",
    "actions_taken": ["关键动作1", "关键动作2", "关键动作3"],
    "solution": "采用的核心方法/方案（概括性描述）",
    "result": "resolved 或 partial 或 unresolved 或 abandoned",
    "result_detail": "整体结果概述（2-3 句话）",
    "reference_theory": "最重要的知识点或方法论（如有）。如无则为 null",
    "efficiency_score": 3,
    "activity_type": "该项目最主要的活动类型",
    "project": "该任务所属的项目名称",
    "tags": ["标签1", "标签2"],
    "task_count": 5
  }}
]
```

效率评分说明（1-5）：5=极其高效 4=高效 3=正常 2=较低效 1=低效

要求：
1. 每个项目/主题合并为 1-2 个综合性任务，总数不超过 {max_tasks} 个。
2. 合并时保留最重要的知识点和方法论。
3. task_count 字段填写该综合任务合并了多少个原始任务。
4. 只输出 JSON 数组，不要输出其他内容。"""


def _run_consolidation(
    db: Session,
    source_tasks: list[AnalyzedTask],
    period: str,
    p_start: datetime,
    p_end: datetime,
    run: AnalysisRun,
    gateway,
) -> int:
    """执行聚合分析，将底层任务合并为高层任务。返回创建的任务数。"""
    period_label = {"month": "近一个月", "year": "近一年"}.get(period, period)
    prompt = _build_consolidation_prompt(source_tasks, period_label)

    result = gateway.chat(
        system_prompt=CONSOLIDATION_SYSTEM_PROMPT,
        user_prompt=prompt,
        temperature=0.2,
    )

    parsed = _parse_llm_response(result.content, 0)
    task_count = 0
    for task_data in parsed:
        task = AnalyzedTask(
            id=f"task_{uuid.uuid4().hex}",
            period=period,
            period_start=p_start,
            period_end=p_end,
            title=task_data.get("title", "未命名任务")[:300],
            problem_description=task_data.get("problem_description", ""),
            actions_taken=task_data.get("actions_taken", []),
            solution=task_data.get("solution"),
            result=task_data.get("result", "partial"),
            result_detail=task_data.get("result_detail"),
            reference_theory=task_data.get("reference_theory"),
            efficiency_score=_clamp_score(task_data.get("efficiency_score")),
            activity_type=task_data.get("activity_type", "其他"),
            project=task_data.get("project"),
            tags=task_data.get("tags", []),
            sources=[],
            source_event_ids=[],
            analysis_run_id=run.id,
            model=gateway.model,
        )
        db.add(task)
        task_count += 1

    return task_count


def _run_direct_analysis(
    db: Session,
    period: str,
    p_start: datetime,
    p_end: datetime,
    run: AnalysisRun,
    gateway,
) -> int:
    """直接分析原始事件：事件→会话→LLM分批→AnalyzedTask。返回创建的任务数。"""
    all_events = _load_period_events(db, period)
    run.total_events_seen = len(all_events)

    events = _filter_meaningful_events(all_events)
    run.noise_events_count = len(all_events) - len(events)

    if not events:
        return 0

    sessions = _build_activity_sessions(events)

    # 限制最大会话数
    total_sessions = len(sessions)
    if total_sessions > _MAX_WEEK_SESSIONS:
        print(f"[EventAnalysis] Sessions {total_sessions} > max {_MAX_WEEK_SESSIONS}, truncating")
        sessions = sessions[:_MAX_WEEK_SESSIONS]

    sessions = _enrich_sessions_with_events(sessions, events)

    batch_size = 6
    total_batches = (len(sessions) + batch_size - 1) // batch_size
    all_tasks: list[dict] = []

    for batch_idx, i in enumerate(range(0, len(sessions), batch_size), 1):
        batch = sessions[i:i + batch_size]
        print(f"[EventAnalysis] Direct batch {batch_idx}/{total_batches} ({len(batch)} sessions)")
        prompt = _build_batch_prompt(batch)

        result = gateway.chat(
            system_prompt=ANALYSIS_SYSTEM_PROMPT,
            user_prompt=prompt,
            temperature=0.1,
        )

        parsed = _parse_llm_response(result.content, len(batch))
        for j, task_data in enumerate(parsed):
            if j < len(batch):
                task_data["_session"] = batch[j]
        all_tasks.extend(parsed)

    task_count = 0
    for task_data in all_tasks:
        session_info = task_data.pop("_session", {})
        source_event_ids = session_info.get("source_event_ids", [])

        task = AnalyzedTask(
            id=f"task_{uuid.uuid4().hex}",
            period=period,
            period_start=p_start,
            period_end=p_end,
            title=task_data.get("title", "未命名任务")[:300],
            problem_description=task_data.get("problem_description", ""),
            actions_taken=task_data.get("actions_taken", []),
            solution=task_data.get("solution"),
            result=task_data.get("result", "partial"),
            result_detail=task_data.get("result_detail"),
            reference_theory=task_data.get("reference_theory"),
            efficiency_score=_clamp_score(task_data.get("efficiency_score")),
            activity_type=task_data.get("activity_type", session_info.get("type", "其他")),
            project=session_info.get("project"),
            tags=task_data.get("tags", []),
            sources=_parse_sources(session_info.get("sources", "")),
            source_event_ids=source_event_ids,
            analysis_run_id=run.id,
            model=gateway.model,
        )
        db.add(task)
        task_count += 1

    return task_count


def run_event_analysis(
    db: Session,
    period: str = "week",
    trigger_mode: str = "manual",
    refresh: bool = False,
) -> AnalysisRun:
    """主入口：运行事件分析，产出结构化 AnalyzedTask。

    Args:
        db: 数据库 session
        period: 分析周期 ("week" / "month" / "year")
        trigger_mode: 触发方式 ("manual" / "scheduled_daily" / "scheduled_interval")
        refresh: 是否强制重新分析（忽略已有结果）

    Returns:
        AnalysisRun 记录
    """
    gateway = get_llm_gateway()
    if not gateway.configured:
        raise RuntimeError("LLM is not configured.")

    p_start = period_start(period)
    p_end = datetime.now(timezone.utc)
    current_key = calendar_period_key(period)

    # 0. 清理同一日历周期的旧结果（如本周 W33 的旧分析），
    #    保留其他周期的历史数据供 Month/Year 聚合使用
    old_runs = list(db.execute(
        select(AnalysisRun).where(AnalysisRun.period == period)
    ).scalars())
    stale_run_ids = [
        r.id for r in old_runs
        if calendar_period_key(period, r.created_at) == current_key
    ]
    if stale_run_ids:
        db.execute(delete(AnalyzedTask).where(AnalyzedTask.analysis_run_id.in_(stale_run_ids)))
        db.execute(delete(AnalysisRun).where(AnalysisRun.id.in_(stale_run_ids)))
        db.commit()
        print(f"[EventAnalysis] Cleaned {len(stale_run_ids)} stale runs for {period} key={current_key}")

    # 1. 创建 AnalysisRun 记录
    run = AnalysisRun(
        id=f"run_{uuid.uuid4().hex}",
        period=period,
        period_start=p_start,
        period_end=p_end,
        trigger_mode=trigger_mode,
        status="running",
        model=gateway.model,
    )
    db.add(run)
    db.commit()

    try:
        if period == "week":
            # ── Week: 直接分析原始事件 ──
            task_count = _run_direct_analysis(db, period, p_start, p_end, run, gateway)
        else:
            # ── Month/Year: 基于底层周期任务做聚合 ──
            source_period = "week" if period == "month" else "month"
            source_tasks = _load_tasks_in_range(db, source_period, p_start)

            if len(source_tasks) >= _MIN_TASKS_FOR_CONSOLIDATION:
                print(f"[EventAnalysis] Consolidation: {len(source_tasks)} {source_period} tasks → {period}")
                run.total_events_seen = len(source_tasks)
                task_count = _run_consolidation(
                    db, source_tasks, period, p_start, p_end, run, gateway,
                )
            else:
                # 底层数据不足，降级为直接分析
                print(f"[EventAnalysis] Fallback: {len(source_tasks)} {source_period} tasks < {_MIN_TASKS_FOR_CONSOLIDATION}, direct analysis for {period}")
                task_count = _run_direct_analysis(db, period, p_start, p_end, run, gateway)

        run.tasks_identified = task_count
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()

        print(f"[EventAnalysis] Run {run.id}: {task_count} tasks (period={period})")
        return run

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)[:1000]
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        print(f"[EventAnalysis] Run {run.id} failed: {exc}")
        return run


def _clamp_score(score) -> int | None:
    """将效率评分限制在 1-5 范围。"""
    if score is None:
        return None
    try:
        return max(1, min(5, int(score)))
    except (ValueError, TypeError):
        return None


def _parse_sources(sources_str: str) -> list[str]:
    """从 "shell(3), ide(2), browser(1)" 格式解析出来源列表。"""
    if not sources_str:
        return []
    result = []
    for part in sources_str.split(","):
        name = part.strip().split("(")[0].strip()
        if name:
            result.append(name)
    return result


# ── 查询函数 ──────────────────────────────────────────


def get_analyzed_tasks(
    db: Session,
    period: str = "week",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[AnalyzedTask], int]:
    """获取指定周期的分析任务列表和总数。

    Week 只显示最新一次运行的结果（历史周数据保留但不展示，供 Month 聚合用）。
    Month/Year 展示所有任务（聚合结果不会累积太多）。
    """
    base = select(AnalyzedTask).where(AnalyzedTask.period == period)

    # Week: 只取最新一次 AnalysisRun 的任务
    if period == "week":
        latest_run = db.execute(
            select(AnalysisRun)
            .where(AnalysisRun.period == "week")
            .order_by(AnalysisRun.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if latest_run:
            base = base.where(AnalyzedTask.analysis_run_id == latest_run.id)
        else:
            return [], 0

    total = db.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar() or 0

    tasks = list(
        db.execute(
            base.order_by(AnalyzedTask.created_at.desc()).limit(limit).offset(offset)
        ).scalars()
    )
    return tasks, total


def get_analysis_runs(
    db: Session,
    period: str = "week",
    limit: int = 10,
) -> list[AnalysisRun]:
    """获取分析运行历史。"""
    return list(
        db.execute(
            select(AnalysisRun)
            .where(AnalysisRun.period == period)
            .order_by(AnalysisRun.created_at.desc())
            .limit(limit)
        ).scalars()
    )


def get_period_comparison(
    db: Session,
    current_period: str,
    previous_period: str,
) -> dict:
    """对比两个周期的分析任务。"""
    def _stats(period: str) -> dict:
        tasks = list(db.execute(
            select(AnalyzedTask).where(AnalyzedTask.period == period)
        ).scalars())

        if not tasks:
            return {"total": 0, "by_type": {}, "by_result": {}, "avg_efficiency": 0}

        by_type: dict[str, int] = {}
        by_result: dict[str, int] = {}
        total_eff = 0
        eff_count = 0

        for t in tasks:
            by_type[t.activity_type] = by_type.get(t.activity_type, 0) + 1
            by_result[t.result] = by_result.get(t.result, 0) + 1
            if t.efficiency_score:
                total_eff += t.efficiency_score
                eff_count += 1

        return {
            "total": len(tasks),
            "by_type": by_type,
            "by_result": by_result,
            "avg_efficiency": round(total_eff / eff_count, 1) if eff_count > 0 else 0,
        }

    return {
        "current": _stats(current_period),
        "previous": _stats(previous_period),
    }


def build_tasks_context_for_review(db: Session, period: str = "week") -> str | None:
    """将已分析任务格式化为复盘用的文本上下文。

    如果没有分析任务，返回 None（调用方应回退到原始事件）。
    """
    tasks = list(db.execute(
        select(AnalyzedTask)
        .where(AnalyzedTask.period == period)
        .order_by(AnalyzedTask.created_at.desc())
        .limit(30)
    ).scalars())

    if not tasks:
        return None

    lines = ["--- AI 已分析的结构化任务（优先使用这些数据，而非原始事件）---"]

    # 统计摘要
    by_type: dict[str, int] = {}
    for t in tasks:
        by_type[t.activity_type] = by_type.get(t.activity_type, 0) + 1
    type_summary = ", ".join(f"{t}: {c}" for t, c in sorted(by_type.items(), key=lambda x: x[1], reverse=True))
    lines.append(f"任务总数: {len(tasks)} | 类型分布: {type_summary}")
    lines.append("")

    for i, t in enumerate(tasks[:20], 1):
        result_label = {"resolved": "已解决", "partial": "部分完成", "unresolved": "未解决", "abandoned": "已放弃"}.get(t.result, t.result)
        eff = f"效率{t.efficiency_score}/5" if t.efficiency_score else ""
        lines.append(f"{i}. [{t.activity_type}] {t.title}")
        lines.append(f"   项目: {t.project or '未归属'} | 结果: {result_label} | {eff}")
        if t.problem_description:
            lines.append(f"   问题: {t.problem_description[:120]}")
        if t.solution:
            lines.append(f"   方案: {t.solution[:120]}")
        if t.reference_theory:
            lines.append(f"   知识点: {t.reference_theory[:120]}")
        if t.actions_taken:
            lines.append(f"   动作: {' → '.join(t.actions_taken[:4])}")
        lines.append("")

    return "\n".join(lines)


def build_tasks_context_for_skills(db: Session, period: str = "week") -> str | None:
    """将已分析任务格式化为 Skill 草稿生成用的文本上下文。"""
    tasks = list(db.execute(
        select(AnalyzedTask)
        .where(AnalyzedTask.period == period)
        .order_by(AnalyzedTask.created_at.desc())
        .limit(20)
    ).scalars())

    if not tasks:
        return None

    lines = ["--- AI 已分析的结构化任务（用于 Skill 挖掘）---"]

    # 按活动类型分组
    by_type: dict[str, list[AnalyzedTask]] = {}
    for t in tasks:
        by_type.setdefault(t.activity_type, []).append(t)

    for atype, group in sorted(by_type.items(), key=lambda x: len(x[1]), reverse=True):
        lines.append(f"\n[{atype}] ({len(group)} 个任务)")
        for t in group[:5]:
            lines.append(f"  - {t.title}")
            if t.problem_description:
                lines.append(f"    问题: {t.problem_description[:100]}")
            if t.solution:
                lines.append(f"    方案: {t.solution[:100]}")
            if t.actions_taken:
                lines.append(f"    步骤: {' → '.join(t.actions_taken[:3])}")

    return "\n".join(lines)
