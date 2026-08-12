"""WorkEvent ORM 模型 — 三层事件模型。

事件分为三层：
  Layer 1 - 习惯事件 (habit): 时间、工具、频率、切换模式
  Layer 2 - 问题事件 (problem): 报错、调试、搜索、方案设计（能拿细节才分析）
  Layer 3 - 结果事件 (result): 是否解决、用了多久、产出了什么
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── 三层事件类型定义 ──────────────────────────────────

# Layer 1 - 习惯事件: 不关心内容细节，只做画像
HABIT_EVENT_TYPES = ("app_usage", "browser", "context_switch")

# Layer 2 - 问题事件: 能拿到细节才分析
PROBLEM_EVENT_TYPES = ("search", "debug", "coding", "reading", "writing", "design", "error", "planning", "summary", "note")

# Layer 3 - 结果事件: 追踪闭环
RESULT_EVENT_TYPES = ("resolved", "unresolved", "partial", "abandoned")

ALL_EVENT_TYPES = HABIT_EVENT_TYPES + PROBLEM_EVENT_TYPES + RESULT_EVENT_TYPES


def infer_event_layer(event_type: str) -> str:
    """根据 event_type 推断所属层。"""
    if event_type in HABIT_EVENT_TYPES:
        return "habit"
    if event_type in RESULT_EVENT_TYPES:
        return "result"
    return "problem"


class WorkEvent(Base):
    __tablename__ = "work_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"event_{uuid.uuid4().hex}")

    # ── 三层分类 ──
    event_layer: Mapped[str] = mapped_column(String(16), default="problem", index=True)

    # ── 基础字段 ──
    source: Mapped[str] = mapped_column(String(64), default="manual", index=True)
    event_type: Mapped[str] = mapped_column(String(64), default="note", index=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    privacy_level: Mapped[str] = mapped_column(String(32), default="metadata")
    project: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str] = mapped_column(String(32), default="partial", index=True)
    linked_skill_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # ── Phase 2 新增字段 ──
    parent_event_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    artifacts: Mapped[list[str]] = mapped_column(JSON, default=list)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Phase 4: 采集器元数据 ──
    collector_metadata: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=None)

    # ── 时间 ──
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
