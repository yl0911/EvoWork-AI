"""DuckDB 分析路由。"""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.core.dependencies import get_analytics_engine

router = APIRouter(tags=["analytics"])


@router.get("/analytics/habit")
def habit_profile(
    period: str = Query(default="month", pattern="^(week|month|year)$"),
) -> dict:
    """习惯画像：各类活动时间比例。"""
    engine = get_analytics_engine()
    return engine.habit_profile(period)


@router.get("/analytics/repeated")
def repeated_problems(
    period: str = Query(default="month", pattern="^(week|month|year)$"),
    threshold: int = Query(default=2, ge=1),
) -> dict:
    """重复问题识别。"""
    engine = get_analytics_engine()
    return engine.repeated_problems(period, threshold=threshold)


@router.get("/analytics/efficiency")
def efficiency_metrics(
    period: str = Query(default="month", pattern="^(week|month|year)$"),
) -> dict:
    """效率指标：解决耗时、解决率。"""
    engine = get_analytics_engine()
    return engine.efficiency_metrics(period)


@router.get("/analytics/full")
def full_analysis(
    period: str = Query(default="month", pattern="^(week|month|year)$"),
) -> dict:
    """完整分析报告。"""
    engine = get_analytics_engine()
    return engine.full_analysis(period)


@router.get("/analytics/shell")
def shell_analysis(
    period: str = Query(default="month", pattern="^(week|month|year)$"),
) -> dict:
    """Shell 命令洞察：Top 命令、错误率、类型分布。"""
    engine = get_analytics_engine()
    return engine.shell_commands(period)


@router.get("/analytics/patterns")
def work_patterns(
    period: str = Query(default="month", pattern="^(week|month|year)$"),
) -> dict:
    """工作节奏分析：小时分布、项目切换频率、活跃天数。"""
    engine = get_analytics_engine()
    return engine.work_patterns(period)


@router.get("/analytics/timeline")
def timeline(
    period: str = Query(default="week", pattern="^(day|week|month|year)$"),
    group_by: str = Query(default="project", pattern="^(project|event_type|source)$"),
) -> dict:
    """时间线数据：按分组返回事件时间跨度，用于甘特图可视化。"""
    engine = get_analytics_engine()
    return engine.timeline(period, group_by=group_by)
