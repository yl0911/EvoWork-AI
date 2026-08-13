"""WorkEvent CRUD 路由 — 含自动向量索引 + 修改记录。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import WorkEvent
from app.models.event_revision import EventRevision
from app.models.work_event import infer_event_layer
from app.schemas.work_event import EventRevisionRead, WorkEventCreate, WorkEventRead, WorkEventUpdate
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


def _revision_to_dict(r: EventRevision) -> dict:
    """将 EventRevision 转为响应字典（含 field_count）。"""
    return {
        "id": r.id,
        "event_id": r.event_id,
        "changes": r.changes,
        "summary": r.summary,
        "revised_at": r.revised_at.isoformat() if r.revised_at else None,
        "field_count": len(r.changes) if r.changes else 0,
    }


@router.get("/events")
def list_events(
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    project: str | None = None,
    event_type: str | None = None,
    event_layer: str | None = None,
) -> dict:
    # 过滤条件
    base_stmt = select(WorkEvent)
    if project:
        base_stmt = base_stmt.where(WorkEvent.project == project)
    if event_type:
        base_stmt = base_stmt.where(WorkEvent.event_type == event_type)
    if event_layer:
        base_stmt = base_stmt.where(WorkEvent.event_layer == event_layer)

    # 总数（用于分页）
    total = db.execute(select(func.count()).select_from(base_stmt.subquery())).scalar() or 0

    # 分页查询
    stmt = base_stmt.order_by(desc(WorkEvent.started_at)).offset(offset).limit(limit)
    events = list(db.execute(stmt).scalars())

    # 批量查询 revision_count
    if events:
        event_ids = [e.id for e in events]
        count_stmt = (
            select(EventRevision.event_id, func.count(EventRevision.id))
            .where(EventRevision.event_id.in_(event_ids))
            .group_by(EventRevision.event_id)
        )
        counts = dict(db.execute(count_stmt).all())
    else:
        counts = {}

    # 构建响应（含 revision_count）
    result = []
    for ev in events:
        d = WorkEventRead.model_validate(ev).model_dump()
        d["revision_count"] = counts.get(ev.id, 0)
        result.append(d)
    return {"events": result, "total": total, "offset": offset, "limit": limit}


@router.get("/events/export")
def export_events(
    db: Session = Depends(get_db),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    project: str | None = None,
    event_type: str | None = None,
    event_layer: str | None = None,
):
    """导出所有事件为 JSON 或 CSV 文件。"""
    from fastapi.responses import StreamingResponse
    import csv as csv_mod
    import io

    stmt = select(WorkEvent)
    if project:
        stmt = stmt.where(WorkEvent.project == project)
    if event_type:
        stmt = stmt.where(WorkEvent.event_type == event_type)
    if event_layer:
        stmt = stmt.where(WorkEvent.event_layer == event_layer)
    stmt = stmt.order_by(desc(WorkEvent.started_at))
    events = list(db.execute(stmt).scalars())

    rows = [WorkEventRead.model_validate(ev).model_dump() for ev in events]

    if format == "csv":
        output = io.StringIO()
        if rows:
            writer = csv_mod.DictWriter(output, fieldnames=rows[0].keys())
            writer.writeheader()
            for row in rows:
                # Flatten dicts for CSV
                flat = {k: (str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v) for k, v in row.items()}
                writer.writerow(flat)
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=evowork_events.csv"},
        )

    import json
    return StreamingResponse(
        iter([json.dumps(rows, ensure_ascii=False, indent=2, default=str)]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=evowork_events.json"},
    )


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
    return [_revision_to_dict(r) for r in revisions]


@router.get("/events/history/counts")
def revision_counts(
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """批量查询所有事件的修订次数（用于前端显示 badge）。"""
    stmt = (
        select(EventRevision.event_id, func.count(EventRevision.id))
        .group_by(EventRevision.event_id)
    )
    return dict(db.execute(stmt).all())
