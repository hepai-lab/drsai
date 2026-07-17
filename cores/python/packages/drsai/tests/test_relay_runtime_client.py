from __future__ import annotations

import ast
import asyncio
from pathlib import Path

import pytest

from drsai.relay.device_identity import DeviceIdentityStore
from drsai.relay.runtime_client import RuntimeCredential, RuntimeCredentialStore, RuntimeEnrollmentClient, RuntimeOutboundConnector
from drsai.relay.enroll_cli import parser


class XorProtector:
    def protect(self, value: bytes) -> bytes:
        return bytes(item ^ 0xA5 for item in value)

    def unprotect(self, value: bytes) -> bytes:
        return self.protect(value)


class RegistrationFixture:
    def __init__(self) -> None:
        self.arguments = None

    async def register(self, **kwargs):
        self.arguments = kwargs
        return "rt-one", "secret-token"


class FakeSocket:
    incoming = []

    def __init__(self) -> None:
        self.sent = []
        self.messages = list(self.incoming)

    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    async def send_json(self, payload): self.sent.append(payload)
    def __aiter__(self): return self
    async def __anext__(self):
        if not self.messages: raise StopAsyncIteration
        return self.messages.pop(0)


class FakeSession:
    last = None

    def __init__(self, headers):
        self.headers, self.socket = headers, FakeSocket()
        FakeSession.last = self

    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def ws_connect(self, url, heartbeat):
        self.url, self.heartbeat = url, heartbeat
        return self.socket


def test_desktop_enrollment_creates_persistent_device_identity(tmp_path: Path) -> None:
    store, transport = DeviceIdentityStore(tmp_path / "identity.bin", XorProtector()), RegistrationFixture()
    credential = asyncio.run(RuntimeEnrollmentClient(store, transport).enroll("registration-code", "Office", "1.4.6"))
    assert credential == RuntimeCredential("rt-one", "secret-token")
    assert transport.arguments["registration_code"] == "registration-code"
    assert transport.arguments["idempotency_key"].startswith("runtime-register-")
    assert store.path.read_bytes() != store.load_or_create().private_key.private_bytes_raw()
    assert store.load_or_create().public_key == transport.arguments["public_key"]


def test_runtime_connector_is_outbound_wss_and_sends_signed_hello(tmp_path: Path) -> None:
    identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
    connector = RuntimeOutboundConnector("wss://relay.example/v1/runtime-connect", RuntimeCredential("rt-one", "token"),
                                         identity, "instance-one", "1.4.6", session_factory=FakeSession)
    asyncio.run(connector.run_once())
    assert FakeSession.last.headers == {"Authorization": "Runtime token"}
    hello = FakeSession.last.socket.sent[0]
    assert hello["type"] == "runtime.hello" and hello["runtime_id"] == "rt-one"
    assert hello["signature"] and hello["nonce"]
    with pytest.raises(ValueError, match="wss"):
        RuntimeOutboundConnector("ws://127.0.0.1:8765", RuntimeCredential("rt", "token"), identity, "i", "1")


def test_runtime_connector_source_has_no_listener_or_server_socket() -> None:
    source = Path(__file__).parents[1] / "src/drsai/relay/runtime_client.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    attributes = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    assert not ({"bind", "listen", "start_server", "TCPSite"} & attributes)


def test_runtime_connector_dispatches_control_request_and_returns_response(tmp_path: Path) -> None:
    class Message:
        type = __import__("aiohttp").WSMsgType.TEXT
        data = '{"type":"runtime.request","request_id":"request-one","operation":"get_run","arguments":{"args":["run-one"],"kwargs":{}}}'

    async def handler(operation, arguments):
        assert operation == "get_run" and arguments["args"] == ["run-one"]
        return {"run_id": "run-one", "status": "completed"}

    FakeSocket.incoming = [Message()]
    try:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect", RuntimeCredential("rt-one", "token"), identity,
            "instance-one", "1.4.7", session_factory=FakeSession, request_handler=handler,
        )
        asyncio.run(connector.run_once())
        response = FakeSession.last.socket.sent[-1]
        assert response == {"type": "runtime.response", "request_id": "request-one", "ok": True,
                            "result": {"run_id": "run-one", "status": "completed"}}
    finally:
        FakeSocket.incoming = []


def test_runtime_connector_publishes_authoritative_workspaces_after_handshake(tmp_path: Path) -> None:
    class Message:
        type = __import__("aiohttp").WSMsgType.TEXT
        data = '{"type":"runtime.connected","runtime":{}}'

    async def workspaces():
        return [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "Project"}]

    FakeSocket.incoming = [Message()]
    try:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect", RuntimeCredential("rt-one", "token"), identity,
            "instance-one", "1.4.7", session_factory=FakeSession, workspace_provider=workspaces,
            backend_health={"opendrsai": "healthy"},
        )
        asyncio.run(connector.run_once())
        assert FakeSession.last.socket.sent[0]["backend_health"] == {"opendrsai": "healthy"}
        assert FakeSession.last.socket.sent[1] == {"type": "runtime.workspaces", "workspaces": [
            {"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "Project"},
        ]}
    finally:
        FakeSocket.incoming = []


def test_runtime_credential_is_protected_and_cli_requires_distinct_registration_code(tmp_path: Path) -> None:
    store = RuntimeCredentialStore(tmp_path / "credential", XorProtector())
    value = RuntimeCredential("rt-one", "runtime-secret")
    store.save(value)
    assert b"runtime-secret" not in store.path.read_bytes()
    assert store.load() == value
    arguments = parser().parse_args(["--relay", "https://relay.example", "--registration-code", "registration-only",
                                     "--name", "PC", "--version", "1"])
    assert arguments.registration_code == "registration-only"
