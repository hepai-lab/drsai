"""Loopback HTTP transport for Runtime Control v1 and OAEP.

The application object is deliberately independent from a web framework.  A
carrier can host it with the bundled asyncio server, another HTTP stack, or a
Relay without changing any Runtime semantics.
"""

from __future__ import annotations

import asyncio
import hmac
import json
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import parse_qs, urlsplit

from .control import ControlError, RuntimeControlService
from .oaep import OaepCursorExpired, OaepValidationError
from .store import RuntimeStoreError


MAX_REQUEST_BYTES = 1_000_000
MAX_HEADER_BYTES = 64_000


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes
    content_type: str = "application/json; charset=utf-8"
    headers: tuple[tuple[str, str], ...] = ()

    @classmethod
    def json(cls, status: int, value: Mapping[str, Any]) -> "HttpResponse":
        return cls(
            status,
            json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"),
        )


class ControlHttpApplication:
    """Strict, secret-free routing over one RuntimeControlService authority."""

    def __init__(self, service: RuntimeControlService, *, bearer_token: str):
        if len(bearer_token) < 32 or any(character.isspace() for character in bearer_token):
            raise ValueError("Loopback bearer token must contain at least 32 non-space characters")
        self.service = service
        self._bearer_token = bearer_token

    async def handle(
        self,
        method: str,
        target: str,
        *,
        headers: Mapping[str, str] | None = None,
        body: bytes = b"",
    ) -> HttpResponse:
        try:
            if len(body) > MAX_REQUEST_BYTES:
                return self._error(413, "request_too_large", "Request body exceeds the transport limit")
            if not self._authorized(headers or {}):
                return self._error(401, "unauthorized", "Runtime authorization is required")
            parsed = urlsplit(target)
            path = parsed.path.rstrip("/") or "/"
            query = parse_qs(parsed.query, keep_blank_values=True)
            params = self._json_object(body) if body else {}

            if method == "GET" and path == "/v1/runtime/health":
                return HttpResponse.json(200, self.service.health())
            if method == "POST" and path == "/v1/runtime/initialize":
                return HttpResponse.json(200, await self.service.dispatch("initialize", params))
            if method == "POST" and path == "/v1/sessions":
                return HttpResponse.json(201, await self.service.dispatch("session.create", params))
            if method == "POST" and path.endswith("/resume"):
                session_id = self._resource_id(path, "/v1/sessions/", "/resume")
                return HttpResponse.json(200, await self.service.dispatch("session.resume", {**params, "session_id": session_id}))
            if method == "POST" and path.endswith("/archive"):
                session_id = self._resource_id(path, "/v1/sessions/", "/archive")
                return HttpResponse.json(200, await self.service.dispatch("session.archive", {**params, "session_id": session_id}))
            if method == "POST" and path.endswith("/runs"):
                session_id = self._resource_id(path, "/v1/sessions/", "/runs")
                return HttpResponse.json(202, await self.service.dispatch("run.start", {**params, "session_id": session_id}))
            if method == "POST" and path.endswith("/cancel"):
                run_id = self._resource_id(path, "/v1/runs/", "/cancel")
                return HttpResponse.json(202, await self.service.dispatch("run.cancel", {**params, "run_id": run_id}))
            if method == "POST" and "/approvals/" in path and path.endswith("/decision"):
                run_and_approval = path.removeprefix("/v1/runs/").removesuffix("/decision").split("/approvals/")
                if len(run_and_approval) != 2 or not all(self._valid_id(item) for item in run_and_approval):
                    raise ValueError("invalid_resource_path")
                run_id, approval_id = run_and_approval
                return HttpResponse.json(200, await self.service.dispatch(
                    "approval.respond", {**params, "run_id": run_id, "approval_id": approval_id},
                ))
            if method == "GET" and path.endswith("/oaep-snapshot"):
                session_id = self._resource_id(path, "/v1/sessions/", "/oaep-snapshot")
                return HttpResponse.json(200, await self.service.dispatch("session.snapshot", {"session_id": session_id}))
            if method == "GET" and path.endswith("/oaep-events"):
                session_id = self._resource_id(path, "/v1/sessions/", "/oaep-events")
                return HttpResponse.json(200, await self.service.dispatch("session.events", {
                    "session_id": session_id,
                    "after_sequence": self._query_integer(query, "after_sequence", 0, minimum=0),
                    "limit": self._query_integer(query, "limit", 100, minimum=1, maximum=500),
                }))
            if method == "GET" and path.endswith("/oaep-events/stream"):
                session_id = self._resource_id(path, "/v1/sessions/", "/oaep-events/stream")
                page = await asyncio.to_thread(
                    self.service.journal.wait_event_page,
                    session_id,
                    after_sequence=self._query_integer(query, "after_sequence", 0, minimum=0),
                    limit=self._query_integer(query, "limit", 100, minimum=1, maximum=500),
                    timeout=float(self._query_integer(query, "wait_seconds", 25, minimum=0, maximum=30)),
                )
                payload = "".join(
                    f"id: {event['sequence']}\nevent: oaep\ndata: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"
                    for event in page["data"]
                )
                if not payload:
                    payload = ": keep-alive\n\n"
                return HttpResponse(
                    200,
                    payload.encode("utf-8"),
                    "text/event-stream; charset=utf-8",
                    (("Cache-Control", "no-store"), ("X-OAEP-Next-Sequence", str(page["next_sequence"]))),
                )
            return self._error(404, "route_not_found", "Runtime route was not found")
        except OaepCursorExpired as exc:
            return HttpResponse.json(409, {
                "error": {"code": exc.code, "message": "OAEP cursor expired", "retryable": True},
                "expired_through": exc.expired_through,
                "snapshot": exc.snapshot,
            })
        except ControlError as exc:
            return self._error(409, exc.code, exc.message)
        except (OaepValidationError, RuntimeStoreError) as exc:
            return self._error(409, getattr(exc, "code", "runtime_conflict"), "Runtime state rejected the request")
        except (ValueError, TypeError, json.JSONDecodeError):
            return self._error(400, "invalid_request", "Runtime request is invalid")

    def _authorized(self, headers: Mapping[str, str]) -> bool:
        authorization = next((value for key, value in headers.items() if key.lower() == "authorization"), "")
        prefix = "Bearer "
        return authorization.startswith(prefix) and hmac.compare_digest(
            authorization[len(prefix):], self._bearer_token,
        )

    @staticmethod
    def _json_object(body: bytes) -> dict[str, Any]:
        value = json.loads(body.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("request_body_not_object")
        return value

    @staticmethod
    def _valid_id(value: str) -> bool:
        return bool(value) and len(value) <= 200 and all(character.isalnum() or character in "._:-" for character in value)

    @classmethod
    def _resource_id(cls, path: str, prefix: str, suffix: str) -> str:
        if not path.startswith(prefix) or not path.endswith(suffix):
            raise ValueError("invalid_resource_path")
        value = path[len(prefix):len(path) - len(suffix)]
        if "/" in value or not cls._valid_id(value):
            raise ValueError("invalid_resource_path")
        return value

    @staticmethod
    def _query_integer(
        query: Mapping[str, list[str]], name: str, default: int, *, minimum: int, maximum: int | None = None,
    ) -> int:
        values = query.get(name)
        value = default if not values else int(values[-1])
        if value < minimum or maximum is not None and value > maximum:
            raise ValueError("query_out_of_range")
        return value

    @staticmethod
    def _error(status: int, code: str, message: str) -> HttpResponse:
        return HttpResponse.json(status, {"error": {"code": code, "message": message, "retryable": False}})


class AsyncioLoopbackServer:
    """Small HTTP/1.1 carrier restricted to an explicit loopback address."""

    def __init__(self, application: ControlHttpApplication, *, host: str = "127.0.0.1", port: int = 0):
        if host not in {"127.0.0.1", "::1"}:
            raise ValueError("The bundled carrier may only bind loopback")
        if not 0 <= port <= 65535:
            raise ValueError("Port is invalid")
        self.application = application
        self.host = host
        self.port = port
        self._server: asyncio.Server | None = None

    async def start(self) -> tuple[str, int]:
        if self._server is None:
            self._server = await asyncio.start_server(self._handle_connection, self.host, self.port)
        socket = self._server.sockets[0]
        address = socket.getsockname()
        return str(address[0]), int(address[1])

    async def close(self) -> None:
        if self._server is None:
            return
        self._server.close()
        await self._server.wait_closed()
        self._server = None

    async def _handle_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            raw_headers = await reader.readuntil(b"\r\n\r\n")
            if len(raw_headers) > MAX_HEADER_BYTES:
                raise ValueError("headers_too_large")
            lines = raw_headers.decode("iso-8859-1").split("\r\n")
            request_line = lines[0].split(" ")
            if len(request_line) != 3 or request_line[2] != "HTTP/1.1":
                raise ValueError("invalid_request_line")
            method, target, _ = request_line
            headers: dict[str, str] = {}
            for line in lines[1:]:
                if not line:
                    continue
                key, separator, value = line.partition(":")
                if not separator or key.lower() in headers:
                    raise ValueError("invalid_header")
                headers[key.lower()] = value.strip()
            length = int(headers.get("content-length", "0"))
            if length < 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("invalid_content_length")
            body = await reader.readexactly(length) if length else b""
            response = await self.application.handle(method, target, headers=headers, body=body)
        except (ValueError, UnicodeError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            response = ControlHttpApplication._error(400, "invalid_http_request", "HTTP request is invalid")
        reason = {200: "OK", 201: "Created", 202: "Accepted", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 409: "Conflict", 413: "Content Too Large"}.get(response.status, "Error")
        writer.write(
            f"HTTP/1.1 {response.status} {reason}\r\nContent-Type: {response.content_type}\r\nContent-Length: {len(response.body)}\r\nConnection: close\r\n".encode("ascii")
        )
        for key, value in response.headers:
            writer.write(f"{key}: {value}\r\n".encode("ascii"))
        writer.write(b"\r\n" + response.body)
        await writer.drain()
        writer.close()
        await writer.wait_closed()
