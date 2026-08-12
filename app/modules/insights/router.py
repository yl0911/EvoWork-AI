"""Insight 分析路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.insights import summarize_insights

router = APIRouter(tags=["insights"])


@router.get("/insights/summary")
def insight_summary(
    db: Session = Depends(get_db),
    period: str = Query(default="week", pattern="^(week|month|year)$"),
) -> dict:
    return summarize_insights(db, period=period)
