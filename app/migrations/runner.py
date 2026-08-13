"""迁移运行器 — 追踪已应用的迁移，跳过已执行的 phase。"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

_TRACK_TABLE = "_applied_migrations"


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(f"""
        CREATE TABLE IF NOT EXISTS {_TRACK_TABLE} (
            phase TEXT PRIMARY KEY,
            applied_at REAL NOT NULL
        )
    """)
    conn.commit()


def _is_applied(conn: sqlite3.Connection, phase: str) -> bool:
    row = conn.execute(
        f"SELECT 1 FROM {_TRACK_TABLE} WHERE phase = ?", (phase,)
    ).fetchone()
    return row is not None


def _mark_applied(conn: sqlite3.Connection, phase: str) -> None:
    conn.execute(
        f"INSERT OR REPLACE INTO {_TRACK_TABLE} (phase, applied_at) VALUES (?, ?)",
        (phase, time.time()),
    )
    conn.commit()


def run_migrations(database_url: str, migrations: dict[str, callable]) -> list[str]:
    """按顺序执行迁移，跳过已应用的 phase。

    Args:
        database_url: SQLite URL (e.g. "sqlite:///./data/evowork.db")
        migrations: 有序 dict，key=phase 名称，value=migrate 函数

    Returns:
        本次实际执行的 phase 名称列表
    """
    db_path = database_url.replace("sqlite:///", "")
    if not Path(db_path).exists():
        # 数据库不存在，所有迁移都跳过（首次启动会由 SQLAlchemy create_all 建表）
        return []

    conn = sqlite3.connect(db_path)
    try:
        _ensure_table(conn)
        applied: list[str] = []

        for phase, migrate_fn in migrations.items():
            if _is_applied(conn, phase):
                continue
            migrate_fn(database_url)
            _mark_applied(conn, phase)
            applied.append(phase)

        return applied
    finally:
        conn.close()
