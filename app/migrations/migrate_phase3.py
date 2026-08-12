"""SQLite 数据库迁移脚本 — Phase 3。

新增 event_revisions 表（事件修改记录）。
运行方式: python -m app.migrations.migrate_phase3
"""

from __future__ import annotations

import sqlite3
from pathlib import Path


def migrate(db_path: str) -> None:
    path = db_path.replace("sqlite:///", "")
    if not Path(path).exists():
        print(f"Database {path} does not exist, skipping migration.")
        return

    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # ── event_revisions 新表 ──
    cur.execute("""
        CREATE TABLE IF NOT EXISTS event_revisions (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL,
            changes TEXT NOT NULL DEFAULT '{}',
            summary TEXT NOT NULL DEFAULT '',
            revised_at TEXT NOT NULL
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS ix_event_revisions_event_id ON event_revisions(event_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_event_revisions_revised_at ON event_revisions(revised_at)")

    conn.commit()
    conn.close()
    print("Phase 3 migration complete: event_revisions table ready.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
