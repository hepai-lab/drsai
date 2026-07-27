from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import HTTPException


class _ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


def _gateway_runtime(tmp_path: Path, monkeypatch):
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("DRSAI_HOME", str(home))

    from drsai.backend import gateway

    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    opened = gateway._runtime_registry().open_workspace(str(workspace))
    engine = gateway._runtime_engine()
    session = engine.create_session(opened.workspace_id, "Session Event transport")
    return gateway, engine, session


def test_snapshot_replay_and_sse_share_one_session_waterline(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    session_id = session["session_id"]
    snapshot = asyncio.run(gateway.runtime_session_conversation_snapshot(session_id))
    assert snapshot["snapshot_sequence"] == 1

    engine.record_conversation_item(
        session_id,
        item_id="message-windows-1",
        kind="message",
        role="user",
        revision=1,
        source_client="windows",
        source_message_id="windows-1",
        payload={"content": "visible on both clients"},
    )
    replay = asyncio.run(gateway.runtime_session_event_list(
        session_id, snapshot["snapshot_sequence"], 500
    ))
    assert replay["next_sequence"] == 2
    assert replay["data"][0]["session_sequence"] == 2

    response = asyncio.run(gateway.runtime_session_event_stream(
        session_id, _ConnectedRequest(), snapshot["snapshot_sequence"]
    ))

    async def first_frame() -> str:
        return await response.body_iterator.__anext__()

    frame = asyncio.run(first_frame())
    assert frame.startswith("id: 2\nevent: session.event\n")
    payload = json.loads(frame.split("data: ", 1)[1])
    assert payload == replay["data"][0]


def test_expired_cursor_is_structured_before_stream_headers(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    session_id = session["session_id"]
    engine.conversation_journal.checkpoint(session_id)
    engine.conversation_journal.compact(session_id, through_sequence=1)

    with pytest.raises(HTTPException) as captured:
        asyncio.run(gateway.runtime_session_event_stream(
            session_id, _ConnectedRequest(), 0
        ))
    assert captured.value.status_code == 409
    assert captured.value.detail["code"] == "cursor_expired"
    assert captured.value.detail["details"]["reason"] == "history_truncated"


def test_gateway_advertises_complete_session_event_profile() -> None:
    from drsai.backend import gateway

    assert {
        "conversation.snapshot",
        "session.event.resume",
        "session.event.stream",
        "session.event.cursor_expired",
    }.issubset(gateway._REMOTE_CAPABILITY_VERSIONS)
