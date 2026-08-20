from __future__ import annotations

from pathlib import Path

import pytest

from opendrsai_dsh_runtime.jsonrpc import JsonRpcNotification
from opendrsai_dsh_runtime.mapper import NativeFactError, NativeFactProjector
from opendrsai_dsh_runtime.oaep import OaepJournal
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore, RuntimeStoreError


def _runtime(tmp_path: Path):
    store = RuntimeAuthorityStore(tmp_path / "runtime.sqlite3")
    store.create_session(
        session_id="session-1", workspace_id="workspace-1", workspace_fingerprint="f" * 64,
        native_profile="dsh-sdk/test-v2", mapping_version="dsh-oaep/1",
    )
    store.bind_native_session(
        "session-1", native_session_id="native-session-1", native_runtime_version="test-v2",
        native_contract_sha256="c" * 64, generation=1,
    )
    store.create_run("session-1", input_digest="a" * 64, run_id="run-1")
    store.transition_run("run-1", "starting")
    store.bind_native_run("run-1", native_message_id="user-1", generation=1)
    journal = OaepJournal(store)
    return store, journal, NativeFactProjector(store, journal, runtime_id="runtime-1")


def _fact(sequence: int, event_type: str, data: dict, *, generation: int = 1, **event_fields):
    return JsonRpcNotification(
        "session.event",
        {
            "sessionId": "native-session-1",
            "event": {"type": event_type, "seq": sequence, "time": 1_700_000_000_000 + sequence, "data": data, **event_fields},
        },
        generation,
    )


def test_committed_native_turn_projects_messages_tools_and_one_terminal(tmp_path: Path) -> None:
    store, journal, projector = _runtime(tmp_path)
    facts = [
        _fact(0, "turn/start", {"turn": 7}),
        _fact(1, "user/message", {"id": "user-1", "role": "user", "content": [{"type": "text", "text": "hello"}]}),
        _fact(2, "assistant/chunk", {"turn": 7, "step": 0, "chunk": {"type": "text-delta", "index": 0, "text": "hi"}}),
        _fact(3, "assistant/message", {
            "turn": 7, "step": 0,
            "message": {"id": "assistant-1", "role": "assistant", "content": [{"type": "text", "text": "hi"}]},
        }),
        _fact(4, "tool/call", {"turn": 7, "step": 0, "callId": "call-1", "name": "read", "arguments": '{"path":"README.md"}'}),
        _fact(5, "tool/result", {
            "turn": 7, "step": 0,
            "message": {"id": "result-1", "role": "user", "toolCallId": "call-1", "content": [{"type": "text", "text": "ok"}]},
        }),
        _fact(6, "turn/end", {"turn": 7, "reason": {"kind": "completed"}}),
    ]
    for fact in facts:
        assert projector.project(fact).disposition == "mapped"
    snapshot = journal.snapshot("session-1")
    assert snapshot["runs"][0]["status"] == "completed"
    assert [item["type"] for item in snapshot["items"]] == ["message", "message", "tool_call"]
    assert [item["status"] for item in snapshot["items"]] == ["completed"] * 3
    assert snapshot["items"][1]["content"]["text"] == "hi"
    assert snapshot["items"][2]["content"]["result"] == "ok"
    events = journal.event_page("session-1", limit=100)["data"]
    assert events[0]["type"] == "event.run.started"
    assert events[-1]["type"] == "event.run.completed"
    assert sum(event["type"].startswith("event.run.") and event["type"].endswith(("completed", "failed", "cancelled")) for event in events) == 1
    assert projector.project(facts[-1]).disposition == "replayed"
    assert journal.snapshot("session-1") == snapshot
    store.close()


def test_turn_start_waits_for_committed_user_message_receipt_proof(tmp_path: Path) -> None:
    store, journal, projector = _runtime(tmp_path)
    assert projector.project(_fact(0, "turn/start", {"turn": 0})).oaep_sequences == ()
    assert journal.event_page("session-1")["data"] == []
    projector.project(_fact(1, "user/message", {
        "id": "user-1", "role": "user", "content": [{"type": "text", "text": "claimed"}],
    }))
    assert store.require_native_run_binding("run-1")["native_turn_id"] == "0"
    assert journal.event_page("session-1")["data"][0]["type"] == "event.run.started"
    store.close()


