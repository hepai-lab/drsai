from __future__ import annotations

import ast
import asyncio
import json
import time
from pathlib import Path
from urllib.parse import unquote

import aiohttp
import pytest

from drsai.relay.device_identity import DeviceIdentityStore
from drsai.relay.generated_contract import PROTOCOL_VERSION
from drsai.relay.runtime_client import (
    RuntimeCredential,
    RuntimeCredentialStore,
    RuntimeEnrollmentClient,
    RuntimeOutboundConnector,
    resolve_runtime_version,
)
from drsai.relay.enroll_cli import parser
from drsai.backend.runtime.observability import ResourceCorrelation, RuntimeObservability


def test_runtime_version_defaults_to_loaded_windows_runtime_and_allows_controlled_override():
    from drsai.version import __version__

    assert resolve_runtime_version() == __version__
    assert resolve_runtime_version(" 9.8.7-rc1 ") == "9.8.7-rc1"


@pytest.mark.parametrize("value", ["unknown", "1.5", "v1.5.3", "1.5.3+local", "1.5.3 bad"])
def test_runtime_version_rejects_non_contract_values(value):
    with pytest.raises(ValueError, match="runtime_version_invalid"):
        resolve_runtime_version(value)


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
    assert "mcp.stdio" not in hello["capabilities"]
    with pytest.raises(ValueError, match="wss"):
        RuntimeOutboundConnector("ws://127.0.0.1:8765", RuntimeCredential("rt", "token"), identity, "i", "1")


def test_runtime_connector_advertises_stdio_mcp_only_when_configured(tmp_path: Path) -> None:
    identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
    connector = RuntimeOutboundConnector(
        "wss://relay.example/v1/runtime-connect", RuntimeCredential("rt-one", "token"),
        identity, "instance-one", "1.4.6", session_factory=FakeSession,
        execution_capabilities=frozenset({"mcp.stdio"}),
    )
    asyncio.run(connector.run_once())
    assert "mcp.stdio" in FakeSession.last.socket.sent[0]["capabilities"]
    hai = RuntimeOutboundConnector(
        "wss://relay.example/api/runtime-relay/v1/runtime-connect", RuntimeCredential("rt-one", "token"),
        identity, "instance-one", "1.4.6", session_factory=FakeSession, wire_protocol="hai-http",
        execution_capabilities=frozenset({"mcp.stdio"}),
    )
    asyncio.run(hai.run_once())
    assert "mcp.stdio" in FakeSession.last.socket.sent[0]["capabilities"]
    assert "mcp.stdio" in unquote(FakeSession.last.url)
    with pytest.raises(ValueError, match="runtime_execution_capability_invalid"):
        RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect", RuntimeCredential("rt-one", "token"),
            identity, "instance-one", "1.4.6", execution_capabilities=frozenset({"shell"}),
        )


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
        assert "capabilities=" in FakeSession.last.url
        assert FakeSession.last.socket.sent[0]["type"] == "heartbeat"
        assert "mcp.stdio" not in FakeSession.last.socket.sent[0]["capabilities"]
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


def test_runtime_connector_forwards_session_scoped_event_frames(tmp_path: Path) -> None:
    async def scenario():
        socket = FakeSocket()

        async def events():
            return [{
                "event_id": "session-event-one",
                "runtime_id": "rt-one",
                "workspace_id": "workspace-one",
                "session_id": "session-one",
                "run_id": "run-one",
                "session_sequence": 7,
                "kind": "conversation.item.delta",
                "timestamp": "2026-07-27T00:00:00+00:00",
                "payload": {"item_id": "message-one", "revision": 2},
            }]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            session_event_provider=events,
            wire_protocol="hai-http",
        )
        task = asyncio.create_task(connector._forward_session_events(socket))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert socket.sent == [{
            "type": "event",
            "scope": "session",
            "session_id": "session-one",
            "session_sequence": 7,
            "event": (await events())[0],
        }]

    asyncio.run(scenario())


