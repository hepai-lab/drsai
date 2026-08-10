"""Bounded, redacted connectivity checks for model providers."""

from __future__ import annotations

import socket
import ssl
import time
from typing import Any, Literal

import httpx

from .schema import ResolvedModelConfig
from .guidance import guidance_for
from .probe_history import probe_fingerprint, record_probe_result
from .telemetry import increment_metric


_MODEL_PROBE_MAX_TOKENS = 256


async def test_provider_connection(
    resolved: ResolvedModelConfig,
    *,
    timeout: float = 15.0,
    mode: Literal["basic", "model"] = "model",
    retries: int = 1,
    record_history: bool = True,
) -> dict[str, Any]:
    """Probe a provider, returning only bounded model text for explicit model calls."""
    provider = resolved.provider
    model_id = resolved.model_id or resolved.model
    secret = provider.api_key.reveal() if provider.api_key is not None else ""
    started = time.monotonic()
    response = None
    used_minimal_call = mode == "model"
    fingerprint = probe_fingerprint(provider.name, model_id, provider.base_url, provider.wire_api, secret)
    for attempt in range(max(0, min(retries, 2)) + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if provider.wire_api == "anthropic" and mode == "model":
                    url = f"{provider.base_url}/messages" if provider.base_url.endswith("/v1") else f"{provider.base_url}/v1/messages"
                    response = await client.post(url, headers={"x-api-key": secret, "anthropic-version": "2023-06-01", "content-type": "application/json"}, json={"model": resolved.model, "max_tokens": _MODEL_PROBE_MAX_TOKENS, "system": "Reply with exactly one lowercase word: pong", "messages": [{"role": "user", "content": "ping"}]})
                elif provider.wire_api == "anthropic":
                    response = await client.get(f"{provider.base_url}/models", headers={"x-api-key": secret, "anthropic-version": "2023-06-01"})
                elif provider.wire_api == "gemini":
                    headers = {"x-goog-api-key": secret} if secret else {}
                    if mode == "model":
                        model_path = resolved.model if resolved.model.startswith("models/") else f"models/{resolved.model}"
                        response = await client.post(
                            f"{provider.base_url.rstrip('/')}/{model_path}:generateContent",
                            headers={**headers, "content-type": "application/json"},
                            json={"systemInstruction": {"parts": [{"text": "Reply with exactly one lowercase word: pong"}]}, "contents": [{"role": "user", "parts": [{"text": "ping"}]}], "generationConfig": {"maxOutputTokens": _MODEL_PROBE_MAX_TOKENS}},
                        )
                    else:
                        response = await client.get(f"{provider.base_url.rstrip('/')}/models", headers=headers)
                else:
                    headers = {"Authorization": f"Bearer {secret}"} if secret else {}
                    if mode == "model":
                        response = await client.post(
                            f"{provider.base_url}/responses",
                            headers={**headers, "content-type": "application/json"},
                            json={
                                "model": resolved.model,
                                "instructions": "Reply with exactly one lowercase word: pong",
                                "input": "ping",
                                "max_output_tokens": _MODEL_PROBE_MAX_TOKENS,
                            },
                        )
                        if response.status_code == 404 and not _response_mentions_model(response):
                            response = await client.post(
                                f"{provider.base_url}/chat/completions",
                                headers={**headers, "content-type": "application/json"},
                                json={
                                    "model": resolved.model,
                                    "messages": [{"role": "user", "content": "Reply with exactly one lowercase word: pong"}],
                                    "max_tokens": _MODEL_PROBE_MAX_TOKENS,
                                },
                            )
                    else:
                        response = await client.get(f"{provider.base_url}/models", headers=headers)
            break
        except httpx.TimeoutException:
            return _complete(provider.name, model_id, mode, _failure("timeout"), started, fingerprint, record_history)
        except httpx.ConnectError as exc:
            if attempt < max(0, min(retries, 2)):
                continue
            return _complete(provider.name, model_id, mode, _failure(_connect_error_code(exc)), started, fingerprint, record_history)
        except httpx.HTTPError:
            return _complete(provider.name, model_id, mode, _failure("connection_failed"), started, fingerprint, record_history)

    if response is None:
        return _complete(provider.name, model_id, mode, _failure("connection_failed"), started, fingerprint, record_history)

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
        return _complete(provider.name, model_id, mode, _failure(error, response.status_code), started, fingerprint, record_history)
    if response.status_code >= 400:
        error = "model_not_found" if _response_mentions_model(response) else "invalid_response"
        return _complete(provider.name, model_id, mode, _failure(error, response.status_code), started, fingerprint, record_history)
    model_output = None
    if mode == "model":
        try:
            payload = response.json()
            model_output = _extract_model_output(payload, provider.wire_api)
            if not model_output:
                error = "model_output_budget_exhausted" if _output_budget_exhausted(payload, provider.wire_api) else "model_output_empty"
                return _complete(provider.name, model_id, mode, _failure(error), started, fingerprint, record_history)
            if not _is_pong(model_output):
                failure = _failure("model_output_mismatch")
                failure["output"] = model_output
                return _complete(provider.name, model_id, mode, failure, started, fingerprint, record_history)
        except (TypeError, ValueError):
            return _complete(provider.name, model_id, mode, _failure("invalid_response"), started, fingerprint, record_history)
    return _complete(provider.name, model_id, mode, {"ok": True, "provider": provider.name, "wire_api": provider.wire_api, "mode": mode, "may_incur_cost": used_minimal_call, **({"output": model_output} if model_output else {})}, started, fingerprint, record_history)


def _extract_model_output(payload: object, wire_api: str) -> str | None:
    if not isinstance(payload, dict):
        return None
    content: object = None
    if wire_api == "anthropic":
        blocks = payload.get("content")
        if isinstance(blocks, list):
            content = "\n".join(
                block["text"] for block in blocks
                if isinstance(block, dict) and isinstance(block.get("text"), str)
            )
    elif wire_api == "gemini":
        candidates = payload.get("candidates")
        if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict):
            candidate_content = candidates[0].get("content")
            parts = candidate_content.get("parts") if isinstance(candidate_content, dict) else None
            if isinstance(parts, list):
                content = "\n".join(part["text"] for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str))
    else:
        # Raw Responses HTTP payloads expose generated text in output message
        # content items. Some compatible Providers also include the SDK-style
        # aggregate output_text field, which is safe to accept as a fallback.
        output = payload.get("output")
        if isinstance(output, list):
            content = "\n".join(
                part["text"]
                for item in output
                if isinstance(item, dict) and item.get("type") == "message"
                for parts in (item.get("content"),)
                if isinstance(parts, list)
                for part in parts
                if isinstance(part, dict)
                and part.get("type") == "output_text"
                and isinstance(part.get("text"), str)
            )
        if not content and isinstance(payload.get("output_text"), str):
            content = payload["output_text"]
        if not content:
            choices = payload.get("choices")
            if isinstance(choices, list) and choices and isinstance(choices[0], dict):
                message = choices[0].get("message")
                if isinstance(message, dict) and isinstance(message.get("content"), str):
                    content = message["content"]
    if not isinstance(content, str):
        return None
    normalized = content.replace("\x00", "").strip()
    return normalized[:2000] or None


def _is_pong(output: str) -> bool:
    return output.strip().strip("`'\".!。 ").lower() == "pong"


def _output_budget_exhausted(payload: object, wire_api: str) -> bool:
    if not isinstance(payload, dict):
        return False
    if wire_api == "anthropic":
        return payload.get("stop_reason") == "max_tokens"
    if wire_api == "gemini":
        candidates = payload.get("candidates")
        return bool(isinstance(candidates, list) and candidates and isinstance(candidates[0], dict) and candidates[0].get("finishReason") == "MAX_TOKENS")
    if payload.get("status") != "incomplete":
        return False
    details = payload.get("incomplete_details")
    return bool(
        isinstance(details, dict)
        and details.get("reason") in {"max_output_tokens", "max_tokens"}
    )


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


def _complete(provider: str, model: str, mode: str, result: dict[str, Any], started: float, fingerprint: str, record_history: bool) -> dict[str, Any]:
    result["model"] = model
    result["duration_ms"] = max(0, round((time.monotonic() - started) * 1000))
    if record_history:
        record_probe_result(provider, model, mode, {key: value for key, value in result.items() if key != "output"}, fingerprint=fingerprint)
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
