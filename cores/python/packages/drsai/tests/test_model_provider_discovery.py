from __future__ import annotations

import asyncio

from drsai.config import model_discovery
from drsai.config.loader import parse_user_config
from drsai.config.provider_presets import get_provider_preset, list_provider_presets
from drsai.config.resolver import resolve_model_config


class _Response:
    status_code = 200
    payload = {"data": [{"id": "z-model"}, {"id": "a-model"}, {"id": "a-model"}]}

    def json(self):
        return self.payload


class _Client:
    calls = 0

    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, _url, *, headers):
        type(self).calls += 1
        assert headers["Authorization"] == "Bearer discovery-secret"
        return _Response()


def _resolved():
    return resolve_model_config(parse_user_config({
        "model": "manual-model",
        "model_provider": "custom",
        "model_providers": {"custom": {
            "base_url": "https://provider.example/v1",
            "api_key": "discovery-secret",
        }},
    }))


def test_presets_keep_invariant_fields_outside_user_config() -> None:
    presets = list_provider_presets()
    assert {item["id"] for item in presets} >= {
        "hepai", "deepseek", "openai", "anthropic", "gemini", "openrouter", "zhizengzeng", "ollama"
    }
    assert get_provider_preset("hepai").label == "HepAI（高能 AI 平台）"
    assert get_provider_preset("hepai").default_model == "deepseek-v4-pro"
    assert get_provider_preset("hepai").auth_mode == "oidc"
    assert get_provider_preset("hepai").requires_api_key is False
    assert get_provider_preset("gemini").base_url == "https://generativelanguage.googleapis.com/v1beta"
    assert get_provider_preset("gemini").wire_api == "gemini"
    assert get_provider_preset("openrouter").base_url == "https://openrouter.ai/api/v1"
    assert get_provider_preset("zhizengzeng").base_url == "https://api.zhizengzeng.com/v1"
    assert get_provider_preset("ollama").requires_api_key is False
    assert get_provider_preset("ollama").auth_mode == "none"
    assert all("api_key" not in item for item in presets)


def test_model_discovery_sorts_deduplicates_and_caches(monkeypatch) -> None:
    model_discovery.clear_model_discovery_cache()
    _Client.calls = 0
    monkeypatch.setattr(model_discovery.httpx, "AsyncClient", _Client)

    first = asyncio.run(model_discovery.discover_provider_models(_resolved()))
    second = asyncio.run(model_discovery.discover_provider_models(_resolved()))

    assert first["ok"] is True
    assert first["provider"] == "custom"
    assert first["models"] == ["a-model", "z-model"]
    assert first["cached"] is False
    assert first["updated_at"]
    assert first["model_details"][0]["known_model"] is False
    assert first["model_details"][0]["metadata_source"] == "unknown"
    assert first["model_details"][0]["vision"] is False
    assert first["model_details"][0]["function_calling"] is False
    assert first["descriptors"][0]["ref"] == {"provider_id": "custom", "model_id": "a-model"}
    assert first["descriptors"][0]["input_modalities"] == []
    assert first["descriptors"][0]["operations"] == []
    assert first["catalog_revision"].startswith("sha256:")
    assert first["catalog_state"] == "fresh"
    assert second["cached"] is True
    assert _Client.calls == 1
    assert "discovery-secret" not in repr(first)
    snapshot = model_discovery.cached_provider_model_catalog("custom", "https://provider.example/v1")
    assert snapshot is not None
    assert snapshot["models"] == ["a-model", "z-model"]
    assert snapshot["availability"] == "available"


def test_model_discovery_failure_keeps_manual_configuration_available(monkeypatch) -> None:
    model_discovery.clear_model_discovery_cache()
    monkeypatch.setattr(model_discovery.httpx, "AsyncClient", _Client)
    _Response.status_code = 503
    result = asyncio.run(model_discovery.discover_provider_models(_resolved(), refresh=True))
    _Response.status_code = 200
    assert result["ok"] is False
    assert result["models"] == []
    assert result["descriptors"] == []
    assert result["catalog_state"] == "error"
    cached = model_discovery.cached_provider_model_catalog("custom", "https://provider.example/v1")
    assert cached is not None
    assert cached["catalog_state"] == "error"
    assert cached["availability"] == "error"
    assert _resolved().model == "manual-model"


