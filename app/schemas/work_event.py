"""WorkEvent Pydantic schemas — 三层事件模型。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.work_event import ALL_EVENT_TYPES


class WorkEventBase(BaseModel):
    # 三层分类
    event_layer: str = "problem"
    # 基础字段
    source: str = "manual"
    event_type: str = "note"
    title: str = Field(min_length=1, max_length=200)
    content: str | None = None
    privacy_level: str = "metadata"
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    duration_minutes: int = Field(default=0, ge=0)
    outcome: str = "partial"
    linked_skill_id: str | None = None
    # Phase 2 新增
    parent_event_id: str | None = None
    artifacts: list[str] = Field(default_factory=list)
    ai_summary: str | None = None
    started_at: datetime | None = None
    # Phase 4: 采集器元数据
    collector_metadata: dict | None = None


class WorkEventCreate(WorkEventBase):
    pass


class WorkEventUpdate(BaseModel):
    """PATCH 更新：所有字段均可选。"""
    event_layer: str | None = None
    source: str | None = None
    event_type: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = None
    privacy_level: str | None = None
    project: str | None = None
    tags: list[str] | None = None
    duration_minutes: int | None = Field(default=None, ge=0)
    outcome: str | None = None
    linked_skill_id: str | None = None
    parent_event_id: str | None = None
    artifacts: list[str] | None = None
    ai_summary: str | None = None
    started_at: datetime | None = None


class WorkEventRead(WorkEventBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