def test_runtime_connector_forwards_strict_oaep_frames_and_rejects_identity_drift(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        acknowledgements = []
        event = {
            "version": "1.0",
            "event_id": "event-one",
            "session_id": "session-one",
            "run_id": "run-one",
            "sequence": 7,
            "type": "event.item.updated",
            "timestamp": "2026-08-02T00:00:00+00:00",
            "dedupe_key": "event-one",
            "source": {"backend": "runtime", "runtime_id": "rt-one"},
            "data": {"item_id": "item-one", "revision": 2},
        }

        async def events():
            return [
                {
                    "runtime_id": "rt-one",
                    "workspace_id": "workspace-one",
                    "session_id": "session-one",
                    "sequence": 7,
                    "event": event,
                },
                {
                    "runtime_id": "forged-runtime",
                    "workspace_id": "workspace-one",
                    "session_id": "session-one",
                    "sequence": 8,
                    "event": {**event, "sequence": 8},
                },
            ]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            oaep_event_provider=events,
            oaep_event_ack=lambda session_id, sequence: acknowledgements.append(
                (session_id, sequence)
            ),
            wire_protocol="hai-http",
        )
        task = asyncio.create_task(connector._forward_oaep_events(socket))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert socket.sent == [{
            "type": "event",
            "protocol": "oaep/1",
            "scope": "session",
            "runtime_id": "rt-one",
            "workspace_id": "workspace-one",
            "session_id": "session-one",
            "sequence": 7,
            "event": event,
        }]
        assert acknowledgements == [("session-one", 7)]

    asyncio.run(scenario())


def test_runtime_connector_does_not_ack_oaep_frame_when_socket_write_fails(
    tmp_path: Path,
) -> None:
    class FailingSocket(FakeSocket):
        async def send_json(self, payload):
            raise ConnectionError("injected_disconnect")

    async def scenario() -> None:
        acknowledgements = []
        event = {
            "version": "1.0",
            "event_id": "event-one",
            "session_id": "session-one",
            "run_id": None,
            "sequence": 1,
            "type": "event.session.updated",
            "timestamp": "2026-08-02T00:00:00+00:00",
            "dedupe_key": "event-one",
            "source": {"backend": "runtime", "runtime_id": "rt-one"},
            "data": {"title": "Session"},
        }

        async def events():
            return [{
                "runtime_id": "rt-one",
                "workspace_id": "workspace-one",
                "session_id": "session-one",
                "sequence": 1,
                "event": event,
            }]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            oaep_event_provider=events,
            oaep_event_ack=lambda session_id, sequence: acknowledgements.append(
                (session_id, sequence)
            ),
            wire_protocol="hai-http",
        )
        task = asyncio.create_task(connector._forward_oaep_events(FailingSocket()))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert acknowledgements == []

    asyncio.run(scenario())


def test_runtime_connector_batches_oaep_ack_to_highest_sequence_per_session(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        acknowledgements: list[dict[str, int]] = []

        def frame(session_id: str, sequence: int) -> dict:
            event = {
                "version": "1.0", "event_id": f"{session_id}-{sequence}",
                "session_id": session_id, "run_id": None, "sequence": sequence,
                "type": "event.session.updated", "timestamp": "2026-08-04T00:00:00Z",
                "dedupe_key": f"{session_id}-{sequence}",
                "source": {"backend": "runtime", "runtime_id": "rt-one"},
                "data": {},
            }
            return {
                "runtime_id": "rt-one", "workspace_id": "workspace-one",
                "session_id": session_id, "sequence": sequence, "event": event,
            }

        async def events():
            return [frame("session-one", 1), frame("session-one", 2), frame("session-two", 4)]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            oaep_event_provider=events,
            oaep_events_ack=lambda cursors: acknowledgements.append(dict(cursors)),
            wire_protocol="hai-http",
        )
        task = asyncio.create_task(connector._forward_oaep_events(socket))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert len(socket.sent) == 3
        assert acknowledgements == [{"session-one": 2, "session-two": 4}]

    asyncio.run(scenario())


