from __future__ import annotations

from pydantic import BaseModel


class PeriodReviewRequest(BaseModel):
    period: str = "week"
    refresh: bool = False


class SkillDraftRequest(BaseModel):
    period: str = "week"
    tag: str | None = None
    refresh: bool = False
