"""Bounded, redacted connectivity checks for model providers."""

from __future__ import annotations

import socket
import ssl
import time
from typing import Any, Literal

import httpx

from .schema import ResolvedModelConfig
from .guidance import guidance_for
from .probe_history import record_probe_result
from .telemetry import increment_metric


async def test_provider_connection(
    resolved: ResolvedModelConfig,
    *,
    timeout: float = 15.0,
    mode: Literal["basic", "model"] = "model",
    retries: int = 1,
) -> dict[str, Any]:
    """Probe a provider without returning response bodies, headers, or secrets."""
    provider = resolved.provider
    secret = provider.api_key.reveal() if provider.api_key is not None else ""
    started = time.monotonic()
    response = None
    used_minimal_call = provider.wire_api == "anthropic" and mode == "model"
    for attempt in range(max(0, min(retries, 2)) + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if provider.wire_api == "anthropic" and mode == "model":
                    url = f"{provider.base_url}/messages" if provider.base_url.endswith("/v1") else f"{provider.base_url}/v1/messages"
                    response = await client.post(url, headers={"x-api-key": secret, "anthropic-version": "2023-06-01", "content-type": "application/json"}, json={"model": resolved.model, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]})
                elif provider.wire_api == "anthropic":
                    response = await client.get(f"{provider.base_url}/models", headers={"x-api-key": secret, "anthropic-version": "2023-06-01"})
                else:
                    headers = {"Authorization": f"Bearer {secret}"} if secret else {}
                    response = await client.get(f"{provider.base_url}/models", headers=headers)
                    if response.status_code == 404 and mode == "model" and not _response_mentions_model(response):
                        used_minimal_call = True
                        response = await client.post(
                            f"{provider.base_url}/chat/completions",
                            headers={**headers, "content-type": "application/json"},
                            json={"model": resolved.model, "max_tokens": 1, "messages": [{"role": "user", "content": "ping"}]},
                        )
            break
        except httpx.TimeoutException:
            return _complete(provider.name, mode, _failure("timeout"), started)
        except httpx.ConnectError as exc:
            if attempt < max(0, min(retries, 2)):
                continue
            return _complete(provider.name, mode, _failure(_connect_error_code(exc)), started)
        except httpx.HTTPError:
            return _complete(provider.name, mode, _failure("connection_failed"), started)

    if response is None:
        return _complete(provider.name, mode, _failure("connection_failed"), started)

    errors = {
        401: "authentication_failed",
        403: "permission_denied",
        404: "endpoint_not_found",
        429: "rate_limited",
    }
    if response.status_code in errors:
        error = errors[response.status_code]
        if response.status_code == 404 and _response_mentions_model(response):
            error = "model_not_found"
        return _complete(provider.name, mode, _failure(error, response.status_code), started)
    if response.status_code >= 400:
        error = "model_not_found" if _response_mentions_model(response) else "invalid_response"
        return _complete(provider.name, mode, _failure(error, response.status_code), started)
    if provider.wire_api == "openai" and mode == "model" and not used_minimal_call:
        try:
            payload = response.json()
            rows = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                return _complete(provider.name, mode, _failure("protocol_mismatch"), started)
            model_ids = {
                item.get("id") for item in rows
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            }
            if resolved.model not in model_ids:
                return _complete(provider.name, mode, _failure("model_not_found"), started)
        except (TypeError, ValueError):
            return _complete(provider.name, mode, _failure("invalid_response"), started)
    return _complete(provider.name, mode, {"ok": True, "provider": provider.name, "wire_api": provider.wire_api, "mode": mode, "may_incur_cost": used_minimal_call}, started)


def _response_mentions_model(response: httpx.Response) -> bool:
    try:
        payload = response.json()
    except (TypeError, ValueError):
        return False
    text = str(payload).lower()
    return "model" in text and ("not found" in text or "unknown" in text or "invalid" in text)


def _failure(error: str, status_code: int | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "error": error,
        **({"status_code": status_code} if status_code is not None else {}),
        "guidance": guidance_for(error),
    }


def _complete(provider: str, mode: str, result: dict[str, Any], started: float) -> dict[str, Any]:
    result["duration_ms"] = max(0, round((time.monotonic() - started) * 1000))
    record_probe_result(provider, mode, result)
    increment_metric("probe_succeeded" if result.get("ok") else f"probe_{result.get('error', 'failed')}")
    return result


def _connect_error_code(exc: httpx.ConnectError) -> str:
    cause: BaseException | None = exc
    while cause is not None:
        if isinstance(cause, ssl.SSLError):
            return "tls_failed"
        if isinstance(cause, socket.gaierror):
            return "dns_failed"
        cause = cause.__cause__
    return "connection_failed"
