"""索引服务 — 事件和 Skill 的 FTS5 + 向量自动索引。"""

from __future__ import annotations

from app.core.dependencies import get_vector_gateway
from app.models.skill import Skill
from app.models.work_event import WorkEvent
from app.services.search import get_search_service


def index_event(event: WorkEvent) -> None:
    """将事件索引到 FTS5 + 向量库。"""
    # FTS5 索引
    svc = get_search_service()
    if svc.ready:
        svc.index_event(
            event.id, event.title, event.content or "",
            event.tags or [], event.project or "",
        )

    # 向量索引
    gw = get_vector_gateway()
    if not gw.configured:
        return
    content = event.content or event.title
    gw.index_event(event.id, content, {
        "event_layer": event.event_layer,
        "event_type": event.event_type,
        "source": event.source,
        "project": event.project or "",
        "title": event.title,
        "tags": event.tags or [],
        "outcome": event.outcome,
        "privacy_level": event.privacy_level,
    })


def index_skill(skill: Skill) -> None:
    """将 Skill 索引到 FTS5 + 向量库。"""
    parts = [skill.name]
    if skill.trigger:
        parts.append(skill.trigger)
    if skill.content:
        parts.append(skill.content)
    if skill.steps:
        parts.extend(skill.steps)
    if skill.methods:
        parts.extend(skill.methods)
    content = "\n".join(parts)

    # FTS5 索引
    svc = get_search_service()
    if svc.ready:
        svc.index_skill(skill.id, skill.name, content, skill.trigger or "", skill.category)

    # 向量索引
    gw = get_vector_gateway()
    if not gw.configured:
        return
    gw.index_skill(skill.id, content, {
        "category": skill.category,
        "name": skill.name,
        "source": skill.source,
        "tags": [],
    })


def delete_event_index(event_id: str) -> None:
    """从 FTS5 + 向量库删除事件索引。"""
    svc = get_search_service()
    if svc.ready:
        svc.delete_event(event_id)
    gw = get_vector_gateway()
    if gw.configured:
        gw.delete(event_id)


def delete_skill_index(skill_id: str) -> None:
    """从 FTS5 + 向量库删除 Skill 索引。"""
    svc = get_search_service()
    if svc.ready:
        svc.delete_skill(skill_id)
    gw = get_vector_gateway()
    if gw.configured:
        gw.delete(skill_id)


def reindex_all(events: list[WorkEvent], skills: list[Skill]) -> dict:
    """重建全部索引（FTS5 + 向量）。"""
    result = {"events": 0, "skills": 0, "status": "ok"}

    # FTS5 重索引
    svc = get_search_service()
    if svc.ready:
        fts = svc.reindex_all()
        result["fts_events"] = fts.get("events", 0)
        result["fts_skills"] = fts.get("skills", 0)

    # 向量重索引
    gw = get_vector_gateway()
    if gw.configured:
        vec = gw.reindex_all(events=events, skills=skills)
        result["events"] = vec.get("events", 0)
        result["skills"] = vec.get("skills", 0)
    else:
        result["status"] = "vector_not_configured"

    return result
