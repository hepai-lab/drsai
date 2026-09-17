"""Portable OAEP Runtime client used by non-Desktop OpenDrSai surfaces.

The client intentionally uses only Python's standard library and the pinned
OAEP validator.  TUI, Android gateways, test harnesses, and future clients can
therefore share one protocol behaviour without importing the bridge server.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

from .oaep import OaepCursorExpired, OaepProtocol


class RuntimeClientError(RuntimeError):
    """A sanitized error returned by Runtime Control."""

    def __init__(self, code: str, message: str, *, retryable: bool = False, status: int = 0):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status = status


@dataclass(frozen=True)
class RuntimeEndpoint:
    base_url: str
    bearer_token: str

    def __post_init__(self) -> None:
        parsed = urlsplit(self.base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("The portable client accepts loopback HTTP endpoints only")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Runtime endpoint must not contain credentials, query, or fragment")
        if len(self.bearer_token) < 32 or any(character.isspace() for character in self.bearer_token):
            raise ValueError("Runtime bearer token is invalid")


class OaepRuntimeClient:
    """Async Runtime Control and OAEP client with cursor recovery support."""

    def __init__(self, endpoint: RuntimeEndpoint, *, protocol: OaepProtocol | None = None):
        self.endpoint = endpoint
        self.protocol = protocol or OaepProtocol()

    async def initialize(self, protocols: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return await self._json("POST", "/v1/runtime/initialize", {"protocols": dict(protocols)} if protocols else {})

    async def health(self) -> dict[str, Any]:
        return await self._json("GET", "/v1/runtime/health")

    async def create_session(self, *, idempotency_key: str, **binding: Any) -> dict[str, Any]:
        return await self._json("POST", "/v1/sessions", {"idempotency_key": idempotency_key, **binding})

    async def resume_session(self, session_id: str) -> dict[str, Any]:
        return await self._json("POST", f"/v1/sessions/{self._id(session_id)}/resume", {})

    async def archive_session(self, session_id: str, *, idempotency_key: str) -> dict[str, Any]:
        return await self._json(
            "POST", f"/v1/sessions/{self._id(session_id)}/archive", {"idempotency_key": idempotency_key}
        )

    async def start_run(
        self, session_id: str, *, idempotency_key: str, content_blocks: Sequence[Mapping[str, Any]]
    ) -> dict[str, Any]:
        return await self._json("POST", f"/v1/sessions/{self._id(session_id)}/runs", {
            "idempotency_key": idempotency_key,
            "content_blocks": [dict(block) for block in content_blocks],
        })

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        return await self._json("POST", f"/v1/runs/{self._id(run_id)}/cancel", {})

    async def respond_approval(self, run_id: str, approval_id: str, *, outcome: str) -> dict[str, Any]:
        return await self._json(
            "POST",
            f"/v1/runs/{self._id(run_id)}/approvals/{self._id(approval_id)}/decision",
            {"outcome": outcome},
        )

    async def snapshot(self, session_id: str) -> dict[str, Any]:
        value = await self._json("GET", f"/v1/sessions/{self._id(session_id)}/oaep-snapshot")
        self.protocol.validate_snapshot(value)
        return value

    async def events(self, session_id: str, *, after_sequence: int = 0, limit: int = 100) -> dict[str, Any]:
        query = urlencode({"after_sequence": after_sequence, "limit": limit})
        try:
            value = await self._json("GET", f"/v1/sessions/{self._id(session_id)}/oaep-events?{query}")
        except _CursorResponse as exc:
            self.protocol.validate_snapshot(exc.snapshot)
            raise OaepCursorExpired(expired_through=exc.expired_through, snapshot=exc.snapshot) from exc
        self.protocol.validate_event_page(value)
        return value

    async def watch(
        self,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 100,
        wait_seconds: int = 25,
        recover_cursor: bool = True,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield validated OAEP events forever, recovering an expired cursor once.

        Cancellation of the consuming task immediately stops the next request;
        the method never treats an accepted cancel command as a terminal fact.
        """
        cursor = after_sequence
        while True:
            query = urlencode({"after_sequence": cursor, "limit": limit, "wait_seconds": wait_seconds})
            try:
                status, headers, body = await self._request(
                    "GET", f"/v1/sessions/{self._id(session_id)}/oaep-events/stream?{query}", None
                )
                self._raise_for_status(status, body)
            except _CursorResponse as exc:
                if not recover_cursor:
                    raise OaepCursorExpired(expired_through=exc.expired_through, snapshot=exc.snapshot) from exc
                self.protocol.validate_snapshot(exc.snapshot)
                cursor = int(exc.snapshot["snapshot_sequence"])
                recover_cursor = False
                continue
            next_sequence = int(headers.get("x-oaep-next-sequence", cursor))
            for event in self._decode_sse(body):
                self.protocol.validate_event(event)
                sequence = int(event["sequence"])
                if sequence <= cursor:
                    continue
                cursor = sequence
                yield event
            cursor = max(cursor, next_sequence)

    async def _json(self, method: str, path: str, value: Mapping[str, Any] | None = None) -> dict[str, Any]:
        status, _headers, body = await self._request(method, path, value)
        self._raise_for_status(status, body)
        decoded = json.loads(body or b"{}")
        if not isinstance(decoded, dict):
            raise RuntimeClientError("invalid_response", "Runtime response must be an object", status=status)
        return decoded

    async def _request(
        self, method: str, path: str, value: Mapping[str, Any] | None
    ) -> tuple[int, dict[str, str], bytes]:
        parsed = urlsplit(self.endpoint.base_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 80
        base_path = parsed.path.rstrip("/")
        body = b"" if value is None else json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
        reader, writer = await asyncio.open_connection(host, port)
        try:
            target = base_path + path
            request = [
                f"{method} {target} HTTP/1.1",
                f"Host: {host}:{port}",
                f"Authorization: Bearer {self.endpoint.bearer_token}",
                "Accept: application/json, text/event-stream",
                "Connection: close",
                f"Content-Length: {len(body)}",
            ]
            if body:
                request.append("Content-Type: application/json")
            writer.write(("\r\n".join(request) + "\r\n\r\n").encode("ascii") + body)
            await writer.drain()
            head = await reader.readuntil(b"\r\n\r\n")
            lines = head.decode("iso-8859-1").split("\r\n")
            status = int(lines[0].split(" ", 2)[1])
            headers = {
                key.strip().lower(): val.strip()
                for line in lines[1:] if line and (parts := line.partition(":"))[1]
                for key, val in [(parts[0], parts[2])]
            }
            length = int(headers.get("content-length", "0"))
            payload = await reader.readexactly(length) if length else b""
            return status, headers, payload
        finally:
            writer.close()
            await writer.wait_closed()

    @staticmethod
    def _raise_for_status(status: int, body: bytes) -> None:
        if 200 <= status < 300:
            return
        try:
            value = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            value = {}
        error = value.get("error", {}) if isinstance(value, dict) else {}
        if status == 409 and error.get("code") == "oaep_cursor_expired":
            raise _CursorResponse(int(value["expired_through"]), dict(value["snapshot"]))
        raise RuntimeClientError(
            str(error.get("code") or "runtime_http_error"),
            str(error.get("message") or "Runtime request failed"),
            retryable=bool(error.get("retryable", False)),
            status=status,
        )

    @staticmethod
    def _decode_sse(body: bytes) -> list[dict[str, Any]]:
        values: list[dict[str, Any]] = []
        for frame in body.decode("utf-8").replace("\r\n", "\n").split("\n\n"):
            data = "\n".join(line[5:].lstrip() for line in frame.splitlines() if line.startswith("data:"))
            if data:
                value = json.loads(data)
                if not isinstance(value, dict):
                    raise RuntimeClientError("invalid_sse_event", "OAEP stream event must be an object")
                values.append(value)
        return values

    @staticmethod
    def _id(value: str) -> str:
        if not value or len(value) > 200 or not all(character.isalnum() or character in "._:-" for character in value):
            raise ValueError("Runtime resource id is invalid")
        return quote(value, safe="._:-")


class _CursorResponse(RuntimeError):
    def __init__(self, expired_through: int, snapshot: dict[str, Any]):
        self.expired_through = expired_through
        self.snapshot = snapshot

