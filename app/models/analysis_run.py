"""AnalysisRun ORM — 每次 AI 事件分析的运行记录。"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"run_{uuid.uuid4().hex}")

    # ── 周期 ──
    period: Mapped[str] = mapped_column(String(32), default="week", index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    # ── 触发与状态 ──
    trigger_mode: Mapped[str] = mapped_column(String(32), default="manual")  # manual / scheduled_daily / scheduled_interval
    status: Mapped[str] = mapped_column(String(32), default="running")  # running / completed / failed

    # ── 统计 ──
    total_events_seen: Mapped[int] = mapped_column(Integer, default=0)
    noise_events_count: Mapped[int] = mapped_column(Integer, default=0)
    tasks_identified: Mapped[int] = mapped_column(Integer, default=0)

    # ── 错误 ──
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── 元数据 ──
    model: Mapped[str] = mapped_column(String(120), default="")

    # ── 时间 ──
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
