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


_PERIOD_EVENT_LIMITS = {"week": 200, "month": 1000, "year": 5000}


def _load_period_events(db: Session, period: str) -> list[WorkEvent]:
    limit = _PERIOD_EVENT_LIMITS.get(period, 200)
    return list(
        db.execute(
            select(WorkEvent)
            .where(WorkEvent.started_at >= period_start(period))
            .order_by(WorkEvent.started_at.desc())
            .limit(limit)
        ).scalars()
    )


# ── 噪声事件过滤 ──────────────────────────────────────

_NOISE_SHELL_TITLES = frozenset({
    "ls", "cd", "pwd", "clear", "exit", "whoami", "date", "echo",
    "history", "which", "type", "env", "printenv",
})


def _is_noise_event(event: WorkEvent) -> bool:
    """判断事件是否为噪声/操作性事件，复盘时应省略。

    噪声类型:
    - 时长 < 1 分钟且无摘要/内容的短时事件
    - Shell 基础导航命令（ls/cd/pwd 等）
    - 浏览器短暂访问（< 30 秒，非深度阅读）
    - outcome 为 error-exit 且时长极短的操作性错误
    """
    # 基础导航命令
    if event.source == "shell":
        title_lower = (event.title or "").strip().lower().split()[0] if event.title else ""
        if title_lower in _NOISE_SHELL_TITLES:
            return True
        # 极短 shell 命令且以错误退出
        if (event.duration_minutes or 0) < 1 and event.outcome in ("error-exit", "error"):
            return True

    # 浏览器短暂访问
    if event.source in ("browser", "activitywatch"):
        if (event.duration_minutes or 0) < 1 and not event.ai_summary:
            return True

    # 无内容的极短事件（排除有 AI 摘要的）
    if (event.duration_minutes or 0) == 0 and not event.ai_summary and not event.content:
        return True

    return False


def _filter_meaningful_events(events: list[WorkEvent]) -> list[WorkEvent]:
    """过滤噪声事件，只保留有意义的、值得复盘的事件。"""
    return [e for e in events if not _is_noise_event(e)]


# ── Shell 工作流分组 ──────────────────────────────────

_SHELL_WORKFLOW_GAP_MINUTES = 5  # 5 分钟内同一项目的命令视为同一工作流


def _group_shell_workflows(events: list[WorkEvent]) -> list[dict]:
    """将 shell 事件按时间窗口+项目分组为工作流会话。

    返回: [{"project": str, "commands": [str], "time_range": str, "outcome_summary": str}]
    """
    shell_events = sorted(
        [e for e in events if e.source == "shell"],
        key=lambda e: e.started_at,
    )
    if not shell_events:
        return []

    workflows: list[dict] = []
    current_group: list[WorkEvent] = [shell_events[0]]

    for event in shell_events[1:]:
        prev = current_group[-1]
        gap = (event.started_at - prev.started_at).total_seconds() / 60
        same_project = (event.project or "") == (prev.project or "")

        if gap <= _SHELL_WORKFLOW_GAP_MINUTES and same_project:
            current_group.append(event)
        else:
            # 提交当前组
            workflows.append(_build_workflow(current_group))
            current_group = [event]

    # 提交最后一组
    workflows.append(_build_workflow(current_group))

    # 过滤掉只有 1 条命令的组（不算工作流）
    return [w for w in workflows if len(w["commands"]) >= 2]


def _build_workflow(group: list[WorkEvent]) -> dict:
    project = group[0].project or "未归属"
    commands = []
    for e in group:
        cmd = (e.collector_metadata or {}).get("command", e.title)
        exit_code = (e.collector_metadata or {}).get("exit_code", 0)
        status = "✗" if exit_code and exit_code != 0 else "✓"
        commands.append(f"[{status}] {cmd}")

    start = group[0].started_at.strftime("%H:%M")
    end = group[-1].started_at.strftime("%H:%M")
    time_range = f"{start}~{end}" if start != end else start

    failed_count = sum(1 for e in group if e.outcome in ("failed", "error-exit", "error"))
    outcome = f"{failed_count}/{len(group)} 失败" if failed_count > 0 else f"{len(group)} 条全部成功"

    return {
        "project": project,
        "commands": commands,
        "time_range": time_range,
        "outcome_summary": outcome,
    }


def _format_shell_workflows(workflows: list[dict]) -> str:
    if not workflows:
        return "无 shell 工作流数据。"
    lines = []
    for i, w in enumerate(workflows, 1):
        lines.append(f"工作流 {i} [{w['project']}] ({w['time_range']}, {w['outcome_summary']}):")
        for cmd in w["commands"]:
            lines.append(f"  {cmd}")
    return "\n".join(lines)


