"""采集器路由 — Git commit、Shell 命令、批量导入、采集器状态。"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import WorkEvent
from app.schemas.collector import (
    ActivityWatchBatchPayload,
    BatchIngestResult,
    BrowserBatchPayload,
    GitCommitPayload,
    IdeBatchPayload,
    ImportBatchRequest,
    IngestResult,
    ShellBatchPayload,
    ShellCommandPayload,
)
from app.services.collector import CollectorService
from app.services.collector_guard import get_all_collector_skills, is_source_enabled
from app.core.config import settings

# 各采集来源的 staleness 阈值（小时）——超过该时间未收到数据视为 stale
STALE_THRESHOLDS: dict[str, float] = {
    "git": 48,
    "shell": 24,
    "activitywatch": 6,
    "browser": 24,
    "ide": 24,
}

router = APIRouter(prefix="/collect", tags=["collectors"])


async def api_key_guard(request: Request) -> None:
    """API Key 认证守卫 — 仅在 COLLECTOR_API_KEY 配置时生效。

    检查请求头 X-API-Key 是否匹配。未配置密钥时跳过验证（向后兼容）。
    """
    if not settings.collector_api_key:
        return  # 未配置 API Key，不限制
    provided = request.headers.get("X-API-Key", "")
    if provided != settings.collector_api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _check_batch_size(events: list, label: str = "events") -> None:
    """校验批量大小不超过 collector_max_batch_size。"""
    limit = settings.collector_max_batch_size
    if len(events) > limit:
        raise HTTPException(
            status_code=413,
            detail=f"Batch too large: {len(events)} {label} exceeds limit of {limit}",
        )


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


def _is_stale(source: str, last_collected_at: str | None) -> bool:
    """判断某采集来源是否 stale（超过阈值未收到数据）。"""
    threshold_hours = STALE_THRESHOLDS.get(source)
    if threshold_hours is None or last_collected_at is None:
        return False
    last_dt = datetime.fromisoformat(last_collected_at)
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    age_hours = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
    return age_hours > threshold_hours


@router.post("/git", response_model=IngestResult)
def collect_git_commit(
    payload: GitCommitPayload,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> IngestResult:
    """接收 git post-commit hook 推送的提交信息。"""
    _guard(db, "git")
    service = CollectorService(db)
    return service.ingest_git_commit(payload)


@router.post("/shell", response_model=IngestResult)
def collect_shell_command(
    payload: ShellCommandPayload,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> IngestResult:
    """接收 shell hook 推送的单条命令。"""
    _guard(db, "shell")
    service = CollectorService(db)
    return service.ingest_shell_command(payload)


@router.post("/shell/batch", response_model=BatchIngestResult)
def collect_shell_batch(
    payload: ShellBatchPayload,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> BatchIngestResult:
    """批量导入 shell 历史命令（历史文件解析或离线缓冲区补发）。"""
    _guard(db, "shell")
    _check_batch_size(payload.commands, "commands")
    service = CollectorService(db)
    return service.ingest_shell_batch(payload.commands, source=payload.source)


@router.post("/activitywatch", response_model=BatchIngestResult)
def collect_activitywatch(
    payload: ActivityWatchBatchPayload,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> BatchIngestResult:
    """导入 ActivityWatch 窗口活动数据。

    事件会按 (app, title) 聚合为 session，自动分类并推断项目，时间窗口去重。
    """
    _guard(db, "activitywatch")
    _check_batch_size(payload.events, "events")
    service = CollectorService(db)
    return service.ingest_activitywatch_batch(payload.events)


@router.post("/browser", response_model=BatchIngestResult)
def collect_browser(
    payload: BrowserBatchPayload,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> BatchIngestResult:
    """接收浏览器扩展推送的页面活动数据。

    事件按 (domain, title) 聚合为 session，通过 URL 模式自动分类（coding/research/learning/browsing），
    推断关联项目，时间窗口去重。
    """
    _guard(db, "browser")
    _check_batch_size(payload.events, "events")
    service = CollectorService(db)
    return service.ingest_browser_batch(payload.events)


@router.post("/ide", response_model=BatchIngestResult)
def collect_ide(
    payload: IdeBatchPayload,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> BatchIngestResult:
    """接收 IDE 扩展推送的编辑活动数据。

    事件按 (project, file_path) 聚合为 session，根据文件类型自动分类（coding/debug/writing/config），
    推断编程语言和项目，时间窗口去重。
    """
    _guard(db, "ide")
    _check_batch_size(payload.events, "events")
    service = CollectorService(db)
    return service.ingest_ide_batch(payload.events)


@router.post("/import", response_model=BatchIngestResult)
def batch_import(
    payload: ImportBatchRequest,
    db: Session = Depends(get_db),
    _: None = Depends(api_key_guard),
) -> BatchIngestResult:
    """批量导入外部来源事件（ActivityWatch、脚本等）。"""
    _guard(db, payload.source)
    _check_batch_size(payload.items, "items")
    service = CollectorService(db)
    return service.ingest_batch(payload.items, default_source=payload.source)


@router.get("/status")
def collector_status(db: Session = Depends(get_db)) -> dict:
    """列出所有采集器及其状态，含关联的系统 Skill 信息、采集统计和 staleness 检测。"""
    skill_status = get_all_collector_skills(db)
    stats = _source_stats(db)

    def _stats(source: str) -> dict:
        s = stats.get(source, {"event_count": 0, "last_collected_at": None})
        threshold = STALE_THRESHOLDS.get(source)
        return {
            **s,
            "stale": _is_stale(source, s.get("last_collected_at")),
            "stale_threshold_hours": threshold,
        }

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
            "stale": False,
            "stale_threshold_hours": None,
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
            "status": "active",
            "endpoint": "/api/collect/browser",
            "description": "浏览器扩展 — 自动追踪页面访问时间，按 URL 分类",
            "linked_skill": skill_status.get("browser"),
            **_stats("browser"),
        },
        {
            "name": "ide",
            "status": "active",
            "endpoint": "/api/collect/ide",
            "description": "IDE 扩展 — 追踪文件编辑活动，按语言和项目分类",
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
