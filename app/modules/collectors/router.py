"""采集器路由 — Git commit、Shell 命令、批量导入、采集器状态。"""

from __future__ import annotations

from sqlalchemy import func, select
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import WorkEvent
from app.schemas.collector import (
    ActivityWatchBatchPayload,
    BatchIngestResult,
    GitCommitPayload,
    ImportBatchRequest,
    IngestResult,
    ShellBatchPayload,
    ShellCommandPayload,
)
from app.services.collector import CollectorService
from app.services.collector_guard import get_all_collector_skills, is_source_enabled

router = APIRouter(prefix="/collect", tags=["collectors"])


def _source_stats(db: Session) -> dict[str, dict]:
    """按 source 聚合事件数和最近采集时间。"""
    rows = db.execute(
        select(
            WorkEvent.source,
            func.count(WorkEvent.id).label("count"),
            func.max(WorkEvent.started_at).label("last_at"),
        ).group_by(WorkEvent.source)
    ).all()
    return {
        row.source: {
            "event_count": row.count,
            "last_collected_at": row.last_at.isoformat() if row.last_at else None,
        }
        for row in rows
    }


def _guard(db: Session, source: str) -> None:
    """如果来源对应的 Skill 被禁用，拒绝写入。"""
    if not is_source_enabled(db, source):
        raise HTTPException(
            status_code=403,
            detail=f"Collector '{source}' is disabled. Enable the corresponding system skill to accept data.",
        )


@router.post("/git", response_model=IngestResult)
def collect_git_commit(
    payload: GitCommitPayload,
    db: Session = Depends(get_db),
) -> IngestResult:
    """接收 git post-commit hook 推送的提交信息。"""
    _guard(db, "git")
    service = CollectorService(db)
    return service.ingest_git_commit(payload)


@router.post("/shell", response_model=IngestResult)
def collect_shell_command(
    payload: ShellCommandPayload,
    db: Session = Depends(get_db),
) -> IngestResult:
    """接收 shell hook 推送的单条命令。"""
    _guard(db, "shell")
    service = CollectorService(db)
    return service.ingest_shell_command(payload)


@router.post("/shell/batch", response_model=BatchIngestResult)
def collect_shell_batch(
    payload: ShellBatchPayload,
    db: Session = Depends(get_db),
) -> BatchIngestResult:
    """批量导入 shell 历史命令（历史文件解析或离线缓冲区补发）。"""
    _guard(db, "shell")
    service = CollectorService(db)
    return service.ingest_shell_batch(payload.commands, source=payload.source)


@router.post("/activitywatch", response_model=BatchIngestResult)
def collect_activitywatch(
    payload: ActivityWatchBatchPayload,
    db: Session = Depends(get_db),
) -> BatchIngestResult:
    """导入 ActivityWatch 窗口活动数据。

    事件会按 (app, title) 聚合为 session，自动分类并推断项目，时间窗口去重。
    """
    _guard(db, "activitywatch")
    service = CollectorService(db)
    return service.ingest_activitywatch_batch(payload.events)


@router.post("/import", response_model=BatchIngestResult)
def batch_import(
    payload: ImportBatchRequest,
    db: Session = Depends(get_db),
) -> BatchIngestResult:
    """批量导入外部来源事件（ActivityWatch、脚本等）。"""
    _guard(db, payload.source)
    service = CollectorService(db)
    return service.ingest_batch(payload.items, default_source=payload.source)


@router.get("/status")
def collector_status(db: Session = Depends(get_db)) -> dict:
    """列出所有采集器及其状态，含关联的系统 Skill 信息和采集统计。"""
    skill_status = get_all_collector_skills(db)
    stats = _source_stats(db)

    def _stats(source: str) -> dict:
        return stats.get(source, {"event_count": 0, "last_collected_at": None})

    collectors = [
        {
            "name": "git",
            "status": "active",
            "endpoint": "/api/collect/git",
            "description": "Git post-commit hook — 自动记录代码提交",
            "linked_skill": skill_status.get("git"),
            **_stats("git"),
        },
        {
            "name": "shell",
            "status": "active",
            "endpoint": "/api/collect/shell",
            "description": "Shell PROMPT_COMMAND hook — 实时采集终端命令",
            "linked_skill": skill_status.get("shell"),
            **_stats("shell"),
        },
        {
            "name": "shell_batch",
            "status": "active",
            "endpoint": "/api/collect/shell/batch",
            "description": "Shell 历史批量导入 — 从历史文件解析或离线缓冲区补发",
            "linked_skill": skill_status.get("shell"),
            **_stats("shell"),
        },
        {
            "name": "import",
            "status": "active",
            "endpoint": "/api/collect/import",
            "description": "批量导入 — 支持任意外部数据源",
            "linked_skill": None,
            "event_count": 0,
            "last_collected_at": None,
        },
        {
            "name": "activitywatch",
            "status": "active",
            "endpoint": "/api/collect/activitywatch",
            "description": "ActivityWatch 窗口活动导入 — 自动聚合、分类、去重",
            "linked_skill": skill_status.get("activitywatch"),
            **_stats("activitywatch"),
        },
        {
            "name": "browser",
            "status": "planned",
            "endpoint": None,
            "description": "浏览器活动追踪（计划中）",
            "linked_skill": skill_status.get("browser"),
            **_stats("browser"),
        },
        {
            "name": "ide",
            "status": "planned",
            "endpoint": None,
            "description": "IDE 使用追踪（计划中）",
            "linked_skill": skill_status.get("ide"),
            **_stats("ide"),
        },
        {
            "name": "manual",
            "status": "active",
            "endpoint": "/api/events",
            "description": "手动事件记录 — 通过 Events 页面创建",
            "linked_skill": skill_status.get("manual"),
            **_stats("manual"),
        },
    ]
    return {"collectors": collectors}
