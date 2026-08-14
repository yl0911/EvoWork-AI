"""APScheduler 集成 — 定时/间隔触发 AI 事件分析。"""

from __future__ import annotations

import logging
from threading import Lock

logger = logging.getLogger(__name__)

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False

_scheduler: BackgroundScheduler | None = None
_lock = Lock()


def init_scheduler() -> None:
    """初始化调度器，从配置中读取调度模式并注册任务。

    在 main.py 的 lifespan 中调用。
    """
    if not HAS_APSCHEDULER:
        logger.warning("APScheduler not installed. Scheduled analysis disabled. "
                       "Install with: pip install apscheduler")
        return

    global _scheduler
    with _lock:
        if _scheduler is not None:
            return
        _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
        _apply_schedule()
        _scheduler.start()
        logger.info(f"[Scheduler] Started (mode={_get_mode()})")


def shutdown_scheduler() -> None:
    """关闭调度器。在 main.py lifespan yield 后调用。"""
    global _scheduler
    with _lock:
        if _scheduler is not None:
            _scheduler.shutdown(wait=False)
            _scheduler = None
            logger.info("[Scheduler] Shutdown.")


def update_schedule(mode: str, **kwargs) -> dict:
    """更新调度配置。由 API 端点调用。

    Args:
        mode: "manual" | "daily" | "interval"
        **kwargs: hour, minute, interval_hours

    Returns:
        当前配置 dict
    """
    from app.core.config import settings

    # 更新内存中的配置
    settings.analysis_schedule_mode = mode
    if "hour" in kwargs and kwargs["hour"] is not None:
        settings.analysis_schedule_hour = int(kwargs["hour"])
    if "minute" in kwargs and kwargs["minute"] is not None:
        settings.analysis_schedule_minute = int(kwargs["minute"])
    if "interval_hours" in kwargs and kwargs["interval_hours"] is not None:
        settings.analysis_schedule_interval_hours = int(kwargs["interval_hours"])

    # 持久化到 .env
    _persist_to_env()

    # 重新应用调度
    if _scheduler is not None:
        _apply_schedule()

    return get_schedule_config()


def get_schedule_config() -> dict:
    """获取当前调度配置。"""
    from app.core.config import settings
    return {
        "mode": settings.analysis_schedule_mode,
        "hour": settings.analysis_schedule_hour,
        "minute": settings.analysis_schedule_minute,
        "interval_hours": settings.analysis_schedule_interval_hours,
    }


def _get_mode() -> str:
    from app.core.config import settings
    return settings.analysis_schedule_mode


def _apply_schedule() -> None:
    """根据当前配置注册/移除调度任务。"""
    if _scheduler is None:
        return

    from app.core.config import settings

    # 先移除已有任务
    job_id = "event_analysis"
    existing = _scheduler.get_job(job_id)
    if existing:
        _scheduler.remove_job(job_id)

    mode = settings.analysis_schedule_mode

    if mode == "manual":
        logger.info("[Scheduler] Mode=manual, no scheduled job.")
        return

    if mode == "daily":
        trigger = CronTrigger(
            hour=settings.analysis_schedule_hour,
            minute=settings.analysis_schedule_minute,
            timezone="Asia/Shanghai",
        )
        _scheduler.add_job(
            _run_scheduled_analysis,
            trigger=trigger,
            id=job_id,
            name="Daily Event Analysis",
            replace_existing=True,
        )
        logger.info(f"[Scheduler] Daily analysis at {settings.analysis_schedule_hour:02d}:{settings.analysis_schedule_minute:02d}")

    elif mode == "biweekly":
        # 周三 + 周日，确保一周至少分析两次，为 Month 聚合提供数据
        trigger = CronTrigger(
            day_of_week="wed,sun",
            hour=settings.analysis_schedule_hour,
            minute=settings.analysis_schedule_minute,
            timezone="Asia/Shanghai",
        )
        _scheduler.add_job(
            _run_scheduled_analysis,
            trigger=trigger,
            id=job_id,
            name="Biweekly Event Analysis",
            replace_existing=True,
        )
        logger.info(f"[Scheduler] Biweekly analysis (Wed+Sun) at {settings.analysis_schedule_hour:02d}:{settings.analysis_schedule_minute:02d}")

    elif mode == "interval":
        trigger = IntervalTrigger(
            hours=settings.analysis_schedule_interval_hours,
        )
        _scheduler.add_job(
            _run_scheduled_analysis,
            trigger=trigger,
            id=job_id,
            name="Interval Event Analysis",
            replace_existing=True,
        )
        logger.info(f"[Scheduler] Interval analysis every {settings.analysis_schedule_interval_hours}h")


def _run_scheduled_analysis() -> None:
    """调度任务回调：打开独立 DB session 运行分析。"""
    try:
        from app.db.session import session_factory
        from app.services.event_analysis import run_event_analysis

        mode = _get_mode()
        trigger_mode = f"scheduled_{mode}"  # scheduled_daily / scheduled_biweekly / scheduled_interval

        with session_factory() as db:
            run = run_event_analysis(
                db=db,
                period="week",
                trigger_mode=trigger_mode,
            )
            logger.info(f"[Scheduler] Analysis completed: {run.tasks_identified} tasks "
                        f"(status={run.status})")
    except Exception as exc:
        logger.error(f"[Scheduler] Analysis failed: {exc}")


def _persist_to_env() -> None:
    """将调度配置写入 .env 文件。"""
    from pathlib import Path
    from app.core.config import settings

    env_path = Path(".env")
    if not env_path.exists():
        env_path.touch()

    content = env_path.read_text(encoding="utf-8")
    updates = {
        "ANALYSIS_SCHEDULE_MODE": settings.analysis_schedule_mode,
        "ANALYSIS_SCHEDULE_HOUR": str(settings.analysis_schedule_hour),
        "ANALYSIS_SCHEDULE_MINUTE": str(settings.analysis_schedule_minute),
        "ANALYSIS_SCHEDULE_INTERVAL_HOURS": str(settings.analysis_schedule_interval_hours),
    }

    lines = content.splitlines()
    updated_keys = set()

    for i, line in enumerate(lines):
        key = line.split("=")[0].strip() if "=" in line else ""
        if key in updates:
            lines[i] = f"{key}={updates[key]}"
            updated_keys.add(key)

    for key, value in updates.items():
        if key not in updated_keys:
            lines.append(f"{key}={value}")

    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