def test_runtime_connector_forwards_content_free_journal_and_wss_latency(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        observability = RuntimeObservability(tmp_path / "observability.sqlite3")
        observability.record_conversation_latency(
            "journal_append",
            3.0,
            ResourceCorrelation(
                "event-one", "event-one", runtime_id="rt-one",
                workspace_id="workspace-one", session_id="session-one",
            ),
        )
        event = {
            "version": "1.0", "event_id": "event-one", "session_id": "session-one",
            "run_id": None, "sequence": 1, "type": "event.session.updated",
            "timestamp": "2026-08-04T00:00:00Z", "dedupe_key": "event-one",
            "source": {"backend": "runtime", "runtime_id": "rt-one"}, "data": {},
        }

        async def events():
            return [{
                "runtime_id": "rt-one", "workspace_id": "workspace-one",
                "session_id": "session-one", "sequence": 1, "event": event,
            }]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"), identity, "instance-one", "2.0.0",
            oaep_event_provider=events,
            conversation_latency_observability=observability,
            wire_protocol="hai-http",
        )
        task = asyncio.create_task(connector._forward_oaep_events(socket))
        await asyncio.sleep(0.01)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert socket.sent[0]["type"] == "event"
        telemetry = [row for row in socket.sent if row["type"] == "telemetry.conversation_latency"]
        assert {row["stage"] for row in telemetry} == {"journal_append", "runtime_wss_send"}
        assert all("event" not in row and "body" not in row for row in telemetry)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "forwarder_name",
    ["_forward_events", "_forward_session_events", "_forward_oaep_events"],
)
def test_runtime_connector_backs_off_idle_event_providers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, forwarder_name: str,
) -> None:
    observed_delays: list[float] = []

    async def no_events() -> list[dict]:
        return []

    async def controlled_sleep(delay: float) -> None:
        observed_delays.append(delay)
        if len(observed_delays) == 3:
            raise asyncio.CancelledError

    async def scenario() -> None:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            event_provider=no_events,
            session_event_provider=no_events,
            oaep_event_provider=no_events,
            wire_protocol="hai-http",
        )
        with pytest.raises(asyncio.CancelledError):
            await getattr(connector, forwarder_name)(FakeSocket())

    monkeypatch.setattr(asyncio, "sleep", controlled_sleep)
    asyncio.run(scenario())
    assert observed_delays == [2.0, 4.0, 4.0]


def test_runtime_connector_keeps_control_correlation_separate_from_oaep_push(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        event = {
            "version": "1.0",
            "event_id": "event-one",
            "session_id": "session-one",
            "run_id": None,
            "sequence": 1,
            "type": "event.session.updated",
            "timestamp": "2026-08-02T00:00:00+00:00",
            "dedupe_key": "event-one",
            "source": {"backend": "runtime", "runtime_id": "rt-one"},
            "data": {"status": "active"},
        }

        async def events():
            return [{
                "runtime_id": "rt-one",
                "workspace_id": "workspace-one",
                "session_id": "session-one",
                "sequence": 1,
                "event": event,
            }]

        async def request_handler(method, path, body, correlation_id):
            await asyncio.sleep(0)
            return 200, {"correlation": correlation_id}

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "2.0.0",
            http_request_handler=request_handler,
            oaep_event_provider=events,
            wire_protocol="hai-http",
        )
        event_task = asyncio.create_task(connector._forward_oaep_events(socket))
        response_task = asyncio.create_task(connector._handle_http_request(socket, {
            "type": "request",
            "request_id": "request-one",
            "correlation_id": "correlation-one",
            "method": "GET",
            "path": "/v1/capabilities",
            "body": None,
        }))
        await response_task
        await asyncio.sleep(0.01)
        event_task.cancel()
        await asyncio.gather(event_task, return_exceptions=True)

        assert {frame["type"] for frame in socket.sent} == {"event", "response"}
        response = next(frame for frame in socket.sent if frame["type"] == "response")
        pushed = next(frame for frame in socket.sent if frame["type"] == "event")
        assert response["request_id"] == "request-one"
        assert response["body"] == {"correlation": "correlation-one"}
        assert "request_id" not in pushed
        assert pushed["protocol"] == "oaep/1"

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


def test_runtime_connector_republishes_complete_workspace_catalog_when_dirty(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        rows = [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "One"}]

        async def workspaces():
            return list(rows)

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        task = asyncio.create_task(connector._forward_workspaces(socket))
        await asyncio.wait_for(_wait_for_sent(socket, 1), timeout=0.5)
        rows.append({"runtime_id": "rt-one", "workspace_id": "ws-two", "display_name": "Two"})
        connector.mark_workspaces_dirty()
        await asyncio.wait_for(_wait_for_sent(socket, 2), timeout=0.5)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert socket.sent[-1] == {"type": "runtime.workspaces", "workspaces": [
            {"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "One"},
            {"runtime_id": "rt-one", "workspace_id": "ws-two", "display_name": "Two"},
        ]}

    asyncio.run(scenario())


def test_runtime_connector_republishes_remove_and_rename_as_full_catalog(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        rows = [
            {"runtime_id": "rt-one", "workspace_id": "stable-ws", "display_name": "Old"},
            {"runtime_id": "rt-one", "workspace_id": "removed-ws", "display_name": "Removed"},
        ]

        async def workspaces():
            return list(rows)

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        task = asyncio.create_task(connector._forward_workspaces(socket))
        await asyncio.wait_for(_wait_for_sent(socket, 1), timeout=0.5)
        rows[:] = [{"runtime_id": "rt-one", "workspace_id": "stable-ws", "display_name": "New"}]
        connector.mark_workspaces_dirty()
        await asyncio.wait_for(_wait_for_sent(socket, 2), timeout=0.5)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert socket.sent[-1]["workspaces"] == [
            {"runtime_id": "rt-one", "workspace_id": "stable-ws", "display_name": "New"},
        ]

    asyncio.run(scenario())


def test_runtime_connector_coalesces_fast_workspace_changes_to_latest_catalog(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        rows = [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "One"}]

        async def workspaces():
            return list(rows)

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        task = asyncio.create_task(connector._forward_workspaces(socket))
        await asyncio.wait_for(_wait_for_sent(socket, 1), timeout=0.5)
        rows[:] = [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "Interim"}]
        connector.mark_workspaces_dirty()
        rows[:] = [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "Final"}]
        connector.mark_workspaces_dirty()
        await asyncio.wait_for(_wait_for_sent(socket, 2), timeout=0.5)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert socket.sent[-1]["workspaces"][0]["display_name"] == "Final"

    asyncio.run(scenario())


