"""Vector Gateway 占位实现。

Chroma 接入将在 Phase 3 完成，当前仅满足接口要求。
"""

from __future__ import annotations

from app.core.config import settings
from app.gateways.base import BaseVectorGateway


class VectorGatewayStub(BaseVectorGateway):
    """占位实现：所有方法为空操作，health_check 返回未配置。"""

    def __init__(self) -> None:
        self._store_type = settings.vector_store
        self._path = settings.vector_store_path
        self._url = settings.vector_store_url

    @property
    def configured(self) -> bool:
        return bool(self._path or self._url)

    def index_document(self, doc_id: str, content: str, metadata: dict) -> None:
        pass

    def search(
        self, query: str, top_k: int = 5, filters: dict | None = None
    ) -> list[dict]:
        return []

    def delete(self, doc_id: str) -> None:
        pass

    def health_check(self) -> dict:
        return {
            "status": "not_configured",
            "provider": self._store_type,
            "path": self._path,
            "url": self._url,
        }
