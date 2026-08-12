"""向量索引服务 — 事件和 Skill 的自动索引。"""

from __future__ import annotations

from app.core.dependencies import get_vector_gateway
from app.models.skill import Skill
from app.models.work_event import WorkEvent


def index_event(event: WorkEvent) -> None:
    """将事件索引到向量库。"""
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
    """将 Skill 索引到向量库。"""
    gw = get_vector_gateway()
    if not gw.configured:
        return
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
    gw.index_skill(skill.id, content, {
        "category": skill.category,
        "name": skill.name,
        "source": skill.source,
        "tags": [],
    })


def delete_event_index(event_id: str) -> None:
    """从向量库删除事件索引。"""
    gw = get_vector_gateway()
    if gw.configured:
        gw.delete(event_id)


def delete_skill_index(skill_id: str) -> None:
    """从向量库删除 Skill 索引。"""
    gw = get_vector_gateway()
    if gw.configured:
        gw.delete(skill_id)


def reindex_all(events: list[WorkEvent], skills: list[Skill]) -> dict:
    """重建全部索引。"""
    gw = get_vector_gateway()
    if not gw.configured:
        return {"events": 0, "skills": 0, "status": "not_configured"}
    result = gw.reindex_all(events=events, skills=skills)
    result["status"] = "ok"
    return result
