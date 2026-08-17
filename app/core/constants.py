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


def previous_period_range(period: str, offset: int = 1) -> tuple[datetime, datetime]:
    """返回往前 offset 个周期的 (start, end) 时间范围。

    - week offset=1 → 上周一 00:00 ~ 本周一 00:00
    - month offset=1 → 上月 1 号 00:00 ~ 本月 1 号 00:00
    - year offset=1 → 去年 1/1 00:00 ~ 今年 1/1 00:00
    """
    now = datetime.now(timezone.utc)
    if period == "week":
        # 当前周一
        current_monday = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        start = current_monday - timedelta(weeks=offset)
        end = current_monday - timedelta(weeks=offset - 1)
        return start, end
    elif period == "month":
        # 当前月 1 号
        current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # 往前 offset 个月
        target_month = current_month_start.month - offset
        target_year = current_month_start.year
        while target_month <= 0:
            target_month += 12
            target_year -= 1
        start = current_month_start.replace(year=target_year, month=target_month)
        # end 是 start 的下一个月的 1 号
        if target_month == 12:
            end = start.replace(year=target_year + 1, month=1)
        else:
            end = start.replace(month=target_month + 1)
        return start, end
    elif period == "year":
        current_year_start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        start = current_year_start.replace(year=current_year_start.year - offset)
        end = current_year_start.replace(year=current_year_start.year - offset + 1)
        return start, end
    # fallback: 按天数
    days = PERIOD_DAYS.get(period, 7)
    end = now - timedelta(days=days * (offset - 1))
    start = end - timedelta(days=days)
    return start, end


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
