"""AnalyzedTask / AnalysisRun 相关 Pydantic schemas。"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── AnalyzedTask ──

class AnalyzedTaskRead(BaseModel):
    id: str
    period: str
    period_start: str
    period_end: str
    title: str
    problem_description: str
    actions_taken: list[str] = []
    solution: str | None = None
    result: str
    result_detail: str | None = None
    reference_theory: str | None = None
    efficiency_score: int | None = None
    activity_type: str
    project: str | None = None
    tags: list[str] = []
    sources: list[str] = []
    source_event_ids: list[str] = []
    analysis_run_id: str | None = None
    model: str = ""
    created_at: str
    updated_at: str


class AnalyzedTaskUpdate(BaseModel):
    title: str | None = None
    problem_description: str | None = None
    solution: str | None = None
    result: str | None = None
    result_detail: str | None = None
    reference_theory: str | None = None
    efficiency_score: int | None = None
    tags: list[str] | None = None


# ── AnalysisRun ──

class AnalysisRunRead(BaseModel):
    id: str
    period: str
    period_start: str
    period_end: str
    trigger_mode: str
    status: str
    total_events_seen: int
    noise_events_count: int
    tasks_identified: int
    error_message: str | None = None
    model: str = ""
    created_at: str
    completed_at: str | None = None


# ── Request ──

class AnalyzeEventsRequest(BaseModel):
    period: str = "week"
    refresh: bool = False


# ── Schedule Config ──

class ScheduleConfigRead(BaseModel):
    mode: str  # manual / daily / biweekly / interval
    hour: int = 22
    minute: int = 0
    interval_hours: int = 6


class ScheduleConfigUpdate(BaseModel):
    mode: str = Field(description="manual | daily | biweekly | interval")
    hour: int | None = None
    minute: int | None = None
    interval_hours: int | None = None
