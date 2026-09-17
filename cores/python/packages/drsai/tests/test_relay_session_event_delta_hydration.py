"""The Relay loopback fast path must return what the HTTP route returns.

``GatewayRuntimeControlHandler._read_local_session_events`` reads the Journal
directly instead of issuing ``GET /v1/sessions/{id}/events``.  That is only safe
while both produce the same page, so the delta rows have to be hydrated against the
canonical Conversation Item in the loopback path too: a ``conversation.item.delta``
row stores one chunk, never the accumulated Item and never a second copy of the
Item's Run/Session binding.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import RUNTIME_EVENT_BINDING_KEYS
from drsai.relay.gateway_control import GatewayRuntimeControlHandler

WORKSPACE_ID = "ws-relay-delta"
CHUNK = "0123456789abcdef" * 16  # 256 chars

BINDING_KEYS = {
    "run_id",
    "session_id",
    "workspace_id",
    "runtime_id",
    "instance_id",
    "correlation_id",
}


class _NoTransport:
    """Fail loudly: the loopback path must never need the Gateway."""

    async def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        raise AssertionError(f"unexpected Gateway request {method} {path}")


def _engine(state_dir: Path) -> RuntimeEngine:
    return RuntimeEngine(
        database=state_dir / "engine.sqlite3",
        identity=RuntimeEngineIdentity(runtime_id="rt-relay", instance_id="inst-relay"),
        workspace_exists=lambda workspace_id: workspace_id == WORKSPACE_ID,
    )


def _stream_with_binding(engine: RuntimeEngine, chunks: list[str]) -> tuple[str, str]:
    session = engine.create_session(WORKSPACE_ID, "relay delta hydration")
    session_id = str(session["session_id"])
    run, _created = engine.create_run(
        session_id, "agent-definition", f"idem-relay-{session_id}"
    )
    run_id = str(run["run_id"])
    for index, chunk in enumerate(chunks, start=1):
        engine.append_event(
            run_id,
            "message.delta",
            {
                "run_id": run_id,
                "session_id": session_id,
                "workspace_id": WORKSPACE_ID,
                "runtime_id": "rt-relay",
                "instance_id": "inst-relay",
                "correlation_id": f"corr-{run_id}",
                "text": chunk,
                "index": index,
            },
        )
    return session_id, run_id


def _handler(state_dir: Path) -> GatewayRuntimeControlHandler:
    return GatewayRuntimeControlHandler("rt-relay", _NoTransport(), state_dir)


def test_loopback_read_matches_the_gateway_route(tmp_path: Path) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir()
    engine = _engine(state_dir)
    session_id, run_id = _stream_with_binding(engine, [CHUNK] * 3)

    handler = _handler(state_dir)
    loopback = handler._read_local_session_events(session_id, 0)
    gateway = engine.list_session_events(session_id)

    # the fast path is a drop-in for the route: same events, same payloads
    assert loopback == gateway
    deltas = [event for event in loopback if event["kind"] == "conversation.item.delta"]
    assert len(deltas) == 3
    for event in deltas:
        payload = event["payload"]["payload"]
        assert payload["delta"] == CHUNK
        # the accumulated Item is re-attached, not just the chunk
        assert payload["text"] == CHUNK * 3
        assert {key: payload[key] for key in BINDING_KEYS} == {
            "run_id": run_id,
            "session_id": session_id,
            "workspace_id": WORKSPACE_ID,
            "runtime_id": "rt-relay",
            "instance_id": "inst-relay",
            "correlation_id": f"corr-{run_id}",
        }

    # the stored rows stay incremental: hydration happens on the response only
    with sqlite3.connect(state_dir / "engine.sqlite3") as journal:
        journal.row_factory = sqlite3.Row
        rows = journal.execute(
            "SELECT payload_json FROM runtime_session_journal "
            "WHERE session_id=? AND event_kind='conversation.item.delta'",
            (session_id,),
        ).fetchall()
    assert len(rows) == 3
    for row in rows:
        inner = json.loads(str(row["payload_json"]))["payload"]
        assert inner["delta"] == CHUNK
        assert "text" not in inner
        assert set(inner).isdisjoint(RUNTIME_EVENT_BINDING_KEYS)


def test_loopback_read_keeps_non_delta_rows_verbatim(tmp_path: Path) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir()
    engine = _engine(state_dir)
    session_id, _run_id = _stream_with_binding(engine, [CHUNK])

    handler = _handler(state_dir)
    loopback = handler._read_local_session_events(session_id, 0)
    gateway = engine.list_session_events(session_id)

    non_delta = [event for event in loopback if event["kind"] != "conversation.item.delta"]
    assert non_delta, "expected at least the session/run events"
    assert non_delta == [
        event for event in gateway if event["kind"] != "conversation.item.delta"
    ]


def test_loopback_read_honours_the_replay_cursor(tmp_path: Path) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir()
    engine = _engine(state_dir)
    session_id, _run_id = _stream_with_binding(engine, [CHUNK] * 3)

    handler = _handler(state_dir)
    all_events = handler._read_local_session_events(session_id, 0)
    tail = handler._read_local_session_events(
        session_id, int(all_events[-2]["session_sequence"])
    )
    assert [event["session_sequence"] for event in tail] == [
        int(all_events[-1]["session_sequence"])
    ]
    assert tail[0]["payload"]["payload"]["text"] == CHUNK * 3


def test_loopback_read_returns_nothing_for_an_unknown_session(tmp_path: Path) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir()
    engine = _engine(state_dir)
    _stream_with_binding(engine, [CHUNK])

    handler = _handler(state_dir)
    assert handler._read_local_session_events("session-missing", 0) == []


def test_loopback_read_without_a_journal(tmp_path: Path) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir()
    handler = _handler(state_dir)
    assert handler._read_local_session_events("session-any", 0) == []


def test_loopback_read_raises_when_the_cursor_expired(tmp_path: Path) -> None:
    from drsai.relay.gateway_control import GatewayControlError

    state_dir = tmp_path / "runtime"
    state_dir.mkdir()
    engine = _engine(state_dir)
    session_id, _run_id = _stream_with_binding(engine, [CHUNK])

    handler = _handler(state_dir)
    with pytest.raises(GatewayControlError) as error:
        handler._read_local_session_events(session_id, -1)
    assert error.value.code == "cursor_expired"
    assert error.value.retryable is True
