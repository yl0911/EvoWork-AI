"""SkillUsageLog ORM 模型 — Skill 使用记录。

追踪 Skill 的使用效果，用于：
- 计算 avg_effectiveness
- 验证"重复问题耗时下降"等效果指标
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


USAGE_OUTCOMES = ("effective", "ineffective", "partial")


class SkillUsageLog(Base):
    __tablename__ = "skill_usage_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"use_{uuid.uuid4().hex}")
    skill_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    time_saved_minutes: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
