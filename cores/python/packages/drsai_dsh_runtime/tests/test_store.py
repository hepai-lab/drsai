from __future__ import annotations

from pathlib import Path

import pytest

from opendrsai_dsh_runtime.store import RuntimeAuthorityStore, RuntimeStoreError


DIGEST_A = "a" * 64
DIGEST_B = "b" * 64
CONTRACT = "c" * 64


@pytest.fixture
def store(tmp_path: Path):
    value = RuntimeAuthorityStore(tmp_path / "runtime.sqlite3")
    yield value
    value.close()


def _session(store: RuntimeAuthorityStore, identity: str = "session-1") -> dict:
    return store.create_session(
        session_id=identity,
        workspace_id="workspace-1",
        workspace_fingerprint=DIGEST_A,
        native_profile="dsh-sdk/0.1.0-rc.5",
        mapping_version="dsh-oaep/1",
    )


def test_session_and_native_binding_are_exact_and_persistent(store: RuntimeAuthorityStore) -> None:
    session = _session(store)
    assert session["owner_profile"] == "bridge"
    binding = store.bind_native_session(
        session["session_id"],
        native_session_id="native-session-1",
        native_runtime_version="0.1.0-rc.5",
        native_contract_sha256=CONTRACT,
        generation=1,
    )
    assert binding["native_session_id"] == "native-session-1"
    assert store.bind_native_session(
        session["session_id"],
        native_session_id="native-session-1",
        native_runtime_version="0.1.0-rc.5",
        native_contract_sha256=CONTRACT,
        generation=2,
    )["generation"] == 2
    with pytest.raises(RuntimeStoreError, match="another native identity"):
        store.bind_native_session(
            session["session_id"],
            native_session_id="native-session-other",
            native_runtime_version="0.1.0-rc.5",
            native_contract_sha256=CONTRACT,
            generation=2,
        )


def test_one_active_run_and_exact_native_turn_binding(store: RuntimeAuthorityStore) -> None:
    session = _session(store)
    store.bind_native_session(
        session["session_id"], native_session_id="native-session-1",
        native_runtime_version="0.1.0-rc.5", native_contract_sha256=CONTRACT, generation=1,
    )
    run = store.create_run(session["session_id"], input_digest=DIGEST_A, run_id="run-1")
    with pytest.raises(RuntimeStoreError) as active:
        store.create_run(session["session_id"], input_digest=DIGEST_B, run_id="run-2")
    assert active.value.code == "session_run_active"
    store.transition_run(run["run_id"], "starting")
    binding = store.bind_native_run(run["run_id"], native_message_id="message-1", generation=1)
    assert binding["native_turn_id"] is None
    binding = store.claim_native_turn(run["run_id"], native_turn_id="turn-1", generation=1)
    assert binding["native_turn_id"] == "turn-1"
    with pytest.raises(RuntimeStoreError) as conflict:
        store.claim_native_turn(run["run_id"], native_turn_id="turn-2", generation=1)
    assert conflict.value.code == "native_turn_conflict"


def test_stale_generation_cannot_bind_run(store: RuntimeAuthorityStore) -> None:
    session = _session(store)
    store.bind_native_session(
        session["session_id"], native_session_id="native-session-1",
        native_runtime_version="0.1.0-rc.5", native_contract_sha256=CONTRACT, generation=2,
    )
    run = store.create_run(session["session_id"], input_digest=DIGEST_A)
    with pytest.raises(RuntimeStoreError) as stale:
        store.bind_native_run(run["run_id"], native_message_id="message-1", generation=1)
    assert stale.value.code == "native_generation_stale"


def test_run_terminal_is_idempotent_but_cannot_change(store: RuntimeAuthorityStore) -> None:
    session = _session(store)
    run = store.create_run(session["session_id"], input_digest=DIGEST_A)
    store.transition_run(run["run_id"], "running")
    terminal = store.transition_run(run["run_id"], "completed", reason="completed")
    assert store.transition_run(run["run_id"], "completed", reason="completed") == terminal
    with pytest.raises(RuntimeStoreError) as conflict:
        store.transition_run(run["run_id"], "failed", reason="error")
    assert conflict.value.code == "run_terminal_conflict"
    second = store.create_run(session["session_id"], input_digest=DIGEST_B)
    assert second["status"] == "queued"


def test_operation_idempotency_and_recovery_ledger(store: RuntimeAuthorityStore) -> None:
    operation, created = store.prepare_operation(
        operation_kind="run.start", idempotency_key="key-1", request_digest=DIGEST_A,
        generation=1, session_id="session-1", run_id="run-1",
    )
    assert created and operation["state"] == "prepared"
    same, created = store.prepare_operation(
        operation_kind="run.start", idempotency_key="key-1", request_digest=DIGEST_A,
        generation=99, session_id="session-1", run_id="run-1",
    )
    assert not created and same["operation_id"] == operation["operation_id"]
    with pytest.raises(RuntimeStoreError) as conflict:
        store.prepare_operation(
            operation_kind="run.start", idempotency_key="key-1", request_digest=DIGEST_B,
            generation=1, session_id="session-1", run_id="run-1",
        )
    assert conflict.value.code == "idempotency_conflict"

    store.transition_operation(operation["operation_id"], "sent", native_request_id="native-request-1")
    store.transition_operation(operation["operation_id"], "outcome_unknown")
    assert [item["operation_id"] for item in store.unresolved_operations()] == [operation["operation_id"]]
    completed = store.transition_operation(
        operation["operation_id"], "completed", result={"message_id": "message-1"}
    )
    assert completed["result"] == {"message_id": "message-1"}
    assert store.unresolved_operations() == []


def test_store_reopens_without_losing_authority(tmp_path: Path) -> None:
    path = tmp_path / "runtime.sqlite3"
    first = RuntimeAuthorityStore(path)
    _session(first)
    first.close()
    second = RuntimeAuthorityStore(path)
    try:
        assert second.require_session("session-1")["mapping_version"] == "dsh-oaep/1"
    finally:
        second.close()

