"""SQLite 数据库迁移脚本 — Phase 2。

为现有表添加 Phase 2 新增列。
运行方式: python -m app.migrations.migrate_phase2
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def _column_exists(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def migrate(db_path: str) -> None:
    path = db_path.replace("sqlite:///", "")
    if not Path(path).exists():
        print(f"Database {path} does not exist, skipping migration.")
        return

    conn = sqlite3.connect(path)
    cur = conn.cursor()

    added = []

    # ── work_events 新增列 ──
    work_event_cols = {
        "event_layer": "TEXT DEFAULT 'problem'",
        "parent_event_id": "TEXT",
        "artifacts": "TEXT DEFAULT '[]'",
        "ai_summary": "TEXT",
    }
    for col, col_type in work_event_cols.items():
        if not _column_exists(cur, "work_events", col):
            cur.execute(f"ALTER TABLE work_events ADD COLUMN {col} {col_type}")
            added.append(f"work_events.{col}")

    # 为 event_layer 创建索引
    try:
        cur.execute("CREATE INDEX IF NOT EXISTS ix_work_events_event_layer ON work_events(event_layer)")
    except Exception:
        pass

    # 为 parent_event_id 创建索引
    try:
        cur.execute("CREATE INDEX IF NOT EXISTS ix_work_events_parent_event_id ON work_events(parent_event_id)")
    except Exception:
        pass

    # ── skills 新增列 ──
    skill_cols = {
        "methods": "TEXT",
        "success_criteria": "TEXT",
        "failure_fallback": "TEXT",
        "agent_assistable": "INTEGER DEFAULT 0",
        "agent_assistable_parts": "TEXT",
        "usage_count": "INTEGER DEFAULT 0",
        "avg_effectiveness": "REAL DEFAULT 0.0",
    }
    for col, col_type in skill_cols.items():
        if not _column_exists(cur, "skills", col):
            cur.execute(f"ALTER TABLE skills ADD COLUMN {col} {col_type}")
            added.append(f"skills.{col}")

    # ── event_embeddings 新表 ──
    cur.execute("""
        CREATE TABLE IF NOT EXISTS event_embeddings (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS ix_event_embeddings_event_id ON event_embeddings(event_id)")

    # ── skill_usage_logs 新表 ──
    cur.execute("""
        CREATE TABLE IF NOT EXISTS skill_usage_logs (
            id TEXT PRIMARY KEY,
            skill_id TEXT NOT NULL,
            event_id TEXT,
            outcome TEXT NOT NULL,
            time_saved_minutes INTEGER DEFAULT 0,
            notes TEXT,
            used_at TEXT NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS ix_skill_usage_logs_skill_id ON skill_usage_logs(skill_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_skill_usage_logs_outcome ON skill_usage_logs(outcome)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_skill_usage_logs_used_at ON skill_usage_logs(used_at)")

    conn.commit()
    conn.close()

    if added:
        print(f"Migration complete. Added columns: {', '.join(added)}")
    else:
        print("Migration complete. No changes needed.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
