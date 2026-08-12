"""FastAPI 依赖注入。

所有 Gateway 实例通过 @lru_cache 缓存，
路由通过 Depends() 注入，确保整个请求生命周期共享同一实例。
"""

from __future__ import annotations

from functools import lru_cache

from app.gateways.base import BaseDBGateway, BaseLLMGateway, BaseVectorGateway
from app.gateways.db.analytics import AnalyticsEngine
from app.gateways.db.sqlalchemy_impl import SQLAlchemyGateway
from app.gateways.llm.openai_compat import OpenAICompatGateway
from app.gateways.vector.chroma_impl import ChromaVectorGateway


@lru_cache
def get_llm_gateway() -> BaseLLMGateway:
    return OpenAICompatGateway()


@lru_cache
def get_db_gateway() -> BaseDBGateway:
    return SQLAlchemyGateway()


@lru_cache
def get_vector_gateway() -> BaseVectorGateway:
    return ChromaVectorGateway()


@lru_cache
def get_analytics_engine() -> AnalyticsEngine:
    from app.core.config import settings
    return AnalyticsEngine(settings.database_url)
