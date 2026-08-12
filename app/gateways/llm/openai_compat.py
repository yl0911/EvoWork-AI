"""OpenAI-compatible LLM Gateway 实现。

支持所有兼容 OpenAI Chat Completions API 的服务：
DeepSeek、Qwen、OpenAI、Ollama、vLLM 等。
"""

from __future__ import annotations

import json
from urllib import error, request

from app.core.config import settings
from app.gateways.base import BaseLLMGateway, LLMGatewayError, LLMResponse


class OpenAICompatGateway(BaseLLMGateway):
    def __init__(self) -> None:
        self._provider = settings.llm_provider
        self._base_url = settings.llm_base_url.rstrip("/")
        self._api_key = settings.llm_api_key
        self._model = settings.llm_model

    @property
    def configured(self) -> bool:
        return bool(self._base_url and self._api_key and self._model)

    @property
    def provider(self) -> str:
        return self._provider

    @property
    def model(self) -> str:
        return self._model

    @property
    def base_url(self) -> str:
        return self._base_url

    @property
    def api_key(self) -> str:
        return self._api_key

    def chat(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> LLMResponse:
        if not self.configured:
            raise LLMGatewayError(
                "LLM is not configured. Please set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL."
            )

        payload = {
            "model": self._model,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        body = json.dumps(payload).encode("utf-8")
        http_request = request.Request(
            f"{self._base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )

        try:
            with request.urlopen(http_request, timeout=60) as response:
                response_data = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise LLMGatewayError(f"LLM HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise LLMGatewayError(f"LLM connection failed: {exc.reason}") from exc
        except TimeoutError as exc:
            raise LLMGatewayError("LLM request timed out.") from exc
        except json.JSONDecodeError as exc:
            raise LLMGatewayError("LLM returned invalid JSON.") from exc

        choices = response_data.get("choices") or []
        message = choices[0].get("message", {}) if choices else {}
        content = message.get("content", "")
        return LLMResponse(
            content=content or "",
            provider=self._provider,
            model=self._model,
        )

    def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
    ):
        """流式对话：yield 每个 content token。"""
        if not self.configured:
            raise LLMGatewayError(
                "LLM is not configured. Please set LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL."
            )

        payload = {
            "model": self._model,
            "temperature": temperature,
            "messages": messages,
            "stream": True,
        }
        body = json.dumps(payload).encode("utf-8")
        http_request = request.Request(
            f"{self._base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )

        try:
            response = request.urlopen(http_request, timeout=120)
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise LLMGatewayError(f"LLM HTTP {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise LLMGatewayError(f"LLM connection failed: {exc.reason}") from exc
        except TimeoutError as exc:
            raise LLMGatewayError("LLM request timed out.") from exc

        try:
            for line in response:
                line = line.decode("utf-8").strip()
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                    delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue
        finally:
            response.close()
