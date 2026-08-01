from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import uuid4

import aiohttp

from .device_identity import DeviceIdentity, DeviceIdentityStore
from .generated_contract import CAPABILITIES, PROTOCOL_VERSION
from .device_identity import SecretProtector, WindowsDpapiProtector

_RUNTIME_VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")


def resolve_runtime_version(override: str | None = None) -> str:
    """Resolve the version of the Runtime loaded by this Windows process."""
    if override is not None and override.strip():
        version = override.strip()
    else:
        from drsai.version import __version__

        version = __version__.strip()
    if not _RUNTIME_VERSION_PATTERN.fullmatch(version):
        raise ValueError("runtime_version_invalid")
    return version


class RegistrationTransport(Protocol):
    async def register(self, *, registration_code: str, display_name: str, version: str,
                       public_key: str, idempotency_key: str) -> tuple[str, str]: ...


@dataclass(frozen=True)
class RuntimeCredential:
    runtime_id: str
    registration_token: str


class RuntimeEnrollmentClient:
    """Desktop/Web/CLI-facing first registration. Android never calls this API."""

    def __init__(self, identity_store: DeviceIdentityStore, transport: RegistrationTransport) -> None:
        self.identity_store, self.transport = identity_store, transport

    async def enroll(self, code: str, display_name: str, version: str) -> RuntimeCredential:
        identity = self.identity_store.load_or_create()
        runtime_id, token = await self.transport.register(registration_code=code, display_name=display_name,
                                                          version=version, public_key=identity.public_key,
                                                          idempotency_key=f"runtime-register-{uuid4()}")
        return RuntimeCredential(runtime_id, token)


