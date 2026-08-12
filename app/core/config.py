"""EvoWork AI 配置管理。

使用 pydantic-settings 从 .env 文件和环境变量自动加载配置。
类型安全、自动验证、IDE 友好。
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    app_name: str = "EvoWork AI"
    app_env: str = "dev"
    app_secret_key: str = "change-me"

    # LLM Gateway
    llm_provider: str = "openai_compatible"
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""

    # Database
    database_url: str = "sqlite:///./data/evowork.db"

    # Vector Store
    vector_store: str = "chroma"
    vector_store_path: str = "./data/chroma"
    vector_store_url: str = ""

    # File Storage
    storage_type: str = "local"
    storage_path: str = "./data/files"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
