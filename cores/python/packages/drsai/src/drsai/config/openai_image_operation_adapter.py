"""Bounded OpenAI-compatible image generation for capability probes."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

import httpx

from drsai.platform_auth import get_model_credential_provider

from .model_operation_adapters import ModelProtocolError
from .model_operation_routing import ResolvedAgentOperation


MAX_IMAGE_BYTES = 20 * 1024 * 1024


@dataclass(frozen=True)
class OpenAIImageResult:
    content: bytes
    mime_type: str = "image/png"


class OpenAIImageOperationAdapter:
    def __init__(self, *, timeout: float = 150.0, transport: httpx.BaseTransport | None = None) -> None:
        self.timeout = timeout
        self.transport = transport

    def generate(self, resolved: ResolvedAgentOperation, *, prompt: str) -> OpenAIImageResult:
        provider = resolved.model.provider
        static_key = provider.api_key.reveal() if provider.api_key else None
        credential = (
            get_model_credential_provider(static_key, provider.base_url)
            if provider.name == "hepai" else None
        )
        key = credential.access_token if credential is not None else static_key
        if provider.requires_api_key and not key:
            raise ModelProtocolError("credential_unavailable", "Provider credential is unavailable")
        base_url = (
            credential.openai_base_url if credential is not None else provider.base_url
        ).rstrip("/")
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport, follow_redirects=False) as client:
                response = client.post(
                    f"{base_url}/images/generations",
                    headers=headers,
                    json={
                        "model": resolved.model.model,
                        "prompt": prompt,
                        "size": "1024x1024",
                        "n": 1,
                        "response_format": "b64_json",
                    },
                )
        except httpx.TimeoutException as exc:
            raise ModelProtocolError("provider_timeout", "Image Provider timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ModelProtocolError("provider_unreachable", "Image Provider is unreachable", retryable=True) from exc
        if response.status_code >= 400:
            code = {
                400: "request_rejected", 401: "authentication_failed", 403: "permission_denied",
                404: "endpoint_not_found", 429: "quota_exceeded",
            }.get(response.status_code, "provider_rejected")
            raise ModelProtocolError(
                code, "Image Provider rejected the request",
                retryable=response.status_code == 429 or response.status_code >= 500,
                status_code=response.status_code,
            )
        try:
            payload = response.json()
            row = payload["data"][0]
            content = base64.b64decode(row["b64_json"], validate=True)
        except (KeyError, IndexError, TypeError, ValueError, binascii.Error) as exc:
            raise ModelProtocolError("invalid_provider_response", "Image Provider returned invalid image data") from exc
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ModelProtocolError("invalid_provider_response", "Image Provider returned empty or oversized image data")
        return OpenAIImageResult(content=content)
