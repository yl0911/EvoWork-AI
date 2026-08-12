"""语义搜索路由 — 向量搜索 + 经验检索 + 重索引。"""

from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.dependencies import get_db_gateway, get_vector_gateway
from app.models import Skill, WorkEvent

router = APIRouter(tags=["search"])


@router.get("/search")
def semantic_search(
    q: str = Query(min_length=1, description="搜索关键词"),
    top_k: int = Query(default=5, ge=1, le=20),
    scope: str | None = Query(default=None, description="搜索范围: events / skills / all"),
) -> dict:
    """跨事件和 Skill 的语义搜索。"""
    gw = get_vector_gateway()
    if not gw.configured:
        return {"status": "not_configured", "results": []}

    results = []
    if scope in (None, "all", "events"):
        event_results = gw.search_events(q, top_k=top_k)
        for r in event_results:
            r["result_type"] = "event"
        results.extend(event_results)

    if scope in (None, "all", "skills"):
        skill_results = gw.search_skills(q, top_k=top_k)
        for r in skill_results:
            r["result_type"] = "skill"
        results.extend(skill_results)

    # 按距离排序
    results.sort(key=lambda r: r.get("distance", 1.0))
    return {
        "query": q,
        "total": len(results),
        "results": results[:top_k],
    }


@router.get("/experience")
def search_experience(
    problem: str = Query(min_length=1, description="问题描述"),
    top_k: int = Query(default=5, ge=1, le=20),
) -> dict:
    """搜索类似问题的历史解决经验。"""
    gw = get_vector_gateway()
    if not gw.configured:
        return {"status": "not_configured", "results": []}

    results = gw.search_experience(problem, top_k=top_k)
    return {
        "query": problem,
        "total": len(results),
        "results": results,
    }


@router.post("/search/reindex")
def reindex_all() -> dict:
    """重建全部向量索引（从 SQLite 重新加载所有事件和 Skill）。"""
    gw = get_vector_gateway()
    if not gw.configured:
        return {"status": "not_configured"}

    db_gw = get_db_gateway()
    with db_gw.get_session_context() as db:
        events = list(db.execute(select(WorkEvent)).scalars())
        skills = list(db.execute(select(Skill)).scalars())
        result = gw.reindex_all(events=events, skills=skills)

    return {
        "status": "ok",
        "events_indexed": result.get("events", 0),
        "skills_indexed": result.get("skills", 0),
    }
