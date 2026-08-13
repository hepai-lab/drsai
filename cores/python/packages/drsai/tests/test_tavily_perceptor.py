from __future__ import annotations

import asyncio
import logging
import pytest

from drsai.backend.runtime.web_search.tavily import TavilyClient, TavilyConfig
from drsai.backend.runtime.web_search.errors import WebProviderError
from drsai.backend.runtime.web_search.tool import web_fetch, web_search
from drsai.backend.runtime.web_search.contracts import WebSearchResponse, WebSearchResult
from drsai.config.perceptor_registry import (
    PERCEPTOR_SECRET_PLACEHOLDER,
    PerceptorResource,
    list_perceptor_resources,
    public_perceptor_payload,
    put_perceptor_resource,
    resolve_perceptor_config,
)


def test_perceptor_registry_protects_tavily_key(tmp_path) -> None:
    resource = put_perceptor_resource(tmp_path, PerceptorResource(
        "web-tavily-main", "public_web", "tavily", ("web.search", "web.extract"),
        {"api_key": "tvly-test-secret", "search_depth": "basic"}, "Tavily", True,
    ))
    stored = (tmp_path / "perceptors" / "perceptor_web-tavily-main.toml").read_text(encoding="utf-8")
    assert "tvly-test-secret" not in stored
    assert public_perceptor_payload(resource)["config"]["api_key"] == PERCEPTOR_SECRET_PLACEHOLDER
    loaded = list_perceptor_resources(tmp_path)[0]
    assert resolve_perceptor_config(loaded, tmp_path)["api_key"] == "tvly-test-secret"


def test_tavily_search_maps_content_to_snippet_not_full_content(monkeypatch) -> None:
    client = TavilyClient(TavilyConfig("tvly-test"))

    async def fake_post(endpoint, payload):
        assert endpoint == "search"
        assert payload["query"] == "Hepix 2026"
        assert payload["include_answer"] is False
        assert payload["include_raw_content"] is False
        return {"request_id": "req-search", "response_time": 0.125, "usage": {"credits": 1}, "results": [{"title": "HEPiX Spring 2026", "url": "https://www.hepix.org/", "content": "HEPiX forum information", "score": 0.9}]}

    monkeypatch.setattr(client, "_post", fake_post)
    response = asyncio.run(client.search("Hepix2026是什么", 3))
    assert response.provider == "tavily"
    assert response.query == "Hepix 2026"
    assert response.results[0].snippet == "HEPiX forum information"
    assert response.results[0].content == ""
    assert response.results[0].score == 0.9
    assert response.public_dict()["receipt"] == {"request_id": "req-search", "latency_ms": 125, "usage_units": 1.0}


