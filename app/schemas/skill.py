"""Skill Pydantic schemas — 三类 Skill 增强。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SkillBase(BaseModel):
    # 基础字段
    name: str = Field(min_length=1, max_length=160)
    category: str = "thinking"
    trigger: str | None = None
    content: str | None = None
    steps: list[str] = Field(default_factory=list)
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    source: str = "user_generated"
    # Phase 2 新增：思路型
    methods: list[str] | None = None
    # Phase 2 新增：可复用型
    success_criteria: str | None = None
    failure_fallback: str | None = None
    # Phase 2 新增：Agent 协作
    agent_assistable: bool = False
    agent_assistable_parts: list[str] | None = None
    # Phase 5: 系统 Skill
    system_skill: bool = False
    enabled: bool = True


class SkillCreate(SkillBase):
    pass


class SkillUpdate(BaseModel):
    """PATCH 更新：所有字段均可选。"""
    name: str | None = Field(default=None, min_length=1, max_length=160)
    category: str | None = None
    trigger: str | None = None
    content: str | None = None
    steps: list[str] | None = None
    inputs: list[str] | None = None
    outputs: list[str] | None = None
    source: str | None = None
    methods: list[str] | None = None
    success_criteria: str | None = None
    failure_fallback: str | None = None
    agent_assistable: bool | None = None
    agent_assistable_parts: list[str] | None = None
    enabled: bool | None = None


class SkillRead(SkillBase):
    id: str
    usage_count: int = 0
    avg_effectiveness: float = 0.0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillUseRequest(BaseModel):
    """记录 Skill 使用。"""
    event_id: str | None = None
    outcome: str = Field(default="effective", pattern="^(effective|ineffective|partial)$")
    time_saved_minutes: int = Field(default=0, ge=0)
    notes: str | None = None
