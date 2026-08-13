"""搜索路由 — 混合搜索（FTS5 + 语义）+ 经验检索 + 重索引 + 热门词。"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.dependencies import get_db_gateway, get_vector_gateway
from app.models import Skill, WorkEvent
from app.services.search import get_search_service

router = APIRouter(tags=["search"])


@router.get("/search")
def hybrid_search(
    q: str = Query(min_length=1, description="搜索关键词"),
    top_k: int = Query(default=20, ge=1, le=50),
    scope: str | None = Query(default=None, description="搜索范围: events / skills / all"),
    source: str | None = Query(default=None, description="来源筛选"),
    event_type: str | None = Query(default=None, description="事件类型筛选"),
    project: str | None = Query(default=None, description="项目筛选"),
    fts_weight: float = Query(default=0.4, ge=0, le=1, description="FTS5 权重"),
    chroma_weight: float = Query(default=0.6, ge=0, le=1, description="Chroma 权重"),
) -> dict:
    """混合搜索：FTS5 关键词 + Chroma 语义，加权融合排名。"""
    svc = get_search_service()
    return svc.hybrid_search(
        q,
        scope=scope or "all",
        top_k=top_k,
        fts_weight=fts_weight,
        chroma_weight=chroma_weight,
        source=source,
        event_type=event_type,
        project=project,
    )


@router.get("/experience")
def search_experience(
    problem: str = Query(min_length=1, description="问题描述"),
    top_k: int = Query(default=10, ge=1, le=20),
) -> dict:
    """搜索类似问题的历史解决经验。"""
    svc = get_search_service()
    return svc.experience_search(problem, top_k=top_k)


@router.post("/search/reindex")
def reindex_all() -> dict:
    """重建全部索引（FTS5 + 向量）。"""
    # FTS5 重索引
    svc = get_search_service()
    fts_result = svc.reindex_all()

    # 向量重索引
    gw = get_vector_gateway()
    vector_result = {"events": 0, "skills": 0}
    if gw.configured:
        db_gw = get_db_gateway()
        with db_gw.get_session_context() as db:
            from sqlalchemy import select
            events = list(db.execute(select(WorkEvent)).scalars())
            skills = list(db.execute(select(Skill)).scalars())
            vector_result = gw.reindex_all(events=events, skills=skills)

    return {
        "status": "ok",
        "fts_events": fts_result.get("events", 0),
        "fts_skills": fts_result.get("skills", 0),
        "vector_events": vector_result.get("events", 0),
        "vector_skills": vector_result.get("skills", 0),
    }


@router.get("/search/hot")
def hot_terms(limit: int = Query(default=20, ge=1, le=50)) -> dict:
    """获取热门搜索词（项目 + 标签）。"""
    svc = get_search_service()
    return svc.hot_terms(limit=limit)
