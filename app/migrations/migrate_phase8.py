"""SQLite 数据库迁移脚本 — Phase 8。

创建 imported_notes 表（笔记导入追踪）。
运行方式: python -m app.migrations.migrate_phase8
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

    if not _table_exists(cur, "imported_notes"):
        cur.execute("""
            CREATE TABLE imported_notes (
                id TEXT PRIMARY KEY,
                original_filename TEXT NOT NULL DEFAULT '',
                file_hash TEXT NOT NULL DEFAULT '',
                file_type TEXT NOT NULL DEFAULT '',
                file_size INTEGER NOT NULL DEFAULT 0,
                inbox_path TEXT NOT NULL DEFAULT '',
                archive_path TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                events_created INTEGER NOT NULL DEFAULT 0,
                event_ids TEXT DEFAULT '[]',
                error_message TEXT,
                trigger_mode TEXT NOT NULL DEFAULT 'manual_scan',
                week_key TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_in_hash ON imported_notes(file_hash)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_in_status ON imported_notes(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_in_week ON imported_notes(week_key)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_in_created ON imported_notes(created_at)")
        created.append("imported_notes")

    conn.commit()
    conn.close()

    if created:
        print(f"Phase 8 migration complete. Created: {', '.join(created)}")
    else:
        print("Phase 8 migration: no changes needed.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
