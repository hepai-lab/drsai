from __future__ import annotations

from pathlib import Path

import pytest

from opendrsai_dsh_runtime.driver import NativeRuntimeIdentity
from opendrsai_dsh_runtime.jsonrpc import JsonRpcNotification
from opendrsai_dsh_runtime.mapper import NativeFactProjector
from opendrsai_dsh_runtime.oaep import OaepJournal
from opendrsai_dsh_runtime.reconcile import RuntimeReconciler
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore, RuntimeStoreError


def _fact(sequence: int, event_type: str, data: dict, generation: int) -> JsonRpcNotification:
    return JsonRpcNotification("session.event", {
        "sessionId": "native-session-1",
        "event": {"type": event_type, "seq": sequence, "time": 1_700_000_000_000 + sequence, "data": data},
    }, generation)


def _identity(digest: str = "c" * 64) -> NativeRuntimeIdentity:
    return NativeRuntimeIdentity(
        "deepseek-harness-sdk-runtime", "test-v2", digest,
        frozenset({"session/history"}), frozenset({"session.event"}), frozenset({"session.resume"}),
    )


def _prepared(tmp_path: Path):
    path = tmp_path / "runtime.sqlite3"
    store = RuntimeAuthorityStore(path)
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
    operation, _ = store.prepare_operation(
        operation_kind="run.start", idempotency_key="run-key", request_digest="a" * 64,
        generation=1, session_id="session-1", run_id="run-1",
    )
    store.transition_operation(operation["operation_id"], "sent")
    store.bind_native_run("run-1", native_message_id="user-1", generation=1)
    store.transition_operation(operation["operation_id"], "outcome_unknown")
    journal = OaepJournal(store)
    mapper = NativeFactProjector(store, journal, runtime_id="runtime-1")
    initial = [
        _fact(0, "agent/inbox/spliced", {"target": "next-turn", "start": 0, "inserted": []}, 1),
        _fact(1, "turn/start", {"turn": 2}, 1),
        _fact(2, "user/message", {
            "id": "user-1", "role": "user", "content": [{"type": "text", "text": "hello"}],
        }, 1),
    ]
    for fact in initial:
        mapper.project(fact)
    store.close()
    return path, initial


def test_restart_replays_history_promotes_generation_and_repairs_uncertain_receipt(tmp_path: Path) -> None:
    path, initial = _prepared(tmp_path)
    store = RuntimeAuthorityStore(path)
    journal = OaepJournal(store)
    mapper = NativeFactProjector(store, journal, runtime_id="runtime-1")
    reconciler = RuntimeReconciler(store, mapper)
    history = [
        *[JsonRpcNotification(f.method, f.params, 2) for f in initial],
        _fact(3, "assistant/message", {
            "turn": 2, "step": 0,
            "message": {"id": "assistant-1", "role": "assistant", "content": [{"type": "text", "text": "done"}]},
        }, 2),
        _fact(4, "turn/end", {"turn": 2, "reason": {"kind": "completed"}}, 2),
    ]
    report = reconciler.reconcile_session(
        "session-1", native_identity=_identity(), generation=2, history=history
    )
    assert (report.replayed_facts, report.mapped_facts, report.repaired_operations) == (3, 2, 1)
    assert report.unresolved_operations == 0
    assert store.require_native_session_binding("session-1")["generation"] == 2
    assert store.require_native_run_binding("run-1")["generation"] == 2
    assert store.require_run("run-1")["status"] == "completed"
    assert journal.event_page("session-1")["data"][-1]["type"] == "event.run.completed"
    store.close()


def test_recovery_profile_mismatch_fails_before_generation_mutation(tmp_path: Path) -> None:
    path, _ = _prepared(tmp_path)
    store = RuntimeAuthorityStore(path)
    reconciler = RuntimeReconciler(
        store, NativeFactProjector(store, OaepJournal(store), runtime_id="runtime-1")
    )
    with pytest.raises(RuntimeStoreError) as mismatch:
        reconciler.reconcile_session(
            "session-1", native_identity=_identity("d" * 64), generation=2, history=[]
        )
    assert mismatch.value.code == "native_recovery_profile_mismatch"
    assert store.require_native_session_binding("session-1")["generation"] == 1
    store.close()


def test_recovery_history_gap_fails_closed_without_blind_operation_retry(tmp_path: Path) -> None:
    path, _ = _prepared(tmp_path)
    store = RuntimeAuthorityStore(path)
    reconciler = RuntimeReconciler(
        store, NativeFactProjector(store, OaepJournal(store), runtime_id="runtime-1")
    )
    with pytest.raises(RuntimeStoreError) as gap:
        reconciler.reconcile_session(
            "session-1", native_identity=_identity(), generation=2,
            history=[_fact(4, "turn/end", {"turn": 2, "reason": {"kind": "completed"}}, 2)],
        )
    assert gap.value.code == "native_sequence_gap"
    assert store.unresolved_operations()[0]["state"] == "outcome_unknown"
    store.close()


def test_unsettled_tool_side_effect_is_quarantined_and_never_replayed(tmp_path: Path) -> None:
    path, initial = _prepared(tmp_path)
    store = RuntimeAuthorityStore(path)
    journal = OaepJournal(store)
    reconciler = RuntimeReconciler(store, NativeFactProjector(store, journal, runtime_id="runtime-1"))
    history = [
        *[JsonRpcNotification(f.method, f.params, 2) for f in initial],
        _fact(3, "tool/call", {
            "turn": 2, "step": 0, "callId": "side-effect-1", "name": "bash",
            "arguments": '{"command":"external-write"}',
        }, 2),
    ]
    report = reconciler.reconcile_session(
        "session-1", native_identity=_identity(), generation=2, history=history,
    )
    assert report.quarantined_side_effects == 1
    assert store.require_run("run-1")["status"] == "outcome_unknown"
    unsettled = store.unsettled_side_effect_items("session-1")
    assert [item["content"]["call_id"] for item in unsettled] == ["side-effect-1"]
    # Reconciliation exposes identities for operator/native-history convergence,
    # never a dispatch command; repeating it cannot execute the tool again.
    assert reconciler.quarantine_unknown_side_effects(session_id="session-1") == 1
    assert store.require_run("run-1")["status"] == "outcome_unknown"
    store.close()
