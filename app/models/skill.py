"""Skill ORM 模型 — 三类 Skill 增强。

三类 Skill:
  - thinking: 思路型（思考路径、方法论、参考资料）
  - reusable: 可复用型（步骤、输入输出、成功/失败标准）
  - open_source: 开源区获取（可收藏、改造、本地运行）
"""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.orm import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── Skill 分类定义 ────────────────────────────────────

SKILL_CATEGORIES = ("thinking", "reusable", "open_source")
SKILL_SOURCES = ("user_generated", "ai_generated", "open_source", "mined", "system")


class Skill(Base):
    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: f"skill_{uuid.uuid4().hex}")

    # ── 基础字段 ──
    name: Mapped[str] = mapped_column(String(160), index=True)
    category: Mapped[str] = mapped_column(String(32), default="thinking", index=True)
    trigger: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    steps: Mapped[list[str]] = mapped_column(JSON, default=list)
    inputs: Mapped[list[str]] = mapped_column(JSON, default=list)
    outputs: Mapped[list[str]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(64), default="user_generated", index=True)

    # ── Phase 2 新增：思路型专用 ──
    methods: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # ── Phase 2 新增：可复用型专用 ──
    success_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_fallback: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Phase 2 新增：Agent 协作 ──
    agent_assistable: Mapped[bool] = mapped_column(Boolean, default=False)
    agent_assistable_parts: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    # ── Phase 2 新增：使用统计 ──
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_effectiveness: Mapped[float] = mapped_column(Float, default=0.0)

    # ── Phase 5: 系统 Skill ──
    system_skill: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # ── 时间 ──
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
