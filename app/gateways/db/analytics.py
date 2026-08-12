"""DuckDB 分析引擎。

通过 SQLAlchemy 从数据库加载数据到 DuckDB 内存表，
利用 DuckDB 的 SQL 分析能力做复杂统计。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import duckdb
from sqlalchemy import select

from app.core.constants import PERIOD_DAYS

logger = logging.getLogger(__name__)


class AnalyticsEngine:
    """基于 DuckDB 的分析引擎。"""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._conn: duckdb.DuckDBPyConnection | None = None

    def _get_conn(self) -> duckdb.DuckDBPyConnection:
        if self._conn is None:
            self._conn = duckdb.connect(":memory:")
        return self._conn

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── 数据加载 ──────────────────────────────────────

    def _get_db_session(self):
        """获取数据库 session。"""
        from app.core.dependencies import get_db_gateway
        return get_db_gateway().get_session_context()

    def _load_events(self, period: str = "month") -> int:
        """加载指定周期的事件到 DuckDB 内存表。"""
        from app.models import WorkEvent

        conn = self._get_conn()
        days = PERIOD_DAYS.get(period, 30)
        start_date = datetime.now(timezone.utc) - timedelta(days=days)

        try:
            with self._get_db_session() as db:
                events = list(
                    db.execute(
                        select(WorkEvent)
                        .where(WorkEvent.started_at >= start_date)
                    ).scalars()
                )

            if not events:
                conn.execute("DROP TABLE IF EXISTS events")
                conn.execute("""
                    CREATE TABLE events (
                        id TEXT, source TEXT, event_type TEXT, event_layer TEXT,
                        title TEXT, project TEXT, outcome TEXT,
                        duration_minutes INTEGER, started_at TEXT
                    )
                """)
                return 0

            # 将事件数据插入 DuckDB
            conn.execute("DROP TABLE IF EXISTS events")
            rows = [
                (
                    e.id, e.source, e.event_type, e.event_layer,
                    e.title, e.project or "", e.outcome,
                    e.duration_minutes or 0,
                    e.started_at.isoformat() if e.started_at else "",
                )
                for e in events
            ]
            conn.execute("""
                CREATE TABLE events AS
                SELECT * FROM (VALUES
                    {}
                ) AS t(id, source, event_type, event_layer, title, project, outcome, duration_minutes, started_at)
            """.format(
                ", ".join(
                    f"('{r[0]}', '{r[1]}', '{r[2]}', '{r[3]}', "
                    f"'{r[4].replace(chr(39), chr(39)+chr(39))}', "
                    f"'{r[5].replace(chr(39), chr(39)+chr(39))}', "
                    f"'{r[6]}', {r[7]}, '{r[8]}')"
                    for r in rows
                )
            ))
            return len(rows)

        except Exception as exc:
            logger.warning("Failed to load events: %s", exc)
            return 0

    def _load_skills(self) -> int:
        """加载 Skill 数据到 DuckDB。"""
        from app.models import Skill

        conn = self._get_conn()
        try:
            with self._get_db_session() as db:
                skills = list(db.execute(select(Skill)).scalars())

            conn.execute("DROP TABLE IF EXISTS skills")
            if not skills:
                conn.execute("""
                    CREATE TABLE skills (
                        id TEXT, name TEXT, category TEXT, source TEXT,
                        usage_count INTEGER, avg_effectiveness REAL
                    )
                """)
                return 0

            rows = [
                (s.id, s.name, s.category, s.source, s.usage_count, s.avg_effectiveness)
                for s in skills
            ]
            conn.execute("""
                CREATE TABLE skills AS
                SELECT * FROM (VALUES
                    {}
                ) AS t(id, name, category, source, usage_count, avg_effectiveness)
            """.format(
                ", ".join(
                    f"('{r[0]}', '{r[1].replace(chr(39), chr(39)+chr(39))}', "
                    f"'{r[2]}', '{r[3]}', {r[4]}, {r[5]})"
                    for r in rows
                )
            ))
            return len(rows)

        except Exception as exc:
            logger.warning("Failed to load skills: %s", exc)
            return 0

    # ── 分析接口 ──────────────────────────────────────

    def time_distribution(self, period: str = "month", group_by: str = "event_type") -> dict:
        """时间分布分析。"""
        count = self._load_events(period)
        if count == 0:
            return {"period": period, "total_events": 0, "distribution": {}}

        conn = self._get_conn()
        rows = conn.execute(f"""
            SELECT {group_by}, COALESCE(SUM(duration_minutes), 0) as total_minutes, COUNT(*) as event_count
            FROM events
            GROUP BY {group_by}
            ORDER BY total_minutes DESC
        """).fetchall()

        return {
            "period": period,
            "group_by": group_by,
            "total_events": count,
            "distribution": {str(row[0]): {"minutes": row[1], "count": row[2]} for row in rows},
        }

    def habit_profile(self, period: str = "month") -> dict:
        """习惯画像：各类活动时间比例。"""
        count = self._load_events(period)
        if count == 0:
            return {"period": period, "profile": {}, "total_minutes": 0}

        conn = self._get_conn()
        total = conn.execute("SELECT COALESCE(SUM(duration_minutes), 0) FROM events").fetchone()[0]
        rows = conn.execute("""
            SELECT event_type, COALESCE(SUM(duration_minutes), 0) as minutes
            FROM events GROUP BY event_type ORDER BY minutes DESC
        """).fetchall()

        profile = {}
        for event_type, minutes in rows:
            pct = round(minutes / total * 100, 1) if total > 0 else 0
            profile[event_type] = {"minutes": minutes, "percentage": pct}

        return {
            "period": period,
            "total_minutes": total,
            "profile": profile,
        }

    def repeated_problems(self, period: str = "month", threshold: int = 2) -> dict:
        """重复问题识别：按 project + event_type 分组。"""
        count = self._load_events(period)
        if count == 0:
            return {"period": period, "repeated": []}

        conn = self._get_conn()
        rows = conn.execute("""
            SELECT project, event_type, COUNT(*) as occurrence,
                   COALESCE(SUM(duration_minutes), 0) as total_minutes,
                   GROUP_CONCAT(DISTINCT title, ' | ') as titles
            FROM events
            WHERE event_layer = 'problem'
            GROUP BY project, event_type
            HAVING COUNT(*) >= ?
            ORDER BY occurrence DESC
        """, [threshold]).fetchall()

        return {
            "period": period,
            "threshold": threshold,
            "repeated": [
                {
                    "project": row[0] or "未归属",
                    "event_type": row[1],
                    "occurrences": row[2],
                    "total_minutes": row[3],
                    "titles": row[4],
                }
                for row in rows
            ],
        }

    def efficiency_metrics(self, period: str = "month") -> dict:
        """效率指标：解决耗时、解决率等。"""
        count = self._load_events(period)
        if count == 0:
            return {"period": period, "metrics": {}}

        conn = self._get_conn()
        rows = conn.execute("""
            SELECT outcome, COUNT(*) as cnt,
                   AVG(duration_minutes) as avg_minutes,
                   COALESCE(SUM(duration_minutes), 0) as total_minutes
            FROM events
            WHERE event_layer = 'problem'
            GROUP BY outcome
            ORDER BY cnt DESC
        """).fetchall()

        total_problem = sum(r[1] for r in rows)
        resolved = next((r[1] for r in rows if r[0] == "resolved"), 0)

        return {
            "period": period,
            "total_problem_events": total_problem,
            "resolve_rate": round(resolved / total_problem * 100, 1) if total_problem > 0 else 0,
            "by_outcome": {
                str(row[0]): {
                    "count": row[1],
                    "avg_minutes": round(row[2] or 0, 1),
                    "total_minutes": row[3],
                }
                for row in rows
            },
        }

    def full_analysis(self, period: str = "month") -> dict:
        """完整分析报告。"""
        return {
            "period": period,
            "analyzed_at": datetime.now(timezone.utc).isoformat(),
            "time_distribution": self.time_distribution(period),
            "habit_profile": self.habit_profile(period),
            "repeated_problems": self.repeated_problems(period),
            "efficiency_metrics": self.efficiency_metrics(period),
        }
