"""笔记导入编排服务 — 扫描 inbox、读取文件、AI 分析、创建事件、归档。"""

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.constants import calendar_period_key
from app.core.dependencies import get_llm_gateway
from app.models.imported_note import ImportedNote
from app.models.work_event import WorkEvent
from app.services.file_reader import FileReaderService, FileContent
from app.services.note_analysis import analyze_note


# ── 目录配置（从 settings 读取，支持运行时修改）──

def _inbox_dir() -> Path:
    return Path(settings.notes_inbox_dir)


def _archive_dir() -> Path:
    return Path(settings.notes_archive_dir)


def _ensure_dirs():
    """确保 inbox 和 archive 目录存在。"""
    _inbox_dir().mkdir(parents=True, exist_ok=True)
    _archive_dir().mkdir(parents=True, exist_ok=True)


# ── 归档逻辑 ──

def _archive_path_for(modified_at: datetime, filename: str) -> Path:
    """根据文件修改时间计算归档路径: archive/YYYY-MM/WXX/filename."""
    year_month = modified_at.strftime("%Y-%m")
    iso = modified_at.isocalendar()
    week_dir = f"W{iso[1]:02d}"
    dest_dir = _archive_dir() / year_month / week_dir
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / filename
    # 避免覆盖同名文件
    if dest.exists():
        stem = Path(filename).stem
        ext = Path(filename).suffix
        dest = dest_dir / f"{stem}_{uuid.uuid4().hex[:8]}{ext}"
    return dest


# ── 单文件处理 ──

def _process_single_file(
    db: Session,
    path: Path,
    trigger_mode: str,
    gateway,
) -> dict:
    """完整处理一个文件: 读取 → 去重 → AI分析 → 创建事件 → 归档。

    Returns: dict with keys: note_id, filename, status, events_created, detail
    """
    filename = path.name
    _ensure_dirs()

    # 1. 读取文件
    try:
        fc: FileContent = FileReaderService.read_file(path)
    except Exception as e:
        return {"note_id": None, "filename": filename, "status": "error",
                "events_created": 0, "detail": f"读取失败: {e}"}

    # 2. 去重检查
    existing = db.execute(
        select(ImportedNote)
        .where(ImportedNote.file_hash == fc.file_hash, ImportedNote.status == "completed")
    ).first()
    if existing:
        # 文件重新出现在 inbox（用户手动放回），允许重新导入
        # 将旧记录标记为 superseded，避免历史混淆
        existing[0].status = "superseded"
        db.commit()

    # 3. 创建 ImportedNote 记录
    week_key = calendar_period_key("week", fc.modified_at)
    note = ImportedNote(
        id=f"note_{uuid.uuid4().hex}",
        original_filename=fc.filename,
        file_hash=fc.file_hash,
        file_type=fc.file_type,
        file_size=fc.file_size,
        inbox_path=str(path),
        status="processing",
        trigger_mode=trigger_mode,
        week_key=week_key,
        model=gateway.model if gateway else "",
    )
    db.add(note)
    db.commit()

    try:
        # 4. AI 分析
        event_dicts = analyze_note(
            text=fc.text,
            filename=fc.filename,
            modified_at=fc.modified_at,
            gateway=gateway,
        )

        if not event_dicts:
            note.status = "completed"
            note.events_created = 0
            note.error_message = "AI 未识别出有效事件"
            db.commit()
            return {"note_id": note.id, "filename": filename, "status": "completed",
                    "events_created": 0, "detail": "AI 未识别出有效事件"}

        # 5. 创建 WorkEvent
        event_ids: list[str] = []
        for i, ev in enumerate(event_dicts):
            eid = f"evt_{uuid.uuid4().hex}"
            event = WorkEvent(
                id=eid,
                event_layer="problem",
                source="manual_note",
                event_type=ev.get("event_type", "note"),
                title=ev.get("title", fc.filename)[:200],
                content=ev.get("content", ""),
                project=ev.get("project"),
                tags=ev.get("tags", []) + ["manual_note"],
                duration_minutes=max(1, ev.get("duration_minutes", 30)),
                outcome=ev.get("outcome", "partial"),
                started_at=fc.modified_at,
                collector_metadata={
                    "collector": "manual_note",
                    "note_id": note.id,
                    "source_file": fc.filename,
                },
            )
            db.add(event)
            event_ids.append(eid)

        db.commit()

        # 6. 归档文件
        try:
            archive_dest = _archive_path_for(fc.modified_at, fc.filename)
            shutil.move(str(path), str(archive_dest))
            note.archive_path = str(archive_dest)
        except (PermissionError, OSError) as e:
            print(f"[NoteImport] Archive failed for {filename}: {e}")
            note.archive_path = None

        # 7. 更新记录
        note.status = "completed"
        note.events_created = len(event_ids)
        note.event_ids = json.dumps(event_ids)
        db.commit()

        return {"note_id": note.id, "filename": filename, "status": "completed",
                "events_created": len(event_ids), "detail": None}

    except Exception as e:
        note.status = "failed"
        note.error_message = str(e)[:500]
        db.commit()
        print(f"[NoteImport] Failed to process {filename}: {e}")
        return {"note_id": note.id, "filename": filename, "status": "error",
                "events_created": 0, "detail": str(e)[:200]}