# ── 跨源活动会话分组 ──────────────────────────────────

_SESSION_GAP_MINUTES = 15  # 15 分钟无活动视为新会话


def _build_activity_sessions(events: list[WorkEvent]) -> list[dict]:
    """将多源事件按时间窗口+项目边界分组为工作会话，并分类为问题类/学习类/编码类等。

    每个会话代表用户完成的"一件事"，可能跨越 shell/browser/IDE/AW 多个来源。
    会话在以下任一条件下切分：
    - 距上一事件超过 15 分钟
    - 事件所属项目发生变化
    """
    if not events:
        return []

    sorted_events = sorted(events, key=lambda e: e.started_at)
    sessions: list[list[WorkEvent]] = []
    current: list[WorkEvent] = [sorted_events[0]]
    current_project = sorted_events[0].project or "未归属"

    for event in sorted_events[1:]:
        prev = current[-1]
        gap = (event.started_at - prev.started_at).total_seconds() / 60
        event_project = event.project or "未归属"

        # 切分会话：时间间隔超 15 分钟 或 项目切换
        if gap > _SESSION_GAP_MINUTES or event_project != current_project:
            sessions.append(current)
            current = [event]
            current_project = event_project
        else:
            current.append(event)
    sessions.append(current)

    # 构建每个会话的摘要
    result = []
    for group in sessions:
        session = _classify_session(group)
        result.append(session)

    # 按时间排序，最新的在前
    result.sort(key=lambda s: s["start"], reverse=True)
    return result


def _classify_session(group: list[WorkEvent]) -> dict:
    """根据事件组成对会话进行分类和摘要。"""
    sources: dict[str, int] = {}
    event_types: dict[str, int] = {}
    tags_set: set[str] = set()
    total_minutes = 0
    failed_count = 0

    for e in group:
        sources[e.source] = sources.get(e.source, 0) + 1
        event_types[e.event_type] = event_types.get(e.event_type, 0) + 1
        total_minutes += e.duration_minutes or 0
        if e.outcome in ("failed", "error-exit", "error", "unresolved"):
            failed_count += 1
        for t in (e.tags or []):
            tags_set.add(t)

    # 会话分类
    activity_type = _infer_activity_type(sources, event_types, tags_set)

    # 项目（取最多事件的项目）
    projects: dict[str, int] = {}
    for e in group:
        p = e.project or "未归属"
        projects[p] = projects.get(p, 0) + 1
    project = max(projects.items(), key=lambda x: x[1])[0] if projects else "未归属"

    # 时间范围
    start = group[0].started_at
    end = group[-1].started_at
    duration_min = max((end - start).total_seconds() / 60, 0)

    # 关键动作（取最重要的 4 个事件标题）
    key_actions = []
    for e in group[:4]:
        title = e.title or ""
        if e.source == "shell":
            cmd = (e.collector_metadata or {}).get("command", title)
            key_actions.append(f"[{e.source}] {cmd[:60]}")
        else:
            key_actions.append(f"[{e.source}] {title[:60]}")

    # 来源摘要
    source_summary = ", ".join(f"{s}({c})" for s, c in sorted(sources.items(), key=lambda x: x[1], reverse=True))

    # 结果摘要
    if failed_count > 0:
        outcome = f"{len(group)} 个动作, {failed_count} 个失败"
    else:
        outcome = f"{len(group)} 个动作, 全部正常"

    return {
        "type": activity_type,
        "project": project,
        "start": start.strftime("%m-%d %H:%M"),
        "end": end.strftime("%H:%M") if start.date() == end.date() else end.strftime("%m-%d %H:%M"),
        "duration_min": round(duration_min),
        "total_minutes": total_minutes,
        "sources": source_summary,
        "outcome": outcome,
        "key_actions": key_actions,
        "event_count": len(group),
    }