def test_tavily_uses_windows_system_proxy_configuration(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        status = 200
        headers: dict[str, str] = {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def json(self, *, content_type=None):
            return {"results": []}

    class FakeSession:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr("drsai.backend.runtime.web_search.tavily.aiohttp.ClientSession", FakeSession)

    result = asyncio.run(TavilyClient(TavilyConfig("tvly-test"))._post_once(
        "search", {"query": "HEPiX 2026"},
    ))

    assert result == {"results": []}
    assert captured["trust_env"] is True


def test_tavily_extract_is_bounded_and_hashed(monkeypatch) -> None:
    client = TavilyClient(TavilyConfig("tvly-test"))

    async def admit(url): return url
    async def fake_post(endpoint, payload):
        assert endpoint == "extract"
        return {"request_id": "req-extract", "response_time": 0.2, "usage": {"credits": 2}, "results": [{"url": "https://www.hepix.org/", "raw_content": "x" * 1500}]}

    monkeypatch.setattr("drsai.backend.runtime.web_search.tavily.ensure_public_url", admit)
    monkeypatch.setattr(client, "_post", fake_post)
    result = asyncio.run(client.extract("https://www.hepix.org/", max_chars=1000))
    assert len(result["content"]) == 1000
    assert result["truncated"] is True
    assert len(result["content_sha256"]) == 64
    assert result["receipt"] == {"request_id": "req-extract", "latency_ms": 200, "usage_units": 2.0}


def test_tavily_retries_transient_failures_without_logging_credentials(monkeypatch, caplog) -> None:
    client = TavilyClient(TavilyConfig("tvly-super-secret"))
    attempts = 0

    async def flaky_post_once(endpoint, payload):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            error = WebProviderError(
                "upstream_unavailable", "Tavily is currently unavailable.",
                provider="tavily", retryable=True,
            )
            error.__cause__ = ConnectionResetError("connection reset")
            raise error
        return {"results": []}

    async def no_delay(_seconds):
        return None

    monkeypatch.setattr(client, "_post_once", flaky_post_once)
    monkeypatch.setattr("drsai.backend.runtime.web_search.tavily.asyncio.sleep", no_delay)
    with caplog.at_level(logging.WARNING):
        result = asyncio.run(client._post("search", {"query": "HEPiX 2026"}))
    assert result == {"results": []}
    assert attempts == 3
    assert "ConnectionResetError" in caplog.text
    assert "tvly-super-secret" not in caplog.text


def test_tavily_does_not_retry_non_retryable_failure(monkeypatch) -> None:
    client = TavilyClient(TavilyConfig("tvly-test"))
    attempts = 0

    async def rejected_post_once(endpoint, payload):
        nonlocal attempts
        attempts += 1
        raise WebProviderError(
            "authentication_failed", "bad key", provider="tavily", retryable=False,
        )

    monkeypatch.setattr(client, "_post_once", rejected_post_once)
    with pytest.raises(WebProviderError, match="bad key"):
        asyncio.run(client._post("search", {"query": "HEPiX 2026"}))
    assert attempts == 1


def test_search_does_not_fallback_for_retryable_tavily_failure(monkeypatch) -> None:
    async def failed_search(self, *_args, **_kwargs):
        raise WebProviderError("timeout", "timeout", provider="tavily", retryable=True)
    monkeypatch.setattr(TavilyClient, "search", failed_search)
    with pytest.raises(WebProviderError, match="timeout"):
        asyncio.run(web_search("HEPiX 2026", provider_config={"api_key": "tvly-test"}))


def test_search_does_not_hide_tavily_authentication_failure(monkeypatch) -> None:
    async def failed_search(self, *_args, **_kwargs):
        raise WebProviderError("authentication_failed", "bad key", provider="tavily", retryable=False)
    monkeypatch.setattr(TavilyClient, "search", failed_search)
    with pytest.raises(WebProviderError, match="bad key"):
        asyncio.run(web_search("HEPiX 2026", provider_config={"api_key": "tvly-test"}))


def test_extract_retryable_failure_does_not_fallback_to_browser(monkeypatch) -> None:
    async def failed_extract(self, *_args, **_kwargs):
        raise WebProviderError("upstream_unavailable", "down", provider="tavily", retryable=True)
    monkeypatch.setattr(TavilyClient, "extract", failed_extract)
    with pytest.raises(WebProviderError, match="down"):
        asyncio.run(web_fetch("https://www.hepix.org/", provider_config={"api_key": "tvly-test"}))


def test_gateway_perceptor_api_saves_public_payload_and_activates_runtime(monkeypatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    stale_users: list[str] = []

    async def mark_stale(user_id: str) -> int:
        stale_users.append(user_id)
        return 1

    async def disruptive_evict(_user_id: str) -> int:
        raise AssertionError("Perceptor activation must not evict an active Agent")

    monkeypatch.setattr(gateway.manager, "mark_user_config_stale", mark_stale)
    monkeypatch.setattr(gateway.manager, "evict_user", disruptive_evict)
    request = gateway.PerceptorRequest(
        perceptor_id="web-tavily-main", name="Tavily", kind="public_web", adapter="tavily",
        capabilities=["web.search", "web.extract"], config={"api_key": "tvly-api-test"}, enabled=True,
    )
    created = asyncio.run(gateway.create_perceptor(request, user_id="test-user"))
    assert created["config"]["api_key"] == PERCEPTOR_SECRET_PLACEHOLDER
    assert gateway._active_tavily_config_for_dir(tmp_path)["api_key"] == "tvly-api-test"
    assert stale_users == ["test-user"]
    listing = asyncio.run(gateway.list_perceptors(user_id="test-user"))
    assert listing["data"][0]["perceptor_id"] == "web-tavily-main"


def test_gateway_perceptor_tests_search_and_extract_independently(monkeypatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    put_perceptor_resource(tmp_path, PerceptorResource(
        "web-tavily-main", "public_web", "tavily", ("web.search", "web.extract"),
        {"api_key": "tvly-api-test"}, "Tavily", True,
    ))

    async def fake_search(self, query, max_results):
        assert query == "HEPiX 2026"
        return WebSearchResponse(query=query, results=(
            WebSearchResult(rank=1, title="HEPiX Spring 2026", url="https://www.hepix.org/"),
        ), provider="tavily")

    async def fake_extract(self, url, *, max_chars):
        assert url == "https://www.hepix.org/"
        assert max_chars == 2_000
        return {"content": "HEPiX", "provider": "tavily", "receipt": {"request_id": "req-extract"}}

    monkeypatch.setattr(TavilyClient, "search", fake_search)
    monkeypatch.setattr(TavilyClient, "extract", fake_extract)
    search_result = asyncio.run(gateway.test_perceptor("web-tavily-main", "search", "test-user"))
    extract_result = asyncio.run(gateway.test_perceptor("web-tavily-main", "extract", "test-user"))
    assert search_result["ok"] is True and search_result["tested"] == "search"
    assert extract_result["ok"] is True and extract_result["tested"] == "extract"


def test_capability_resume_prefetches_bounded_trusted_web_evidence(monkeypatch) -> None:
    from drsai.backend import gateway

    captured: dict[str, object] = {}

    async def fake_web_search(query, max_results, *, provider_config):
        captured.update(query=query, max_results=max_results, provider_config=provider_config)
        return {
            "version": 1,
            "provider": "tavily",
            "retrieved_at": "2026-08-10T18:34:00Z",
            "results": [{
                "rank": 1,
                "title": "HEPiX Spring 2026",
                "url": "https://www.hepix.org/",
                "snippet": "Current HEPiX information",
            }],
            "partial": False,
            "warnings": [],
        }

    monkeypatch.setattr(gateway, "web_search", fake_web_search)
    evidence = asyncio.run(gateway._prefetch_configured_web_evidence(
        "  HEPiX   2026 是什么？  " + "x" * 600,
        {"api_key": "tvly-test"},
    ))

    assert len(str(captured["query"])) == 500
    assert "  " not in str(captured["query"])
    assert captured["max_results"] == 6
    assert captured["provider_config"] == {"api_key": "tvly-test"}
    assert evidence["provider"] == "tavily"
    assert evidence["result_count"] == 1
    assert evidence["results"][0]["url"] == "https://www.hepix.org/"
    assert str(evidence["sha256"]).startswith("sha256:")
    assert "tvly-test" not in evidence["prompt_json"]


def test_configured_web_prefetch_policy_covers_later_conversations() -> None:
    from drsai.backend import gateway

    defaults = {
        "is_codex_run": False,
        "web_search_declined": False,
        "requires_current_web": True,
        "regression_provides_web_search": False,
        "regression_forbids_web_search": False,
        "resuming_capability_configuration": False,
        "capability_resolution": None,
    }
    assert gateway._should_prefetch_configured_web_evidence(**defaults) is True
    assert gateway._should_prefetch_configured_web_evidence(
        **{**defaults, "resuming_capability_configuration": True, "capability_resolution": "resume"},
    ) is True
    for override in (
        {"is_codex_run": True},
        {"web_search_declined": True},
        {"requires_current_web": False},
        {"regression_provides_web_search": True},
        {"regression_forbids_web_search": True},
        {"resuming_capability_configuration": True, "capability_resolution": "without_network"},
    ):
        assert gateway._should_prefetch_configured_web_evidence(
            **{**defaults, **override},
        ) is False
