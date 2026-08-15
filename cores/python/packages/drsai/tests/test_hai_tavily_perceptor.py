from __future__ import annotations

import asyncio

import pytest

from drsai.backend.runtime.web_search.errors import WebProviderError
from drsai.backend.runtime.web_search.hai_tavily import (
    DEFAULT_WORKER_MODEL,
    HaiTavilyClient,
    HaiTavilyConfig,
    _managed_http_error,
    _unwrap_if_result,
)
from drsai.backend.runtime.web_search.tool import web_search
from drsai.platform_auth import PlatformAuthContext, platform_auth_scope
from drsai.config.perceptor_registry import PerceptorResource, put_perceptor_resource
from drsai.backend.runtime.web_search.provider_policy import write_provider_mode


def auth(base_url: str = "https://ai-dev.ihep.ac.cn/apiv2/v1") -> PlatformAuthContext:
    return PlatformAuthContext(
        access_token="secret-oidc-token", subject="00000000-0000-4000-8000-000000000001",
        issuer="https://ai-dev.ihep.ac.cn/api", expires_at=4_000_000_000,
        model_base_url=base_url,
    )


def test_managed_config_rejects_client_credentials_and_routes() -> None:
    for key in ("api_key", "base_url", "worker_url", "project_id"):
        with pytest.raises(WebProviderError, match="does not accept"):
            HaiTavilyConfig.from_mapping({key: "forbidden"})
    with pytest.raises(WebProviderError, match="not allowed"):
        HaiTavilyConfig.from_mapping({"model": "other-worker"})


def test_managed_endpoint_is_exact_and_trusted() -> None:
    client = HaiTavilyClient(HaiTavilyConfig(), auth())
    assert client._endpoint("search") == (
        "https://ai-dev.ihep.ac.cn/apiv2/v1/tools/web-search/search"
    )
    with pytest.raises(WebProviderError) as forbidden:
        client._endpoint("arbitrary")
    assert forbidden.value.code == "function_not_allowed"
    with pytest.raises(WebProviderError) as untrusted:
        HaiTavilyClient(HaiTavilyConfig(), auth("https://attacker.invalid/apiv2/v1"))._endpoint("search")
    assert untrusted.value.code == "managed_route_untrusted"


def test_managed_endpoint_requires_login() -> None:
    with pytest.raises(WebProviderError) as caught:
        HaiTavilyClient(HaiTavilyConfig(), None)._endpoint("search")
    assert caught.value.code == "login_required"


def test_if_envelope_and_errors_are_stable() -> None:
    assert _unwrap_if_result({"result": {"data": {"results": []}}}) == {"results": []}
    assert _managed_http_error(403, {"error": {"code": "quota_exhausted"}}) == ("quota_exhausted", False)
    assert _managed_http_error(503, {}) == ("worker_unavailable", True)
    assert _managed_http_error(504, {"error": {"code": "upstream_timeout"}}) == ("provider_timeout", True)
    assert _managed_http_error(429, {"error": {"code": "quota_exceeded"}}) == ("quota_exhausted", False)
    assert _managed_http_error(503, {"error": {"code": "provider_error"}}) == ("provider_unavailable", True)
    assert _managed_http_error(401, {"error": {"code": "provider_authentication_failed"}}) == ("provider_authentication_failed", False)
    assert _managed_http_error(429, {"error": {"code": "provider_rate_limited"}}) == ("provider_rate_limited", True)
    assert _managed_http_error(429, {"error": {"code": "provider_quota_exhausted"}}) == ("provider_quota_exhausted", False)
    assert _managed_http_error(502, {"error": {"code": "provider_invalid_response"}}) == ("provider_invalid_response", True)
    assert _managed_http_error(422, {"error": {"code": "unsafe_web_url"}}) == ("unsafe_web_url", False)


def test_capability_catalog_unwraps_exact_ddf_list_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = [
        {"object": "list", "data": [{"id": DEFAULT_WORKER_MODEL, "functions": ["extract", "search"], "available": True, "enabled": True}]},
        {"object": "list", "status": "permission_denied", "data": []},
        {"object": "list", "status": "worker_unavailable", "retryable": True, "data": []},
    ]
    class Response:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def json(self, **_kwargs): return payloads.pop(0)
    class Session:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        def get(self, *_args, **_kwargs): return Response()
    monkeypatch.setattr("drsai.backend.runtime.web_search.hai_tavily.aiohttp.ClientSession", Session)
    client = HaiTavilyClient(HaiTavilyConfig(), auth())
    assert asyncio.run(client.capabilities()) == {"id": DEFAULT_WORKER_MODEL, "functions": ["extract", "search"], "available": True, "enabled": True}
    assert asyncio.run(client.capabilities()) == {"available": False, "enabled": False, "functions": [], "error": "permission_denied", "retryable": False}
    assert asyncio.run(client.capabilities()) == {"available": False, "enabled": False, "functions": [], "error": "worker_unavailable", "retryable": True}


