from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers


class _ConnectedRequest:
    headers = Headers({})

    async def is_disconnected(self) -> bool:
        return False


class _OfflineRequest(_ConnectedRequest):
    headers = Headers({"x-opendrsai-auth-mode": "offline"})


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


def test_oaep_snapshot_replay_and_sse_share_one_session_waterline(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    session_id = session["session_id"]
    oaep_snapshot = asyncio.run(gateway.runtime_session_oaep_snapshot(session_id))
    assert oaep_snapshot["version"] == "1.0"
    assert oaep_snapshot["snapshot_sequence"] == 1

    run, _ = engine.create_run(session_id, "agent@1", "gateway-oaep-run")
    engine.set_run_input(
        run["run_id"],
        "hello from desktop",
        source_client="windows",
        source_message_id="gateway-oaep-message-1",
    )
    engine.transition_run(run["run_id"], "running")
    engine.append_backend_event(
        run["run_id"],
        "agent.message.delta",
        {"text": "stream "},
        "gateway-oaep-delta-1",
    )
    engine.append_backend_event(
        run["run_id"],
        "agent.message.delta",
        {"text": "content"},
        "gateway-oaep-delta-2",
    )

    replay = asyncio.run(gateway.runtime_session_oaep_event_list(
        session_id, oaep_snapshot["snapshot_sequence"], 500
    ))
    assert replay["version"] == "1.0"
    assert replay["object"] == "list"
    assert replay["next_sequence"] == replay["data"][-1]["sequence"]
    delta_events = [event for event in replay["data"] if event["type"] == "event.item.delta"]
    assert delta_events[-1]["data"]["delta"]["kind"] == "message.text.append"
    assert delta_events[-1]["data"]["delta"]["text"] == "content"

    response = asyncio.run(gateway.runtime_session_oaep_event_stream(
        session_id, _ConnectedRequest(), oaep_snapshot["snapshot_sequence"]
    ))

    async def first_frame() -> str:
        return await response.body_iterator.__anext__()

    frame = asyncio.run(first_frame())
    assert frame.startswith("id: 2\nevent: oaep.event\n")
    payload = json.loads(frame.split("data: ", 1)[1])
    assert payload == replay["data"][0]


def test_legacy_and_oaep_endpoints_keep_distinct_wire_contracts(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    run, _ = engine.create_run(session["session_id"], "agent@1", "contract")
    engine.set_run_input(
        run["run_id"], "contract message", source_client="windows",
        source_message_id="contract-message-1",
    )
    legacy = asyncio.run(
        gateway.runtime_session_conversation_snapshot(session["session_id"])
    )
    oaep = asyncio.run(gateway.runtime_session_oaep_snapshot(session["session_id"]))
    legacy_item = legacy["items"][0]
    oaep_item = oaep["items"][0]
    assert {"item_id", "kind", "payload"} <= legacy_item.keys()
    assert {"id", "type", "content", "source"} <= oaep_item.keys()
    assert {"id", "type", "content"}.isdisjoint(legacy_item)
    assert {"item_id", "kind", "payload"}.isdisjoint(oaep_item)


def test_oaep_expired_cursor_is_structured_before_stream_headers(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    session_id = session["session_id"]
    engine.conversation_journal.checkpoint(session_id)
    engine.conversation_journal.compact(session_id, through_sequence=1)

    with pytest.raises(HTTPException) as captured:
        asyncio.run(gateway.runtime_session_oaep_event_stream(
            session_id, _ConnectedRequest(), 0
        ))
    assert captured.value.status_code == 409
    assert captured.value.detail["code"] == "cursor_expired"
    assert captured.value.detail["details"]["reason"] == "history_truncated"


def test_oaep_event_pages_replay_ten_thousand_with_exclusive_session_cursor(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    session_id = session["session_id"]
    workspace_id = session["workspace_id"]
    timestamp = "2026-08-02T00:00:00+00:00"
    # The producer/state-machine behavior is tested by the Journal suite.  This
    # bulk fixture isolates the 10k paging contract without 10k transactions.
    legacy_rows = []
    oaep_rows = []
    for sequence in range(2, 10_002):
        event_id = f"bulk-event-{sequence:05d}"
        legacy_rows.append((
            event_id, engine.identity.runtime_id, workspace_id, session_id,
            None, sequence, "session.updated", None, None, event_id,
            "{}", timestamp,
        ))
        oaep_rows.append((
            event_id, session_id, sequence,
            json.dumps({
                "version": "1.0",
                "event_id": event_id,
                "session_id": session_id,
                "run_id": None,
                "sequence": sequence,
                "type": "event.session.updated",
                "timestamp": timestamp,
                "dedupe_key": event_id,
                "source": {
                    "backend": "runtime",
                    "runtime_id": engine.identity.runtime_id,
                },
                "data": {"status": "active"},
            }, separators=(",", ":")),
        ))
    with sqlite3.connect(engine.database) as db:
        db.executemany(
            "INSERT INTO runtime_session_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            legacy_rows,
        )
        db.executemany(
            "INSERT INTO runtime_oaep_events VALUES(?,?,?,?)",
            oaep_rows,
        )
        db.execute(
            "UPDATE runtime_session_sequences SET last_sequence=10001 WHERE session_id=?",
            (session_id,),
        )

    cursor = 1
    observed = []
    while cursor < 10_001:
        page = asyncio.run(gateway.runtime_session_oaep_event_list(
            session_id, cursor, 2000
        ))
        sequences = [event["sequence"] for event in page["data"]]
        assert all(sequence > cursor for sequence in sequences)
        observed.extend(sequences)
        cursor = page["next_sequence"]
    assert observed == list(range(2, 10_002))
    assert len(observed) == len(set(observed)) == 10_000

    other = engine.create_session(workspace_id, "Cursor binding")
    other_page = asyncio.run(gateway.runtime_session_oaep_event_list(
        other["session_id"], 1, 2000
    ))
    assert other_page["data"] == []


def test_oaep_sse_stays_open_across_two_later_runs(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    session_id = session["session_id"]
    snapshot = asyncio.run(gateway.runtime_session_oaep_snapshot(session_id))

    async def scenario() -> tuple[list[str], list[int]]:
        response = await gateway.runtime_session_oaep_event_stream(
            session_id, _ConnectedRequest(), snapshot["snapshot_sequence"]
        )
        iterator = response.body_iterator
        run_ids = []
        sequences = []
        for index in range(2):
            run, _ = engine.create_run(
                session_id, "agent@1", f"persistent-stream-run-{index}"
            )
            engine.set_run_input(
                run["run_id"],
                f"message {index}",
                source_client="windows",
                source_message_id=f"persistent-stream-message-{index}",
            )
            while run["run_id"] not in run_ids:
                frame = await asyncio.wait_for(iterator.__anext__(), timeout=2)
                if frame.startswith(":"):
                    continue
                payload = json.loads(frame.split("data: ", 1)[1])
                sequences.append(payload["sequence"])
                if payload.get("run_id"):
                    run_ids.append(payload["run_id"])
        await iterator.aclose()
        return run_ids, sequences

    run_ids, sequences = asyncio.run(scenario())
    assert len(set(run_ids)) == 2
    assert sequences == sorted(set(sequences))


def test_desktop_chat_stream_is_mirrored_live_into_oaep(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    workspace = gateway._runtime_registry().get_workspace(session["workspace_id"])
    assert workspace is not None

    async def fake_stream(**_kwargs):
        yield {"kind": "delta-1"}
        yield {"kind": "tool-start"}
        yield {"kind": "tool-complete"}
        yield {"kind": "delta-2"}

    def fake_translate(event, _state):
        return {
            "delta-1": [("message.delta", {"text": "hello "})],
            "tool-start": [(
                "tool.start",
                {"tool_id": "desktop-tool-1", "name": "shell"},
            )],
            "tool-complete": [(
                "tool.complete",
                {"tool_id": "desktop-tool-1", "name": "shell", "result": "done"},
            )],
            "delta-2": [("message.delta", {"text": "world"})],
        }[event["kind"]]

    monkeypatch.setattr(gateway.manager, "run_stream", fake_stream)
    monkeypatch.setattr(gateway, "translate_conversation_event", fake_translate)
    monkeypatch.setattr(
        gateway,
        "finalize_conversation_translation",
        lambda _state: ("message.complete", {"text": "hello world"}),
    )
    monkeypatch.setattr(gateway, "_event_to_sse", lambda _event: None)

    request = gateway.ChatRequest(
        messages=[gateway.ChatMessage(role="user", content="internal execution prompt")],
        thread_id=session["session_id"],
        work_dir=workspace.path,
        display_message="visible Desktop message",
        source_message_id="desktop-visible-1",
        metadata={
            "desktop_request_id": "desktop-stream-1",
            "run_id": "desktop-ui-run-1",
        },
    )

    async def consume():
        response = await gateway.chat_completions(request, _ConnectedRequest())
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(consume())
    assert chunks[-1] == "data: [DONE]\n\n"
    snapshot = engine.oaep_snapshot(session["session_id"])
    runs = [run for run in snapshot["runs"] if run["status"] == "completed"]
    assert len(runs) == 1
    run_id = runs[0]["id"]
    items = [item for item in snapshot["items"] if item["run_id"] == run_id]
    assert next(
        item for item in items if item["content"].get("role") == "user"
    )["content"]["text"] == "visible Desktop message"
    assert next(
        item
        for item in items
        if item["type"] == "message" and item["content"].get("role") == "assistant"
    )["content"]["text"] == "hello world"
    assert any(item["type"] in {"tool_call", "command_execution"} for item in items)
    serialized = json.dumps(snapshot, ensure_ascii=False)
    assert "internal execution prompt" not in serialized
    assert workspace.path not in serialized


def test_controlled_desktop_turn_exercises_real_chat_bridge_without_model(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, engine, session = _gateway_runtime(tmp_path, monkeypatch)
    monkeypatch.setenv("DRSAI_RUNTIME_CONTROLLED_MODEL", "1")
    request = gateway.ChatRequest(
        messages=[gateway.ChatMessage(role="user", content="internal acceptance")],
        thread_id=session["session_id"],
        workspace_id=session["workspace_id"],
        user_id="v4-acceptance-windows",
        display_message="visible acceptance message",
        source_message_id="windows-controlled-message-1",
        metadata={
            "desktop_request_id": "windows-controlled-request-1",
            "run_id": "windows-controlled-request-1",
            "v4_controlled_desktop_turn": True,
        },
    )

    async def consume():
        response = await gateway.chat_completions(request, _OfflineRequest())
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(consume())
    assert chunks[-1] == "data: [DONE]\n\n"
    snapshot = engine.oaep_snapshot(session["session_id"])
    run = next(row for row in snapshot["runs"] if row["status"] == "completed")
    items = [row for row in snapshot["items"] if row["run_id"] == run["id"]]
    assert any(row["source"].get("message_id") == "windows-controlled-message-1" for row in items)
    assert any(row["type"] in {"tool_call", "command_execution"} for row in items)
    file_change = next(row for row in items if row["type"] == "file_change")
    assert file_change["content"]["changes"] == [
        {"path": "acceptance/controlled-result.txt", "operation": "modify"}
    ]
    assert "absolute_path" not in file_change["content"]
    assert "internal acceptance" not in json.dumps(snapshot)


def test_controlled_desktop_turn_is_fail_closed_outside_acceptance_launcher(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, _engine, session = _gateway_runtime(tmp_path, monkeypatch)
    monkeypatch.delenv("DRSAI_RUNTIME_CONTROLLED_MODEL", raising=False)
    request = gateway.ChatRequest(
        messages=[gateway.ChatMessage(role="user", content="internal acceptance")],
        thread_id=session["session_id"],
        workspace_id=session["workspace_id"],
        user_id="v4-acceptance-windows",
        display_message="visible acceptance message",
        source_message_id="windows-controlled-message-2",
        metadata={
            "desktop_request_id": "windows-controlled-request-2",
            "v4_controlled_desktop_turn": True,
        },
    )
    with pytest.raises(HTTPException) as captured:
        asyncio.run(gateway.chat_completions(request, _OfflineRequest()))
    assert captured.value.status_code == 403
    assert captured.value.detail["code"] == "controlled_desktop_turn_forbidden"


def test_desktop_oaep_bridge_rejects_cross_workspace_session(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, _engine, session = _gateway_runtime(tmp_path, monkeypatch)
    other_path = tmp_path / "other-workspace"
    other_path.mkdir()
    gateway._runtime_registry().open_workspace(str(other_path))
    request = gateway.ChatRequest(
        messages=[gateway.ChatMessage(role="user", content="execution")],
        thread_id=session["session_id"],
        work_dir=str(other_path),
        display_message="visible",
        source_message_id="desktop-cross-workspace-message",
        metadata={"desktop_request_id": "desktop-cross-workspace-request"},
    )
    with pytest.raises(HTTPException) as captured:
        gateway._prepare_desktop_oaep_bridge(request, _ConnectedRequest())
    assert captured.value.status_code == 409
    assert captured.value.detail["code"] == "session_workspace_mismatch"


def test_desktop_oaep_bridge_requires_user_visible_message(
    tmp_path: Path, monkeypatch
) -> None:
    gateway, _engine, session = _gateway_runtime(tmp_path, monkeypatch)
    workspace = gateway._runtime_registry().get_workspace(session["workspace_id"])
    assert workspace is not None
    request = gateway.ChatRequest(
        messages=[gateway.ChatMessage(role="user", content="internal-only")],
        thread_id=session["session_id"],
        work_dir=workspace.path,
        metadata={"desktop_request_id": "desktop-missing-display"},
    )
    with pytest.raises(HTTPException) as captured:
        gateway._prepare_desktop_oaep_bridge(request, _ConnectedRequest())
    assert captured.value.status_code == 409
    assert captured.value.detail["code"] == "desktop_oaep_identity_required"


def test_gateway_advertises_complete_session_event_profile() -> None:
    from drsai.backend import gateway

    assert {
        "conversation.snapshot",
        "session.event.resume",
        "session.event.stream",
        "session.event.cursor_expired",
    }.issubset(gateway._REMOTE_CAPABILITY_VERSIONS)
    assert {
        "oaep.v1",
        "oaep.session.snapshot",
        "oaep.session.events",
        "oaep.session.events.stream",
    }.issubset(gateway._REMOTE_CAPABILITY_VERSIONS)
    assert gateway._RUNTIME_PROTOCOLS["oaep"] == {
        "version": "1.0",
        "profiles": ["oaep.session-stream/1"],
    }
    assert gateway._RUNTIME_PROTOCOLS["owop"]["version"] == "1.0"
    assert {"files", "git", "pty", "artifact"}.issubset(
        gateway._RUNTIME_PROTOCOLS["owop"]["capabilities"]
    )
