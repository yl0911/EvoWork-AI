"""Skill 推荐引擎 — 基于事件模式匹配的 Skill 推荐。

分析近期工作事件，识别模式和痛点，
推荐最相关的 Skill 来提升效率。
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

logger = logging.getLogger(__name__)


class SkillEngine:
    """Skill 推荐与关联分析引擎。"""

    def _get_db_session(self):
        from app.core.dependencies import get_db_gateway
        return get_db_gateway().get_session_context()

    # ── 推荐 ────────────────────────────────────────

    def recommend(self, limit: int = 10) -> list[dict]:
        """基于近期事件模式推荐 Skill。

        策略：
        1. 分析近期事件中的高频 event_type / project / tags
        2. 用 Chroma 语义搜索匹配 Skill
        3. 排除已有链接的系统 Skill
        4. 按相关度 + 使用效果排序
        """
        from app.models import Skill, WorkEvent

        recommendations: list[dict] = []

        try:
            with self._get_db_session() as db:
                # 加载近期事件（30天）
                cutoff = datetime.now(timezone.utc) - timedelta(days=30)
                events = list(db.execute(
                    select(WorkEvent).where(WorkEvent.started_at >= cutoff)
                ).scalars())

                if not events:
                    return []

                # 统计模式
                type_counts: Counter = Counter()
                project_counts: Counter = Counter()
                tag_counts: Counter = Counter()
                outcome_counts: Counter = Counter()

                for e in events:
                    type_counts[e.event_type] += 1
                    if e.project:
                        project_counts[e.project] += 1
                    if e.tags:
                        for t in (e.tags if isinstance(e.tags, list) else []):
                            tag_counts[t] += 1
                    outcome_counts[e.outcome] += 1

                # 已链接的 skill ID 集合
                linked_ids = {
                    e.linked_skill_id for e in events if e.linked_skill_id
                }

                # 加载非系统 Skill
                all_skills = list(db.execute(
                    select(Skill).where(Skill.system_skill == False)  # noqa: E712
                ).scalars())

                if not all_skills:
                    return []

                # Chroma 语义匹配
                from app.core.dependencies import get_vector_gateway
                gw = get_vector_gateway()

                for skill in all_skills:
                    if skill.id in linked_ids:
                        continue

                    score = 0.0
                    reasons: list[str] = []

                    # 触发词匹配：检查 skill.trigger 是否出现在高频事件类型中
                    if skill.trigger:
                        trigger_lower = skill.trigger.lower()
                        for etype, count in type_counts.most_common(10):
                            if etype in trigger_lower or trigger_lower in etype:
                                score += count * 0.15
                                reasons.append(f"matches '{etype}' events ({count}x)")

                    # 标签匹配：skill name 中的关键词与高频标签匹配
                    skill_name_lower = skill.name.lower()
                    for tag, count in tag_counts.most_common(15):
                        if tag.lower() in skill_name_lower:
                            score += count * 0.1
                            reasons.append(f"tag '{tag}' ({count}x)")

                    # 项目匹配
                    for proj, count in project_counts.most_common(5):
                        if proj.lower() in skill_name_lower:
                            score += count * 0.08
                            reasons.append(f"project '{proj}' ({count}x)")

                    # Chroma 语义搜索加分
                    if gw.configured:
                        try:
                            query_text = " ".join(
                                [t for t, _ in type_counts.most_common(3)]
                                + [t for t, _ in tag_counts.most_common(3)]
                            )
                            results = gw.search_skills(query_text, top_k=5)
                            for r in results:
                                if r["id"] == skill.id:
                                    distance = r.get("distance", 1.0)
                                    sim = max(0, 1 - distance / 2)
                                    score += sim * 0.3
                                    if sim > 0.3:
                                        reasons.append("semantic match")
                                    break
                        except Exception:
                            pass

                    # 使用效果加分
                    if skill.usage_count > 0 and skill.avg_effectiveness > 0:
                        score += skill.avg_effectiveness * 0.15
                        reasons.append(f"effectiveness {skill.avg_effectiveness:.0%}")

                    if score > 0.05:
                        recommendations.append({
                            "skill_id": skill.id,
                            "skill_name": skill.name,
                            "category": skill.category,
                            "score": round(score, 3),
                            "reasons": reasons[:3],
                            "usage_count": skill.usage_count,
                            "avg_effectiveness": skill.avg_effectiveness,
                            "trigger": skill.trigger,
                        })

            # 排序取 top N
            recommendations.sort(key=lambda r: r["score"], reverse=True)
            return recommendations[:limit]

        except Exception as exc:
            logger.warning("Skill recommendation failed: %s", exc)
            return []

    # ── 关联事件查询 ────────────────────────────────

    def linked_events(self, skill_id: str, limit: int = 50) -> dict:
        """查询与 Skill 关联的事件及统计。"""
        from app.models import WorkEvent

        try:
            with self._get_db_session() as db:
                events = list(db.execute(
                    select(WorkEvent)
                    .where(WorkEvent.linked_skill_id == skill_id)
                    .order_by(WorkEvent.started_at.desc())
                    .limit(limit)
                ).scalars())

                if not events:
                    return {"events": [], "stats": {"total": 0}}

                # 统计
                type_counts: Counter = Counter()
                outcome_counts: Counter = Counter()
                project_counts: Counter = Counter()
                total_minutes = 0

                for e in events:
                    type_counts[e.event_type] += 1
                    outcome_counts[e.outcome] += 1
                    if e.project:
                        project_counts[e.project] += 1
                    total_minutes += e.duration_minutes or 0

                return {
                    "events": [
                        {
                            "id": e.id,
                            "title": e.title,
                            "event_type": e.event_type,
                            "source": e.source,
                            "project": e.project,
                            "outcome": e.outcome,
                            "duration_minutes": e.duration_minutes,
                            "started_at": e.started_at.isoformat() if e.started_at else None,
                        }
                        for e in events
                    ],
                    "stats": {
                        "total": len(events),
                        "total_minutes": total_minutes,
                        "by_type": dict(type_counts.most_common(10)),
                        "by_outcome": dict(outcome_counts),
                        "by_project": dict(project_counts.most_common(5)),
                    },
                }

        except Exception as exc:
            logger.warning("Linked events query failed: %s", exc)
            return {"events": [], "stats": {"total": 0}}

    # ── 批量回填 linked_skill_id ────────────────────

    def backfill_links(self) -> dict:
        """为历史事件回填 linked_skill_id（基于 source → system skill 映射）。"""
        from app.models import WorkEvent
        from app.services.collector_guard import SOURCE_SKILL_MAP

        updated = 0
        try:
            with self._get_db_session() as db:
                events = list(db.execute(
                    select(WorkEvent).where(WorkEvent.linked_skill_id.is_(None))
                ).scalars())

                for e in events:
                    skill_id = SOURCE_SKILL_MAP.get(e.source)
                    if skill_id:
                        e.linked_skill_id = skill_id
                        updated += 1

                if updated > 0:
                    db.commit()

        except Exception as exc:
            logger.warning("Backfill failed: %s", exc)

        return {"updated": updated}


from functools import lru_cache  # noqa: E402


@lru_cache
def get_skill_engine() -> SkillEngine:
    return SkillEngine()
