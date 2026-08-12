"""AI 分析路由（复盘 + Skill 草稿）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.gateways.base import LLMGatewayError
from app.schemas.ai import PeriodReviewRequest, SkillDraftRequest
from app.services.ai_analysis import generate_period_review, generate_skill_draft

router = APIRouter(tags=["ai"])


@router.post("/ai/period-review")
def ai_period_review(payload: PeriodReviewRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return generate_period_review(db, period=payload.period, refresh=payload.refresh)
    except LLMGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/ai/skill-draft")
def ai_skill_draft(payload: SkillDraftRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return generate_skill_draft(db, period=payload.period, tag=payload.tag, refresh=payload.refresh)
    except LLMGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
