from __future__ import annotations

import ast
import asyncio
import json
from pathlib import Path

import pytest

from drsai.relay.device_identity import DeviceIdentityStore
from drsai.relay.generated_contract import PROTOCOL_VERSION
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


def test_runtime_connector_supports_frozen_hai_http_frames(tmp_path: Path) -> None:
    class Message:
        type = __import__("aiohttp").WSMsgType.TEXT
        data = json.dumps({
            "type": "request",
            "request_id": "request-hai",
            "correlation_id": "correlation-hai",
            "method": "GET",
            "path": "/v1/sessions?workspace_id=workspace-one",
            "body": None,
        })

    async def handler(method, path, body, correlation_id):
        assert (method, path, body, correlation_id) == (
            "GET",
            "/v1/sessions?workspace_id=workspace-one",
            None,
            "correlation-hai",
        )
        return 200, {"data": [{"session_id": "session-one"}]}

    FakeSocket.incoming = [Message()]
    try:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://ai-dev.ihep.ac.cn/api/runtime-relay/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            session_factory=FakeSession,
            http_request_handler=handler,
            wire_protocol="hai-http",
        )
        asyncio.run(connector.run_once())
        assert FakeSession.last.headers == {"X-Runtime-Token": "token"}
        assert "runtime_id=rt-one" in FakeSession.last.url
        assert "instance_id=instance-one" in FakeSession.last.url
        assert "version=2.0.0" in FakeSession.last.url
        assert FakeSession.last.socket.sent[0]["type"] == "heartbeat"
        assert FakeSession.last.socket.sent[-1] == {
            "type": "response",
            "request_id": "request-hai",
            "status": 200,
            "body": {"data": [{"session_id": "session-one"}]},
        }
    finally:
        FakeSocket.incoming = []


def test_runtime_connector_forwards_hai_event_frames(tmp_path: Path) -> None:
    async def scenario():
        socket = FakeSocket()
        calls = 0

        async def events():
            nonlocal calls
            calls += 1
            return [{
                "event_id": "event-one",
                "sequence": 1,
                "runtime_id": "rt-one",
                "workspace_id": "workspace-one",
                "session_id": "session-one",
                "run_id": "run-one",
                "timestamp": "2026-07-26T00:00:00+00:00",
                "kind": "message.delta",
                "payload": {"delta": "hello"},
            }]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            event_provider=events,
            wire_protocol="hai-http",
        )
        task = asyncio.create_task(connector._forward_events(socket))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert calls == 1
        assert socket.sent == [{
            "type": "event",
            "run_id": "run-one",
            "event": {
                "event_id": "event-one",
                "sequence": 1,
                "runtime_id": "rt-one",
                "workspace_id": "workspace-one",
                "session_id": "session-one",
                "run_id": "run-one",
                "timestamp": "2026-07-26T00:00:00+00:00",
                "kind": "message.delta",
                "payload": {"delta": "hello"},
            },
        }]

    asyncio.run(scenario())


def test_runtime_connector_normalizes_hai_http_error_envelope(tmp_path: Path) -> None:
    async def scenario():
        socket = FakeSocket()

        async def handler(method, path, body, correlation_id):
            return 404, {"error": {"code": "session_not_found", "message": "missing"}}

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            http_request_handler=handler,
            wire_protocol="hai-http",
        )
        await connector._handle_http_request(socket, {
            "type": "request",
            "request_id": "request-error",
            "correlation_id": "correlation-error",
            "method": "GET",
            "path": "/v1/sessions/missing",
            "body": None,
        })
        response = socket.sent[0]
        assert response["type"] == "response"
        assert response["status"] == 404
        assert response["error"] == {
            "code": "session_not_found",
            "message": "missing",
            "correlation_id": "correlation-error",
            "retryable": False,
            "details": {},
            "source": "runtime",
        }
        assert "body" not in response

    asyncio.run(scenario())


def test_runtime_connector_normalizes_loopback_runtime_identity_to_enrollment(tmp_path: Path) -> None:
    async def scenario():
        socket = FakeSocket()

        async def handler(method, path, body, correlation_id):
            assert (method, path, body) == ("GET", "/v1/runtime?detail=true", None)
            return 200, {
                "runtime_id": "loopback-installation-id",
                "instance_id": "loopback-instance",
                "version": "1.5.2",
                "protocol_version": 1,
                "platform": "win32",
            }

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("relay-enrollment-id", "token"),
            identity,
            "bridge-instance",
            "2.0.0",
            http_request_handler=handler,
            wire_protocol="hai-http",
        )
        await connector._handle_http_request(socket, {
            "type": "request",
            "request_id": "request-runtime",
            "correlation_id": "correlation-runtime",
            "method": "GET",
            "path": "/v1/runtime?detail=true",
            "body": None,
        })

        assert socket.sent == [{
            "type": "response",
            "request_id": "request-runtime",
            "status": 200,
            "body": {
                "runtime_id": "relay-enrollment-id",
                "instance_id": "bridge-instance",
                "version": "2.0.0",
                "protocol_version": PROTOCOL_VERSION,
                "platform": "win32",
            },
        }]

    asyncio.run(scenario())


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
