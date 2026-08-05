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
    assert {item["id"] for item in presets} >= {"hepai", "openai", "anthropic", "ollama"}
    assert get_provider_preset("ollama").requires_api_key is False
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
    assert second["cached"] is True
    assert _Client.calls == 1
    assert "discovery-secret" not in repr(first)


def test_model_discovery_failure_keeps_manual_configuration_available(monkeypatch) -> None:
    model_discovery.clear_model_discovery_cache()
    monkeypatch.setattr(model_discovery.httpx, "AsyncClient", _Client)
    _Response.status_code = 503
    result = asyncio.run(model_discovery.discover_provider_models(_resolved(), refresh=True))
    _Response.status_code = 200
    assert result["ok"] is False
    assert result["models"] == []
    assert _resolved().model == "manual-model"
