"""EvoWork AI 共享常量与工具函数。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

PERIOD_DAYS: dict[str, int] = {
    "week": 7,
    "month": 30,
    "year": 365,
}


def period_start(period: str) -> datetime:
    """返回指定周期对应的起始时间（UTC）。"""
    days = PERIOD_DAYS.get(period, 7)
    return datetime.now(timezone.utc) - timedelta(days=days)
