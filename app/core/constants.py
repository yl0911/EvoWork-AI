"""EvoWork AI 共享常量与工具函数。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

PERIOD_DAYS: dict[str, int] = {
    "week": 7,
    "month": 30,
    "year": 365,
}


def period_start(period: str) -> datetime:
    """返回指定周期对应的起始时间（UTC，日历对齐）。

    - week: 当前 ISO 周的周一 00:00 UTC
    - month: 当前月 1 号 00:00 UTC
    - year: 当前年 1 月 1 日 00:00 UTC
    """
    now = datetime.now(timezone.utc)
    if period == "week":
        # ISO weekday: Monday=1, Sunday=7
        monday = now - timedelta(days=now.weekday())
        return monday.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "year":
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    # fallback
    days = PERIOD_DAYS.get(period, 7)
    return now - timedelta(days=days)


def calendar_period_key(period: str, dt: datetime | None = None) -> str:
    """返回当前日历周期的唯一标识符。

    - week → "2026-W33"（ISO 周）
    - month → "2026-08"
    - year → "2026"

    用于判断两次分析是否属于同一日历周期（同一周期的旧结果会被替换，
    不同周期的旧结果会保留，供上层聚合使用）。
    """
    if dt is None:
        dt = datetime.now(timezone.utc)
    if period == "week":
        iso = dt.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    elif period == "month":
        return f"{dt.year}-{dt.month:02d}"
    elif period == "year":
        return str(dt.year)
    return f"{period}-{dt.strftime('%Y%m%d')}"
