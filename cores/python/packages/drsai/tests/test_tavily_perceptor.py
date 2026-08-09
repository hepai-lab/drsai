from __future__ import annotations

import asyncio
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


def test_search_falls_back_only_for_retryable_tavily_failure(monkeypatch) -> None:
    async def failed_search(self, *_args, **_kwargs):
        raise WebProviderError("timeout", "timeout", provider="tavily", retryable=True)
    async def fallback(query, limit):
        return WebSearchResponse(query=query, results=(), provider="bing-playwright")
    monkeypatch.setattr(TavilyClient, "search", failed_search)
    monkeypatch.setattr("drsai.backend.runtime.web_search.tool.search_bing_with_playwright", fallback)
    payload = asyncio.run(web_search("HEPiX 2026", provider_config={"api_key": "tvly-test"}))
    assert payload["provider"] == "bing-playwright"
    assert payload["warnings"] == ["tavily_fallback:timeout"]


def test_search_does_not_hide_tavily_authentication_failure(monkeypatch) -> None:
    async def failed_search(self, *_args, **_kwargs):
        raise WebProviderError("authentication_failed", "bad key", provider="tavily", retryable=False)
    monkeypatch.setattr(TavilyClient, "search", failed_search)
    with pytest.raises(WebProviderError, match="bad key"):
        asyncio.run(web_search("HEPiX 2026", provider_config={"api_key": "tvly-test"}))


def test_extract_retryable_failure_escalates_to_browser(monkeypatch) -> None:
    async def failed_extract(self, *_args, **_kwargs):
        raise WebProviderError("upstream_unavailable", "down", provider="tavily", retryable=True)
    async def browser_fetch(url, limit):
        return {"provider": "playwright", "final_url": url, "content": "fallback", "max_chars": limit}
    monkeypatch.setattr(TavilyClient, "extract", failed_extract)
    monkeypatch.setattr("drsai.backend.runtime.web_search.tool.fetch_with_playwright", browser_fetch)
    result = asyncio.run(web_fetch("https://www.hepix.org/", provider_config={"api_key": "tvly-test"}))
    assert result["provider"] == "playwright"


def test_gateway_perceptor_api_saves_public_payload_and_activates_runtime(monkeypatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    request = gateway.PerceptorRequest(
        perceptor_id="web-tavily-main", name="Tavily", kind="public_web", adapter="tavily",
        capabilities=["web.search", "web.extract"], config={"api_key": "tvly-api-test"}, enabled=True,
    )
    created = asyncio.run(gateway.create_perceptor(request, user_id="test-user"))
    assert created["config"]["api_key"] == PERCEPTOR_SECRET_PLACEHOLDER
    assert gateway._active_tavily_config_for_dir(tmp_path)["api_key"] == "tvly-api-test"
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
