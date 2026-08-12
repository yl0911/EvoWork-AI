"""EventEmbedding ORM 模型 — 事件向量索引记录。

用于 Chroma 向量检索（Phase 3 接入），记录哪些事件已被索引。
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EventEmbedding(Base):
    __tablename__ = "event_embeddings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"emb_{uuid.uuid4().hex}")
    event_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