def _infer_activity_type(sources: dict[str, int], event_types: dict[str, int], tags: set[str]) -> str:
    """根据事件组成推断会话的活动类型。"""
    has_debug = event_types.get("debug", 0) > 0 or event_types.get("error", 0) > 0 or "error-exit" in tags
    has_search = event_types.get("search", 0) > 0 or "research" in tags or "docs-lookup" in tags
    has_browser = sources.get("browser", 0) > 0 or sources.get("activitywatch", 0) > 0
    has_shell = sources.get("shell", 0) > 0
    has_ide = sources.get("ide", 0) > 0
    has_coding = event_types.get("coding", 0) > 0
    has_writing = event_types.get("writing", 0) > 0 or event_types.get("note", 0) > 0
    has_ops = "ops" in tags or event_types.get("ops", 0) > 0 or any(t in tags for t in ("container", "remote", "process"))

    # 优先级：调试 > 运维 > 学习 > 编码 > 写作 > 浏览
    if has_debug and has_search:
        return "问题排查"
    if has_debug:
        return "调试修复"
    if has_ops and has_shell:
        return "部署运维"
    if has_search and has_browser:
        return "学习调研"
    if has_browser and not has_ide and not has_shell:
        return "浏览阅读"
    if has_coding or has_ide:
        return "编码开发"
    if has_writing:
        return "文档写作"
    if has_shell:
        return "命令行操作"
    return "其他"


def _format_activity_sessions(sessions: list[dict]) -> str:
    if not sessions:
        return "无活动会话数据。"
    lines = []
    # 按类型分组统计
    type_counts: dict[str, int] = {}
    type_minutes: dict[str, int] = {}
    for s in sessions:
        type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1
        type_minutes[s["type"]] = type_minutes.get(s["type"], 0) + s["total_minutes"]

    lines.append("会话类型分布:")
    for t, count in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
        mins = type_minutes[t]
        lines.append(f"  {t}: {count} 次会话, 共 {mins} 分钟")

    lines.append("")
    lines.append("会话明细（最近 12 个）:")
    for i, s in enumerate(sessions[:12], 1):
        lines.append(f"{i}. [{s['type']}] {s['project']} | {s['start']}~{s['end']} ({s['duration_min']}min)")
        lines.append(f"   来源: {s['sources']} | {s['outcome']}")
        for action in s["key_actions"][:3]:
            lines.append(f"   · {action}")
    return "\n".join(lines)


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

    # ── 跨源活动会话分组 ──
    activity_sessions = _build_activity_sessions(events)
    session_section = ""
    if activity_sessions:
        session_section = "--- 工作会话（跨源事件分组，每个会话代表一件完整的事）---\n" + _format_activity_sessions(activity_sessions)

    sections = [
        f"统计信息:\n{insights}",
    ]
    if skills_context:
        sections.append(skills_context)
    if analytics_context:
        sections.append(analytics_context)
    if session_section:
        sections.append(session_section)

    # ── 优先使用已分析的结构化任务 ──
    try:
        from app.services.event_analysis import build_tasks_context_for_review
        tasks_text = build_tasks_context_for_review(db, period)
        if tasks_text:
            sections.append(tasks_text)
    except Exception:
        pass

    sections.append(f"事件列表:\n{_format_events(events)}")

    return "\n\n".join(sections)


