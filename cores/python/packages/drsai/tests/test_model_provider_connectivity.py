from __future__ import annotations

import asyncio

from drsai.config import connectivity
from drsai.config.loader import parse_user_config
from drsai.config.resolver import resolve_model_config
from drsai.config.probe_history import clear_probe_history, latest_probe_result


class _Response:
    def __init__(self, status_code: int, payload) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _Client:
    response = _Response(200, {"data": [{"id": "custom-model"}]})
    request = None

    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, url, *, headers):
        type(self).request = ("GET", url, headers, None)
        return type(self).response

    async def post(self, url, *, headers, json):
        type(self).request = ("POST", url, headers, json)
        return type(self).response


def _resolved(*, wire_api="openai", requires_key=True):
    provider = {
        "base_url": "https://provider.example/v1",
        "wire_api": wire_api,
        "requires_api_key": requires_key,
    }
    if requires_key:
        provider["api_key"] = "probe-secret"
    return resolve_model_config(parse_user_config({
        "model": "custom-model",
        "model_provider": "custom",
        "model_providers": {"custom": provider},
    }))


def test_openai_model_probe_returns_bounded_output_without_leaking_secret(monkeypatch) -> None:
    clear_probe_history()
    _Client.response = _Response(200, {"choices": [{"message": {"content": "pong"}}]})
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)

    result = asyncio.run(connectivity.test_provider_connection(_resolved()))

    assert result["ok"] is True
    assert result["provider"] == "custom"
    assert result["wire_api"] == "openai"
    assert result["mode"] == "model"
    assert isinstance(result["duration_ms"], int)
    assert result["output"] == "pong"
    assert _Client.request[0:2] == ("POST", "https://provider.example/v1/chat/completions")
    assert _Client.request[2]["Authorization"] == "Bearer probe-secret"
    assert _Client.request[3]["messages"][-1] == {"role": "user", "content": "ping"}
    assert _Client.request[3]["max_tokens"] == 256
    assert "probe-secret" not in repr(result)
    latest = latest_probe_result("custom")
    assert latest["ok"] is True
    assert latest["model"] == "custom-model"
    assert latest["mode"] == "model"
    assert "output" not in latest
    assert "probe-secret" not in repr(latest)


def test_gemini_native_model_probe_uses_generate_content(monkeypatch) -> None:
    _Client.response = _Response(200, {"candidates": [{"content": {"parts": [{"text": "pong"}]}, "finishReason": "STOP"}]})
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    result = asyncio.run(connectivity.test_provider_connection(_resolved(wire_api="gemini")))
    assert result["ok"] is True
    assert result["wire_api"] == "gemini"
    assert _Client.request[0:2] == ("POST", "https://provider.example/v1/models/custom-model:generateContent")
    assert _Client.request[2]["x-goog-api-key"] == "probe-secret"
    assert _Client.request[3]["contents"][0]["parts"][0]["text"] == "ping"


def test_openai_probe_reports_missing_model_and_invalid_payload(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(404, {"error": {"message": "model not found"}})
    assert asyncio.run(connectivity.test_provider_connection(_resolved()))["error"] == "model_not_found"

    _Client.response = _Response(200, ValueError("not json"))
    assert asyncio.run(connectivity.test_provider_connection(_resolved()))["error"] == "invalid_response"


def test_basic_probe_does_not_require_model_in_catalog(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(200, {"data": [{"id": "other-model"}]})

    result = asyncio.run(connectivity.test_provider_connection(_resolved(), mode="basic"))

    assert result["ok"] is True
    assert result["mode"] == "basic"


def test_anthropic_and_no_key_probes_use_correct_protocol(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(200, {"content": [{"type": "text", "text": "pong"}]})
    result = asyncio.run(connectivity.test_provider_connection(_resolved(wire_api="anthropic")))
    assert result["ok"] is True
    assert result["output"] == "pong"
    assert _Client.request[0:2] == ("POST", "https://provider.example/v1/messages")
    assert _Client.request[2]["x-api-key"] == "probe-secret"
    assert _Client.request[3]["model"] == "custom-model"
    assert _Client.request[3]["messages"] == [{"role": "user", "content": "ping"}]
    assert _Client.request[3]["max_tokens"] == 256

    _Client.response = _Response(200, {"choices": [{"message": {"content": "pong"}}]})
    result = asyncio.run(connectivity.test_provider_connection(_resolved(requires_key=False)))
    assert result["ok"] is True
    assert _Client.request[2] == {"content-type": "application/json"}


def test_error_response_distinguishes_model_from_endpoint(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(404, {"error": {"message": "model not found"}})
    assert asyncio.run(connectivity.test_provider_connection(_resolved()))["error"] == "model_not_found"

    _Client.response = _Response(404, {"error": {"message": "route not found"}})
    assert asyncio.run(connectivity.test_provider_connection(_resolved()))["error"] == "endpoint_not_found"


def test_openai_model_probe_calls_chat_completion_directly(monkeypatch) -> None:
    class ChatOnlyClient(_Client):
        async def get(self, url, *, headers):
            type(self).request = ("GET", url, headers, None)
            return _Response(404, {"error": "route not found"})

        async def post(self, url, *, headers, json):
            type(self).request = ("POST", url, headers, json)
            return _Response(200, {"choices": [{"message": {"content": "pong"}}]})

    monkeypatch.setattr(connectivity.httpx, "AsyncClient", ChatOnlyClient)
    result = asyncio.run(connectivity.test_provider_connection(_resolved(), mode="model"))
    assert result["ok"] is True
    assert result["may_incur_cost"] is True
    assert result["output"] == "pong"
    assert ChatOnlyClient.request[0:2] == ("POST", "https://provider.example/v1/chat/completions")


def test_model_probe_fails_when_output_is_empty_or_not_pong(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(200, {"choices": [{"message": {"content": ""}}]})
    empty = asyncio.run(connectivity.test_provider_connection(_resolved(), mode="model"))
    assert empty["ok"] is False
    assert empty["error"] == "model_output_empty"

    _Client.response = _Response(200, {"choices": [{"message": {"content": "hello"}}]})
    mismatch = asyncio.run(connectivity.test_provider_connection(_resolved(), mode="model"))
    assert mismatch["ok"] is False
    assert mismatch["error"] == "model_output_mismatch"
    assert mismatch["output"] == "hello"
    assert "output" not in latest_probe_result("custom")


def test_reasoning_model_reports_exhausted_output_budget(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(200, {
        "choices": [{
            "finish_reason": "length",
            "message": {"content": "", "reasoning_content": "The model is still reasoning."},
        }],
    })

    result = asyncio.run(connectivity.test_provider_connection(_resolved(), mode="model"))

    assert result["ok"] is False
    assert result["error"] == "model_output_budget_exhausted"
    assert "reasoning_content" not in repr(result)


def test_rate_limit_has_stable_guidance(monkeypatch) -> None:
    monkeypatch.setattr(connectivity.httpx, "AsyncClient", _Client)
    _Client.response = _Response(429, {"error": "too many requests"})
    result = asyncio.run(connectivity.test_provider_connection(_resolved(), retries=0))
    assert result["error"] == "rate_limited"
    assert result["guidance"]["retryable"] is True