class AiohttpRegistrationTransport:
    def __init__(self, relay_https_url: str) -> None:
        parsed = urlparse(relay_https_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("relay_registration_url_must_use_https")
        self.root = relay_https_url.rstrip("/")

    async def register(self, *, registration_code: str, display_name: str, version: str,
                       public_key: str, idempotency_key: str) -> tuple[str, str]:
        body = {"request_id": str(uuid4()), "correlation_id": str(uuid4()), "idempotency_key": idempotency_key,
                "display_name": display_name, "version": version, "public_key": public_key}
        async with aiohttp.ClientSession() as session:
            async with session.post(f"{self.root}/v1/runtimes/register", json=body,
                                    headers={"X-Registration-Code": registration_code},
                                    allow_redirects=False) as response:
                if response.status >= 400:
                    raise RuntimeError(f"runtime_registration_failed:{response.status}")
                result = await response.json()
                return str(result["runtime_id"]), str(result["registration_token"])


class RuntimeCredentialStore:
    def __init__(self, path: Path, protector: SecretProtector | None = None) -> None:
        self.path, self.protector = path, protector or WindowsDpapiProtector()

    def save(self, credential: RuntimeCredential) -> None:
        protected = self.protector.protect(json.dumps(credential.__dict__, separators=(",", ":")).encode())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(__import__("base64").b64encode(protected))
        temporary.chmod(0o600)
        temporary.replace(self.path)

    def load(self) -> RuntimeCredential:
        protected = __import__("base64").b64decode(self.path.read_bytes())
        return RuntimeCredential(**json.loads(self.protector.unprotect(protected)))


class RuntimeOutboundConnector:
    """A Runtime-initiated WSS client. It never binds or listens on a socket."""

    def __init__(self, relay_wss_url: str, credential: RuntimeCredential, identity: DeviceIdentity,
                 instance_id: str, version: str, *, session_factory: Any = aiohttp.ClientSession,
                 request_handler: Callable[[str, dict[str, Any]], Awaitable[Any]] | None = None,
                 http_request_handler: Callable[
                     [str, str, dict[str, Any] | None, str], Awaitable[tuple[int, Any]]
                 ] | None = None,
                 event_provider: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None,
                 session_event_provider: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None,
                 workspace_provider: Callable[[], Awaitable[list[dict[str, Any]]]] | None = None,
                 backend_health: dict[str, str] | None = None,
                 wire_protocol: str = "legacy-operation") -> None:
        parsed = urlparse(relay_wss_url)
        if parsed.scheme != "wss" or not parsed.hostname:
            raise ValueError("relay_url_must_use_wss")
        self.url, self.credential, self.identity = relay_wss_url, credential, identity
        self.instance_id, self.version, self.session_factory = instance_id, version, session_factory
        self.request_handler = request_handler
        self.http_request_handler = http_request_handler
        self.event_provider = event_provider
        self.session_event_provider = session_event_provider
        self.workspace_provider = workspace_provider
        self._workspace_dirty = asyncio.Event()
        self._workspace_sync_lock = asyncio.Lock()
        self._workspace_sync_task: asyncio.Task[list[dict[str, Any]]] | None = None
        self._workspace_revision = 0
        self._workspace_published_revision = -1
        self.backend_health = dict(backend_health or {})
        if wire_protocol not in {"legacy-operation", "hai-http"}:
            raise ValueError("runtime_wire_protocol_invalid")
        self.wire_protocol = wire_protocol

    async def run_once(self) -> None:
        if self.wire_protocol == "hai-http":
            headers = {"X-Runtime-Token": self.credential.registration_token}
            parsed = urlparse(self.url)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            query.update({
                "runtime_id": self.credential.runtime_id,
                "instance_id": self.instance_id,
                "version": self.version,
            })
            connection_url = urlunparse(parsed._replace(query=urlencode(query)))
        else:
            headers = {"Authorization": f"Runtime {self.credential.registration_token}"}
            connection_url = self.url
        async with self.session_factory(headers=headers) as session:
            async with session.ws_connect(connection_url, heartbeat=20) as socket:
                background_tasks: list[asyncio.Task[Any]] = []
                if self.wire_protocol == "hai-http":
                    await socket.send_json({"type": "heartbeat", "timestamp": time.time()})
                    background_tasks.append(asyncio.create_task(self._send_heartbeats(socket)))
                    if self.workspace_provider is not None:
                        background_tasks.append(asyncio.create_task(self._forward_workspaces(socket)))
                    if self.event_provider is not None:
                        background_tasks.append(asyncio.create_task(self._forward_events(socket)))
                    if self.session_event_provider is not None:
                        background_tasks.append(asyncio.create_task(self._forward_session_events(socket)))
                else:
                    nonce = str(uuid4())
                    proof = f"{self.credential.runtime_id}\n{self.instance_id}\n{nonce}".encode()
                    await socket.send_json({
                        "type": "runtime.hello", "runtime_id": self.credential.runtime_id,
                        "instance_id": self.instance_id, "version": self.version,
                        "protocol_version": PROTOCOL_VERSION, "capabilities": sorted(CAPABILITIES),
                        "backend_health": self.backend_health,
                        "nonce": nonce, "signature": self.identity.sign(proof),
                    })
                try:
                    async for message in socket:
                        if message.type == aiohttp.WSMsgType.TEXT:
                            payload = json.loads(message.data)
                            if payload.get("type") == "ping":
                                await socket.send_json({"type": "pong", "request_id": payload.get("request_id")})
                            elif payload.get("type") == "runtime.connected" and self.workspace_provider is not None:
                                await self._try_publish_workspaces(socket)
                                if not any(task.get_name() == "runtime-workspaces" for task in background_tasks):
                                    background_tasks.append(asyncio.create_task(
                                        self._forward_workspaces(socket, publish_initial=False),
                                        name="runtime-workspaces"
                                    ))
                            elif payload.get("type") == "runtime.request":
                                await self._handle_request(socket, payload)
                            elif payload.get("type") == "request":
                                await self._handle_http_request(socket, payload)
                        elif message.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
                finally:
                    for task in background_tasks:
                        task.cancel()
                    if background_tasks:
                        await asyncio.gather(*background_tasks, return_exceptions=True)

    @staticmethod
    async def _send_heartbeats(socket: Any) -> None:
        while True:
            await asyncio.sleep(15)
            await socket.send_json({"type": "heartbeat", "timestamp": time.time()})

    def mark_workspaces_dirty(self) -> None:
        if self.workspace_provider is None:
            return
        self._workspace_revision += 1
        self._workspace_dirty.set()

    async def _try_publish_workspaces(self, socket: Any) -> bool:
        if self.workspace_provider is None:
            return True
        target_revision = self._workspace_revision
        try:
            workspaces = await self._workspace_catalog_snapshot()
            await socket.send_json({"type": "runtime.workspaces", "workspaces": workspaces})
        except Exception:
            self._workspace_dirty.set()
            return False
        if self._workspace_revision == target_revision:
            self._workspace_published_revision = target_revision
            self._workspace_dirty.clear()
        else:
            self._workspace_dirty.set()
        return True

    async def _workspace_catalog_snapshot(self) -> list[dict[str, Any]]:
        if self.workspace_provider is None:
            raise RuntimeError("workspace_catalog_sync_unsupported")
        async with self._workspace_sync_lock:
            task = self._workspace_sync_task
            if task is None or task.done():
                task = asyncio.create_task(asyncio.wait_for(self.workspace_provider(), timeout=5.0))
                self._workspace_sync_task = task
        try:
            return await task
        finally:
            async with self._workspace_sync_lock:
                if self._workspace_sync_task is task and task.done():
                    self._workspace_sync_task = None

    async def _sync_workspace_catalog(self) -> dict[str, Any]:
        workspaces = await self._workspace_catalog_snapshot()
        return {
            "runtime_id": self.credential.runtime_id,
            "workspaces": workspaces,
            "catalog_revision": max(
                [self._workspace_revision, *[
                    int(item.get("revision") or 0)
                    for item in workspaces
                    if isinstance(item, dict)
                ]],
            ),
        }

    async def _forward_workspaces(self, socket: Any, *, publish_initial: bool = True) -> None:
        if publish_initial:
            await self._try_publish_workspaces(socket)
        retry_delay = 0.5
        while True:
            await self._workspace_dirty.wait()
            await asyncio.sleep(0.05)
            if await self._try_publish_workspaces(socket):
                retry_delay = 0.5
            else:
                await asyncio.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 10.0)

    async def _forward_events(self, socket: Any) -> None:
        while True:
            try:
                for event in await self.event_provider():
                    run_id = str(event.get("run_id") or "")
                    if run_id:
                        await socket.send_json({"type": "event", "run_id": run_id, "event": event})
            except Exception:
                # A failed poll must not tear down the control channel. The
                # next iteration resumes from the Runtime-owned sequence.
                pass
            await asyncio.sleep(1)

    async def _forward_session_events(self, socket: Any) -> None:
        while True:
            try:
                for event in await self.session_event_provider():
                    session_id = str(event.get("session_id") or "")
                    sequence = int(event.get("session_sequence") or 0)
                    if session_id and sequence > 0:
                        await socket.send_json({
                            "type": "event",
                            "scope": "session",
                            "session_id": session_id,
                            "session_sequence": sequence,
                            "event": event,
                        })
            except Exception:
                # The next poll resumes from the Runtime-owned Session cursor.
                pass
            await asyncio.sleep(1)

    async def _handle_request(self, socket: Any, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("request_id") or "")
        operation = str(payload.get("operation") or "")
        arguments = payload.get("arguments")
        if not request_id or not operation or not isinstance(arguments, dict):
            return
        try:
            if operation == "workspace.catalog.sync":
                result = await self._sync_workspace_catalog()
            elif self.request_handler is None:
                raise RuntimeError("runtime_operation_unsupported")
            else:
                result = await self.request_handler(operation, arguments)
            response = {"type": "runtime.response", "request_id": request_id, "ok": True, "result": result}
        except Exception as exc:
            code = getattr(exc, "code", None) or str(exc) or "runtime_request_failed"
            response = {"type": "runtime.response", "request_id": request_id, "ok": False, "error": {
                "code": str(code), "message": str(exc), "retryable": bool(getattr(exc, "retryable", False)),
            }}
        await socket.send_json(response)

    async def _handle_http_request(self, socket: Any, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("request_id") or "")
        correlation_id = str(payload.get("correlation_id") or "")
        method = str(payload.get("method") or "").upper()
        path = str(payload.get("path") or "")
        body = payload.get("body")
        if (
            not request_id
            or not correlation_id
            or method not in {"GET", "POST", "PATCH", "PUT", "DELETE"}
            or not path.startswith("/v1/")
            or body is not None and not isinstance(body, dict)
        ):
            return
        try:
            if self.http_request_handler is None:
                raise RuntimeError("runtime_http_proxy_unsupported")
            status, result = await self.http_request_handler(method, path, body, correlation_id)
            if (
                int(status) < 400
                and method == "GET"
                and path.partition("?")[0] == "/v1/runtime"
                and isinstance(result, dict)
            ):
                # The Relay enrollment is the externally authoritative Runtime
                # identity. The loopback gateway has its own installation
                # identity and package version, which must never leak through
                # the HAI proxy as a conflicting Runtime.
                result = {
                    **result,
                    "runtime_id": self.credential.runtime_id,
                    "instance_id": self.instance_id,
                    "version": self.version,
                    "protocol_version": PROTOCOL_VERSION,
                }
            if int(status) >= 400:
                raw_error = result.get("error") if isinstance(result, dict) else None
                if not isinstance(raw_error, dict) and isinstance(result, dict):
                    raw_error = result.get("detail")
                if not isinstance(raw_error, dict):
                    raw_error = {}
                response = {
                    "type": "response",
                    "request_id": request_id,
                    "status": int(status),
                    "error": {
                        "code": str(raw_error.get("code") or f"runtime_http_{status}"),
                        "message": str(raw_error.get("message") or "Runtime request failed"),
                        "correlation_id": str(raw_error.get("correlation_id") or correlation_id),
                        "retryable": bool(raw_error.get("retryable", int(status) >= 500)),
                        "details": (
                            raw_error.get("details")
                            if isinstance(raw_error.get("details"), dict)
                            else raw_error.get("detail")
                            if isinstance(raw_error.get("detail"), dict)
                            else {}
                        ),
                        "source": "runtime",
                    },
                }
            else:
                response = {
                    "type": "response",
                    "request_id": request_id,
                    "status": int(status),
                    "body": result,
                }
        except Exception as exc:
            code = getattr(exc, "code", None) or str(exc) or "runtime_request_failed"
            response = {
                "type": "response",
                "request_id": request_id,
                "status": 503 if bool(getattr(exc, "retryable", False)) else 400,
                "error": {
                    "code": str(code),
                    "message": str(exc),
                    "correlation_id": correlation_id,
                    "retryable": bool(getattr(exc, "retryable", False)),
                    "details": {},
                    "source": "runtime",
                },
            }
        await socket.send_json(response)

    async def run_forever(self, stop: asyncio.Event, *, maximum_backoff: float = 30.0) -> None:
        backoff = 1.0
        while not stop.is_set():
            try:
                await self.run_once()
                backoff = 1.0
                # A peer can accept the WebSocket handshake and immediately
                # close it without raising an aiohttp exception. Do not spin a
                # reconnect loop that can starve the co-hosted Gateway startup
                # and request handling tasks.
                try:
                    await asyncio.wait_for(stop.wait(), timeout=backoff)
                except TimeoutError:
                    pass
            except (aiohttp.ClientError, TimeoutError):
                try:
                    await asyncio.wait_for(stop.wait(), timeout=backoff)
                except TimeoutError:
                    pass
                backoff = min(maximum_backoff, backoff * 2)
