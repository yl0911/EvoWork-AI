from __future__ import annotations

from pydantic import BaseModel, Field


class PeriodReviewRequest(BaseModel):
    period: str = "week"
    refresh: bool = False


class SkillDraftRequest(BaseModel):
    period: str = "week"
    tag: str | None = None
    refresh: bool = False


class ChatMessage(BaseModel):
    role: str = Field(description="system | user | assistant")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    period: str = "week"
