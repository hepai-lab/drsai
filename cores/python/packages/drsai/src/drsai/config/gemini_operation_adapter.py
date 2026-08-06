"""Bounded Gemini generateContent adapter for multimodal model operations."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from typing import Mapping, Sequence
from urllib.parse import quote

import httpx

from .model_operation_adapters import ModelProtocolError, NormalizedToolCall
from .model_operation_routing import ResolvedAgentOperation


MAX_GEMINI_IMAGE_BYTES = 20 * 1024 * 1024


@dataclass(frozen=True)
class GeminiImagePart:
    mime_type: str
    content: bytes


@dataclass(frozen=True)
class NormalizedGeminiResult:
    text: str
    tool_calls: tuple[NormalizedToolCall, ...] = ()
    images: tuple[GeminiImagePart, ...] = ()
    finish_reason: str | None = None


class GeminiGenerateContentAdapter:
    def __init__(self, *, timeout: float = 120.0, transport: httpx.BaseTransport | None = None) -> None:
        self.timeout = timeout
        self.transport = transport

    def create(
        self,
        resolved: ResolvedAgentOperation,
        *,
        prompt: str,
        image: bytes | None = None,
        image_mime: str | None = None,
        tools: Sequence[Mapping[str, object]] = (),
        response_modalities: Sequence[str] = ("TEXT",),
    ) -> NormalizedGeminiResult:
        if not prompt or len(prompt) > 4_000:
            raise ModelProtocolError("request_rejected", "Gemini prompt is outside the probe limit")
        if image is not None and (not image_mime or not image_mime.startswith("image/")):
            raise ModelProtocolError("request_rejected", "Gemini image MIME type is invalid")
        provider = resolved.model.provider
        key = provider.api_key.reveal() if provider.api_key else None
        if provider.requires_api_key and not key:
            raise ModelProtocolError("credential_unavailable", "Provider credential is unavailable")
        parts: list[dict[str, object]] = [{"text": prompt}]
        if image is not None:
            if not image or len(image) > MAX_GEMINI_IMAGE_BYTES:
                raise ModelProtocolError("request_rejected", "Gemini image is empty or too large")
            parts.append({"inlineData": {"mimeType": image_mime, "data": base64.b64encode(image).decode("ascii")}})
        payload: dict[str, object] = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": list(response_modalities)},
        }
        if tools:
            payload["tools"] = [{"functionDeclarations": [_gemini_function(tool) for tool in tools]}]
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if key:
            headers["x-goog-api-key"] = key
        base_url = provider.base_url.rstrip("/")
        version_root = base_url if base_url.endswith(("/v1beta", "/v1")) else f"{base_url}/v1beta"
        url = f"{version_root}/models/{quote(resolved.model.model, safe='-_.')}:generateContent"
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport, follow_redirects=False) as client:
                response = client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise ModelProtocolError("provider_timeout", "Provider request timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ModelProtocolError("provider_unreachable", "Provider request failed", retryable=True) from exc
        if response.status_code >= 400:
            raise _gemini_http_error(response)
        try:
            return _normalize_gemini(response.json())
        except (TypeError, ValueError, KeyError, binascii.Error) as exc:
            raise ModelProtocolError("invalid_provider_response", "Provider returned an invalid Gemini response") from exc


def _gemini_function(tool: Mapping[str, object]) -> dict[str, object]:
    if tool.get("type") != "function" or not isinstance(tool.get("name"), str):
        raise ModelProtocolError("request_rejected", "Gemini tool definition is invalid")
    return {
        key: tool[key]
        for key in ("name", "description", "parameters") if key in tool
    }


def _gemini_http_error(response: httpx.Response) -> ModelProtocolError:
    status = response.status_code
    code = {
        400: "request_rejected", 401: "authentication_failed", 403: "permission_denied",
        404: "endpoint_not_found", 429: "quota_exceeded",
    }.get(status, "provider_rejected")
    safe_text = ""
    try:
        payload = response.json()
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            safe_text = " ".join(str(error.get(key) or "") for key in ("code", "type", "status", "message"))
        elif isinstance(error, str):
            safe_text = error
    except (TypeError, ValueError):
        safe_text = ""
    normalized = safe_text[:1000].casefold()
    if any(marker in normalized for marker in ("model_not_found", "model not found", "unknown model", "does not exist", "invalid model")):
        code, retryable = "model_not_found", False
    elif any(marker in normalized for marker in ("operation_unsupported", "not supported", "unsupported operation")):
        code, retryable = "operation_unsupported", False
    elif any(marker in normalized for marker in ("permission", "forbidden", "access denied")):
        code, retryable = "permission_denied", False
    elif any(marker in normalized for marker in ("quota", "insufficient balance", "insufficient credit")):
        code, retryable = "quota_exceeded", True
    elif any(marker in normalized for marker in ("unauthorized", "authentication", "api key")):
        code, retryable = "authentication_failed", False
    elif any(marker in normalized for marker in ("bad gateway", "upstream", "temporarily unavailable", "timeout")):
        code, retryable = "provider_unreachable", True
    else:
        retryable = status == 429 or status >= 500
    return ModelProtocolError(
        code, "Provider rejected the Gemini request", retryable=retryable, status_code=status,
    )


def _normalize_gemini(body: object) -> NormalizedGeminiResult:
    if not isinstance(body, dict) or not isinstance(body.get("candidates"), list) or not body["candidates"]:
        raise ValueError("Gemini response has no candidates")
    candidate = body["candidates"][0]
    content = candidate.get("content") if isinstance(candidate, dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        raise ValueError("Gemini response has no parts")
    texts: list[str] = []
    calls: list[NormalizedToolCall] = []
    images: list[GeminiImagePart] = []
    for index, part in enumerate(parts):
        if not isinstance(part, dict):
            continue
        if isinstance(part.get("text"), str):
            texts.append(part["text"])
        function = part.get("functionCall")
        if isinstance(function, dict):
            name, arguments = function.get("name"), function.get("args")
            if not isinstance(name, str) or not name or not isinstance(arguments, dict):
                raise ValueError("Gemini function call is invalid")
            calls.append(NormalizedToolCall(f"gemini-call-{index}", name, arguments))
        inline = part.get("inlineData") or part.get("inline_data")
        if isinstance(inline, dict):
            mime = inline.get("mimeType") or inline.get("mime_type")
            encoded = inline.get("data")
            if not isinstance(mime, str) or not mime.startswith("image/") or not isinstance(encoded, str):
                raise ValueError("Gemini inline image is invalid")
            raw = base64.b64decode(encoded, validate=True)
            if not raw or len(raw) > MAX_GEMINI_IMAGE_BYTES:
                raise ValueError("Gemini inline image is empty or too large")
            images.append(GeminiImagePart(mime, raw))
    return NormalizedGeminiResult(
        text="\n".join(texts).strip(),
        tool_calls=tuple(calls),
        images=tuple(images),
        finish_reason=str(candidate.get("finishReason")) if candidate.get("finishReason") else None,
    )
