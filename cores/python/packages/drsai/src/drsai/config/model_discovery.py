"""Bounded in-memory model discovery for compatible providers."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Any

import re

import httpx

from .schema import ResolvedModelConfig
from .model_registry import find_model_capabilities
from .model_catalog import ModelDescriptor, ModelRef, build_runtime_model_catalog

# Mirror of ModelRef._identity — providers (e.g. HepAI) return "models" whose
# ids contain spaces (agent display names like "Dr.Sai Assistant").  Those are
# not selectable chat models and would otherwise crash ModelRef.__post_init__
# with ValueError("model_id is invalid"), killing the TUI gateway on /model.
_MODEL_ID_PATTERN = re.compile(r"^[^\s\x00-\x1f]{1,240}$")


@dataclass(frozen=True)
class _CacheEntry:
    expires_at: float
    models: tuple[str, ...]
    updated_at: str


@dataclass(frozen=True)
class _FailureCacheEntry:
    expires_at: float
    error: str
    state: str
    updated_at: str


_CACHE: dict[tuple[str, str], _CacheEntry] = {}
_FAILURES: dict[tuple[str, str], _FailureCacheEntry] = {}
_CACHE_GENERATION = 0


def cached_provider_model_catalog(provider: str, base_url: str) -> dict[str, Any] | None:
    """Return the last discovery fact for one exact Provider endpoint.

    Reading the cache never performs network I/O. Expired entries remain useful
    as explicitly stale facts, so the product can distinguish an offline/stale
    catalog from a Provider that has never been discovered.
    """
    cached = _CACHE.get((provider, base_url))
    failure = _FAILURES.get((provider, base_url))
    if failure is not None and failure.expires_at > time.monotonic():
        return {
            "provider": provider,
            "models": [],
            "updated_at": failure.updated_at,
            "catalog_state": failure.state,
            "availability": failure.state,
            "error": failure.error,
        }
    if cached is None:
        return None
    stale = cached.expires_at <= time.monotonic()
    return {
        "provider": provider,
        "models": list(cached.models),
        "updated_at": cached.updated_at,
        "catalog_state": "stale" if stale else "fresh",
        "availability": "stale" if stale else "available",
    }


async def discover_provider_models(
    resolved: ResolvedModelConfig,
    *,
    timeout: float = 15.0,
    cache_ttl: float = 60.0,
    refresh: bool = False,
) -> dict[str, Any]:
    provider = resolved.provider
    generation = _CACHE_GENERATION
    cache_key = (provider.name, provider.base_url)
    now = time.monotonic()
    cached = _CACHE.get(cache_key)
    if not refresh and cached and cached.expires_at > now:
        return _result(provider.name, cached.models, cached=True, updated_at=cached.updated_at)
    if not refresh and cached:
        return _result(
            provider.name,
            cached.models,
            cached=True,
            updated_at=cached.updated_at,
            catalog_state="stale",
            availability="stale",
        )

    secret = provider.api_key.reveal() if provider.api_key else ""
    headers = {}
    if provider.wire_api == "anthropic":
        headers = {"x-api-key": secret, "anthropic-version": "2023-06-01"}
    elif provider.wire_api == "gemini":
        headers = {"x-goog-api-key": secret} if secret else {}
    elif secret:
        headers = {"Authorization": f"Bearer {secret}"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(f"{provider.base_url}/models", headers=headers)
    except httpx.TimeoutException:
        return _remember_failure(cache_key, generation, "timeout", "error", cache_ttl)
    except httpx.HTTPError:
        return _remember_failure(cache_key, generation, "connection_failed", "offline", cache_ttl)
    if response.status_code in {401, 403}:
        return _remember_failure(cache_key, generation, "authentication_failed", "unauthorized", cache_ttl)
    if response.status_code >= 400:
        return {
            **_remember_failure(cache_key, generation, "model_discovery_failed", "error", cache_ttl),
            "status_code": response.status_code,
        }
    try:
        payload = response.json()
        rows = payload.get("models") if provider.wire_api == "gemini" and isinstance(payload, dict) else payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise ValueError
        discovered_models = sorted({
            (item.get("name", "").removeprefix("models/") if provider.wire_api == "gemini" else item.get("id", "")) for item in rows
            if isinstance(item, dict)
            and isinstance(item.get("name" if provider.wire_api == "gemini" else "id"), str)
            and _MODEL_ID_PATTERN.fullmatch(item.get("name" if provider.wire_api == "gemini" else "id", ""))
            and "/" in item.get("name" if provider.wire_api == "gemini" else "id", "")
        })
        discovered_set = set(discovered_models)
        # Preserve configured models that the Provider really returned before
        # bounding a large catalog. Otherwise late-sorting IDs such as tts-1
        # and whisper-1 can be misreported as unverified.
        configured_models = [model_id for model_id in provider.models if model_id in discovered_set]
        models = tuple(dict.fromkeys((*configured_models, *discovered_models)))[:500]
    except (TypeError, ValueError):
        return _remember_failure(cache_key, generation, "invalid_response", "error", cache_ttl)
    updated_at = datetime.now(timezone.utc).isoformat()
    # A config commit may complete while an older discovery request is still
    # in flight. Its response remains valid for that caller, but must never
    # repopulate the cache after the commit invalidated the prior generation.
    if generation == _CACHE_GENERATION:
        _CACHE[cache_key] = _CacheEntry(now + max(cache_ttl, 0), models, updated_at)
        _FAILURES.pop(cache_key, None)
    return _result(provider.name, models, cached=False, updated_at=updated_at)


def clear_model_discovery_cache() -> None:
    global _CACHE_GENERATION
    _CACHE_GENERATION += 1
    _CACHE.clear()
    _FAILURES.clear()


def _result(
    provider: str,
    models: tuple[str, ...],
    *,
    cached: bool,
    updated_at: str,
    catalog_state: str = "fresh",
    availability: str = "available",
) -> dict[str, Any]:
    details = []
    descriptors: list[ModelDescriptor] = []
    for model in models:
        # Defensive: even if a caller bypasses the discovery filter, never let a
        # malformed id (spaces/control chars) crash ModelRef and take down the
        # gateway process. Only expose chat-style ids (contain "/"); agent
        # display names without "/" are not selectable chat models.
        if not _MODEL_ID_PATTERN.fullmatch(model) or "/" not in model:
            continue
        capabilities, known = find_model_capabilities(model)
        details.append({
            "id": model,
            "known_model": known,
            "metadata_source": "builtin" if known else "unknown",
            "token_limit": capabilities.token_limit,
            "max_tokens": capabilities.max_tokens,
            "vision": capabilities.vision,
            "reasoning": capabilities.reasoning.supported,
            "function_calling": capabilities.function_calling,
            "json_output": capabilities.json_output,
        })
        operations: list[str] = []
        input_modalities: list[str] = []
        output_modalities: list[str] = []
        reasoning_efforts: tuple[str, ...] = ()
        if known:
            input_modalities.append("text")
            if capabilities.vision:
                input_modalities.append("image")
            output_modalities.append("text")
            operations.append("chat")
            if capabilities.function_calling:
                operations.append("tool_calling")
            if capabilities.reasoning.supported:
                operations.append("reasoning")
                reasoning_efforts = tuple(capabilities.reasoning.effort_levels)  # type: ignore[assignment]
        descriptors.append(ModelDescriptor(
            ref=ModelRef(provider, model),
            display_name=model,
            input_modalities=tuple(input_modalities),  # type: ignore[arg-type]
            output_modalities=tuple(output_modalities),  # type: ignore[arg-type]
            operations=tuple(operations),  # type: ignore[arg-type]
            reasoning_efforts=reasoning_efforts,  # type: ignore[arg-type]
            token_limit=capabilities.token_limit if known else None,
            max_output_tokens=capabilities.max_tokens if known else None,
            availability=availability,  # type: ignore[arg-type]
            capability_source="builtin" if known else "unknown",
            capability_confidence="inferred" if known else "unknown",
            updated_at=updated_at,
        ))
    catalog = build_runtime_model_catalog(descriptors, state=catalog_state)  # type: ignore[arg-type]
    return {
        "ok": True,
        "provider": provider,
        "models": list(models),
        "model_details": details,
        "descriptors": [descriptor.public_dict() for descriptor in catalog.models],
        "catalog_revision": catalog.revision,
        "catalog_state": catalog.state,
        "cached": cached,
        "updated_at": updated_at,
    }


def _failure(error: str, state: str) -> dict[str, Any]:
    return {"ok": False, "error": error, "models": [], "descriptors": [], "catalog_state": state}


def _remember_failure(
    cache_key: tuple[str, str], generation: int, error: str, state: str, cache_ttl: float,
) -> dict[str, Any]:
    updated_at = datetime.now(timezone.utc).isoformat()
    if generation == _CACHE_GENERATION:
        _FAILURES[cache_key] = _FailureCacheEntry(
            time.monotonic() + min(max(cache_ttl, 0), 15.0), error, state, updated_at,
        )
        _CACHE.pop(cache_key, None)
    return {**_failure(error, state), "updated_at": updated_at}
