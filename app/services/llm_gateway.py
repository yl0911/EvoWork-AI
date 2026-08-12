"""LLM Gateway 向后兼容层。

实际实现已迁移到 app.gateways.llm.openai_compat。
此文件 re-export 旧接口名称，保持现有代码的导入路径不变。
"""

from __future__ import annotations

from app.core.dependencies import get_llm_gateway
from app.gateways.base import LLMGatewayError, LLMResponse


def LLMGateway():
    """返回全局 LLM Gateway 实例（向后兼容）。"""
    return get_llm_gateway()


__all__ = ["LLMGateway", "LLMGatewayError", "LLMResponse"]
