"""SQLite 数据库迁移脚本 — Phase 5。

为 skills 表添加 system_skill 和 enabled 列。
运行方式: python -m app.migrations.migrate_phase5
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

    if not _column_exists(cur, "skills", "system_skill"):
        cur.execute("ALTER TABLE skills ADD COLUMN system_skill INTEGER DEFAULT 0")
        added.append("skills.system_skill")

    if not _column_exists(cur, "skills", "enabled"):
        cur.execute("ALTER TABLE skills ADD COLUMN enabled INTEGER DEFAULT 1")
        added.append("skills.enabled")

    if added:
        try:
            cur.execute("CREATE INDEX IF NOT EXISTS ix_skills_system_skill ON skills(system_skill)")
        except Exception:
            pass

    conn.commit()
    conn.close()

    if added:
        print(f"Phase 5 migration complete. Added: {', '.join(added)}")
    else:
        print("Phase 5 migration: no changes needed.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
