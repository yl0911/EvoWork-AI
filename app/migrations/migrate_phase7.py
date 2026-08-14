"""SQLite 数据库迁移脚本 — Phase 7。

创建 analyzed_tasks 和 analysis_runs 表（AI 事件分析中间层）。
运行方式: python -m app.migrations.migrate_phase7
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def _table_exists(cursor: sqlite3.Cursor, table: str) -> bool:
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cursor.fetchone() is not None


def migrate(db_path: str) -> None:
    path = db_path.replace("sqlite:///", "")
    if not Path(path).exists():
        print(f"Database {path} does not exist, skipping migration.")
        return

    conn = sqlite3.connect(path)
    cur = conn.cursor()
    created = []

    if not _table_exists(cur, "analyzed_tasks"):
        cur.execute("""
            CREATE TABLE analyzed_tasks (
                id TEXT PRIMARY KEY,
                period TEXT NOT NULL DEFAULT 'week',
                period_start TIMESTAMP,
                period_end TIMESTAMP,
                title TEXT NOT NULL DEFAULT '',
                problem_description TEXT NOT NULL DEFAULT '',
                actions_taken TEXT DEFAULT '[]',
                solution TEXT,
                result TEXT NOT NULL DEFAULT 'partial',
                result_detail TEXT,
                reference_theory TEXT,
                efficiency_score INTEGER,
                activity_type TEXT NOT NULL DEFAULT '其他',
                project TEXT,
                tags TEXT DEFAULT '[]',
                sources TEXT DEFAULT '[]',
                source_event_ids TEXT DEFAULT '[]',
                analysis_run_id TEXT,
                model TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_at_period ON analyzed_tasks(period)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_at_created ON analyzed_tasks(created_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_at_activity ON analyzed_tasks(activity_type)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_at_project ON analyzed_tasks(project)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_at_run_id ON analyzed_tasks(analysis_run_id)")
        created.append("analyzed_tasks")

    if not _table_exists(cur, "analysis_runs"):
        cur.execute("""
            CREATE TABLE analysis_runs (
                id TEXT PRIMARY KEY,
                period TEXT NOT NULL DEFAULT 'week',
                period_start TIMESTAMP,
                period_end TIMESTAMP,
                trigger_mode TEXT NOT NULL DEFAULT 'manual',
                status TEXT NOT NULL DEFAULT 'running',
                total_events_seen INTEGER NOT NULL DEFAULT 0,
                noise_events_count INTEGER NOT NULL DEFAULT 0,
                tasks_identified INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                model TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP,
                completed_at TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ar_period ON analysis_runs(period)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ar_created ON analysis_runs(created_at)")
        created.append("analysis_runs")

    conn.commit()
    conn.close()

    if created:
        print(f"Phase 7 migration complete. Created: {', '.join(created)}")
    else:
        print("Phase 7 migration: no changes needed.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