def test_config_invalidation_prevents_inflight_old_discovery_from_refilling_cache(monkeypatch) -> None:
    model_discovery.clear_model_discovery_cache()

    async def scenario() -> None:
        started = asyncio.Event()
        release = asyncio.Event()
        calls = 0

        class Response:
            status_code = 200

            def __init__(self, model: str) -> None:
                self.model = model

            def json(self):
                return {"data": [{"id": self.model}]}

        class DelayedClient:
            def __init__(self, *, timeout: float) -> None:
                self.timeout = timeout

            async def __aenter__(self): return self
            async def __aexit__(self, *_args): return None

            async def get(self, _url, *, headers):
                nonlocal calls
                calls += 1
                if calls == 1:
                    started.set()
                    await release.wait()
                    return Response("old-model")
                return Response("new-model")

        monkeypatch.setattr(model_discovery.httpx, "AsyncClient", DelayedClient)
        old_request = asyncio.create_task(model_discovery.discover_provider_models(_resolved(), refresh=True))
        await started.wait()
        model_discovery.clear_model_discovery_cache()
        release.set()
        old_result = await old_request
        next_result = await model_discovery.discover_provider_models(_resolved())

        assert old_result["models"] == ["old-model"]
        assert next_result["models"] == ["new-model"]
        assert next_result["cached"] is False
        assert calls == 2

    asyncio.run(scenario())


def test_expired_cache_is_explicitly_stale_until_refresh(monkeypatch) -> None:
    model_discovery.clear_model_discovery_cache()
    _Client.calls = 0
    monkeypatch.setattr(model_discovery.httpx, "AsyncClient", _Client)
    first = asyncio.run(model_discovery.discover_provider_models(_resolved(), cache_ttl=0))
    stale = asyncio.run(model_discovery.discover_provider_models(_resolved()))
    assert first["catalog_state"] == "fresh"
    snapshot = model_discovery.cached_provider_model_catalog("custom", "https://provider.example/v1")
    assert snapshot is not None
    assert snapshot["catalog_state"] == "stale"
    assert snapshot["availability"] == "stale"
    refreshed = asyncio.run(model_discovery.discover_provider_models(_resolved(), refresh=True))
    assert stale["catalog_state"] == "stale"
    assert stale["descriptors"][0]["availability"] == "stale"
    assert stale["catalog_revision"] != first["catalog_revision"]
    assert refreshed["catalog_state"] == "fresh"
    assert _Client.calls == 2


def test_discovery_failures_keep_distinct_catalog_states(monkeypatch) -> None:
    class FailureResponse:
        status_code = 401

    class FailureClient(_Client):
        async def get(self, _url, *, headers):
            return FailureResponse()

    model_discovery.clear_model_discovery_cache()
    monkeypatch.setattr(model_discovery.httpx, "AsyncClient", FailureClient)
    unauthorized = asyncio.run(model_discovery.discover_provider_models(_resolved(), refresh=True))
    assert unauthorized["catalog_state"] == "unauthorized"
    assert unauthorized["error"] == "authentication_failed"
    cached_unauthorized = model_discovery.cached_provider_model_catalog("custom", "https://provider.example/v1")
    assert cached_unauthorized is not None
    assert cached_unauthorized["availability"] == "unauthorized"

    class OfflineClient(_Client):
        async def get(self, _url, *, headers):
            raise model_discovery.httpx.ConnectError("offline")

    monkeypatch.setattr(model_discovery.httpx, "AsyncClient", OfflineClient)
    offline = asyncio.run(model_discovery.discover_provider_models(_resolved(), refresh=True))
    assert offline["catalog_state"] == "offline"
    assert offline["error"] == "connection_failed"
