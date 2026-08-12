"""ChromaDB Vector Gateway 实现。

两个 collection:
  - evowork_events: 事件向量索引
  - evowork_skills: Skill 向量索引

隐私策略：privacy_level == "private" 的事件不索引。
"""

from __future__ import annotations

import logging
from pathlib import Path

import chromadb

from app.core.config import settings
from app.gateways.base import BaseVectorGateway

logger = logging.getLogger(__name__)


class ChromaVectorGateway(BaseVectorGateway):
    def __init__(self) -> None:
        self._store_type = settings.vector_store
        self._path = settings.vector_store_path
        self._url = settings.vector_store_url
        self._client: chromadb.ClientAPI | None = None
        self._events_collection = None
        self._skills_collection = None
        self._init_client()

    def _init_client(self) -> None:
        try:
            if self._url:
                self._client = chromadb.HttpClient(host=self._url)
            elif self._path:
                Path(self._path).mkdir(parents=True, exist_ok=True)
                self._client = chromadb.PersistentClient(path=self._path)
            else:
                return

            self._events_collection = self._client.get_or_create_collection(
                name="evowork_events",
                metadata={"hnsw:space": "cosine"},
            )
            self._skills_collection = self._client.get_or_create_collection(
                name="evowork_skills",
                metadata={"hnsw:space": "cosine"},
            )
            logger.info("ChromaDB initialized: events=%d, skills=%d",
                        self._events_collection.count(),
                        self._skills_collection.count())
        except Exception as exc:
            logger.warning("ChromaDB init failed: %s", exc)
            self._client = None

    @property
    def configured(self) -> bool:
        return self._client is not None

    # ── 索引 ──────────────────────────────────────────

    def index_document(self, doc_id: str, content: str, metadata: dict) -> None:
        """通用索引（默认写入 events collection）。"""
        self.index_event(doc_id, content, metadata)

    def index_event(self, event_id: str, content: str, metadata: dict) -> None:
        """索引事件到向量库。"""
        if not self._events_collection:
            return
        # 隐私保护：private 事件不索引
        if metadata.get("privacy_level") == "private":
            return
        # 隐私保护：metadata 级别事件只索引标题和标签
        if metadata.get("privacy_level") == "metadata":
            content = metadata.get("title", "") + " " + " ".join(metadata.get("tags", []))

        try:
            self._events_collection.upsert(
                ids=[event_id],
                documents=[content],
                metadatas=[{
                    "type": "event",
                    "event_layer": metadata.get("event_layer", "problem"),
                    "event_type": metadata.get("event_type", ""),
                    "source": metadata.get("source", ""),
                    "project": metadata.get("project", ""),
                    "title": metadata.get("title", ""),
                    "tags": ",".join(metadata.get("tags", [])),
                    "outcome": metadata.get("outcome", ""),
                }],
            )
        except Exception as exc:
            logger.warning("Failed to index event %s: %s", event_id, exc)

    def index_skill(self, skill_id: str, content: str, metadata: dict) -> None:
        """索引 Skill 到向量库。"""
        if not self._skills_collection:
            return
        try:
            self._skills_collection.upsert(
                ids=[skill_id],
                documents=[content],
                metadatas=[{
                    "type": "skill",
                    "category": metadata.get("category", ""),
                    "name": metadata.get("name", ""),
                    "source": metadata.get("source", ""),
                    "tags": ",".join(metadata.get("tags", [])),
                }],
            )
        except Exception as exc:
            logger.warning("Failed to index skill %s: %s", skill_id, exc)

    # ── 搜索 ──────────────────────────────────────────

    def search(self, query: str, top_k: int = 5, filters: dict | None = None) -> list[dict]:
        """跨 events + skills 的语义搜索。"""
        results = []
        results.extend(self.search_events(query, top_k=top_k, filters=filters))
        results.extend(self.search_skills(query, top_k=top_k, filters=filters))
        # 按 distance 排序（越小越相似）
        results.sort(key=lambda r: r.get("distance", 1.0))
        return results[:top_k]

    def search_events(self, query: str, top_k: int = 5, filters: dict | None = None) -> list[dict]:
        """搜索事件。"""
        if not self._events_collection:
            return []
        try:
            where_filter = self._build_where_filter(filters)
            result = self._events_collection.query(
                query_texts=[query],
                n_results=min(top_k, self._events_collection.count() or 1),
                where=where_filter if where_filter else None,
            )
            return self._format_results(result)
        except Exception as exc:
            logger.warning("Event search failed: %s", exc)
            return []

    def search_skills(self, query: str, top_k: int = 5, filters: dict | None = None) -> list[dict]:
        """搜索 Skill。"""
        if not self._skills_collection:
            return []
        try:
            where_filter = self._build_where_filter(filters)
            result = self._skills_collection.query(
                query_texts=[query],
                n_results=min(top_k, self._skills_collection.count() or 1),
                where=where_filter if where_filter else None,
            )
            return self._format_results(result)
        except Exception as exc:
            logger.warning("Skill search failed: %s", exc)
            return []

    def search_experience(self, problem_description: str, top_k: int = 5) -> list[dict]:
        """搜索类似问题的历史解决经验。

        只搜索 problem 和 result 层事件，返回已解决的问题经验。
        """
        if not self._events_collection:
            return []
        try:
            result = self._events_collection.query(
                query_texts=[problem_description],
                n_results=top_k,
                where={"$or": [
                    {"event_layer": "problem"},
                    {"event_layer": "result"},
                ]},
            )
            # 优先返回已解决的结果
            return self._format_results(result)
        except Exception as exc:
            logger.warning("Experience search failed: %s", exc)
            return []

    # ── 删除 ──────────────────────────────────────────

    def delete(self, doc_id: str) -> None:
        """从两个 collection 中删除。"""
        try:
            if self._events_collection:
                self._events_collection.delete(ids=[doc_id])
            if self._skills_collection:
                self._skills_collection.delete(ids=[doc_id])
        except Exception as exc:
            logger.warning("Delete failed for %s: %s", doc_id, exc)

    # ── 批量重索引 ────────────────────────────────────

    def reindex_all(self, events: list = None, skills: list = None) -> dict:
        """批量重建索引（用于迁移或初始化）。"""
        indexed = {"events": 0, "skills": 0}
        if events:
            for event in events:
                content = event.content or event.title
                self.index_event(event.id, content, {
                    "event_layer": event.event_layer,
                    "event_type": event.event_type,
                    "source": event.source,
                    "project": event.project or "",
                    "title": event.title,
                    "tags": event.tags or [],
                    "outcome": event.outcome,
                    "privacy_level": event.privacy_level,
                })
                indexed["events"] += 1
        if skills:
            for skill in skills:
                content = self._skill_to_text(skill)
                self.index_skill(skill.id, content, {
                    "category": skill.category,
                    "name": skill.name,
                    "source": skill.source,
                    "tags": [],
                })
                indexed["skills"] += 1
        return indexed

    # ── 健康检查 ──────────────────────────────────────

    def health_check(self) -> dict:
        if not self._client:
            return {
                "status": "not_configured",
                "provider": self._store_type,
                "path": self._path,
                "url": self._url,
            }
        try:
            events_count = self._events_collection.count() if self._events_collection else 0
            skills_count = self._skills_collection.count() if self._skills_collection else 0
            return {
                "status": "ok",
                "provider": self._store_type,
                "path": self._path,
                "events_indexed": events_count,
                "skills_indexed": skills_count,
            }
        except Exception as exc:
            return {
                "status": "error",
                "provider": self._store_type,
                "detail": str(exc),
            }

    # ── 辅助方法 ──────────────────────────────────────

    @staticmethod
    def _build_where_filter(filters: dict | None) -> dict | None:
        """构建 Chroma where filter。"""
        if not filters:
            return None
        conditions = []
        for key, value in filters.items():
            if value is not None:
                conditions.append({key: value})
        if not conditions:
            return None
        if len(conditions) == 1:
            return conditions[0]
        return {"$and": conditions}

    @staticmethod
    def _format_results(result) -> list[dict]:
        """格式化 ChromaDB query 结果。"""
        items = []
        if not result or not result.get("ids"):
            return items
        ids = result["ids"][0] if result["ids"] else []
        documents = result["documents"][0] if result["documents"] else []
        metadatas = result["metadatas"][0] if result["metadatas"] else []
        distances = result["distances"][0] if result.get("distances") else [None] * len(ids)

        for i, doc_id in enumerate(ids):
            items.append({
                "id": doc_id,
                "content": documents[i] if i < len(documents) else "",
                "metadata": metadatas[i] if i < len(metadatas) else {},
                "distance": distances[i] if i < len(distances) else None,
            })
        return items

    @staticmethod
    def _skill_to_text(skill) -> str:
        """将 Skill 转为可索引文本。"""
        parts = [skill.name]
        if skill.trigger:
            parts.append(skill.trigger)
        if skill.content:
            parts.append(skill.content)
        if skill.steps:
            parts.extend(skill.steps)
        if skill.methods:
            parts.extend(skill.methods)
        return "\n".join(parts)