def test_runtime_connector_keeps_workspace_dirty_after_publish_failure_and_retries(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        calls = 0

        async def workspaces():
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("catalog_backend_unavailable")
            return [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": f"Call {calls}"}]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        task = asyncio.create_task(connector._forward_workspaces(socket))
        await asyncio.wait_for(_wait_for_sent(socket, 1), timeout=0.5)
        connector.mark_workspaces_dirty()
        await asyncio.wait_for(_wait_for_sent(socket, 2), timeout=1.5)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert calls >= 3
        assert socket.sent[-1]["workspaces"][0]["display_name"] == "Call 3"

    asyncio.run(scenario())


def test_runtime_connector_reconnect_publishes_dirty_workspace_catalog(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        rows = [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "Offline Change"}]

        async def workspaces():
            return list(rows)

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        connector.mark_workspaces_dirty()
        assert await connector._try_publish_workspaces(socket)
        assert socket.sent == [{"type": "runtime.workspaces", "workspaces": rows}]

    asyncio.run(scenario())


def test_runtime_connector_handles_workspace_catalog_sync_without_clearing_dirty(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        rows = [
            {
                "runtime_id": "rt-one",
                "workspace_id": "ws-active",
                "display_name": "默认",
                "lifecycle": "active",
                "revision": 4,
                "updated_at": "2026-07-27T19:00:00+00:00",
            },
            {
                "runtime_id": "rt-one",
                "workspace_id": "ws-archived",
                "display_name": "Archived",
                "lifecycle": "archived",
                "revision": 2,
                "updated_at": "2026-07-27T19:01:00+00:00",
            },
            {
                "runtime_id": "rt-one",
                "workspace_id": "ws-removed",
                "display_name": "Removed",
                "lifecycle": "removed",
                "revision": 3,
                "updated_at": "2026-07-27T19:02:00+00:00",
            },
        ]

        async def workspaces():
            return list(rows)

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        connector.mark_workspaces_dirty()
        await connector._handle_request(socket, {
            "type": "runtime.request",
            "request_id": "sync-one",
            "operation": "workspace.catalog.sync",
            "arguments": {"request_id": "outer", "correlation_id": "corr"},
        })
        assert connector._workspace_dirty.is_set()
        response = socket.sent[-1]
        assert response["ok"] is True
        assert response["result"]["catalog_revision"] == 4
        assert response["result"]["workspaces"] == rows
        assert "path" not in json.dumps(response)

    asyncio.run(scenario())


def test_runtime_connector_coalesces_concurrent_workspace_catalog_sync(tmp_path: Path) -> None:
    async def scenario() -> None:
        socket = FakeSocket()
        calls = 0
        release = asyncio.Event()

        async def workspaces():
            nonlocal calls
            calls += 1
            await release.wait()
            return [{"runtime_id": "rt-one", "workspace_id": "ws-one", "display_name": "One"}]

        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
            workspace_provider=workspaces,
        )
        first = asyncio.create_task(connector._handle_request(socket, {
            "type": "runtime.request", "request_id": "sync-one",
            "operation": "workspace.catalog.sync", "arguments": {},
        }))
        second = asyncio.create_task(connector._handle_request(socket, {
            "type": "runtime.request", "request_id": "sync-two",
            "operation": "workspace.catalog.sync", "arguments": {},
        }))
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(first, second)
        assert calls == 1
        assert [item["request_id"] for item in socket.sent[-2:]] == ["sync-one", "sync-two"]

    asyncio.run(scenario())


async def _wait_for_sent(socket: FakeSocket, count: int) -> None:
    while len(socket.sent) < count:
        await asyncio.sleep(0.01)


def test_runtime_connector_backs_off_after_clean_peer_disconnect(tmp_path: Path) -> None:
    async def scenario() -> None:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
        )
        stop = asyncio.Event()
        calls = 0

        async def clean_disconnect() -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                asyncio.get_running_loop().call_later(0.05, stop.set)

        connector.run_once = clean_disconnect  # type: ignore[method-assign]
        await asyncio.wait_for(connector.run_forever(stop), timeout=0.5)
        assert calls == 1
        assert connector.diagnostic_state() == {
            "connection": "stopped",
            "heartbeat": "unknown",
        }

    asyncio.run(scenario())


def test_runtime_connector_diagnostics_require_live_recent_heartbeat(tmp_path: Path) -> None:
    identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
    connector = RuntimeOutboundConnector(
        "wss://relay.example/v1/runtime-connect",
        RuntimeCredential("rt-one", "token"), identity, "instance-one", "1.5.3",
    )
    assert connector.diagnostic_state() == {"connection": "idle", "heartbeat": "unknown"}
    connector._connection_state = "connected"
    connector._last_heartbeat_ack_monotonic = time.monotonic()
    assert connector.diagnostic_state() == {"connection": "connected", "heartbeat": "ok"}
    connector._last_heartbeat_ack_monotonic = time.monotonic() - 60
    assert connector.diagnostic_state(heartbeat_ttl=45) == {
        "connection": "connected", "heartbeat": "stale",
    }
    connector._connection_state = "retrying"
    assert connector.diagnostic_state(heartbeat_ttl=90)["heartbeat"] == "stale"
    with pytest.raises(ValueError, match="runtime_connector_heartbeat_ttl_invalid"):
        connector.diagnostic_state(heartbeat_ttl=0)


def test_runtime_connector_recovers_after_unexpected_iteration_failure_without_leaking_body(
    tmp_path: Path, caplog,
) -> None:
    async def scenario() -> None:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"),
            identity,
            "instance-one",
            "1.5.3",
        )
        stop = asyncio.Event()
        calls = 0

        async def fail_then_recover() -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise ValueError("private-frame-body-must-not-be-logged")
            stop.set()

        connector.run_once = fail_then_recover  # type: ignore[method-assign]
        await asyncio.wait_for(connector.run_forever(stop, maximum_backoff=0.01), timeout=0.5)
        assert calls == 2

    asyncio.run(scenario())
    assert "runtime_relay_connector_iteration_failed" in caplog.text
    assert "private-frame-body-must-not-be-logged" not in caplog.text


