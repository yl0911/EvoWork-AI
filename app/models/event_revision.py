"""EventRevision ORM 模型 — 事件修改记录。"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EventRevision(Base):
    __tablename__ = "event_revisions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"rev_{uuid.uuid4().hex}")
    event_id: Mapped[str] = mapped_column(String(64), index=True)

    # 修改的字段名 → {"old": <旧值>, "new": <新值>}
    changes: Mapped[dict] = mapped_column(JSON, default=dict)

    # 修改摘要（自动生成的简短描述）
    summary: Mapped[str] = mapped_column(Text, default="")

    revised_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