# ── 公开接口 ──

def scan_inbox(db: Session, trigger_mode: str = "manual_scan") -> dict:
    """扫描 inbox 目录，处理所有支持的文件。

    Returns: {total, created, skipped, errors, results}
    """
    _ensure_dirs()
    gateway = get_llm_gateway()

    files = [
        f for f in _inbox_dir().iterdir()
        if f.is_file() and f.suffix.lower() in FileReaderService.SUPPORTED_TYPES
    ]

    results = []
    for f in files:
        r = _process_single_file(db, f, trigger_mode, gateway)
        results.append(r)

    created = sum(1 for r in results if r["status"] == "completed" and r["events_created"] > 0)
    skipped = sum(1 for r in results if r["status"] == "skipped")
    errors = sum(1 for r in results if r["status"] == "error")

    return {
        "total": len(results),
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "results": results,
    }


def process_uploaded_file(
    db: Session,
    file_data: bytes,
    filename: str,
    trigger_mode: str = "manual_upload",
) -> dict:
    """处理通过 API 上传的文件。"""
    _ensure_dirs()
    gateway = get_llm_gateway()

    # 保存到临时位置
    ext = Path(filename).suffix.lower()
    if ext not in FileReaderService.SUPPORTED_TYPES:
        return {"note_id": None, "filename": filename, "status": "error",
                "events_created": 0, "detail": f"不支持的文件类型: {ext}"}

    temp_path = _inbox_dir() / f"_upload_{uuid.uuid4().hex[:8]}{ext}"
    try:
        temp_path.write_bytes(file_data)
        return _process_single_file(db, temp_path, trigger_mode, gateway)
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        return {"note_id": None, "filename": filename, "status": "error",
                "events_created": 0, "detail": str(e)[:200]}


def get_inbox_status() -> dict:
    """返回 inbox 目录状态。"""
    _ensure_dirs()
    files = [
        f for f in _inbox_dir().iterdir()
        if f.is_file() and f.suffix.lower() in FileReaderService.SUPPORTED_TYPES
    ]
    by_type: dict[str, int] = {}
    for f in files:
        ext = f.suffix.lower()
        by_type[ext] = by_type.get(ext, 0) + 1

    return {
        "total_files": len(files),
        "by_type": by_type,
        "supported_types": sorted(FileReaderService.SUPPORTED_TYPES),
        "inbox_path": str(_inbox_dir().resolve()),
    }


def get_import_history(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
) -> tuple[list[ImportedNote], int]:
    """查询导入历史。"""
    from sqlalchemy import func
    query = select(ImportedNote)
    count_query = select(func.count()).select_from(ImportedNote)
    if status:
        query = query.where(ImportedNote.status == status)
        count_query = count_query.where(ImportedNote.status == status)
    query = query.order_by(ImportedNote.created_at.desc()).offset(offset).limit(limit)
    total = db.execute(count_query).scalar() or 0
    notes = list(db.execute(query).scalars())
    return notes, total
