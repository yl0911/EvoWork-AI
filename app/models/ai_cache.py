from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AICache(Base):
    __tablename__ = "ai_cache"
    __table_args__ = (UniqueConstraint("cache_key", name="uq_ai_cache_key"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"ai_{uuid.uuid4().hex}")
    cache_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    tag: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    input_fingerprint: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

