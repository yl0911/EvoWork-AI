"""系统配置相关 Schema。"""

from __future__ import annotations

from pydantic import BaseModel


class ConfigUpdate(BaseModel):
    """运行时配置更新，所有字段可选（部分更新）。"""

    # LLM Gateway
    llm_provider: str | None = None
    llm_base_url: str | None = None
    llm_api_key: str | None = None
    llm_model: str | None = None

    # Collector Security
    collector_api_key: str | None = None
    collector_max_batch_size: int | None = None

    # Analysis Scheduler
    analysis_schedule_mode: str | None = None
    analysis_schedule_hour: int | None = None
    analysis_schedule_minute: int | None = None
    analysis_schedule_interval_hours: int | None = None

    # Notes Import
    notes_inbox_dir: str | None = None
    notes_archive_dir: str | None = None


# Settings 字段名 → .env 键名 的映射
_FIELD_TO_ENV: dict[str, str] = {
    "app_name": "APP_NAME",
    "app_env": "APP_ENV",
    "app_secret_key": "APP_SECRET_KEY",
    "llm_provider": "LLM_PROVIDER",
    "llm_base_url": "LLM_BASE_URL",
    "llm_api_key": "LLM_API_KEY",
    "llm_model": "LLM_MODEL",
    "database_url": "DATABASE_URL",
    "vector_store": "VECTOR_STORE",
    "vector_store_path": "VECTOR_STORE_PATH",
    "vector_store_url": "VECTOR_STORE_URL",
    "storage_type": "STORAGE_TYPE",
    "storage_path": "STORAGE_PATH",
    "collector_api_key": "COLLECTOR_API_KEY",
    "collector_max_batch_size": "COLLECTOR_MAX_BATCH_SIZE",
    "analysis_schedule_mode": "ANALYSIS_SCHEDULE_MODE",
    "analysis_schedule_hour": "ANALYSIS_SCHEDULE_HOUR",
    "analysis_schedule_minute": "ANALYSIS_SCHEDULE_MINUTE",
    "analysis_schedule_interval_hours": "ANALYSIS_SCHEDULE_INTERVAL_HOURS",
    "notes_inbox_dir": "NOTES_INBOX_DIR",
    "notes_archive_dir": "NOTES_ARCHIVE_DIR",
}