def test_runtime_connector_transport_failure_logs_only_safe_type_and_status(
    tmp_path: Path, caplog,
) -> None:
    async def scenario() -> None:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"), identity, "instance-one", "1.5.3",
        )
        stop = asyncio.Event()

        async def fail_handshake() -> None:
            asyncio.get_running_loop().call_later(0.01, stop.set)
            raise aiohttp.WSServerHandshakeError(
                request_info=None, history=(), status=401,
                message="private-response-body-must-not-be-logged", headers=None,
            )

        connector.run_once = fail_handshake  # type: ignore[method-assign]
        await asyncio.wait_for(connector.run_forever(stop, maximum_backoff=0.01), timeout=0.5)

    asyncio.run(scenario())
    assert "runtime_relay_connector_transport_failed" in caplog.text
    assert "WSServerHandshakeError" in caplog.text and "status=401" in caplog.text
    assert "private-response-body-must-not-be-logged" not in caplog.text


def test_runtime_connector_rejects_nonpositive_backoff(tmp_path: Path) -> None:
    async def scenario() -> None:
        identity = DeviceIdentityStore(tmp_path / "id", XorProtector()).load_or_create()
        connector = RuntimeOutboundConnector(
            "wss://relay.example/v1/runtime-connect",
            RuntimeCredential("rt-one", "token"), identity, "instance-one", "1.5.3",
        )
        with pytest.raises(ValueError, match="runtime_connector_maximum_backoff_invalid"):
            await connector.run_forever(asyncio.Event(), maximum_backoff=0)

    asyncio.run(scenario())


def test_runtime_credential_is_protected_and_cli_requires_distinct_registration_code(tmp_path: Path) -> None:
    store = RuntimeCredentialStore(tmp_path / "credential", XorProtector())
    value = RuntimeCredential("rt-one", "runtime-secret")
    store.save(value)
    assert b"runtime-secret" not in store.path.read_bytes()
    assert store.load() == value
    arguments = parser().parse_args(["--relay", "https://relay.example", "--registration-code", "registration-only",
                                     "--name", "PC", "--version", "1"])
    assert arguments.registration_code == "registration-only"
