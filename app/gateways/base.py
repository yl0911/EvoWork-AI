"""Gateway 抽象基类定义。

所有外部服务（LLM、数据库、向量库）通过抽象接口访问，
具体实现可独立切换，互不影响。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


# ── LLM ──────────────────────────────────────────────

class LLMGatewayError(RuntimeError):
    """LLM 调用异常。"""


@dataclass(frozen=True)
class LLMResponse:
    content: str
    provider: str
    model: str


class BaseLLMGateway(ABC):
    """LLM 网关抽象基类。"""

    @property
    @abstractmethod
    def configured(self) -> bool:
        """网关是否已正确配置。"""

    @property
    @abstractmethod
    def provider(self) -> str:
        """提供商标识。"""

    @property
    @abstractmethod
    def model(self) -> str:
        """当前使用的模型名。"""

    @abstractmethod
    def chat(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """发送对话请求并返回结果。"""


# ── Database ──────────────────────────────────────────

class BaseDBGateway(ABC):
    """数据库网关抽象基类。"""

    @abstractmethod
    def init_db(self) -> None:
        """初始化数据库（建表等）。"""

    @abstractmethod
    def get_session(self):
        """获取一个数据库会话（generator）。"""

    @abstractmethod
    def health_check(self) -> dict:
        """返回连接健康状态。"""


# ── Vector Store ──────────────────────────────────────

class BaseVectorGateway(ABC):
    """向量存储网关抽象基类。"""

    @abstractmethod
    def index_document(
        self, doc_id: str, content: str, metadata: dict
    ) -> None:
        """将文档索引到向量库。"""

    @abstractmethod
    def search(
        self, query: str, top_k: int = 5, filters: dict | None = None
    ) -> list[dict]:
        """语义相似搜索。"""

    @abstractmethod
    def delete(self, doc_id: str) -> None:
        """删除指定文档的索引。"""

    @abstractmethod
    def health_check(self) -> dict:
        """返回连接健康状态。"""