def generate_period_review(db: Session, period: str = "week", refresh: bool = False) -> dict:
    all_events = _load_period_events(db, period)
    events = _filter_meaningful_events(all_events)
    noise_count = len(all_events) - len(events)
    insights = summarize_insights(db, period=period)
    gateway = get_llm_gateway()

    # ── 上一周期对比 ──
    prev_period = {"week": "month", "month": "year", "year": "year"}.get(period, "year")
    prev_insights = summarize_insights(db, period=prev_period)
    comparison_lines = []
    if prev_insights:
        cur_events = insights.get("total_events", 0)
        prev_events = prev_insights.get("total_events", 0)
        cur_minutes = insights.get("total_minutes", 0)
        prev_minutes = prev_insights.get("total_minutes", 0)
        cur_skills = insights.get("skill_count", 0)
        prev_skills = prev_insights.get("skill_count", 0)

        def _delta(cur, prev):
            if prev == 0:
                return "新增" if cur > 0 else "持平"
            pct = round((cur - prev) / prev * 100)
            return f"+{pct}%" if pct >= 0 else f"{pct}%"

        comparison_lines.append(f"事件数: {cur_events} (vs 上周期 {prev_events}, {_delta(cur_events, prev_events)})")
        comparison_lines.append(f"总时长: {cur_minutes}min (vs 上周期 {prev_minutes}min, {_delta(cur_minutes, prev_minutes)})")
        comparison_lines.append(f"Skill 数: {cur_skills} (vs 上周期 {prev_skills}, {_delta(cur_skills, prev_skills)})")

    comparison_context = ""
    if comparison_lines:
        comparison_context = "--- 环比数据（当前 vs 上一周期）---\n" + "\n".join(comparison_lines)

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

    # ── 跨源活动会话分组 ──
    activity_sessions = _build_activity_sessions(events)
    session_context = "--- 工作会话（跨源事件按时间窗口分组，每个会话代表一件完整的事）---\n" + _format_activity_sessions(activity_sessions) if activity_sessions else ""

    # ── 优先使用已分析的结构化任务 ──
    analyzed_context = ""
    try:
        from app.services.event_analysis import build_tasks_context_for_review
        tasks_text = build_tasks_context_for_review(db, period)
        if tasks_text:
            analyzed_context = tasks_text
    except Exception:
        pass  # 分析任务不可用时回退到原始事件

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

    noise_note = f"（已过滤 {noise_count} 条噪声事件：导航命令、短暂访问、操作性错误等，无需分析这些。）" if noise_count > 0 else ""

    # 如果有结构化分析任务，优先使用它们作为核心数据源
    analyzed_section = ""
    if analyzed_context:
        analyzed_section = f"\n{analyzed_context}\n"

    prompt = f"""请基于下面的工作会话、统计信息、环比对比和量化分析数据，生成一个个人复盘。

核心分析原则：不要从单条事件或命令的角度分析，而是从"用户在做一件事"的角度分析。
每个工作会话代表用户完成的一件完整的事（如：调试一个问题、开发一个功能、学习一个技术点），可能跨越 shell、浏览器、IDE 等多个来源。
请从问题类、学习类、编码类、运维类等各类型会话出发，分析效率和模式。

{noise_note}

统计信息:
{insights}

{comparison_context}

{analytics_context}

{analyzed_section}
{session_context}

事件列表（已过滤噪声，仅保留有意义的事件）:
{_format_events(events)}

输出格式:
1. 本周期核心工作/学习概览（聚焦最重要的 2-3 件事，说明每件事涉及了哪些类型的工作）
2. 趋势变化（对比上一周期的环比数据，指出哪些方面在进步、哪些在退步，给出可能的原因）
3. 活动类型分析（从会话分类出发：
   - 问题排查/调试修复类会话：占多少比例？通常多长时间能解决？是否有反复出现的同类问题？
   - 编码开发类会话：效率如何？是否经常被打断？一个功能从编码到发布通常经过哪些步骤？
   - 学习调研类会话：学了什么？是为了解决当前问题还是知识储备？学习后是否有落地应用？
   - 部署运维类会话：频率如何？是否有可自动化的重复运维操作？
   不要列出每个会话，而是提炼各类型的整体模式和效率。
   对于发现的问题，用引用块给出解法或知识点。）
4. 重复模式识别（跨会话发现反复出现的模式：同一类问题反复排查、同一类工作流反复手动执行、反复在某个环节卡住。
   每个模式后面用引用块给出解法或知识点。）
5. 已改善的点（从数据变化中识别出用户已经做出的优化，如新增 Skill、减少重复操作、缩短问题解决时间等）
6. 可优化的点（识别当前流程中仍存在的低效环节。
   每个可优化点后面必须跟一个引用块，给出具体的解法或相关知识点。）
7. 下一步 3 个行动（聚焦解决重复问题和核心卡点）

关于引用块格式（非常重要，必须严格遵守）:
- 当发现一个问题或低效环节时，紧跟其后用 Markdown 引用块（> 开头）给出具体解法或相关知识理论。
- 解法格式：`> **解法**：具体的解决方案、工具推荐、实施步骤`
- 知识点格式：`> **知识点**：理论/概念名称 — 用一句话说明它如何解决当前问题`
- 每个问题/低效点至少给出一个引用块（解法或知识点，或两者都给）。
- 引用块要具体、可执行，不要泛泛而谈。比如不要说"建议学习设计模式"，而要说"知识点：策略模式（Strategy Pattern）— 将不同的数据归因规则封装为独立策略类，新增数据源时只需添加新策略，不修改现有代码"。

要求:
- 不要使用监控、考核、排名语气。
- 从"事"的角度分析，不要逐条事件或命令分析。多条事件可能只是同一件事的不同动作。
- 如果某类问题只出现一次且不重要，可以省略。
- 优先分析反复出现的问题和可沉淀的方法论。
- 优先指出能帮助用户自主学习和突破问题的建议。
- 如果某个判断只是推测，请标注"推测"。
- 结合工作节奏数据给出时间管理建议（如高峰时段适合深度工作）。
- 使用 Markdown 输出，但不要使用横线分隔。
- 每个小节控制在 2-4 个短段或列表项，避免整段过长。
- 列表项优先使用短句，适合仪表盘阅读。
- 引用块是最重要的输出，它们帮助用户打破认知盲区和补充知识盲点。"""

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
    all_events = _load_period_events(db, period)
    events = _filter_meaningful_events(all_events)

    # 按项目/主题分组，识别核心问题域
    project_groups: dict[str, list[WorkEvent]] = {}
    for event in events:
        key = event.project or "未归属"
        project_groups.setdefault(key, []).append(event)

    # 按 event_type 分组，识别高频操作模式
    type_groups: dict[str, list[WorkEvent]] = {}
    for event in events:
        type_groups.setdefault(event.event_type, []).append(event)

    # 按 tag 聚合，找到高频标签
    tag_counts: dict[str, int] = {}
    for event in events:
        for item in event.tags or []:
            tag_counts[item] = tag_counts.get(item, 0) + 1
    top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:8]

    # 如果指定了 tag，仍然过滤（用户主动选择）
    if tag:
        events = [e for e in events if tag in (e.tags or [])]

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

    # 构建分组上下文
    group_context_lines = []
    if project_groups:
        group_context_lines.append("按项目分组:")
        for proj, group in sorted(project_groups.items(), key=lambda x: len(x[1]), reverse=True)[:5]:
            types_in_group = {}
            for e in group:
                types_in_group[e.event_type] = types_in_group.get(e.event_type, 0) + 1
            type_summary = ", ".join(f"{t}({c})" for t, c in sorted(types_in_group.items(), key=lambda x: x[1], reverse=True)[:4])
            group_context_lines.append(f"  - {proj}: {len(group)} 事件 [{type_summary}]")

    if top_tags:
        group_context_lines.append(f"高频标签: {', '.join(f'{t}({c})' for t, c in top_tags)}")

    # 识别反复出现的问题模式
    problem_events = [e for e in events if e.event_type in ("debug", "error", "search") or e.outcome in ("unresolved", "partial")]
    if problem_events:
        group_context_lines.append(f"问题/调试事件: {len(problem_events)} 条")
        problem_titles = [f"  - {e.title} ({e.source}, {e.duration_minutes}min)" for e in problem_events[:6]]
        group_context_lines.extend(problem_titles)

    group_context = "\n".join(group_context_lines) if group_context_lines else ""

    # ── 优先使用已分析的结构化任务 ──
    analyzed_skill_context = ""
    try:
        from app.services.event_analysis import build_tasks_context_for_skills
        tasks_text = build_tasks_context_for_skills(db, period)
        if tasks_text:
            analyzed_skill_context = f"\n{tasks_text}\n"
    except Exception:
        pass

    prompt = f"""请基于下面的事件数据，生成 2-3 个 Skill 草稿。

核心原则：不是为单个事件生成 Skill，而是从多个事件中发现核心问题，整合出处理该类问题的方法论。
每个 Skill 应针对一个反复出现的核心问题或高频工作流，整合相关的处理方式和方法。

{f'目标主题: {tag}' if tag else ''}

--- 事件分组分析 ---
{group_context}

{analyzed_skill_context}
--- 事件列表（已过滤噪声，{len(events)} 条有意义事件）---
{_format_events(events)}

输出格式（每个 Skill 重复此格式，用 ## Skill N: 名称 分隔）:

## Skill 1: [名称]

**针对问题**: 一句话说明这个 Skill 解决什么核心问题
**Skill 类型**: 思路型 / 可复用型 / 开源区候选
**触发条件**: 什么情况下应该使用这个 Skill
**适用场景**: 具体在哪些项目中、哪些工作流程中适用
**方法论步骤**:
1. ...（整合多个事件中的处理经验，形成系统化步骤）
2. ...
**需要输入**: 使用时需要提供什么
**输出产物**: 使用后产出什么
**成功判断**: 怎么判断 Skill 执行成功
**失败回退**: 如果某步失败，如何回退
**可由 Agent 辅助的部分**: 哪些步骤可以交给 AI Agent 自动执行

要求:
- 生成 2-3 个 Skill，每个针对不同的核心问题域（不要重复覆盖同一问题）。
- 优先选择反复出现的问题和高频操作模式来生成 Skill。
- 步骤要整合多个事件中的经验，不是只基于单条事件。
- 如果事件不足以支撑某个 Skill，可以标注"待补充"但不编造。
- Skill 是为个人学习和工作辅助服务，不是管理评价。
- 步骤要具体、可复用、可执行。
- 使用 Markdown 输出。"""

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
