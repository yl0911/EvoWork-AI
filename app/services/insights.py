"""规则化 Insight 分析引擎。"""

from __future__ import annotations

from collections import Counter, defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import PERIOD_DAYS, period_start
from app.models import Skill, WorkEvent


def summarize_insights(db: Session, period: str = "week") -> dict:
    started_after = period_start(period)
    events = list(
        db.execute(
            select(WorkEvent)
            .where(WorkEvent.started_at >= started_after)
            .order_by(WorkEvent.started_at.desc())
        ).scalars()
    )
    skills_count = db.execute(select(Skill.id)).all()

    total_minutes = sum(event.duration_minutes or 0 for event in events)
    event_type_minutes: dict[str, int] = defaultdict(int)
    source_minutes: dict[str, int] = defaultdict(int)
    project_minutes: dict[str, int] = defaultdict(int)
    outcome_counter: Counter[str] = Counter()
    tag_counter: Counter[str] = Counter()
    daily_minutes: dict[str, int] = defaultdict(int)

    for event in events:
        minutes = event.duration_minutes or 0
        event_type_minutes[event.event_type] += minutes
        source_minutes[event.source] += minutes
        project_minutes[event.project or "未归属项目"] += minutes
        outcome_counter[event.outcome] += 1
        daily_minutes[event.started_at.date().isoformat()] += minutes
        tag_counter.update(event.tags or [])

    repeated_tags = [
        {"tag": tag, "count": count}
        for tag, count in tag_counter.most_common()
        if count >= 2
    ]

    focus_type = None
    if event_type_minutes:
        focus_type = max(event_type_minutes.items(), key=lambda item: item[1])[0]

    insight_notes = []
    if focus_type == "search":
        insight_notes.append("检索时间占比较高，适合补一个问题定义或资料筛选 Skill。")
    if repeated_tags:
        top = repeated_tags[0]
        insight_notes.append(f"{top['tag']} 在近期重复出现 {top['count']} 次，适合沉淀为可复用 Skill。")
    if not insight_notes:
        insight_notes.append("近期事件分布较均衡，可以继续增加事件样本以形成更稳定画像。")

    return {
        "period": period,
        "started_after": started_after.isoformat(),
        "total_events": len(events),
        "total_minutes": total_minutes,
        "skill_count": len(skills_count),
        "event_type_minutes": dict(sorted(event_type_minutes.items(), key=lambda item: item[1], reverse=True)),
        "source_minutes": dict(sorted(source_minutes.items(), key=lambda item: item[1], reverse=True)),
        "project_minutes": dict(sorted(project_minutes.items(), key=lambda item: item[1], reverse=True)),
        "outcomes": dict(outcome_counter),
        "repeated_tags": repeated_tags,
        "daily_minutes": dict(sorted(daily_minutes.items())),
        "insight_notes": insight_notes,
    }