def test_real_rc5_preamble_preserves_native_cursor_until_claimed_user_message(tmp_path: Path) -> None:
    store, journal, projector = _runtime(tmp_path)
    assert projector.project(_fact(0, "agent/inbox/spliced", {
        "target": "next-turn", "start": 0,
        "inserted": [{"id": "user-1", "role": "user", "content": [{"type": "text", "text": "queued"}]}],
    })).disposition == "reviewed_no_oaep"
    projector.project(_fact(1, "turn/start", {"turn": 3}))
    projector.project(_fact(2, "agent/inbox/spliced", {"target": "next-turn", "start": 0, "inserted": []}))
    projector.project(_fact(3, "step/start", {"turn": 3, "step": 0}))
    projector.project(_fact(4, "user/message", {
        "id": "user-1", "role": "user", "source": {"kind": "user"},
        "content": [{"type": "text", "text": "queued"}],
    }))
    assert store.require_native_run_binding("run-1")["native_turn_id"] == "3"
    assert [event["type"] for event in journal.event_page("session-1")["data"][:2]] == [
        "event.run.started", "event.item.created",
    ]
    projector.project(_fact(5, "session/title", {
        "title": "Queued task", "messageSeqs": [4], "source": {"kind": "fallback"},
    }))
    assert journal.snapshot("session-1")["session"]["title"] == "Queued task"
    assert journal.event_page("session-1")["data"][-1]["type"] == "event.session.updated"
    store.close()


def test_plugin_runtime_context_user_message_is_not_a_second_run_receipt(tmp_path: Path) -> None:
    store, journal, projector = _runtime(tmp_path)
    projector.project(_fact(0, "turn/start", {"turn": 1, "messageId": "user-1"}))
    result = projector.project(_fact(1, "user/message", {
        "id": "plugin-context-1", "role": "user",
        "source": {"kind": "plugin", "plugin": "@deepseek-ai/dsh-system-prompt", "form": "snapshot"},
        "content": [{"type": "text", "text": "runtime context"}],
    }))
    assert result.oaep_sequences == ()
    assert store.require_native_run_binding("run-1")["native_turn_id"] == "1"
    assert [event["type"] for event in journal.event_page("session-1")["data"]] == ["event.run.started"]
    store.close()


def test_open_turn_and_native_cursor_recover_after_bridge_restart(tmp_path: Path) -> None:
    path = tmp_path / "runtime.sqlite3"
    store, _, projector = _runtime(tmp_path)
    projector.project(_fact(0, "agent/inbox/spliced", {"target": "next-turn", "start": 0, "inserted": []}))
    projector.project(_fact(1, "turn/start", {"turn": 9}))
    store.close()

    reopened = RuntimeAuthorityStore(path)
    journal = OaepJournal(reopened)
    recovered = NativeFactProjector(reopened, journal, runtime_id="runtime-1")
    recovered.project(_fact(2, "user/message", {
        "id": "user-1", "role": "user", "content": [{"type": "text", "text": "resume"}],
    }))
    assert reopened.require_native_run_binding("run-1")["native_turn_id"] == "9"
    assert journal.snapshot("session-1")["runs"][0]["status"] == "running"
    reopened.close()


def test_generation_gap_and_unknown_required_event_fail_closed(tmp_path: Path) -> None:
    store, _, projector = _runtime(tmp_path)
    with pytest.raises(RuntimeStoreError) as stale:
        projector.project(_fact(0, "turn/start", {"turn": 0, "messageId": "user-1"}, generation=2))
    assert stale.value.code == "native_generation_stale"
    with pytest.raises(RuntimeStoreError) as gap:
        projector.project(_fact(1, "turn/start", {"turn": 0}))
    assert gap.value.code == "native_sequence_gap"
    with pytest.raises(NativeFactError) as unknown:
        projector.project(_fact(0, "future/authority-change", {}))
    assert unknown.value.code == "native_event_unknown_required"
    with pytest.raises(NativeFactError) as forbidden:
        projector.project(_fact(0, "todo/write", {"todos": []}))
    assert forbidden.value.code == "native_event_profile_forbidden"
    ignored = projector.project(_fact(0, "future/diagnostic", {}, ignorable=True))
    assert ignored.disposition == "ignored_compatible"
    store.close()


def test_failed_turn_has_safe_oaep_error_and_no_false_completion(tmp_path: Path) -> None:
    store, journal, projector = _runtime(tmp_path)
    projector.project(_fact(0, "turn/start", {"turn": 1}))
    projector.project(_fact(1, "user/message", {
        "id": "user-1", "role": "user", "content": [{"type": "text", "text": "claimed"}],
    }))
    projector.project(_fact(2, "turn/end", {
        "turn": 1, "reason": {"kind": "error", "error": {"code": "UPSTREAM", "message": "secret-free"}},
    }))
    event = journal.event_page("session-1")["data"][-1]
    assert event["type"] == "event.run.failed"
    assert event["data"]["error"]["code"] == "dsh_turn_error"
    assert store.require_run("run-1")["status"] == "failed"
    store.close()
