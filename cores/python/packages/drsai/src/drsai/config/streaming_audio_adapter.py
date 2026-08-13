"""Production WebSocket adapter for Agent-bound streaming transcription.

The adapter deliberately does not emulate streaming by repeatedly invoking the
serial upload endpoint. Providers opt in by exposing an OpenAI-compatible
``/audio/transcriptions/stream`` WebSocket beside their configured API base.
Credentials stay in the Gateway process and are never sent to the renderer.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp

from drsai.platform_auth import get_model_credential_provider

from .model_operation_adapters import ModelProtocolError
from .model_operation_routing import ResolvedAgentOperation


MAX_STREAM_EVENT_BYTES = 256_000
MAX_STREAM_AUDIO_FRAME_BYTES = 384_000


class OpenAIStreamingTranscriptionAdapter:
    """One authenticated upstream WebSocket transcription session."""

    def __init__(self, *, connect_timeout: float = 10.0, session: aiohttp.ClientSession | None = None) -> None:
        self.connect_timeout = connect_timeout
        self._external_session = session
        self._session: aiohttp.ClientSession | None = None
        self._socket: aiohttp.ClientWebSocketResponse | None = None

    async def connect(self, resolved: ResolvedAgentOperation, start: Mapping[str, Any]) -> None:
        if self._socket is not None:
            raise RuntimeError("Streaming transcription adapter is already connected")
        provider = resolved.model.provider
        static_key = provider.api_key.reveal() if provider.api_key else None
        credential = (
            get_model_credential_provider(static_key, provider.base_url)
            if provider.name == "hepai" else None
        )
        key = credential.access_token if credential is not None else static_key
        if provider.requires_api_key and not key:
            raise ModelProtocolError("credential_unavailable", "Provider credential is unavailable")
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        base_url = credential.openai_base_url if credential is not None else provider.base_url
        self._session = self._external_session or aiohttp.ClientSession()
        try:
            self._socket = await self._session.ws_connect(
                streaming_transcription_url(base_url),
                headers=headers,
                timeout=aiohttp.ClientWSTimeout(ws_receive=None, ws_close=5.0),
                autoclose=True,
                autoping=True,
                heartbeat=20.0,
                max_msg_size=MAX_STREAM_EVENT_BYTES,
            )
            await self.send_json({
                "type": "start",
                "protocolVersion": 2,
                "model": resolved.model.model,
                "sessionId": str(start.get("sessionId") or ""),
                "turnId": str(start.get("turnId") or ""),
                "encoding": start.get("encoding"),
                "sampleRateHz": start.get("sampleRateHz"),
                "channels": start.get("channels"),
                "languageHint": start.get("languageHint"),
                "providerEndpointing": bool(start.get("providerEndpointing", True)),
                "resume": start.get("resume"),
            })
        except (aiohttp.ClientError, TimeoutError) as exc:
            await self.close()
            raise ModelProtocolError("provider_unreachable", "Streaming audio Provider is unreachable", retryable=True) from exc

    async def send_json(self, payload: Mapping[str, Any]) -> None:
        if self._socket is None:
            raise RuntimeError("Streaming transcription adapter is not connected")
        encoded = json.dumps(dict(payload), separators=(",", ":"))
        if len(encoded.encode("utf-8")) > MAX_STREAM_EVENT_BYTES:
            raise ModelProtocolError("request_rejected", "Streaming control event is too large")
        await self._socket.send_str(encoded)

    async def send_audio(self, audio: bytes) -> None:
        if self._socket is None:
            raise RuntimeError("Streaming transcription adapter is not connected")
        if not audio or len(audio) > MAX_STREAM_AUDIO_FRAME_BYTES:
            raise ModelProtocolError("request_rejected", "Streaming audio frame is empty or too large")
        await self._socket.send_bytes(audio)

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        if self._socket is None:
            raise RuntimeError("Streaming transcription adapter is not connected")
        async for message in self._socket:
            if message.type == aiohttp.WSMsgType.TEXT:
                try:
                    payload = json.loads(message.data)
                except (TypeError, ValueError) as exc:
                    raise ModelProtocolError("invalid_provider_response", "Streaming Provider returned invalid JSON") from exc
                if not isinstance(payload, dict):
                    raise ModelProtocolError("invalid_provider_response", "Streaming Provider event must be an object")
                yield payload
            elif message.type in {aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSE}:
                break

    async def close(self) -> None:
        socket, self._socket = self._socket, None
        if socket is not None and not socket.closed:
            await socket.close()
        if self._session is not None and self._session is not self._external_session:
            await self._session.close()
        self._session = None


def streaming_transcription_url(base_url: str) -> str:
    """Convert an HTTP API base into its secure streaming transcription URL."""
    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ModelProtocolError("configuration_invalid", "Provider base URL cannot be used for streaming audio")
    loopback = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme != "https" and not loopback:
        raise ModelProtocolError("configuration_invalid", "Streaming audio Provider must use TLS")
    path = f"{parsed.path.rstrip('/')}/audio/transcriptions/stream"
    return urlunsplit(("wss" if parsed.scheme == "https" else "ws", parsed.netloc, path, "", ""))
