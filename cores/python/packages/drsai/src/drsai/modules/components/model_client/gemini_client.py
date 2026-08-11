"""Gemini native ``generateContent`` client for the unified Agent Runtime."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Mapping, Sequence
from typing import Any
from uuid import uuid4

import httpx
from autogen_core import CancellationToken, FunctionCall, Image
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    ModelCapabilities,
    ModelFamily,
    ModelInfo,
    RequestUsage,
    SystemMessage,
    UserMessage,
)
from autogen_core.tools import Tool, ToolSchema
from pydantic import BaseModel


class GeminiNativeChatCompletionClient(ChatCompletionClient):
    """Small native Gemini adapter with text, images, and function calls."""

    def __init__(self, *, model: str, base_url: str, api_key: str, max_tokens: int = 8192, timeout: float = 60.0, vision: bool = True) -> None:
        self._model = model.removeprefix("models/")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._max_tokens = max_tokens
        self._client = httpx.AsyncClient(timeout=timeout)
        self._actual = RequestUsage(prompt_tokens=0, completion_tokens=0)
        self._total = RequestUsage(prompt_tokens=0, completion_tokens=0)
        self._model_info: ModelInfo = {
            "vision": vision,
            "function_calling": True,
            "json_output": True,
            "structured_output": False,
            "family": ModelFamily.GEMINI_2_5_PRO,
            "multiple_system_messages": True,
        }

    async def create(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        json_output: bool | type[BaseModel] | None = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: CancellationToken | None = None,
    ) -> CreateResult:
        if cancellation_token is not None and cancellation_token.is_cancelled():
            raise RuntimeError("Gemini request cancelled")
        payload = self._request_payload(messages, tools, json_output, extra_create_args)
        response = await self._client.post(
            f"{self._base_url}/models/{self._model}:generateContent",
            headers={"x-goog-api-key": self._api_key, "content-type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        return self._decode_response(response.json())

    async def create_stream(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        json_output: bool | type[BaseModel] | None = None,
        extra_create_args: Mapping[str, Any] = {},
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[str | CreateResult, None]:
        result = await self.create(messages, tools=tools, json_output=json_output, extra_create_args=extra_create_args, cancellation_token=cancellation_token)
        if isinstance(result.content, str) and result.content:
            yield result.content
        yield result

    async def close(self) -> None:
        await self._client.aclose()

    def actual_usage(self) -> RequestUsage:
        return self._actual

    def total_usage(self) -> RequestUsage:
        return self._total

    def count_tokens(self, messages: Sequence[LLMMessage], *, tools: Sequence[Tool | ToolSchema] = []) -> int:
        text = " ".join(str(getattr(message, "content", "")) for message in messages)
        return max(1, len(text) // 4) + len(tools) * 32

    def remaining_tokens(self, messages: Sequence[LLMMessage], *, tools: Sequence[Tool | ToolSchema] = []) -> int:
        return max(0, 1_000_000 - self.count_tokens(messages, tools=tools))

    @property
    def capabilities(self) -> ModelCapabilities:  # pragma: no cover - compatibility shim
        return self._model_info

    @property
    def model_info(self) -> ModelInfo:
        return self._model_info

    def _request_payload(self, messages: Sequence[LLMMessage], tools: Sequence[Tool | ToolSchema], json_output: bool | type[BaseModel] | None, extra: Mapping[str, Any]) -> dict[str, Any]:
        system_parts: list[dict[str, str]] = []
        contents: list[dict[str, Any]] = []
        for message in messages:
            if isinstance(message, SystemMessage):
                system_parts.append({"text": message.content})
            elif isinstance(message, UserMessage):
                parts: list[dict[str, Any]] = []
                values = message.content if isinstance(message.content, list) else [message.content]
                for value in values:
                    parts.append({"inlineData": {"mimeType": "image/png", "data": value.to_base64()}} if isinstance(value, Image) else {"text": str(value)})
                contents.append({"role": "user", "parts": parts})
            elif isinstance(message, AssistantMessage):
                if isinstance(message.content, str):
                    parts = [{"text": message.content}]
                else:
                    parts = [{"functionCall": {"name": call.name, "args": _json_object(call.arguments)}} for call in message.content]
                contents.append({"role": "model", "parts": parts})
            elif isinstance(message, FunctionExecutionResultMessage):
                contents.append({"role": "user", "parts": [{"functionResponse": {"name": item.name, "response": {"result": item.content}}} for item in message.content]})
        generation: dict[str, Any] = {"maxOutputTokens": self._max_tokens}
        if json_output:
            generation["responseMimeType"] = "application/json"
            if isinstance(json_output, type) and issubclass(json_output, BaseModel):
                generation["responseSchema"] = json_output.model_json_schema()
        generation.update({key: value for key, value in extra.items() if key in {"temperature", "topP", "topK", "stopSequences", "candidateCount"}})
        payload: dict[str, Any] = {"contents": contents, "generationConfig": generation}
        if system_parts:
            payload["systemInstruction"] = {"parts": system_parts}
        declarations = []
        for tool in tools:
            schema = tool.schema if isinstance(tool, Tool) else tool
            declarations.append({"name": schema["name"], "description": schema.get("description", ""), "parameters": schema.get("parameters", {"type": "object", "properties": {}})})
        if declarations:
            payload["tools"] = [{"functionDeclarations": declarations}]
        return payload

    def _decode_response(self, payload: object) -> CreateResult:
        if not isinstance(payload, dict):
            raise ValueError("Gemini returned a non-object response")
        candidates = payload.get("candidates")
        if not isinstance(candidates, list) or not candidates or not isinstance(candidates[0], dict):
            raise ValueError("Gemini response contains no candidate")
        candidate = candidates[0]
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            raise ValueError("Gemini response contains no content parts")
        calls: list[FunctionCall] = []
        texts: list[str] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                texts.append(part["text"])
            call = part.get("functionCall")
            if isinstance(call, dict) and isinstance(call.get("name"), str):
                calls.append(FunctionCall(id=uuid4().hex, name=call["name"], arguments=json.dumps(call.get("args", {}), ensure_ascii=False)))
        usage_raw = payload.get("usageMetadata")
        prompt = int(usage_raw.get("promptTokenCount", 0)) if isinstance(usage_raw, dict) else 0
        completion = int(usage_raw.get("candidatesTokenCount", 0)) if isinstance(usage_raw, dict) else 0
        usage = RequestUsage(prompt_tokens=prompt, completion_tokens=completion)
        self._actual = usage
        self._total = RequestUsage(prompt_tokens=self._total.prompt_tokens + prompt, completion_tokens=self._total.completion_tokens + completion)
        finish = str(candidate.get("finishReason", "STOP"))
        finish_reason = "function_calls" if calls else "length" if finish == "MAX_TOKENS" else "content_filter" if finish in {"SAFETY", "RECITATION", "BLOCKLIST"} else "stop"
        return CreateResult(finish_reason=finish_reason, content=calls if calls else "\n".join(texts), usage=usage, cached=False)


def _json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}
