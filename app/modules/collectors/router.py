"""采集器路由 — Git commit 收集、批量导入、采集器状态。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.collector import (
    BatchIngestResult,
    GitCommitPayload,
    ImportBatchRequest,
    IngestResult,
)
from app.services.collector import CollectorService

router = APIRouter(prefix="/collect", tags=["collectors"])


@router.post("/git", response_model=IngestResult)
def collect_git_commit(
    payload: GitCommitPayload,
    db: Session = Depends(get_db),
) -> IngestResult:
    """接收 git post-commit hook 推送的提交信息。"""
    service = CollectorService(db)
    return service.ingest_git_commit(payload)


@router.post("/import", response_model=BatchIngestResult)
def batch_import(
    payload: ImportBatchRequest,
    db: Session = Depends(get_db),
) -> BatchIngestResult:
    """批量导入外部来源事件（ActivityWatch、脚本等）。"""
    service = CollectorService(db)
    return service.ingest_batch(payload.items, default_source=payload.source)


@router.get("/status")
def collector_status() -> dict:
    """列出所有采集器及其状态。"""
    return {
        "collectors": [
            {
                "name": "git",
                "status": "active",
                "endpoint": "/api/collect/git",
                "description": "Git post-commit hook — 自动记录代码提交",
            },
            {
                "name": "import",
                "status": "active",
                "endpoint": "/api/collect/import",
                "description": "批量导入 — 支持任意外部数据源",
            },
            {
                "name": "activitywatch",
                "status": "planned",
                "endpoint": None,
                "description": "桌面活动追踪（计划中）",
            },
            {
                "name": "file_watcher",
                "status": "planned",
                "endpoint": None,
                "description": "文件变更监控（计划中）",
            },
        ]
    }
