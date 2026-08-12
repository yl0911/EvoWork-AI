"""WorkEvent CRUD 路由 — 含自动向量索引 + 修改记录。"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import WorkEvent
from app.models.event_revision import EventRevision
from app.models.work_event import infer_event_layer
from app.schemas.work_event import WorkEventCreate, WorkEventRead, WorkEventUpdate
from app.services.indexing import delete_event_index, index_event

router = APIRouter(tags=["events"])

# 不可用于 diff 比较的内部字段
_SKIP_DIFF_FIELDS = {"id", "created_at", "updated_at"}


def _serialize_value(v):
    """将字段值转为可 JSON 序列化的形式。"""
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _build_revision(event_id: str, old_values: dict, new_values: dict) -> EventRevision | None:
    """对比新旧值，生成 EventRevision（无变更返回 None）。"""
    changes = {}
    for key in new_values:
        if key in _SKIP_DIFF_FIELDS:
            continue
        old = old_values.get(key)
        new = new_values[key]
        if _serialize_value(old) != _serialize_value(new):
            changes[key] = {
                "old": _serialize_value(old),
                "new": _serialize_value(new),
            }
    if not changes:
        return None
    # 生成摘要
    fields = ", ".join(changes.keys())
    summary = f"Updated: {fields}"
    return EventRevision(
        event_id=event_id,
        changes=changes,
        summary=summary,
    )


@router.get("/events", response_model=list[WorkEventRead])
def list_events(
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    project: str | None = None,
    event_type: str | None = None,
    event_layer: str | None = None,
) -> list[WorkEvent]:
    stmt = select(WorkEvent)
    if project:
        stmt = stmt.where(WorkEvent.project == project)
    if event_type:
        stmt = stmt.where(WorkEvent.event_type == event_type)
    if event_layer:
        stmt = stmt.where(WorkEvent.event_layer == event_layer)
    stmt = stmt.order_by(desc(WorkEvent.started_at)).limit(limit)
    return list(db.execute(stmt).scalars())


@router.post("/events", response_model=WorkEventRead)
def create_event(payload: WorkEventCreate, db: Session = Depends(get_db)) -> WorkEvent:
    data = payload.model_dump()
    if data["started_at"] is None:
        data["started_at"] = datetime.now(timezone.utc)
    if data["event_layer"] == "problem":
        data["event_layer"] = infer_event_layer(data["event_type"])
    event = WorkEvent(**data)
    db.add(event)
    db.commit()
    db.refresh(event)
    # 自动索引
    index_event(event)
    return event


@router.patch("/events/{event_id}", response_model=WorkEventRead)
def update_event(
    event_id: str,
    payload: WorkEventUpdate,
    db: Session = Depends(get_db),
) -> WorkEvent:
    event = db.get(WorkEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    update_data = payload.model_dump(exclude_unset=True)

    # 快照旧值
    old_values = {}
    for key in update_data:
        old_values[key] = getattr(event, key, None)

    # 应用变更
    for key, value in update_data.items():
        setattr(event, key, value)

    # 记录修改历史
    revision = _build_revision(event_id, old_values, update_data)
    if revision:
        db.add(revision)

    db.commit()
    db.refresh(event)
    # 自动重新索引
    index_event(event)
    return event


@router.delete("/events/{event_id}")
def delete_event(event_id: str, db: Session = Depends(get_db)) -> dict:
    event = db.get(WorkEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")
    db.delete(event)
    db.commit()
    # 删除向量索引
    delete_event_index(event_id)
    return {"deleted": event_id}


@router.get("/events/{event_id}/history")
def event_history(
    event_id: str,
    db: Session = Depends(get_db),
) -> list[dict]:
    """获取事件的修改记录，按时间倒序。"""
    event = db.get(WorkEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="event not found")

    stmt = (
        select(EventRevision)
        .where(EventRevision.event_id == event_id)
        .order_by(desc(EventRevision.revised_at))
    )
    revisions = list(db.execute(stmt).scalars())
    return [
        {
            "id": r.id,
            "event_id": r.event_id,
            "changes": r.changes,
            "summary": r.summary,
            "revised_at": r.revised_at.isoformat() if r.revised_at else None,
        }
        for r in revisions
    ]
