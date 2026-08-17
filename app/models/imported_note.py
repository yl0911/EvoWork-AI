"""ImportedNote ORM — 笔记导入追踪记录。"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ImportedNote(Base):
    __tablename__ = "imported_notes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"note_{uuid.uuid4().hex}")

    # ── 文件信息 ──
    original_filename: Mapped[str] = mapped_column(String(512), default="")
    file_hash: Mapped[str] = mapped_column(String(128), default="", index=True)  # SHA-256
    file_type: Mapped[str] = mapped_column(String(32), default="")  # ".md", ".pdf", etc.
    file_size: Mapped[int] = mapped_column(Integer, default=0)

    # ── 路径 ──
    inbox_path: Mapped[str] = mapped_column(String(1024), default="")
    archive_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # ── 状态 ──
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)  # pending / processing / completed / failed / superseded

    # ── 处理结果 ──
    events_created: Mapped[int] = mapped_column(Integer, default=0)
    event_ids: Mapped[str] = mapped_column(Text, default="[]")  # JSON string of list
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── 触发与分组 ──
    trigger_mode: Mapped[str] = mapped_column(String(32), default="manual_scan")  # manual_scan / manual_upload / scheduled
    week_key: Mapped[str] = mapped_column(String(16), default="", index=True)  # "2026-W33"

    # ── 元数据 ──
    model: Mapped[str] = mapped_column(String(120), default="")

    # ── 时间 ──
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
