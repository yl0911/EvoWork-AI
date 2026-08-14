"""AnalyzedTask ORM — AI 分析后的结构化任务记录。

每条记录代表一个有意义的工作任务，由 AI 从多个原始事件分析产出。
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AnalyzedTask(Base):
    __tablename__ = "analyzed_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"task_{uuid.uuid4().hex}")

    # ── 周期 ──
    period: Mapped[str] = mapped_column(String(32), default="week", index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    # ── 核心结构化字段 ──
    title: Mapped[str] = mapped_column(String(300), index=True)
    problem_description: Mapped[str] = mapped_column(Text, default="")
    actions_taken: Mapped[list[str]] = mapped_column(JSON, default=list)
    solution: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str] = mapped_column(String(32), default="partial")  # resolved / partial / unresolved / abandoned
    result_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_theory: Mapped[str | None] = mapped_column(Text, nullable=True)
    efficiency_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5

    # ── 分类 ──
    activity_type: Mapped[str] = mapped_column(String(64), default="其他", index=True)
    project: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    sources: Mapped[list[str]] = mapped_column(JSON, default=list)  # ["shell", "ide", "browser"]

    # ── 关联 ──
    source_event_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    # ── 元数据 ──
    analysis_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(120), default="")

    # ── 时间 ──
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