def test_managed_invoke_uses_frozen_infinite_function_envelope(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    class Response:
        status = 200
        headers = {"x-request-id": "req-if"}
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def json(self, **_kwargs): return {"object": "web_search.response", "request_id": "req-if", "trace_id": "trace-if", "model": DEFAULT_WORKER_MODEL, "function": "search", "data": {"results": []}}

    class Session:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        def post(self, endpoint, *, headers, json):
            captured.update(endpoint=endpoint, headers=headers, json=json)
            return Response()

    monkeypatch.setattr("drsai.backend.runtime.web_search.hai_tavily.aiohttp.ClientSession", Session)
    result = asyncio.run(HaiTavilyClient(HaiTavilyConfig(), auth())._invoke("search", {"query": "HEPiX"}))
    assert result == {"results": [], "request_id": "req-if", "_ddf_trace_id": "trace-if", "_ddf_model": DEFAULT_WORKER_MODEL, "_ddf_function": "search"}
    assert captured["json"] == {"model": DEFAULT_WORKER_MODEL, "arguments": {"query": "HEPiX"}}
    assert captured["headers"]["Authorization"] == "Bearer secret-oidc-token"
    assert len(captured["headers"]["Idempotency-Key"]) == 32
    assert "api_key" not in repr(captured["json"])


def test_managed_invoke_preserves_public_error_identity_without_raw_body(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        status = 429
        headers = {}
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def json(self, **_kwargs):
            return {"error": {"code": "provider_rate_limited", "request_id": "req-ddf-rate", "message": "SECRET-UPSTREAM-BODY"}}
    class Session:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        def post(self, *_args, **_kwargs): return Response()
    monkeypatch.setattr("drsai.backend.runtime.web_search.hai_tavily.aiohttp.ClientSession", Session)
    with pytest.raises(WebProviderError) as caught:
        asyncio.run(HaiTavilyClient(HaiTavilyConfig(), auth())._invoke("search", {"query": "HEPiX"}))
    assert caught.value.code == "provider_rate_limited"
    assert caught.value.retryable is True
    assert caught.value.request_id == "req-ddf-rate"
    assert "SECRET-UPSTREAM-BODY" not in str(caught.value)


def test_managed_invoke_propagates_cancellation_without_mapping_or_late_result(monkeypatch: pytest.MonkeyPatch) -> None:
    entered = asyncio.Event()
    released = asyncio.Event()

    class Response:
        status = 200
        headers = {}
        async def __aenter__(self):
            entered.set()
            await asyncio.Event().wait()
        async def __aexit__(self, *_args):
            released.set()
    class Session:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): released.set()
        def post(self, *_args, **_kwargs): return Response()

    monkeypatch.setattr("drsai.backend.runtime.web_search.hai_tavily.aiohttp.ClientSession", Session)

    async def scenario() -> None:
        task = asyncio.create_task(HaiTavilyClient(HaiTavilyConfig(), auth())._invoke("search", {"query": "HEPiX"}))
        await asyncio.wait_for(entered.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.wait_for(released.wait(), timeout=1)

    asyncio.run(scenario())


def test_managed_search_maps_to_provider_neutral_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    async def invoke(self, function, arguments):
        captured.update({"function": function, "arguments": arguments})
        return {
            "request_id": "req-managed", "response_time": 0.25,
            "_ddf_trace_id": "trace-managed", "_ddf_model": DEFAULT_WORKER_MODEL, "_ddf_function": "search",
            "usage": {"credits": 1},
            "results": [{"title": "HEPiX Spring 2026", "url": "https://indico.cern.ch/event/1598655", "content": "Workshop", "score": 0.9}],
        }

    monkeypatch.setattr(HaiTavilyClient, "_invoke", invoke)
    with platform_auth_scope(auth()):
        result = asyncio.run(web_search("HEPiX2026是什么", 3, provider_config={"adapter": "hai_managed_tavily"}))
    assert result["provider"] == "hai_managed_tavily"
    assert result["results"][0]["url"] == "https://indico.cern.ch/event/1598655"
    assert result["receipt"] == {"request_id": "req-managed", "latency_ms": 250, "usage_units": 1.0, "trace_id": "trace-managed", "model": DEFAULT_WORKER_MODEL, "function": "search"}
    assert captured["function"] == "search"
    assert captured["arguments"]["include_answer"] is False
    assert captured["arguments"]["include_raw_content"] is False
    assert captured["arguments"]["auto_parameters"] is False
    assert "api_key" not in captured["arguments"]
    assert DEFAULT_WORKER_MODEL == "hepai/tavily-web-search-v1"


def test_gateway_projects_managed_perceptor_only_inside_authenticated_scope(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    async def discovered(self):
        return {"available": True, "enabled": True, "functions": ["search", "extract"]}
    monkeypatch.setattr(HaiTavilyClient, "capabilities", discovered)
    signed_out = asyncio.run(gateway.list_perceptors())
    assert signed_out["data"] == []
    assert gateway._active_web_search_config() is None

    with platform_auth_scope(auth()):
        signed_in = asyncio.run(gateway.list_perceptors())
        managed = signed_in["data"][0]
        assert managed["perceptor_id"] == "hai-managed-web-search"
        assert managed["adapter"] == "hai_managed_tavily"
        assert managed["config"] == {"managed": True, "credential_source": "platform_session"}
        assert managed["status"] == "available"
        assert managed["platform"] == {"available": True, "enabled": True, "functions": ["search", "extract"]}
        assert "api_key" not in repr(managed)
        assert gateway._active_web_search_config() == {
            "adapter": "hai_managed_tavily", "model": DEFAULT_WORKER_MODEL,
            "timeout_seconds": 20, "max_document_chars": 20_000,
        }


def test_gateway_provider_policy_overrides_auto_without_silent_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    put_perceptor_resource(tmp_path, PerceptorResource(
        "web-tavily-main", "public_web", "tavily", ("web.search", "web.extract"),
        {"api_key": "tvly-local-test"}, "BYOK", True,
    ))
    with platform_auth_scope(auth()):
        assert gateway._active_web_search_config()["adapter"] == "hai_managed_tavily"
        write_provider_mode(tmp_path, "byok")
        assert gateway._active_web_search_config()["api_key"] == "tvly-local-test"
        write_provider_mode(tmp_path, "none")
        assert gateway._active_web_search_config() is None
        write_provider_mode(tmp_path, "managed")
        assert gateway._active_web_search_config()["adapter"] == "hai_managed_tavily"
    assert gateway._active_web_search_config() is None


def test_gateway_provider_policy_api_persists_only_mode(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    stale = []
    async def mark_stale(user_id): stale.append(user_id)
    monkeypatch.setattr(gateway.manager, "mark_user_config_stale", mark_stale)
    with platform_auth_scope(auth()):
        user_id = auth().subject
        result = asyncio.run(gateway.update_web_search_provider_policy(gateway.WebSearchProviderPolicyRequest(mode="managed"), user_id))
        assert result == {"mode": "managed", "provider": "hai_managed_tavily", "available": True, "error": None}
        assert asyncio.run(gateway.get_web_search_provider_policy(user_id)) == result
    assert stale == [auth().subject]
    policy_text = (tmp_path / "perceptors" / "web_search_policy.json").read_text(encoding="utf-8")
    assert "token" not in policy_text.lower() and "api_key" not in policy_text.lower()


def test_gateway_managed_perceptor_tests_real_search_and_extract_paths(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    from drsai.backend import gateway

    monkeypatch.setattr(gateway, "_get_config_dir", lambda _user_id=None: tmp_path)
    async def fake_search(query, max_results, *, provider_config):
        assert (query, max_results) == ("OpenDrSai", 1)
        assert provider_config["adapter"] == "hai_managed_tavily"
        return {"provider": "hai_managed_tavily", "results": [{"title": "OpenDrSai"}], "receipt": {"request_id": "req-search"}}
    async def fake_fetch(url, *, max_chars, provider_config):
        assert (url, max_chars) == ("https://www.hepix.org/", 2_000)
        assert provider_config["adapter"] == "hai_managed_tavily"
        return {"provider": "hai_managed_tavily", "content": "HEPiX", "final_url": url, "receipt": {"request_id": "req-extract"}}
    monkeypatch.setattr(gateway, "web_search", fake_search)
    monkeypatch.setattr(gateway, "web_fetch", fake_fetch)
    with platform_auth_scope(auth()):
        search = asyncio.run(gateway.test_perceptor("hai-managed-web-search", "search"))
        extract = asyncio.run(gateway.test_perceptor("hai-managed-web-search", "extract"))
    assert search["ok"] is True and search["tested"] == "search"
    assert extract["ok"] is True and extract["tested"] == "extract"
