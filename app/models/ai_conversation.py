from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AIConversation(Base):
    """AI 对话会话。"""
    __tablename__ = "ai_conversations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"conv_{uuid.uuid4().hex}")
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New Conversation")
    period: Mapped[str] = mapped_column(String(32), nullable=False, default="week")
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class AIMessage(Base):
    """AI 对话消息。"""
    __tablename__ = "ai_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"msg_{uuid.uuid4().hex}")
    conversation_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
