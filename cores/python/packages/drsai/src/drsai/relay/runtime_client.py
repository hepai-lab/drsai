from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import urlparse
from uuid import uuid4

import aiohttp

from .device_identity import DeviceIdentity, DeviceIdentityStore
from .generated_contract import CAPABILITIES, PROTOCOL_VERSION
from .device_identity import SecretProtector, WindowsDpapiProtector


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
                                    headers={"X-Registration-Code": registration_code}) as response:
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
                 workspace_provider: Callable[[], Awaitable[list[dict[str, str]]]] | None = None,
                 backend_health: dict[str, str] | None = None) -> None:
        parsed = urlparse(relay_wss_url)
        if parsed.scheme != "wss" or not parsed.hostname:
            raise ValueError("relay_url_must_use_wss")
        self.url, self.credential, self.identity = relay_wss_url, credential, identity
        self.instance_id, self.version, self.session_factory = instance_id, version, session_factory
        self.request_handler = request_handler
        self.workspace_provider = workspace_provider
        self.backend_health = dict(backend_health or {})

    async def run_once(self) -> None:
        headers = {"Authorization": f"Runtime {self.credential.registration_token}"}
        async with self.session_factory(headers=headers) as session:
            async with session.ws_connect(self.url, heartbeat=20) as socket:
                nonce = str(uuid4())
                proof = f"{self.credential.runtime_id}\n{self.instance_id}\n{nonce}".encode()
                await socket.send_json({
                    "type": "runtime.hello", "runtime_id": self.credential.runtime_id,
                    "instance_id": self.instance_id, "version": self.version,
                    "protocol_version": PROTOCOL_VERSION, "capabilities": sorted(CAPABILITIES),
                    "backend_health": self.backend_health,
                    "nonce": nonce, "signature": self.identity.sign(proof),
                })
                async for message in socket:
                    if message.type == aiohttp.WSMsgType.TEXT:
                        payload = json.loads(message.data)
                        if payload.get("type") == "ping":
                            await socket.send_json({"type": "pong", "request_id": payload.get("request_id")})
                        elif payload.get("type") == "runtime.connected" and self.workspace_provider is not None:
                            await socket.send_json({"type": "runtime.workspaces",
                                                    "workspaces": await self.workspace_provider()})
                        elif payload.get("type") == "runtime.request":
                            await self._handle_request(socket, payload)
                    elif message.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break

    async def _handle_request(self, socket: Any, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("request_id") or "")
        operation = str(payload.get("operation") or "")
        arguments = payload.get("arguments")
        if not request_id or not operation or not isinstance(arguments, dict):
            return
        try:
            if self.request_handler is None:
                raise RuntimeError("runtime_operation_unsupported")
            result = await self.request_handler(operation, arguments)
            response = {"type": "runtime.response", "request_id": request_id, "ok": True, "result": result}
        except Exception as exc:
            code = getattr(exc, "code", None) or str(exc) or "runtime_request_failed"
            response = {"type": "runtime.response", "request_id": request_id, "ok": False, "error": {
                "code": str(code), "message": str(exc), "retryable": bool(getattr(exc, "retryable", False)),
            }}
        await socket.send_json(response)

    async def run_forever(self, stop: asyncio.Event, *, maximum_backoff: float = 30.0) -> None:
        backoff = 1.0
        while not stop.is_set():
            try:
                await self.run_once()
                backoff = 1.0
            except (aiohttp.ClientError, TimeoutError):
                try:
                    await asyncio.wait_for(stop.wait(), timeout=backoff)
                except TimeoutError:
                    pass
                backoff = min(maximum_backoff, backoff * 2)
