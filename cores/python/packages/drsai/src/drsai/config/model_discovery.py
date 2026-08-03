"""Bounded in-memory model discovery for compatible providers."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any

import httpx

from .schema import ResolvedModelConfig
from .model_registry import find_model_capabilities


@dataclass(frozen=True)
class _CacheEntry:
    expires_at: float
    models: tuple[str, ...]
    updated_at: str


_CACHE: dict[tuple[str, str], _CacheEntry] = {}


async def discover_provider_models(
    resolved: ResolvedModelConfig,
    *,
    timeout: float = 15.0,
    cache_ttl: float = 60.0,
    refresh: bool = False,
) -> dict[str, Any]:
    provider = resolved.provider
    cache_key = (provider.name, provider.base_url)
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if not refresh and cached and cached.expires_at > now:
        return _result(provider.name, cached.models, cached=True, updated_at=cached.updated_at)

    secret = provider.api_key.reveal() if provider.api_key else ""
    headers = {}
    if provider.wire_api == "anthropic":
        headers = {"x-api-key": secret, "anthropic-version": "2023-06-01"}
    elif secret:
        headers = {"Authorization": f"Bearer {secret}"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(f"{provider.base_url}/models", headers=headers)
    except httpx.TimeoutException:
        return {"ok": False, "error": "timeout", "models": []}
    except httpx.HTTPError:
        return {"ok": False, "error": "connection_failed", "models": []}
    if response.status_code in {401, 403}:
        return {"ok": False, "error": "authentication_failed", "models": []}
    if response.status_code >= 400:
        return {"ok": False, "error": "model_discovery_failed", "status_code": response.status_code, "models": []}
    try:
        payload = response.json()
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise ValueError
        models = tuple(sorted({
            item["id"] for item in rows
            if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip()
        }))[:500]
    except (TypeError, ValueError):
        return {"ok": False, "error": "invalid_response", "models": []}
    updated_at = datetime.now(timezone.utc).isoformat()
    _CACHE[cache_key] = _CacheEntry(now + max(cache_ttl, 0), models, updated_at)
    return _result(provider.name, models, cached=False, updated_at=updated_at)


def clear_model_discovery_cache() -> None:
    _CACHE.clear()


def _result(provider: str, models: tuple[str, ...], *, cached: bool, updated_at: str) -> dict[str, Any]:
    details = []
    for model in models:
        capabilities, known = find_model_capabilities(model)
        details.append({
            "id": model,
            "known_model": known,
            "metadata_source": "builtin" if known else "generic-default",
            "token_limit": capabilities.token_limit,
            "max_tokens": capabilities.max_tokens,
            "vision": capabilities.vision,
            "reasoning": capabilities.reasoning.supported,
        })
    return {"ok": True, "provider": provider, "models": list(models), "model_details": details, "cached": cached, "updated_at": updated_at}
