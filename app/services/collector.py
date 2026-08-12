"""采集服务核心 — 转换、去重、持久化、索引。"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import WorkEvent
from app.models.work_event import infer_event_layer
from app.services.indexing import index_event
from app.schemas.collector import (
    BatchIngestResult,
    GitCommitPayload,
    ImportItem,
    IngestResult,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── Git commit 消息关键词 → 标签/类型映射 ────────────

_KEYWORD_MAP: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"\bfix(?:ed|es)?|bugfix|hotfix|patch\b", re.I), "debug", "bugfix"),
    (re.compile(r"\brefactor|restructur|cleanup\b", re.I), "coding", "refactor"),
    (re.compile(r"\bdocs?|readme|changelog\b", re.I), "writing", "docs"),
    (re.compile(r"\btest|spec\b", re.I), "coding", "testing"),
    (re.compile(r"\bfeat(?:ure)?|add(?:ed)?|implement\b", re.I), "coding", "feature"),
    (re.compile(r"\bchore|deps?|bump|ci\b", re.I), "coding", "chore"),
    (re.compile(r"\bstyle|format|lint\b", re.I), "coding", "style"),
    (re.compile(r"\bperf|optim|speed\b", re.I), "coding", "performance"),
]


def _infer_git_event(message: str) -> tuple[str, list[str]]:
    """从 commit message 推断 event_type 和额外 tags。"""
    subject = message.split("\n")[0]  # 只看第一行
    best_type = "coding"
    tags: list[str] = []
    for pattern, evt_type, tag in _KEYWORD_MAP:
        if pattern.search(subject):
            best_type = evt_type
            tags.append(tag)
            break
    return best_type, tags


class CollectorService:
    def __init__(self, db: Session):
        self.db = db

    # ── Git Commit ──────────────────────────────────

    def ingest_git_commit(self, payload: GitCommitPayload) -> IngestResult:
        # 1. 去重：同一 SHA 不重复录入
        if self._has_git_commit(payload.sha):
            return IngestResult(status="skipped_duplicate", detail=f"SHA {payload.sha[:12]} already recorded")

        # 2. 推断类型和标签
        event_type, auto_tags = _infer_git_event(payload.message)
        subject = payload.message.split("\n")[0]
        body = "\n".join(payload.message.split("\n")[1:]).strip() or None

        # 3. 构建事件
        started_at = payload.committed_at or utc_now()
        event = WorkEvent(
            event_layer=infer_event_layer(event_type),
            source="git",
            event_type=event_type,
            title=subject[:200],
            content=body,
            project=payload.repo_name,
            tags=auto_tags + ([payload.branch] if payload.branch else []),
            duration_minutes=0,
            outcome="resolved",
            started_at=started_at,
            collector_metadata={
                "collector": "git",
                "ref": payload.sha,
                "branch": payload.branch,
                "author": payload.author_name,
                "files_changed": len(payload.files_changed),
                "insertions": payload.insertions,
                "deletions": payload.deletions,
            },
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        index_event(event)
        return IngestResult(event_id=event.id, status="created")

    # ── Batch Import ────────────────────────────────

    def ingest_batch(self, items: list[ImportItem], default_source: str = "external") -> BatchIngestResult:
        results: list[IngestResult] = []
        for item in items:
            try:
                r = self._ingest_single(item, default_source)
                results.append(r)
            except Exception as e:
                results.append(IngestResult(status="error", detail=str(e)))

        created = sum(1 for r in results if r.status == "created")
        skipped = sum(1 for r in results if r.status == "skipped_duplicate")
        errors = sum(1 for r in results if r.status == "error")
        return BatchIngestResult(
            total=len(items), created=created, skipped=skipped, errors=errors, results=results,
        )

    def _ingest_single(self, item: ImportItem, default_source: str) -> IngestResult:
        # 去重
        if item.external_id and self._has_external_id(item.external_id):
            return IngestResult(status="skipped_duplicate", detail=f"external_id={item.external_id}")

        source = item.source if item.source != "manual" else default_source
        event_type = item.event_type
        event_layer = item.event_layer or infer_event_layer(event_type)
        started_at = item.started_at or utc_now()

        event = WorkEvent(
            event_layer=event_layer,
            source=source,
            event_type=event_type,
            title=item.title[:200],
            content=item.content,
            project=item.project,
            tags=item.tags,
            duration_minutes=item.duration_minutes,
            outcome=item.outcome,
            started_at=started_at,
            collector_metadata={
                "collector": source,
                "external_id": item.external_id,
                **item.metadata,
            },
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        index_event(event)
        return IngestResult(event_id=event.id, status="created")

    # ── Dedup helpers ───────────────────────────────

    def _has_git_commit(self, sha: str) -> bool:
        """检查是否已有同一 SHA 的 git 事件。"""
        stmt = select(WorkEvent).where(
            WorkEvent.source == "git",
            WorkEvent.collector_metadata.isnot(None),
        )
        events = list(self.db.execute(stmt).scalars())
        for ev in events:
            meta = ev.collector_metadata or {}
            if meta.get("ref", "").startswith(sha) or sha.startswith(meta.get("ref", "")):
                return True
        return False

    def _has_external_id(self, external_id: str) -> bool:
        """检查是否已有同一 external_id 的事件。"""
        stmt = select(WorkEvent).where(WorkEvent.collector_metadata.isnot(None))
        events = list(self.db.execute(stmt).scalars())
        for ev in events:
            meta = ev.collector_metadata or {}
            if meta.get("external_id") == external_id:
                return True
        return False
