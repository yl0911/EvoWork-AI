"""SQLite 数据库迁移脚本 — Phase 4。

为 work_events 添加 collector_metadata 列（采集器元数据）。
运行方式: python -m app.migrations.migrate_phase4
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
    if not _column_exists(cur, "work_events", "collector_metadata"):
        cur.execute("ALTER TABLE work_events ADD COLUMN collector_metadata TEXT")
        added.append("work_events.collector_metadata")

    conn.commit()
    conn.close()

    if added:
        print(f"Phase 4 migration complete. Added: {', '.join(added)}")
    else:
        print("Phase 4 migration: no changes needed.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
