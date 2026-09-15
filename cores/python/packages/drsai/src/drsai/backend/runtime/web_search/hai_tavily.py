"""HAI-managed Tavily Perceptor transported through DDF Infinite Function."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from typing import Any, Mapping
from urllib.parse import urlsplit
import uuid

import aiohttp

from drsai.platform_auth import PlatformAuthContext, get_platform_auth

from .contracts import ProviderReceipt, WebSearchResponse, WebSearchResult, normalize_max_results, plan_search_query
from .errors import WebProviderError
from .url_safety import UnsafeWebUrl, ensure_public_url, validate_url_shape


MANAGED_TAVILY_ADAPTER = "hai_managed_tavily"
DEFAULT_WORKER_MODEL = "hepai/tavily-web-search-v1"
_TRUSTED_DDF_HOSTS = frozenset({"ai.ihep.ac.cn", "ai-dev.ihep.ac.cn"})
_ALLOWED_FUNCTIONS = frozenset({"search", "extract"})


@dataclass(frozen=True)
class HaiTavilyConfig:
    model: str = DEFAULT_WORKER_MODEL
    timeout_seconds: float = 20.0
    max_document_chars: int = 20_000

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "HaiTavilyConfig":
        forbidden = {"api_key", "base_url", "worker_url", "project_id"}.intersection(value)
        if forbidden:
            raise WebProviderError(
                "managed_configuration_invalid",
                "HAI-managed web search does not accept client-owned provider credentials or routes.",
                provider=MANAGED_TAVILY_ADAPTER,
            )
        model = str(value.get("model") or DEFAULT_WORKER_MODEL).strip()
        if model != DEFAULT_WORKER_MODEL:
            raise WebProviderError(
                "managed_configuration_invalid", "The managed Perceptor model is not allowed.",
                provider=MANAGED_TAVILY_ADAPTER,
            )
        return cls(
            model=model,
            timeout_seconds=max(1.0, min(float(value.get("timeout_seconds") or 20), 60.0)),
            max_document_chars=max(1000, min(int(value.get("max_document_chars") or 20_000), 50_000)),
        )


class HaiTavilyClient:
    def __init__(self, config: HaiTavilyConfig, auth: PlatformAuthContext | None = None) -> None:
        self.config = config
        self.auth = auth or get_platform_auth()

    def _api_root(self) -> str:
        if self.auth is None:
            raise WebProviderError("login_required", "Sign in to use HAI-managed web search.", provider=MANAGED_TAVILY_ADAPTER)
        parsed = urlsplit(self.auth.model_base_url)
        if parsed.scheme != "https" or parsed.hostname not in _TRUSTED_DDF_HOSTS or parsed.port not in {None, 443}:
            raise WebProviderError("managed_route_untrusted", "The HAI DDF route is not trusted.", provider=MANAGED_TAVILY_ADAPTER)
        return self.auth.model_base_url.rstrip("/")

    def _endpoint(self, function: str) -> str:
        if function not in _ALLOWED_FUNCTIONS:
            raise WebProviderError("function_not_allowed", "The managed function is not allowed.", provider=MANAGED_TAVILY_ADAPTER)
        return f"{self._api_root()}/tools/web-search/{function}"

    async def _invoke(self, function: str, arguments: Mapping[str, object]) -> dict[str, Any]:
        endpoint = self._endpoint(function)
        assert self.auth is not None
        timeout = aiohttp.ClientTimeout(total=self.config.timeout_seconds)
        headers = {
            "Authorization": f"Bearer {self.auth.access_token}",
            "Content-Type": "application/json",
            "Idempotency-Key": uuid.uuid4().hex,
        }
        try:
            async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
                async with session.post(endpoint, headers=headers, json={"model": self.config.model, "arguments": dict(arguments)}) as response:
                    request_id = response.headers.get("x-request-id", "")
                    try:
                        body = await response.json(content_type=None)
                    except (ValueError, aiohttp.ContentTypeError) as exc:
                        raise WebProviderError("provider_invalid_response", "HAI DDF returned invalid JSON.", provider=MANAGED_TAVILY_ADAPTER, retryable=response.status >= 500, request_id=request_id) from exc
                    if response.status >= 400:
                        code, retryable = _managed_http_error(response.status, body)
                        public_error = body.get("error") if isinstance(body, Mapping) else None
                        body_request_id = public_error.get("request_id") if isinstance(public_error, Mapping) else None
                        raise WebProviderError(
                            code, "HAI-managed web search request failed.", provider=MANAGED_TAVILY_ADAPTER,
                            retryable=retryable, status_code=response.status,
                            request_id=str(body_request_id or request_id or "")[:160],
                        )
        except TimeoutError as exc:
            raise WebProviderError("provider_timeout", "HAI-managed web search timed out.", provider=MANAGED_TAVILY_ADAPTER, retryable=True) from exc
        except aiohttp.ClientError as exc:
            raise WebProviderError("worker_unavailable", "HAI-managed web search is unavailable.", provider=MANAGED_TAVILY_ADAPTER, retryable=True) from exc
        result = _unwrap_if_result(body)
        if isinstance(body, Mapping):
            result.setdefault("request_id", str(body.get("request_id") or request_id))
            result["_ddf_trace_id"] = str(body.get("trace_id") or "")
            result["_ddf_model"] = str(body.get("model") or self.config.model)
            result["_ddf_function"] = str(body.get("function") or function)
        elif request_id and not result.get("request_id"):
            result["request_id"] = request_id
        return result

    async def capabilities(self) -> dict[str, Any]:
        endpoint = f"{self._api_root()}/tools/web-search/capabilities"
        assert self.auth is not None
        timeout = aiohttp.ClientTimeout(total=min(self.config.timeout_seconds, 10.0))
        try:
            async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
                async with session.get(endpoint, headers={"Authorization": f"Bearer {self.auth.access_token}"}) as response:
                    try:
                        body = await response.json(content_type=None)
                    except (ValueError, aiohttp.ContentTypeError) as exc:
                        raise WebProviderError(
                            "provider_invalid_response", "Managed Perceptor discovery returned invalid JSON.",
                            provider=MANAGED_TAVILY_ADAPTER, retryable=response.status >= 500,
                        ) from exc
                    if response.status >= 400:
                        code, retryable = _managed_http_error(response.status, body)
                        raise WebProviderError(code, "Managed Perceptor discovery failed.", provider=MANAGED_TAVILY_ADAPTER, retryable=retryable, status_code=response.status)
        except TimeoutError as exc:
            raise WebProviderError("provider_timeout", "Managed Perceptor discovery timed out.", provider=MANAGED_TAVILY_ADAPTER, retryable=True) from exc
        except aiohttp.ClientError as exc:
            raise WebProviderError("worker_unavailable", "Managed Perceptor discovery is unavailable.", provider=MANAGED_TAVILY_ADAPTER, retryable=True) from exc
        if not isinstance(body, Mapping):
            raise WebProviderError("provider_invalid_response", "Managed Perceptor discovery returned invalid JSON.", provider=MANAGED_TAVILY_ADAPTER, retryable=True)
        nested = body.get("data")
        if isinstance(nested, list):
            if not nested:
                status = str(body.get("status") or "permission_denied").strip().lower()
                return {"available": False, "enabled": False, "functions": [], "error": status, "retryable": bool(body.get("retryable", False))}
            if len(nested) != 1 or not isinstance(nested[0], Mapping):
                raise WebProviderError("provider_invalid_response", "Managed Perceptor catalog is ambiguous.", provider=MANAGED_TAVILY_ADAPTER, retryable=True)
            return dict(nested[0])
        return dict(nested) if isinstance(nested, Mapping) else dict(body)

    async def search(self, query: str, max_results: int = 8, *, allowed_domains: tuple[str, ...] = (), blocked_domains: tuple[str, ...] = (), freshness: str | None = None) -> WebSearchResponse:
        plan, limit = plan_search_query(query), normalize_max_results(max_results)
        payload: dict[str, object] = {
            "query": plan.effective_query,
            "max_results": limit,
            "search_depth": "basic",
            "include_answer": False,
            "include_raw_content": False,
            "include_images": False,
            "auto_parameters": False,
        }
        if allowed_domains: payload["include_domains"] = list(allowed_domains)
        if blocked_domains: payload["exclude_domains"] = list(blocked_domains)
        if freshness: payload["time_range"] = freshness
        data = await self._invoke("search", payload)
        rows = data.get("results")
        if not isinstance(rows, list):
            raise WebProviderError("provider_invalid_response", "Managed search returned no result list.", provider=MANAGED_TAVILY_ADAPTER, retryable=True)
        results: list[WebSearchResult] = []
        for item in rows[:limit]:
            if not isinstance(item, Mapping): continue
            title, url = str(item.get("title") or "").strip(), str(item.get("url") or "").strip()
            if not title or not url: continue
            try: validate_url_shape(url)
            except UnsafeWebUrl: continue
            score = item.get("score")
            results.append(WebSearchResult(
                rank=len(results) + 1, title=title, url=url,
                snippet=str(item.get("content") or item.get("snippet") or "").strip(),
                score=float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else None,
            ))
        return WebSearchResponse(
            query=plan.effective_query, requested_query=plan.requested_query,
            rewrite_reason=plan.rewrite_reason, results=tuple(results),
            provider=MANAGED_TAVILY_ADAPTER, receipt=_receipt(data),
        )

    async def extract(self, url: str, *, output_format: str = "markdown", max_chars: int | None = None) -> dict[str, Any]:
        await ensure_public_url(url)
        data = await self._invoke("extract", {"url": url, "extract_depth": "basic", "format": output_format, "include_images": False})
        rows = data.get("results")
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], Mapping):
            raise WebProviderError("provider_invalid_response", "Managed extract returned no document.", provider=MANAGED_TAVILY_ADAPTER, retryable=True)
        row = rows[0]
        final_url = str(row.get("url") or url)
        await ensure_public_url(final_url)
        complete = str(row.get("raw_content") or row.get("content") or "").replace("\r\n", "\n").strip()
        limit = max(1000, min(max_chars or self.config.max_document_chars, 50_000))
        return {
            "version": 1, "requested_url": url, "final_url": final_url,
            "title": str(row.get("title") or "")[:500], "content": complete[:limit],
            "content_type": "text/markdown" if output_format == "markdown" else "text/plain",
            "format": output_format, "provider": MANAGED_TAVILY_ADAPTER,
            "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "content_sha256": hashlib.sha256(complete.encode()).hexdigest(),
            "truncated": len(complete) > limit, "warnings": [], "receipt": _receipt(data).public_dict(),
        }


def _unwrap_if_result(value: object) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise WebProviderError("provider_invalid_response", "HAI IF response is invalid.", provider=MANAGED_TAVILY_ADAPTER, retryable=True)
    current: object = value
    for key in ("result", "data", "output"):
        if isinstance(current, Mapping) and key in current:
            current = current[key]
    if not isinstance(current, Mapping):
        raise WebProviderError("provider_invalid_response", "HAI IF result is invalid.", provider=MANAGED_TAVILY_ADAPTER, retryable=True)
    return dict(current)


def _managed_http_error(status: int, body: object) -> tuple[str, bool]:
    raw = body.get("error") if isinstance(body, Mapping) else None
    candidate = raw.get("code") if isinstance(raw, Mapping) else body.get("code") if isinstance(body, Mapping) else None
    code = str(candidate or "").strip().lower()
    raw_code = code
    aliases = {
        "quota_exceeded": "quota_exhausted",
        "upstream_timeout": "provider_timeout", "timeout": "provider_timeout",
        "provider_error": "provider_unavailable", "upstream_unavailable": "provider_unavailable",
        "provider_auth_error": "provider_authentication_failed", "upstream_auth_error": "provider_authentication_failed",
        "upstream_rate_limited": "provider_rate_limited", "upstream_quota_exhausted": "provider_quota_exhausted",
        "invalid_upstream_response": "provider_invalid_response", "unsafe_url": "unsafe_web_url",
        "capability_not_found": "permission_denied",
        "forbidden_provider_parameter": "invalid_request", "invalid_idempotency_key": "invalid_request",
        "idempotency_conflict": "invalid_request", "request_id_conflict": "invalid_request",
    }
    code = aliases.get(code, code)
    retryable_codes = {"rate_limited", "worker_unavailable", "provider_rate_limited", "provider_timeout", "provider_unavailable", "provider_invalid_response"}
    allowed = {
        "login_required", "permission_denied", "quota_exhausted", "rate_limited", "worker_unavailable",
        "provider_authentication_failed", "provider_rate_limited", "provider_quota_exhausted",
        "provider_timeout", "provider_unavailable", "provider_invalid_response", "unsafe_web_url", "invalid_request",
    }
    if code in allowed: return code, code in retryable_codes
    if status == 401: return "login_required", False
    if status == 403: return "permission_denied", False
    if status == 429: return "rate_limited", True
    if status >= 500: return "worker_unavailable", True
    return "invalid_request", False


def _receipt(data: Mapping[str, Any]) -> ProviderReceipt:
    usage = data.get("usage")
    credits = usage.get("credits") if isinstance(usage, Mapping) else None
    latency = data.get("response_time")
    return ProviderReceipt(
        request_id=str(data.get("request_id") or ""),
        latency_ms=round(float(latency) * 1000) if isinstance(latency, (int, float)) and not isinstance(latency, bool) else None,
        usage_units=float(credits) if isinstance(credits, (int, float)) and not isinstance(credits, bool) else None,
        trace_id=str(data.get("_ddf_trace_id") or ""),
        model=str(data.get("_ddf_model") or ""),
        function=str(data.get("_ddf_function") or ""),
    )
