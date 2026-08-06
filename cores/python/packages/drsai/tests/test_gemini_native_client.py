from __future__ import annotations

import asyncio
import json

import httpx
from autogen_core.models import UserMessage

from drsai.modules.components.model_client.gemini_client import GeminiNativeChatCompletionClient


def test_gemini_native_client_maps_text_request_and_usage() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["key"] = request.headers.get("x-goog-api-key")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": "hello"}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2},
        })

    client = GeminiNativeChatCompletionClient(model="gemini-2.5-pro", base_url="https://generativelanguage.googleapis.com/v1beta", api_key="secret")
    asyncio.run(client._client.aclose())
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(client.create([UserMessage(content="hi", source="user")]))
    assert result.content == "hello"
    assert result.usage.prompt_tokens == 3
    assert captured["url"] == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    assert captured["key"] == "secret"
    assert captured["body"]["contents"][0]["parts"] == [{"text": "hi"}]
    asyncio.run(client.close())


def test_gemini_native_client_maps_function_calls() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"functionCall": {"name": "lookup", "args": {"q": "x"}}}]}, "finishReason": "STOP"}]})

    client = GeminiNativeChatCompletionClient(model="gemini-2.5-pro", base_url="https://example.test/v1beta", api_key="secret")
    asyncio.run(client._client.aclose())
    client._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(client.create([UserMessage(content="find", source="user")]))
    assert result.finish_reason == "function_calls"
    assert result.content[0].name == "lookup"
    assert json.loads(result.content[0].arguments) == {"q": "x"}
    asyncio.run(client.close())
