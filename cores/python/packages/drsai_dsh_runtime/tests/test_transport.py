from __future__ import annotations

import asyncio
import json

import pytest

from opendrsai_dsh_runtime.control import ControlError
from opendrsai_dsh_runtime.oaep import OaepCursorExpired
from opendrsai_dsh_runtime.transport import AsyncioLoopbackServer, ControlHttpApplication


TOKEN = "a" * 48


class FakeJournal:
    def wait_event_page(self, session_id, *, after_sequence, limit, timeout):
        assert session_id == "session-1"
        assert (after_sequence, limit) == (4, 5)
        return {
            "data": [{"sequence": 5, "type": "event.run.completed"}],
            "next_sequence": 5,
        }


class FakeService:
    journal = FakeJournal()

    def health(self):
        return {"status": "available", "runtime_id": "runtime-dsh"}

    async def dispatch(self, method, params):
        if params.get("explode"):
            raise ControlError("native_unavailable", "Native Runtime is unavailable")
        if method == "session.events" and params["after_sequence"] == 1:
            raise OaepCursorExpired(expired_through=3, snapshot={"snapshot_sequence": 8})
        return {"method": method, "params": params}


@pytest.mark.asyncio
async def test_application_requires_bearer_and_routes_control_and_oaep() -> None:
    application = ControlHttpApplication(FakeService(), bearer_token=TOKEN)  # type: ignore[arg-type]
    unauthorized = await application.handle("GET", "/v1/runtime/health")
    assert unauthorized.status == 401

    created = await application.handle(
        "POST",
        "/v1/sessions/session-1/runs",
        headers={"Authorization": f"Bearer {TOKEN}"},
        body=json.dumps({"idempotency_key": "run-key", "content_blocks": []}).encode(),
    )
    assert created.status == 202
    assert json.loads(created.body) == {
        "method": "run.start",
        "params": {"idempotency_key": "run-key", "content_blocks": [], "session_id": "session-1"},
    }

    page = await application.handle(
        "GET",
        "/v1/sessions/session-1/oaep-events?after_sequence=1&limit=20",
        headers={"authorization": f"Bearer {TOKEN}"},
    )
    assert page.status == 409
    assert json.loads(page.body)["snapshot"]["snapshot_sequence"] == 8


@pytest.mark.asyncio
async def test_stream_is_bounded_sse_and_preserves_authoritative_sequence() -> None:
    application = ControlHttpApplication(FakeService(), bearer_token=TOKEN)  # type: ignore[arg-type]
    response = await application.handle(
        "GET",
        "/v1/sessions/session-1/oaep-events/stream?after_sequence=4&limit=5&wait_seconds=0",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    assert response.status == 200
    assert response.content_type.startswith("text/event-stream")
    assert b"id: 5\nevent: oaep\ndata:" in response.body
    assert ("X-OAEP-Next-Sequence", "5") in response.headers


@pytest.mark.asyncio
async def test_bundled_server_only_binds_loopback_and_serves_http() -> None:
    application = ControlHttpApplication(FakeService(), bearer_token=TOKEN)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="loopback"):
        AsyncioLoopbackServer(application, host="0.0.0.0")

    server = AsyncioLoopbackServer(application)
    host, port = await server.start()
    reader, writer = await asyncio.open_connection(host, port)
    writer.write(
        f"GET /v1/runtime/health HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {TOKEN}\r\n\r\n".encode()
    )
    await writer.drain()
    payload = await reader.read()
    writer.close()
    await writer.wait_closed()
    await server.close()
    assert b"HTTP/1.1 200 OK" in payload
    assert b'"runtime_id":"runtime-dsh"' in payload


@pytest.mark.asyncio
async def test_transport_does_not_leak_control_failure_details() -> None:
    application = ControlHttpApplication(FakeService(), bearer_token=TOKEN)  # type: ignore[arg-type]
    response = await application.handle(
        "POST",
        "/v1/runtime/initialize",
        headers={"Authorization": f"Bearer {TOKEN}"},
        body=b'{"explode":true}',
    )
    assert response.status == 409
    assert json.loads(response.body)["error"] == {
        "code": "native_unavailable",
        "message": "Native Runtime is unavailable",
        "retryable": False,
    }
