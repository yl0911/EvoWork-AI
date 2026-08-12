"""采集器 Pydantic schemas — Git commit、批量导入等。"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


# ── Git Commit ──────────────────────────────────────

class GitCommitPayload(BaseModel):
    sha: str = Field(min_length=7, description="Full or short commit SHA")
    message: str = Field(min_length=1, description="Full commit message")
    author_name: str = ""
    author_email: str = ""
    branch: str | None = None
    repo_name: str | None = None
    files_changed: list[str] = Field(default_factory=list)
    insertions: int = 0
    deletions: int = 0
    committed_at: datetime | None = None


# ── Batch Import ────────────────────────────────────

class ImportItem(BaseModel):
    source: str = "manual"
    event_type: str = "note"
    event_layer: str | None = None  # auto-inferred if None
    title: str = Field(min_length=1, max_length=200)
    content: str | None = None
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    duration_minutes: int = Field(default=0, ge=0)
    outcome: str = "partial"
    started_at: datetime | None = None
    external_id: str | None = None  # for dedup
    metadata: dict = Field(default_factory=dict)


class ImportBatchRequest(BaseModel):
    source: str = "external"
    items: list[ImportItem] = Field(min_length=1)


# ── Shell Command ──────────────────────────────────

class ShellCommandPayload(BaseModel):
    command: str = Field(min_length=1, description="The shell command text")
    exit_code: int = Field(default=0, description="Command exit code (0 = success)")
    cwd: str | None = Field(default=None, description="Current working directory")
    shell_type: str = Field(default="bash", description="Shell type: bash, zsh, powershell, cmd")
    executed_at: datetime | None = None


class ShellBatchPayload(BaseModel):
    """Bulk import from shell history file or offline buffer."""
    source: str = "shell"
    commands: list[ShellCommandPayload] = Field(min_length=1)


# ── ActivityWatch ──────────────────────────────────

class ActivityWatchEventPayload(BaseModel):
    """ActivityWatch 单条事件（窗口活动或浏览器活动）。"""
    app: str = Field(default="", description="Application name (e.g. 'Visual Studio Code')")
    title: str = Field(default="", description="Window title or browser tab title")
    url: str | None = Field(default=None, description="Browser URL (for aw-watcher-web events)")
    timestamp: datetime | None = Field(default=None, description="Event start time")
    duration_seconds: float = Field(default=0, ge=0, description="Duration in seconds")


class ActivityWatchBatchPayload(BaseModel):
    """ActivityWatch 批量导入请求。"""
    source: str = "activitywatch"
    hostname: str | None = Field(default=None, description="AW hostname for bucket tracking")
    events: list[ActivityWatchEventPayload] = Field(min_length=1)


# ── Results ─────────────────────────────────────────

class IngestResult(BaseModel):
    event_id: str | None = None
    status: str  # "created" | "skipped_duplicate" | "error"
    detail: str | None = None


class BatchIngestResult(BaseModel):
    total: int
    created: int
    skipped: int
    errors: int
    results: list[IngestResult]
