"""混合搜索服务 — FTS5 全文搜索 + Chroma 语义搜索。

FTS5 提供精确关键词匹配（BM25 排序），
Chroma 提供语义相似度搜索，
两者加权融合返回统一排名结果。
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import text

logger = logging.getLogger(__name__)

# 匹配中英文 token，用于高亮
_TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff\u3400-\u4dbf]", re.UNICODE)


class SearchService:
    """混合搜索服务：SQLite FTS5 + Chroma 向量。"""

    def __init__(self) -> None:
        self._initialized = False

    # ── 初始化 ────────────────────────────────────────

    def _get_engine(self):
        from app.core.dependencies import get_db_gateway
        return get_db_gateway().engine

    def ensure_tables(self) -> None:
        """创建 FTS5 虚拟表（如不存在）。启动时调用。"""
        engine = self._get_engine()
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
                USING fts5(id, title, content, tags, project, tokenize='unicode61')
            """))
            conn.execute(text("""
                CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts
                USING fts5(id, name, content, trigger_text, category, tokenize='unicode61')
            """))
            conn.commit()
        self._initialized = True
        logger.info("FTS5 tables initialized")

    @property
    def ready(self) -> bool:
        return self._initialized

    # ── 索引操作 ──────────────────────────────────────

    def index_event(self, event_id: str, title: str, content: str,
                    tags: list[str], project: str) -> None:
        """索引事件到 FTS5。"""
        engine = self._get_engine()
        tags_str = " ".join(tags) if tags else ""
        with engine.connect() as conn:
            conn.execute(text("DELETE FROM events_fts WHERE id = :id"), {"id": event_id})
            conn.execute(
                text("""
                    INSERT INTO events_fts (id, title, content, tags, project)
                    VALUES (:id, :title, :content, :tags, :project)
                """),
                {"id": event_id, "title": title or "", "content": content or "",
                 "tags": tags_str, "project": project or ""},
            )
            conn.commit()

    def index_skill(self, skill_id: str, name: str, content: str,
                    trigger: str, category: str) -> None:
        """索引 Skill 到 FTS5。"""
        engine = self._get_engine()
        with engine.connect() as conn:
            conn.execute(text("DELETE FROM skills_fts WHERE id = :id"), {"id": skill_id})
            conn.execute(
                text("""
                    INSERT INTO skills_fts (id, name, content, trigger_text, category)
                    VALUES (:id, :name, :content, :trigger, :category)
                """),
                {"id": skill_id, "name": name or "", "content": content or "",
                 "trigger": trigger or "", "category": category or ""},
            )
            conn.commit()

    def delete_event(self, event_id: str) -> None:
        engine = self._get_engine()
        with engine.connect() as conn:
            conn.execute(text("DELETE FROM events_fts WHERE id = :id"), {"id": event_id})
            conn.commit()

    def delete_skill(self, skill_id: str) -> None:
        engine = self._get_engine()
        with engine.connect() as conn:
            conn.execute(text("DELETE FROM skills_fts WHERE id = :id"), {"id": skill_id})
            conn.commit()

    # ── FTS5 搜索 ─────────────────────────────────────

    def search_fts5(self, query: str, scope: str = "all", top_k: int = 20,
                    source: str | None = None, event_type: str | None = None,
                    project: str | None = None) -> list[dict]:
        """FTS5 BM25 关键词搜索。

        BM25 rank 为负值，越接近 0 越相关。
        """
        fts_query = self._build_fts5_query(query)
        if not fts_query:
            return []

        engine = self._get_engine()
        results: list[dict] = []
        keywords = [t for t in _TOKEN_RE.findall(query) if len(t) >= 1]

        with engine.connect() as conn:
            # ── 搜索事件 ──
            if scope in ("all", "events"):
                clauses: list[str] = []
                params: dict = {"q": fts_query, "lim": top_k * 2}
                if source:
                    clauses.append("e.source = :src")
                    params["src"] = source
                if event_type:
                    clauses.append("e.event_type = :etype")
                    params["etype"] = event_type
                if project:
                    clauses.append("e.project = :proj")
                    params["proj"] = project

                join = ""
                where = ""
                if clauses:
                    join = " JOIN work_events e ON f.id = e.id "
                    where = " WHERE " + " AND ".join(clauses)

                try:
                    rows = conn.execute(text(f"""
                        SELECT f.id, f.title, f.content, f.tags, f.project,
                               e.source, e.event_type, e.event_layer, e.outcome,
                               e.started_at, e.duration_minutes,
                               bm25(events_fts) AS rank
                        FROM events_fts f
                        LEFT JOIN work_events e ON f.id = e.id
                        {join.rstrip()}
                        WHERE events_fts MATCH :q
                        ORDER BY rank ASC
                        LIMIT :lim
                    """), params).fetchall()

                    if not rows:
                        # 简化查询（不带 JOIN 过滤）
                        rows = conn.execute(text("""
                            SELECT f.id, f.title, f.content, f.tags, f.project,
                                   e.source, e.event_type, e.event_layer, e.outcome,
                                   e.started_at, e.duration_minutes,
                                   bm25(events_fts) AS rank
                            FROM events_fts f
                            LEFT JOIN work_events e ON f.id = e.id
                            WHERE events_fts MATCH :q
                            ORDER BY rank ASC
                            LIMIT :lim
                        """), {"q": fts_query, "lim": top_k * 2}).fetchall()

                    # 计算 BM25 归一化参数
                    ranks = [r[-1] for r in rows] if rows else []
                    min_rank = min(ranks) if ranks else -1.0
                    max_rank = max(ranks) if ranks else 0.0

                    for r in rows:
                        content = r[2] or r[1] or ""
                        started_at = r[9]
                        if started_at is not None and not isinstance(started_at, str):
                            started_at = started_at.isoformat()
                        results.append({
                            "id": r[0],
                            "result_type": "event",
                            "title": r[1] or "",
                            "content": content,
                            "tags": r[3].split() if r[3] else [],
                            "project": r[4] or "",
                            "source": r[5] or "",
                            "event_type": r[6] or "",
                            "event_layer": r[7] or "",
                            "outcome": r[8] or "",
                            "started_at": started_at,
                            "duration_minutes": r[10] or 0,
                            "bm25_rank": r[11],
                            "bm25_score": self._normalize_bm25(r[11], min_rank, max_rank),
                            "highlight": self._highlight_snippet(content, keywords),
                        })
                except Exception as exc:
                    logger.warning("FTS5 event search failed: %s", exc)

            # ── 搜索 Skill ──
            if scope in ("all", "skills"):
                try:
                    rows = conn.execute(text("""
                        SELECT f.id, f.name, f.content, f.trigger_text, f.category,
                               s.enabled, s.usage_count,
                               bm25(skills_fts) AS rank
                        FROM skills_fts f
                        LEFT JOIN skills s ON f.id = s.id
                        WHERE skills_fts MATCH :q
                        ORDER BY rank ASC
                        LIMIT :lim
                    """), {"q": fts_query, "lim": top_k * 2}).fetchall()

                    s_ranks = [r[-1] for r in rows] if rows else []
                    s_min = min(s_ranks) if s_ranks else -1.0
                    s_max = max(s_ranks) if s_ranks else 0.0

                    for r in rows:
                        content = r[2] or r[1] or ""
                        results.append({
                            "id": r[0],
                            "result_type": "skill",
                            "title": r[1] or "",
                            "content": content,
                            "trigger": r[3] or "",
                            "category": r[4] or "",
                            "enabled": bool(r[5]),
                            "usage_count": r[6] or 0,
                            "bm25_rank": r[7],
                            "bm25_score": self._normalize_bm25(r[7], s_min, s_max),
                            "highlight": self._highlight_snippet(content, keywords),
                        })
                except Exception as exc:
                    logger.warning("FTS5 skill search failed: %s", exc)

        return results

    # ── 混合搜索 ──────────────────────────────────────

    def hybrid_search(self, query: str, scope: str = "all", top_k: int = 20,
                      fts_weight: float = 0.4, chroma_weight: float = 0.6,
                      source: str | None = None, event_type: str | None = None,
                      project: str | None = None) -> dict:
        """FTS5 + Chroma 混合搜索，加权融合排名。"""
        from app.core.dependencies import get_vector_gateway

        fetch_k = top_k * 3

        # 并行获取两种搜索结果
        fts_results = self.search_fts5(
            query, scope, fetch_k, source=source,
            event_type=event_type, project=project,
        ) if self._initialized else []

        gw = get_vector_gateway()
        chroma_results: list[dict] = []
        if gw.configured:
            filters = {}
            if source:
                filters["source"] = source
            if event_type:
                filters["event_type"] = event_type
            if project:
                filters["project"] = project
            vf = filters or None

            if scope in ("all", "events"):
                for r in gw.search_events(query, top_k=fetch_k, filters=vf):
                    r["result_type"] = "event"
                    chroma_results.append(r)
            if scope in ("all", "skills"):
                for r in gw.search_skills(query, top_k=fetch_k, filters=vf):
                    r["result_type"] = "skill"
                    chroma_results.append(r)

        # ── 融合排名 ──
        keywords = [t for t in _TOKEN_RE.findall(query) if len(t) >= 1]
        merged = self._merge_results(
            fts_results, chroma_results, keywords,
            fts_weight, chroma_weight,
        )
        merged.sort(key=lambda r: r["score"], reverse=True)

        return {
            "query": query,
            "total": len(merged),
            "results": merged[:top_k],
            "has_fts": self._initialized and len(fts_results) > 0,
            "has_chroma": gw.configured and len(chroma_results) > 0,
        }

    # ── 经验搜索 ──────────────────────────────────────

    def experience_search(self, problem: str, top_k: int = 10) -> dict:
        """搜索类似问题的历史解决经验（problem + result 层事件）。"""
        from app.core.dependencies import get_vector_gateway

        results: list[dict] = []

        # Chroma 经验搜索
        gw = get_vector_gateway()
        if gw.configured:
            for r in gw.search_experience(problem, top_k=top_k):
                results.append({
                    "id": r["id"],
                    "problem": r.get("content", ""),
                    "result": "",
                    "event_type": r.get("metadata", {}).get("event_type", ""),
                    "project": r.get("metadata", {}).get("project", ""),
                    "outcome": r.get("metadata", {}).get("outcome", ""),
                    "tags": [t for t in r.get("metadata", {}).get("tags", "").split(",") if t],
                    "distance": r.get("distance"),
                })

        return {
            "query": problem,
            "total": len(results),
            "results": results,
        }

    # ── 批量重索引 ────────────────────────────────────

    def reindex_all(self) -> dict:
        """重建全部 FTS5 索引。"""
        from app.core.dependencies import get_db_gateway
        from app.models import Skill, WorkEvent
        from sqlalchemy import select

        engine = self._get_engine()
        counts = {"events": 0, "skills": 0}

        with engine.connect() as conn:
            conn.execute(text("DELETE FROM events_fts"))
            conn.execute(text("DELETE FROM skills_fts"))
            conn.commit()

        db_gw = get_db_gateway()
        with db_gw.get_session_context() as db:
            for event in db.execute(select(WorkEvent)).scalars():
                self.index_event(
                    event.id, event.title, event.content or "",
                    event.tags or [], event.project or "",
                )
                counts["events"] += 1

            for skill in db.execute(select(Skill)).scalars():
                parts = [skill.content or ""]
                if skill.steps:
                    parts.extend(skill.steps)
                if skill.methods:
                    parts.extend(skill.methods)
                self.index_skill(
                    skill.id, skill.name, "\n".join(parts),
                    skill.trigger or "", skill.category,
                )
                counts["skills"] += 1

        return counts

    # ── 热门词 ────────────────────────────────────────

    def hot_terms(self, limit: int = 20) -> dict:
        """获取热门搜索词（基于事件 tags 和 project）。"""
        from app.core.dependencies import get_db_gateway
        from app.models import WorkEvent
        from sqlalchemy import func, select

        db_gw = get_db_gateway()
        projects: list[dict] = []
        tags: list[dict] = []

        try:
            with db_gw.get_session_context() as db:
                rows = db.execute(
                    select(WorkEvent.project, func.count(WorkEvent.id))
                    .where(WorkEvent.project.isnot(None))
                    .where(WorkEvent.project != "")
                    .group_by(WorkEvent.project)
                    .order_by(func.count(WorkEvent.id).desc())
                    .limit(limit)
                ).all()
                projects = [{"term": r[0], "count": r[1]} for r in rows]

                all_events = db.execute(
                    select(WorkEvent.tags).where(WorkEvent.tags.isnot(None))
                ).scalars()
                tag_counts: dict[str, int] = {}
                for tag_list in all_events:
                    if isinstance(tag_list, list):
                        for t in tag_list:
                            if isinstance(t, str) and t.strip():
                                tag_counts[t] = tag_counts.get(t, 0) + 1
                tags = sorted(
                    [{"term": t, "count": c} for t, c in tag_counts.items()],
                    key=lambda x: x["count"], reverse=True,
                )[:limit]
        except Exception as exc:
            logger.warning("hot_terms failed: %s", exc)

        return {"projects": projects, "tags": tags}

    # ── 辅助方法 ──────────────────────────────────────

    @staticmethod
    def _build_fts5_query(raw: str) -> str:
        """构建 FTS5 查询字符串。

        - 提取中英文 token
        - 英文用前缀匹配 (*)
        - CJK 字符直接拼接
        - 多个 term 之间用 OR（匹配任一词项，BM25 自动排序）
        """
        tokens = _TOKEN_RE.findall(raw)
        if not tokens:
            return ""
        parts = []
        for t in tokens:
            if all("\u4e00" <= c <= "\u9fff" or "\u3400" <= c <= "\u4dbf" for c in t):
                parts.append(t)
            else:
                parts.append(f"{t}*")
        return " OR ".join(parts)

    @staticmethod
    def _normalize_bm25(rank: float, min_rank: float, max_rank: float) -> float:
        """归一化 BM25 rank 到 [0, 1]。BM25 rank 为负值，越接近 0 越相关。"""
        if min_rank == max_rank:
            return 1.0 if min_rank < 0 else 0.0
        return (rank - min_rank) / (max_rank - min_rank) if max_rank != min_rank else 0.5

    @staticmethod
    def _cosine_distance_to_score(distance: float | None) -> float:
        """将 cosine distance [0, 2] 转为相似度 [0, 1]。"""
        if distance is None:
            return 0.0
        return max(0.0, 1.0 - distance / 2.0)

    def _merge_results(self, fts_results: list[dict], chroma_results: list[dict],
                       keywords: list[str],
                       fts_w: float, chroma_w: float) -> list[dict]:
        """融合 FTS5 和 Chroma 结果。

        同一 ID 出现在两个来源时，取 max(fts_score, chroma_score)。
        仅在一个来源出现时，使用对应权重。
        """
        by_id: dict[str, dict] = {}

        for r in fts_results:
            rid = r["id"]
            score = r["bm25_score"] * fts_w
            by_id[rid] = {
                "id": rid,
                "result_type": r["result_type"],
                "title": r.get("title", ""),
                "content": r.get("content", ""),
                "score": score,
                "fts_score": r["bm25_score"],
                "chroma_distance": None,
                "source": r.get("source", ""),
                "event_type": r.get("event_type", ""),
                "event_layer": r.get("event_layer", ""),
                "project": r.get("project", ""),
                "tags": r.get("tags", []),
                "outcome": r.get("outcome", ""),
                "category": r.get("category", ""),
                "started_at": r.get("started_at"),
                "duration_minutes": r.get("duration_minutes", 0),
                "highlight": r.get("highlight", ""),
            }

        for r in chroma_results:
            rid = r["id"]
            chroma_score = self._cosine_distance_to_score(r.get("distance"))
            weighted = chroma_score * chroma_w

            if rid in by_id:
                # 同一结果：取较高分数
                by_id[rid]["score"] = max(by_id[rid]["score"], weighted)
                by_id[rid]["chroma_distance"] = r.get("distance")
                if not by_id[rid]["highlight"] and r.get("content"):
                    by_id[rid]["highlight"] = self._highlight_snippet(r["content"], keywords)
                # 从 Chroma metadata 补充缺失字段
                meta = r.get("metadata", {})
                if not by_id[rid]["source"]:
                    by_id[rid]["source"] = meta.get("source", "")
                if not by_id[rid]["event_type"]:
                    by_id[rid]["event_type"] = meta.get("event_type", "")
                if not by_id[rid]["project"]:
                    by_id[rid]["project"] = meta.get("project", "")
            else:
                by_id[rid] = {
                    "id": rid,
                    "result_type": r.get("result_type", "event"),
                    "title": r.get("metadata", {}).get("title", ""),
                    "content": r.get("content", ""),
                    "score": weighted,
                    "fts_score": None,
                    "chroma_distance": r.get("distance"),
                    "source": r.get("metadata", {}).get("source", ""),
                    "event_type": r.get("metadata", {}).get("event_type", ""),
                    "event_layer": r.get("metadata", {}).get("event_layer", ""),
                    "project": r.get("metadata", {}).get("project", ""),
                    "tags": [t for t in r.get("metadata", {}).get("tags", "").split(",") if t],
                    "outcome": r.get("metadata", {}).get("outcome", ""),
                    "category": r.get("metadata", {}).get("category", ""),
                    "started_at": None,
                    "duration_minutes": 0,
                    "highlight": self._highlight_snippet(r.get("content", ""), keywords),
                }

        return list(by_id.values())

    @staticmethod
    def _highlight_snippet(text: str, keywords: list[str],
                          window: int = 250) -> str:
        """在文本中高亮关键词，返回带 <mark> 标签的片段。"""
        if not text or not keywords:
            return (text[:window] + "...") if text and len(text) > window else (text or "")

        lower = text.lower()
        kw_lower = [(k, k.lower()) for k in keywords]

        first_pos = None
        for _, kl in kw_lower:
            pos = lower.find(kl)
            if pos != -1 and (first_pos is None or pos < first_pos):
                first_pos = pos

        if first_pos is None:
            return (text[:window] + "...") if len(text) > window else text

        start = max(0, first_pos - 40)
        end = min(len(text), first_pos + window)
        snippet = text[start:end]
        if start > 0:
            snippet = "..." + snippet
        if end < len(text):
            snippet += "..."

        # 高亮：先替换长关键词避免嵌套
        for k, kl in sorted(kw_lower, key=lambda x: len(x[1]), reverse=True):
            pos = 0
            while True:
                idx = snippet.lower().find(kl, pos)
                if idx == -1:
                    break
                original = snippet[idx:idx + len(k)]
                snippet = snippet[:idx] + "<mark>" + original + "</mark>" + snippet[idx + len(k):]
                pos = idx + len(k) + 13  # len("<mark></mark>")

        return snippet


# ── 单例 ──────────────────────────────────────────────

from functools import lru_cache  # noqa: E402


@lru_cache
def get_search_service() -> SearchService:
    return SearchService()
