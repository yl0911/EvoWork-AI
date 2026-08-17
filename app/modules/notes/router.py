"""笔记导入 API 路由。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.note_import import (
    get_import_history,
    get_inbox_status,
    process_uploaded_file,
    scan_inbox,
)

router = APIRouter(tags=["notes"])


@router.post("/notes/open-inbox")
def open_inbox_folder():
    """在系统文件管理器中打开 inbox 目录。"""
    import os
    import subprocess
    from pathlib import Path

    from app.core.config import settings

    inbox = Path(settings.notes_inbox_dir).resolve()
    inbox.mkdir(parents=True, exist_ok=True)

    try:
        if os.name == "nt":
            os.startfile(str(inbox))
        elif os.name == "darwin":
            subprocess.Popen(["open", str(inbox)])
        else:
            subprocess.Popen(["xdg-open", str(inbox)])
        return {"ok": True, "path": str(inbox)}
    except Exception as e:
        return {"ok": False, "error": str(e), "path": str(inbox)}


@router.post("/notes/scan")
def trigger_scan(db: Session = Depends(get_db)):
    """手动触发 inbox 目录扫描，处理所有支持的文件。"""
    result = scan_inbox(db, trigger_mode="manual_scan")
    return {
        "total": result["total"],
        "created": result["created"],
        "skipped": result["skipped"],
        "errors": result["errors"],
        "details": result["results"],
    }


@router.post("/notes/upload")
async def upload_note(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """上传单个笔记文件进行导入。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    content = await file.read()
    result = process_uploaded_file(
        db,
        file_data=content,
        filename=file.filename,
        trigger_mode="manual_upload",
    )

    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("detail", "Unknown error"))

    return {
        "note_id": result.get("note_id"),
        "filename": result["filename"],
        "status": result["status"],
        "events_created": result["events_created"],
    }


@router.get("/notes/inbox-status")
def inbox_status():
    """获取 inbox 目录状态：文件数量、类型分布。"""
    return get_inbox_status()


@router.get("/notes/history")
def import_history(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """获取笔记导入历史记录。"""
    notes, total = get_import_history(db, limit=limit, offset=offset, status=status)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": n.id,
                "original_filename": n.original_filename,
                "file_type": n.file_type,
                "file_size": n.file_size,
                "status": n.status,
                "events_created": n.events_created,
                "error_message": n.error_message,
                "trigger_mode": n.trigger_mode,
                "week_key": n.week_key,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in notes
        ],
    }
