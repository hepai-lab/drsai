"""Async Tavily Search and Extract adapters using the stable REST API."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import logging
from typing import Any, Mapping

import aiohttp

from .contracts import ProviderReceipt, WebSearchResponse, WebSearchResult, normalize_max_results, plan_search_query
from .errors import WebProviderError, classify_http_error
from .url_safety import UnsafeWebUrl, ensure_public_url, validate_url_shape


logger = logging.getLogger(__name__)
_MAX_REQUEST_ATTEMPTS = 3
_RETRY_DELAYS_SECONDS = (0.25, 0.75)


@dataclass(frozen=True)
class TavilyConfig:
    api_key: str
    base_url: str = "https://api.tavily.com"
    project_id: str = ""
    search_depth: str = "basic"
    extract_depth: str = "basic"
    timeout_seconds: float = 15.0
    max_document_chars: int = 20_000

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> "TavilyConfig":
        key = str(value.get("api_key") or "").strip()
        if not key: raise WebProviderError("authentication_failed", "Tavily API key is not configured.", provider="tavily")
        return cls(
            api_key=key, base_url=str(value.get("base_url") or cls.base_url).rstrip("/"),
            project_id=str(value.get("project_id") or ""), search_depth=str(value.get("search_depth") or "basic"),
            extract_depth=str(value.get("extract_depth") or "basic"),
            timeout_seconds=max(1.0, min(float(value.get("timeout_seconds") or 15), 60.0)),
            max_document_chars=max(1000, min(int(value.get("max_document_chars") or 20_000), 50_000)),
        )


class TavilyClient:
    def __init__(self, config: TavilyConfig) -> None:
        self.config = config

    async def _post(self, endpoint: str, payload: Mapping[str, object]) -> dict[str, Any]:
        for attempt in range(1, _MAX_REQUEST_ATTEMPTS + 1):
            try:
                return await self._post_once(endpoint, payload)
            except WebProviderError as exc:
                if not exc.retryable or attempt >= _MAX_REQUEST_ATTEMPTS:
                    raise
                # Keep diagnostics useful without logging provider bodies,
                # request headers, payloads, or credentials.
                cause = exc.__cause__ or exc.__context__
                logger.warning(
                    "Retrying Tavily %s after %s (%s), attempt %d/%d",
                    endpoint,
                    exc.code,
                    type(cause).__name__ if cause is not None else type(exc).__name__,
                    attempt,
                    _MAX_REQUEST_ATTEMPTS,
                )
                await asyncio.sleep(_RETRY_DELAYS_SECONDS[attempt - 1])
        raise AssertionError("unreachable")

    async def _post_once(self, endpoint: str, payload: Mapping[str, object]) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
        if self.config.project_id: headers["X-Project-ID"] = self.config.project_id
        timeout = aiohttp.ClientTimeout(total=self.config.timeout_seconds)
        try:
            # Edge/Chrome on Windows honor the system proxy/PAC configuration.
            # ``aiohttp`` does not unless ``trust_env`` is enabled, which made
            # the Tavily website reachable while the packaged Runtime's API
            # request incorrectly attempted a blocked direct connection.
            async with aiohttp.ClientSession(timeout=timeout, trust_env=True) as session:
                async with session.post(f"{self.config.base_url}/{endpoint}", headers=headers, json=dict(payload)) as response:
                    request_id = response.headers.get("x-request-id", "")
                    if response.status >= 400:
                        code, retryable = classify_http_error(response.status)
                        raise WebProviderError(code, f"Tavily returned HTTP {response.status}.", provider="tavily", retryable=retryable, status_code=response.status, request_id=request_id)
                    try: data = await response.json(content_type=None)
                    except (ValueError, aiohttp.ContentTypeError) as exc:
                        raise WebProviderError("invalid_response", "Tavily returned an invalid JSON response.", provider="tavily", retryable=True, request_id=request_id) from exc
                    if isinstance(data, dict) and request_id and not data.get("request_id"):
                        data["request_id"] = request_id
        except TimeoutError as exc:
            raise WebProviderError("timeout", "Tavily request timed out.", provider="tavily", retryable=True) from exc
        except aiohttp.ClientError as exc:
            logger.warning(
                "Tavily %s connection failed (%s; cause=%s)",
                endpoint,
                type(exc).__name__,
                type(exc.__cause__).__name__ if exc.__cause__ is not None else "none",
            )
            raise WebProviderError("upstream_unavailable", "Tavily is currently unavailable.", provider="tavily", retryable=True) from exc
        if not isinstance(data, dict):
            raise WebProviderError("invalid_response", "Tavily returned an invalid response.", provider="tavily", retryable=True)
        return data

    @staticmethod
    def _receipt(data: Mapping[str, Any]) -> ProviderReceipt:
        raw_latency = data.get("response_time")
        latency_ms = round(float(raw_latency) * 1000) if isinstance(raw_latency, (int, float)) and not isinstance(raw_latency, bool) else None
        usage = data.get("usage")
        raw_units = usage.get("credits") if isinstance(usage, Mapping) else None
        usage_units = float(raw_units) if isinstance(raw_units, (int, float)) and not isinstance(raw_units, bool) else None
        return ProviderReceipt(request_id=str(data.get("request_id") or ""), latency_ms=latency_ms, usage_units=usage_units)

    async def search(self, query: str, max_results: int = 8, *, allowed_domains: tuple[str, ...] = (), blocked_domains: tuple[str, ...] = (), freshness: str | None = None) -> WebSearchResponse:
        plan = plan_search_query(query); limit = normalize_max_results(max_results)
        payload: dict[str, object] = {
            "query": plan.effective_query, "max_results": limit, "search_depth": self.config.search_depth,
            "include_answer": False, "include_raw_content": False, "include_images": False, "auto_parameters": False,
        }
        if allowed_domains: payload["include_domains"] = list(allowed_domains)
        if blocked_domains: payload["exclude_domains"] = list(blocked_domains)
        if freshness: payload["time_range"] = freshness
        data = await self._post("search", payload)
        raw_results = data.get("results")
        if not isinstance(raw_results, list):
            raise WebProviderError("invalid_response", "Tavily search response has no results list.", provider="tavily", retryable=True)
        results: list[WebSearchResult] = []
        for item in raw_results[:limit]:
            if not isinstance(item, Mapping): continue
            title, url = str(item.get("title") or "").strip(), str(item.get("url") or "").strip()
            if not title or not url: continue
            try: validate_url_shape(url)
            except UnsafeWebUrl: continue
            raw_score = item.get("score")
            score = float(raw_score) if isinstance(raw_score, (int, float)) and not isinstance(raw_score, bool) else None
            results.append(WebSearchResult(rank=len(results) + 1, title=title, url=url, snippet=str(item.get("content") or "").strip(), score=score))
        return WebSearchResponse(
            query=plan.effective_query, requested_query=plan.requested_query, rewrite_reason=plan.rewrite_reason,
            results=tuple(results), provider="tavily", warnings=(), candidates=(), receipt=self._receipt(data),
        )

    async def extract(self, url: str, *, output_format: str = "markdown", max_chars: int | None = None) -> dict[str, Any]:
        await ensure_public_url(url)
        data = await self._post("extract", {"urls": url, "extract_depth": self.config.extract_depth, "format": output_format, "include_images": False})
        rows = data.get("results")
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], Mapping):
            raise WebProviderError("upstream_unavailable", "Tavily could not extract this URL.", provider="tavily", retryable=True, request_id=str(data.get("request_id") or ""))
        final_url = str(rows[0].get("url") or url); await ensure_public_url(final_url)
        complete = str(rows[0].get("raw_content") or "").replace("\r\n", "\n").strip()
        limit = max(1000, min(max_chars or self.config.max_document_chars, 50_000))
        return {
            "version": 1, "requested_url": url, "final_url": final_url, "title": "",
            "content": complete[:limit], "content_type": "text/markdown" if output_format == "markdown" else "text/plain",
            "format": output_format, "provider": "tavily",
            "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "content_sha256": hashlib.sha256(complete.encode("utf-8")).hexdigest(), "truncated": len(complete) > limit,
            "warnings": [],
            "receipt": self._receipt(data).public_dict(),
        }
