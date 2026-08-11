"""Agent-bound OpenAI-compatible speech synthesis and transcription."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import httpx

from .model_operation_adapters import ModelProtocolError
from .model_operation_routing import ResolvedAgentOperation


MAX_AUDIO_BYTES = 10 * 1024 * 1024


@dataclass(frozen=True)
class SpeechSynthesisResult:
    content: bytes
    media_type: str
    format: str


@dataclass(frozen=True)
class SpeechTranscriptionResult:
    text: str
    language: str | None = None
    confidence: float | None = None


class OpenAIAudioOperationAdapter:
    def __init__(self, *, timeout: float = 60.0, transport: httpx.BaseTransport | None = None) -> None:
        self.timeout = timeout
        self.transport = transport

    def synthesize(
        self,
        resolved: ResolvedAgentOperation,
        *,
        text: str,
        voice: str = "alloy",
        speed: float = 1.0,
        output_format: Literal["mp3", "wav", "opus"] = "mp3",
    ) -> SpeechSynthesisResult:
        value = text.strip()
        if not value or len(value) > 12_000:
            raise ModelProtocolError("request_rejected", "Speech text is empty or too large")
        if speed < 0.5 or speed > 2.0:
            raise ModelProtocolError("request_rejected", "Speech speed is outside the supported range")
        response = self._post(
            resolved, "/audio/speech",
            json={
                "model": resolved.model.model, "input": value, "voice": voice,
                "speed": speed, "response_format": output_format,
            },
        )
        content = response.content
        if not content or len(content) > MAX_AUDIO_BYTES:
            raise ModelProtocolError("invalid_provider_response", "Speech response is empty or too large")
        media = {"mp3": "audio/mpeg", "wav": "audio/wav", "opus": "audio/ogg"}[output_format]
        _validate_audio_signature(content, output_format)
        return SpeechSynthesisResult(content, media, output_format)

    def transcribe(
        self,
        resolved: ResolvedAgentOperation,
        *,
        audio: bytes,
        filename: str = "recording.wav",
        media_type: str = "audio/wav",
        language: str | None = None,
    ) -> SpeechTranscriptionResult:
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            raise ModelProtocolError("request_rejected", "Transcription audio is empty or too large")
        data = {"model": resolved.model.model}
        if language:
            data["language"] = language.split("-", 1)[0].lower()
        response = self._post(
            resolved, "/audio/transcriptions", data=data,
            files={"file": (filename, audio, media_type)},
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise ModelProtocolError("invalid_provider_response", "Transcription response is invalid") from exc
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise ModelProtocolError("invalid_provider_response", "Transcription response omitted text")
        confidence = payload.get("confidence")
        return SpeechTranscriptionResult(
            text.strip(),
            str(payload.get("language")) if payload.get("language") else language,
            float(confidence) if isinstance(confidence, (int, float)) and not isinstance(confidence, bool) else None,
        )

    def _post(self, resolved: ResolvedAgentOperation, path: str, **kwargs) -> httpx.Response:
        provider = resolved.model.provider
        key = provider.api_key.reveal() if provider.api_key else None
        if provider.requires_api_key and not key:
            raise ModelProtocolError("credential_unavailable", "Provider credential is unavailable")
        headers = dict(kwargs.pop("headers", {}))
        headers["Accept"] = "application/json"
        if key:
            headers["Authorization"] = f"Bearer {key}"
        try:
            with httpx.Client(timeout=self.timeout, transport=self.transport, follow_redirects=False) as client:
                response = client.post(f"{provider.base_url.rstrip('/')}{path}", headers=headers, **kwargs)
        except httpx.TimeoutException as exc:
            raise ModelProtocolError("provider_timeout", "Audio Provider timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ModelProtocolError("provider_unreachable", "Audio Provider is unreachable", retryable=True) from exc
        if response.status_code >= 400:
            code = {
                400: "request_rejected", 401: "authentication_failed", 403: "permission_denied",
                404: "endpoint_not_found", 413: "request_rejected", 429: "quota_exceeded",
            }.get(response.status_code, "provider_rejected")
            raise ModelProtocolError(
                code, "Audio Provider rejected the request",
                retryable=response.status_code == 429 or response.status_code >= 500,
                status_code=response.status_code,
            )
        return response


def _validate_audio_signature(content: bytes, output_format: str) -> None:
    valid = (
        output_format == "wav" and len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WAVE"
    ) or (
        output_format == "mp3" and (content.startswith(b"ID3") or (len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0))
    ) or (
        output_format == "opus" and (content.startswith(b"OggS") or b"OpusHead" in content[:128])
    )
    if not valid:
        raise ModelProtocolError("invalid_provider_response", "Speech response is not the requested audio format")
