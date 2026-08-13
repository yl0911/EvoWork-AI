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


# ── Conversation Persistence ──

class ConversationCreate(BaseModel):
    period: str = "week"


class ConversationRead(BaseModel):
    id: str
    title: str
    period: str
    message_count: int = 0
    created_at: str
    updated_at: str


class MessageSave(BaseModel):
    role: str
    content: str


class MessagesSaveRequest(BaseModel):
    messages: list[MessageSave] = Field(default_factory=list)
    title: str | None = None  # auto-update conversation title


class MessageRead(BaseModel):
    id: str
    role: str
    content: str
    order_index: int
    created_at: str
