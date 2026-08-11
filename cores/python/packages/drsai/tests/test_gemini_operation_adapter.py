from __future__ import annotations

import base64
import json

import httpx
import pytest

from drsai.config.gemini_operation_adapter import GeminiGenerateContentAdapter
from drsai.config.loader import parse_user_config
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.config.model_operation_adapters import ModelProtocolError
from drsai.config.model_operation_routing import resolve_agent_operation


def _resolved(role="image_understanding_model", model="gemini-3.6-flash", operation="chat"):
    config = parse_user_config({"model_providers": {"zhizengzeng": {
        "base_url": "https://provider.example/v1", "google_base_url": "https://provider.example/google",
        "requires_api_key": False,
        "models": {
            "gemini-3.6-flash": {"input_modalities": ["text", "image"], "output_modalities": ["text"], "api_protocol": "gemini", "capabilities": ["chat"]},
            "gemini-3.1-flash-lite-image": {"input_modalities": ["text", "image"], "output_modalities": ["text", "image"], "api_protocol": "gemini", "capabilities": ["chat", "image_generation"]},
        },
    }}})
    selection = AgentModelSelection("explicit", ModelRef("zhizengzeng", model))
    policy = AgentModelPolicy(
        agent_id="my-drsai",
        image_understanding_model=selection if role == "image_understanding_model" else None,
        image_generation_model=selection if role == "image_generation_model" else None,
    )
    return resolve_agent_operation(config, policy, role=role, operation=operation, require_credentials=False)


def test_gemini_image_understanding_request_and_text_result() -> None:
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["payload"] = json.loads(request.content)
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "{\"background\":\"red\"}"}]}}]})
    result = GeminiGenerateContentAdapter(transport=httpx.MockTransport(handler)).create(
        _resolved(), prompt="describe", image=b"png", image_mime="image/png",
    )
    assert seen["path"] == "/google/v1beta/models/gemini-3.6-flash:generateContent"
    assert seen["payload"]["contents"][0]["parts"][1]["inlineData"]["data"] == base64.b64encode(b"png").decode()
    assert result.text == '{"background":"red"}'


def test_gemini_function_call_is_normalized() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["tools"][0]["functionDeclarations"][0]["name"] == "calculator_add"
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"functionCall": {"name": "calculator_add", "args": {"a": 17, "b": 25}}}]}}]})
    result = GeminiGenerateContentAdapter(transport=httpx.MockTransport(handler)).create(
        _resolved(), prompt="add", tools=[{"type": "function", "name": "calculator_add", "parameters": {"type": "object"}}],
    )
    assert result.tool_calls[0].arguments == {"a": 17, "b": 25}


def test_gemini_mixed_text_image_result() -> None:
    raw = b"fake-image"
    adapter = GeminiGenerateContentAdapter(transport=httpx.MockTransport(lambda _request: httpx.Response(200, json={
        "candidates": [{"content": {"parts": [
            {"text": "generated"}, {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(raw).decode()}},
        ]}}],
    })))
    result = adapter.create(
        _resolved("image_generation_model", "gemini-3.1-flash-lite-image", "image_generation"),
        prompt="blue circle", response_modalities=("TEXT", "IMAGE"),
    )
    assert result.text == "generated"
    assert result.images[0].mime_type == "image/png" and result.images[0].content == raw


@pytest.mark.parametrize(("status", "code"), [(403, "permission_denied"), (404, "endpoint_not_found"), (429, "quota_exceeded")])
def test_gemini_errors_are_stable(status, code) -> None:
    adapter = GeminiGenerateContentAdapter(transport=httpx.MockTransport(lambda _request: httpx.Response(status)))
    with pytest.raises(ModelProtocolError) as raised:
        adapter.create(_resolved(), prompt="describe")
    assert raised.value.code == code


@pytest.mark.parametrize(("payload", "code", "retryable"), [
    ({"error": {"message": "Unknown model gemini-3.6-flash"}}, "model_not_found", False),
    ({"error": {"message": "Bad gateway from upstream service"}}, "provider_unreachable", True),
    ({"error": {"code": "operation_unsupported", "message": "Function tools are not supported"}}, "operation_unsupported", False),
])
def test_gemini_502_body_is_safely_classified(payload, code, retryable) -> None:
    adapter = GeminiGenerateContentAdapter(transport=httpx.MockTransport(
        lambda _request: httpx.Response(502, json=payload),
    ))
    with pytest.raises(ModelProtocolError) as raised:
        adapter.create(_resolved(), prompt="describe")
    assert raised.value.code == code
    assert raised.value.retryable is retryable
    assert str(raised.value) == "Provider rejected the Gemini request"
