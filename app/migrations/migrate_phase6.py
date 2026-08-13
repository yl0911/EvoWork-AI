"""SQLite 数据库迁移脚本 — Phase 6。

创建 ai_conversations 和 ai_messages 表。
运行方式: python -m app.migrations.migrate_phase6
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

    if not _table_exists(cur, "ai_conversations"):
        cur.execute("""
            CREATE TABLE ai_conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT 'New Conversation',
                period TEXT NOT NULL DEFAULT 'week',
                message_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP,
                updated_at TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ai_conv_created ON ai_conversations(created_at)")
        created.append("ai_conversations")

    if not _table_exists(cur, "ai_messages"):
        cur.execute("""
            CREATE TABLE ai_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                order_index INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ai_msg_conv ON ai_messages(conversation_id)")
        created.append("ai_messages")

    conn.commit()
    conn.close()

    if created:
        print(f"Phase 6 migration complete. Created: {', '.join(created)}")
    else:
        print("Phase 6 migration: no changes needed.")


if __name__ == "__main__":
    from app.core.config import settings
    migrate(settings.database_url)
