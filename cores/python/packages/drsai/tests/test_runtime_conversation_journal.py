from __future__ import annotations

import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import (
    RuntimeConversationJournal,
    SessionCursorExpired,
    _redact_credentials,
)
from drsai.backend.runtime.oaep import (
    project_openai_chat_completion_chunks,
    reduce_oaep_events,
)
from drsai.relay.models import ConversationSnapshot, SessionEvent

ROOT = Path(__file__).resolve().parents[5]
OAEP_SCHEMA = ROOT / "cores" / "protocol" / "oaep" / "oaep.schema.json"


def test_journal_redaction_preserves_diagnostic_codes_and_removes_credentials() -> None:
    safe = _redact_credentials({
        "result": '{"error_code":"service_unavailable","api_key":"sk-secret"}',
        "token": "top-secret",
    })

    assert "service_unavailable" in safe["result"]
    assert "sk-secret" not in safe["result"]
    assert safe["token"] == "[REDACTED]"


@pytest.fixture()
def runtime(tmp_path: Path) -> tuple[RuntimeEngine, RuntimeConversationJournal]:
    database = tmp_path / "runtime.sqlite3"
    engine = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-journal", "instance-one"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
    )
    return engine, RuntimeConversationJournal(database, "runtime-journal")


def _session_and_run(
    engine: RuntimeEngine,
    *,
    workspace_id: str = "workspace-one",
    key: str = "journal-run",
) -> tuple[dict, dict]:
    session = engine.create_session(workspace_id, "Journal Session")
    run, _ = engine.create_run(session["session_id"], "agent@1", key)
    return session, run


def test_concurrent_session_sequence_is_strictly_monotonic_and_survives_restart(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    baseline = journal.snapshot(session["session_id"])["snapshot_sequence"]

    def append(index: int) -> dict:
        event, created = journal.append_event(
            session["session_id"],
            "tool.state.changed",
            {"index": index},
            run_id=run["run_id"],
            dedupe_key=f"tool-{index}",
        )
        assert created
        return event

    with ThreadPoolExecutor(max_workers=20) as pool:
        events = list(pool.map(append, range(100)))
    assert sorted(event["session_sequence"] for event in events) == list(
        range(baseline + 1, baseline + 101)
    )
    assert [event["session_sequence"] for event in journal.replay(session["session_id"])] == list(
        range(1, baseline + 101)
    )

    restarted = RuntimeConversationJournal(engine.database, "runtime-journal")
    last, created = restarted.append_event(
        session["session_id"],
        "run.state.changed",
        {"status": "completed"},
        run_id=run["run_id"],
    )
    assert created and last["session_sequence"] == baseline + 101


def test_windows_and_android_concurrent_sends_share_one_ordered_session(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session = engine.create_session("workspace-one", "Dual-client concurrency")
    baseline = journal.snapshot(session["session_id"])["snapshot_sequence"]

    def send(index: int) -> tuple[str, str]:
        source_client = "windows" if index % 2 == 0 else "android"
        source_message_id = f"{source_client}-concurrent-{index}"
        run, created = engine.create_run(
            session["session_id"],
            "opendrsai@1",
            f"dual-client-run-{index}",
            "opendrsai",
        )
        assert created
        engine.set_run_input(
            run["run_id"],
            f"concurrent message {index}",
            source_client=source_client,
            source_message_id=source_message_id,
        )
        return run["run_id"], source_message_id

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(send, range(100)))

    snapshot = journal.snapshot(session["session_id"])
    sequences = [
        event["session_sequence"]
        for event in journal.replay(session["session_id"])
        if event["session_sequence"] > baseline
    ]
    assert sequences == list(range(baseline + 1, snapshot["snapshot_sequence"] + 1))
    assert len({run_id for run_id, _ in results}) == 100
    assert len({source_id for _, source_id in results}) == 100
    user_items = [
        item
        for item in snapshot["items"]
        if item["kind"] == "message" and item["role"] == "user"
    ]
    assert len(user_items) == 100
    assert sum(item["source_client"] == "windows" for item in user_items) == 50
    assert sum(item["source_client"] == "android" for item in user_items) == 50
    assert len(engine.list_session_runs(session["session_id"])) == 100


def test_item_revision_source_message_id_and_semantic_retries_are_idempotent(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    baseline = len(journal.replay(session["session_id"]))
    arguments = {
        "session_id": session["session_id"],
        "item_id": "user-item",
        "kind": "message",
        "role": "user",
        "revision": 1,
        "source_client": "android",
        "source_message_id": "android-message-1",
        "payload": {"text": "hello"},
        "run_id": run["run_id"],
    }
    item, event, created = journal.upsert_item(**arguments)
    repeated_item, repeated_event, repeated_created = journal.upsert_item(**arguments)
    assert created and not repeated_created
    assert repeated_item == item and repeated_event == event
    assert len(journal.replay(session["session_id"])) == baseline + 1

    updated, update_event, updated_created = journal.upsert_item(
        **{**arguments, "revision": 2, "payload": {"text": "hello world"}}
    )
    assert updated_created
    assert updated["revision"] == 2
    assert update_event["session_sequence"] == baseline + 2
    with pytest.raises(ValueError, match="backwards"):
        journal.upsert_item(**arguments)
    with pytest.raises(ValueError, match="different semantics"):
        journal.upsert_item(**{**arguments, "revision": 2, "payload": {"text": "other"}})
    with pytest.raises(ValueError, match="another Conversation Item"):
        journal.upsert_item(**{**arguments, "item_id": "other-item"})


def test_item_and_journal_append_are_one_transaction_under_injected_failure(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    baseline = journal.snapshot(session["session_id"])["snapshot_sequence"]
    with journal._connect() as db:
        db.execute(
            "CREATE TRIGGER fail_projection BEFORE INSERT ON runtime_conversation_items "
            "BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="injected projection failure"):
        journal.upsert_item(
            session["session_id"],
            item_id="atomic-item",
            kind="message",
            role="assistant",
            revision=1,
            source_client="runtime",
            payload={"text": "must rollback"},
            run_id=run["run_id"],
        )
    assert journal.snapshot(session["session_id"])["snapshot_sequence"] == baseline
    assert len(journal.replay(session["session_id"])) == baseline
    with journal._connect() as db:
        db.execute("DROP TRIGGER fail_projection")


def test_canonical_oaep_item_event_and_legacy_projection_commit_atomically(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    baseline = journal.snapshot(session["session_id"])["snapshot_sequence"]
    with journal._connect() as db:
        db.execute(
            "CREATE TRIGGER fail_oaep_projection BEFORE INSERT ON runtime_oaep_items "
            "BEGIN SELECT RAISE(ABORT, 'injected oaep projection failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="injected oaep projection failure"):
        journal.upsert_item(
            session["session_id"],
            item_id="atomic-oaep-item",
            kind="message",
            role="assistant",
            revision=1,
            source_client="runtime",
            payload={"text": "must rollback", "status": "running"},
            run_id=run["run_id"],
        )
    with journal._connect() as db:
        assert db.execute(
            "SELECT 1 FROM runtime_conversation_items WHERE item_id='atomic-oaep-item'"
        ).fetchone() is None
        assert db.execute(
            "SELECT 1 FROM runtime_session_journal WHERE item_id='atomic-oaep-item'"
        ).fetchone() is None
        assert db.execute(
            "SELECT 1 FROM runtime_oaep_items WHERE item_id='atomic-oaep-item'"
        ).fetchone() is None
        db.execute("DROP TRIGGER fail_oaep_projection")
    assert journal.snapshot(session["session_id"])["snapshot_sequence"] == baseline


def test_oaep_item_sequence_is_run_local_and_state_machine_is_fail_closed(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session = engine.create_session("workspace-one", "OAEP item order")
    first_run, _ = engine.create_run(session["session_id"], "agent@1", "oaep-order-1")
    second_run, _ = engine.create_run(session["session_id"], "agent@1", "oaep-order-2")

    for run, prefix in ((first_run, "first"), (second_run, "second")):
        for index in range(2):
            journal.upsert_item(
                session["session_id"],
                item_id=f"{prefix}-{index}",
                kind="message",
                role="assistant",
                revision=1,
                source_client="runtime",
                payload={"text": prefix, "status": "running"},
                run_id=run["run_id"],
            )
    items = journal.oaep_items(session["session_id"])
    by_run: dict[str, list[int]] = {}
    for item in items:
        by_run.setdefault(item["run_id"], []).append(item["sequence"])
    assert by_run[first_run["run_id"]] == [1, 2]
    assert by_run[second_run["run_id"]] == [1, 2]

    journal.upsert_item(
        session["session_id"],
        item_id="first-0",
        kind="message",
        role="assistant",
        revision=2,
        source_client="runtime",
        payload={"text": "done", "status": "completed"},
        run_id=first_run["run_id"],
    )
    terminal_waterline = journal.snapshot(session["session_id"])["snapshot_sequence"]
    with pytest.raises(ValueError, match="terminal status"):
        journal.upsert_item(
            session["session_id"],
            item_id="first-0",
            kind="message",
            role="assistant",
            revision=3,
            source_client="runtime",
            payload={"text": "illegal", "status": "completed"},
            run_id=first_run["run_id"],
        )
    assert journal.snapshot(session["session_id"])["snapshot_sequence"] == terminal_waterline

    # A newer adapter mapping may correct both the projected content and a
    # previously inferred terminal status. It is the sole exception to the
    # normal fail-closed terminal state machine.
    journal.upsert_item(
        session["session_id"],
        item_id="first-0",
        kind="message",
        role="assistant",
        revision=3,
        source_client="runtime",
        payload={
            "text": "corrected",
            "status": "failed",
            "mapping_version": "oaep-codex/1.4",
            "projection_correction": True,
        },
        run_id=first_run["run_id"],
    )
    corrected = next(item for item in journal.oaep_items(session["session_id"]) if item["id"] == "first-0")
    assert corrected["status"] == "failed"
    assert corrected["content"]["text"] == "corrected"


def test_oaep_owop_references_are_workspace_bound_and_artifacts_get_safe_refs(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    operation_ref = {
        "protocol": "owop/1",
        "operation_id": "operation-safe",
        "workspace_id": "workspace-one",
        "operation": "files.read",
        "correlation_id": "correlation-safe",
    }
    journal.upsert_item(
        session["session_id"],
        item_id="tool-with-operation",
        kind="tool",
        role="tool",
        revision=1,
        source_client="runtime",
        payload={
            "tool_name": "files.read",
            "call_id": "call-safe",
            "arguments": {},
            "result": {"ok": True},
            "status": "completed",
            "operation_ref": operation_ref,
        },
        run_id=run["run_id"],
    )
    artifact = journal.upsert_item(
        session["session_id"],
        item_id="artifact-with-ref",
        kind="artifact",
        role=None,
        revision=1,
        source_client="runtime",
        payload={
            "artifact_id": "artifact-safe",
            "artifact_type": "report",
            "name": "Report",
            "summary": "ready",
            "status": "completed",
        },
        run_id=run["run_id"],
    )
    items = {item["id"]: item for item in journal.oaep_items(session["session_id"])}
    assert items["tool-with-operation"]["content"]["operation_ref"] == operation_ref
    assert items["artifact-with-ref"]["content"]["resource_refs"] == [{
        "protocol": "owop/1",
        "workspace_id": "workspace-one",
        "resource_type": "artifact",
        "resource_id": "artifact-safe",
    }]
    assert artifact[2]

    before = journal.snapshot(session["session_id"])["snapshot_sequence"]
    with pytest.raises(ValueError, match="another Workspace"):
        journal.upsert_item(
            session["session_id"],
            item_id="foreign-operation",
            kind="tool",
            role="tool",
            revision=1,
            source_client="runtime",
            payload={
                "tool_name": "files.read",
                "call_id": "call-foreign",
                "arguments": {},
                "result": {},
                "status": "completed",
                "operation_ref": {**operation_ref, "workspace_id": "workspace-two"},
            },
            run_id=run["run_id"],
        )
    assert journal.snapshot(session["session_id"])["snapshot_sequence"] == before


def test_v3_rows_migrate_idempotently_to_canonical_oaep_tables(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    journal.upsert_item(
        session["session_id"],
        item_id="migration-item",
        kind="message",
        role="assistant",
        revision=1,
        source_client="runtime",
        payload={"text": "migrate", "status": "completed"},
        run_id=run["run_id"],
    )
    with journal._connect() as db:
        db.execute("DELETE FROM runtime_oaep_events")
        db.execute("DELETE FROM runtime_oaep_items")
    restarted = RuntimeConversationJournal(engine.database, "runtime-journal")
    expected_events = restarted.replay_oaep(session["session_id"])
    expected_items = restarted.oaep_items(session["session_id"])
    report = restarted.oaep_migration_report()
    assert report["status"] == "completed"
    assert report["complete"] is True
    assert report["projected_items"] == report["migratable_items"]
    assert report["projected_events"] == report["legacy_events"]
    assert report["totals"]["items"] == report["legacy_items"]
    assert report["projectable"]["items"] == report["migratable_items"]
    assert report["degraded_notices"][0]["code"] == "legacy_item_without_run"
    assert report["failures"] == {"count": 0, "last_error_code": None}
    with journal._connect() as db:
        db.execute("DELETE FROM runtime_oaep_events")
        db.execute("DELETE FROM runtime_oaep_items")
    restarted_again = RuntimeConversationJournal(engine.database, "runtime-journal")
    assert restarted_again.replay_oaep(session["session_id"]) == expected_events
    assert restarted_again.oaep_items(session["session_id"]) == expected_items
    assert restarted_again.oaep_migration_report()["complete"] is True


def test_completed_oaep_projection_skips_full_legacy_replay(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    journal.upsert_item(
        session["session_id"], item_id="already-projected", kind="message",
        role="assistant", revision=1, source_client="runtime",
        payload={"text": "current", "status": "completed"}, run_id=run["run_id"],
    )

    def unexpected_replay(*_args, **_kwargs):
        raise AssertionError("completed OAEP projection must not be replayed")

    monkeypatch.setattr(RuntimeConversationJournal, "_store_oaep_item", unexpected_replay)
    monkeypatch.setattr(RuntimeConversationJournal, "_store_oaep_event", unexpected_replay)
    restarted = RuntimeConversationJournal(engine.database, "runtime-journal")
    assert restarted.oaep_migration_report()["complete"] is True
    assert restarted.oaep_items(session["session_id"])[-1]["id"] == "already-projected"


def test_failed_oaep_migration_is_audited_and_resumes_idempotently(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal], monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    journal.upsert_item(
        session["session_id"], item_id="resume-migration-item", kind="message",
        role="assistant", revision=1, source_client="runtime",
        payload={"text": "resume", "status": "completed"}, run_id=run["run_id"],
    )
    with journal._connect() as db:
        db.execute("DELETE FROM runtime_oaep_events")
        db.execute("DELETE FROM runtime_oaep_items")

    original = RuntimeConversationJournal._store_oaep_event
    calls = 0

    def fail_once(self, db, event, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise sqlite3.OperationalError("injected migration failure")
        return original(self, db, event, **kwargs)

    monkeypatch.setattr(RuntimeConversationJournal, "_store_oaep_event", fail_once)
    with pytest.raises(sqlite3.OperationalError, match="injected migration failure"):
        RuntimeConversationJournal(engine.database, "runtime-journal")
    with sqlite3.connect(engine.database) as db:
        status, error_code = db.execute(
            "SELECT status,last_error_code FROM runtime_oaep_migration_state WHERE singleton=1"
        ).fetchone()
    assert status == "failed"
    assert error_code == "OperationalError"

    monkeypatch.setattr(RuntimeConversationJournal, "_store_oaep_event", original)
    resumed = RuntimeConversationJournal(engine.database, "runtime-journal")
    assert resumed.oaep_migration_report()["complete"] is True
    sequences = [event["sequence"] for event in resumed.replay_oaep(session["session_id"])]
    assert sequences == list(range(1, len(sequences) + 1))


def test_oaep_schema_down_up_is_empty_only_and_legacy_rollback_remains_readable(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    journal.upsert_item(
        session["session_id"], item_id="rollback-readable", kind="message",
        role="assistant", revision=1, source_client="runtime",
        payload={"text": "rollback", "status": "completed"}, run_id=run["run_id"],
    )
    legacy_before = journal.snapshot(session["session_id"])
    with pytest.raises(RuntimeError, match="oaep_downgrade_data_present"):
        journal.downgrade_empty_oaep_schema()
    assert journal.snapshot(session["session_id"]) == legacy_before

    with journal._connect() as db:
        db.execute("DELETE FROM runtime_oaep_events")
        db.execute("DELETE FROM runtime_oaep_items")
    journal.downgrade_empty_oaep_schema()
    with sqlite3.connect(engine.database) as db:
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
    assert "runtime_oaep_events" not in tables
    assert "runtime_session_journal" in tables

    upgraded = RuntimeConversationJournal(engine.database, "runtime-journal")
    assert upgraded.snapshot(session["session_id"]) == legacy_before
    assert upgraded.oaep_migration_report()["complete"] is True
    assert upgraded.replay_oaep(session["session_id"])


def test_lazy_and_startup_oaep_migrations_have_the_same_projection_hash(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    journal.upsert_item(
        session["session_id"], item_id="lazy-migration", kind="message",
        role="assistant", revision=1, source_client="runtime",
        payload={"text": "same hash", "status": "completed"}, run_id=run["run_id"],
    )
    startup_items = journal.oaep_items(session["session_id"])
    startup_hash = journal.projection_hash(startup_items)
    startup_events = journal.replay_oaep(session["session_id"])

    with journal._connect() as db:
        db.execute("DELETE FROM runtime_oaep_events")
        db.execute("DELETE FROM runtime_oaep_items")
    assert journal.ensure_oaep_projection(session["session_id"]) is True
    lazy_items = journal.oaep_items(session["session_id"])
    assert journal.projection_hash(lazy_items) == startup_hash
    lazy_events = journal.replay_oaep(session["session_id"])
    assert [
        (event["event_id"], event["sequence"], event["type"])
        for event in lazy_events
    ] == [
        (event["event_id"], event["sequence"], event["type"])
        for event in startup_events
    ]
    assert journal.ensure_oaep_projection(session["session_id"]) is False


def test_snapshot_watermark_plus_replay_closes_the_subscription_race(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    journal.upsert_item(
        session["session_id"],
        item_id="assistant-item",
        kind="message",
        role="assistant",
        revision=1,
        source_client="runtime",
        payload={"text": "part"},
        run_id=run["run_id"],
    )
    snapshot = journal.snapshot(session["session_id"])
    journal.upsert_item(
        session["session_id"],
        item_id="assistant-item",
        kind="message",
        role="assistant",
        revision=2,
        source_client="runtime",
        payload={"text": "complete"},
        run_id=run["run_id"],
    )
    replay = journal.replay(
        session["session_id"], after_sequence=snapshot["snapshot_sequence"]
    )
    assert snapshot["snapshot_sequence"] == 3
    assert [event["session_sequence"] for event in replay] == [4]
    assert replay[0]["payload"]["revision"] == 2
    ConversationSnapshot.model_validate(snapshot)
    SessionEvent.model_validate(replay[0])


def test_waiter_wakes_for_new_session_event_without_polling_loss(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    baseline = journal.snapshot(session["session_id"])["snapshot_sequence"]
    with ThreadPoolExecutor(max_workers=1) as pool:
        waiting = pool.submit(
            journal.wait_for_events,
            session["session_id"],
            after_sequence=baseline,
            timeout=5,
        )
        event, _ = journal.append_event(
            session["session_id"],
            "run.created",
            {"status": "queued"},
            run_id=run["run_id"],
        )
        assert waiting.result(timeout=5) == [event]


def test_checkpoint_compaction_preserves_snapshot_and_expires_old_cursor(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine)
    for revision in range(1, 6):
        journal.upsert_item(
            session["session_id"],
            item_id="assistant-item",
            kind="message",
            role="assistant",
            revision=revision,
            source_client="runtime",
            payload={"text": f"revision-{revision}"},
            run_id=run["run_id"],
        )
    before = journal.snapshot(session["session_id"])
    checkpoint = journal.checkpoint(session["session_id"])
    with journal._connect() as db, pytest.raises(sqlite3.IntegrityError, match="append-only"):
        db.execute(
            "DELETE FROM runtime_session_journal WHERE session_id=?",
            (session["session_id"],),
        )
    compacted = journal.compact(session["session_id"], through_sequence=4)
    after = journal.snapshot(session["session_id"])
    assert compacted == {"removed_events": 4, "earliest_retained_sequence": 5}
    assert before == after
    canonical = json.dumps(
        after["items"], ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    assert checkpoint["snapshot_hash"] == hashlib.sha256(canonical.encode()).hexdigest()
    with pytest.raises(SessionCursorExpired) as expired:
        journal.replay(session["session_id"], after_sequence=0)
    assert expired.value.details["earliest_sequence"] == 5
    assert [event["session_sequence"] for event in journal.replay(
        session["session_id"], after_sequence=4
    )] == [5, 6, 7]


def test_cross_session_run_and_event_dedupe_conflicts_fail_closed(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    first_session, first_run = _session_and_run(engine, key="first")
    second_session, _ = _session_and_run(engine, key="second")
    with pytest.raises(ValueError, match="another Session"):
        journal.append_event(
            second_session["session_id"],
            "run.created",
            {},
            run_id=first_run["run_id"],
        )
    event, created = journal.append_event(
        first_session["session_id"],
        "run.created",
        {"status": "queued"},
        run_id=first_run["run_id"],
        dedupe_key="run-created",
    )
    repeated, repeated_created = journal.append_event(
        first_session["session_id"],
        "run.created",
        {"status": "queued"},
        run_id=first_run["run_id"],
        dedupe_key="run-created",
    )
    assert created and not repeated_created and repeated == event
    with pytest.raises(ValueError, match="different semantics"):
        journal.append_event(
            first_session["session_id"],
            "run.created",
            {"status": "running"},
            run_id=first_run["run_id"],
            dedupe_key="run-created",
        )


def test_runtime_engine_writes_session_run_input_state_and_backend_events_atomically(
    tmp_path: Path,
) -> None:
    engine = RuntimeEngine(
        tmp_path / "integrated.sqlite3",
        RuntimeEngineIdentity("runtime-integrated", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Integrated")
    run, _ = engine.create_run(session["session_id"], "agent@1", "integrated-run")
    engine.set_run_input(
        run["run_id"],
        "hello from Android",
        correlation_id="corr-integrated",
        source_client="android",
        source_message_id="android-message-integrated",
    )
    engine.transition_run(run["run_id"], "running")
    engine.append_backend_event(
        run["run_id"],
        "tool.progress",
        {"title": "Reading workspace"},
        "backend-tool-1",
    )

    events = engine.list_session_events(session["session_id"])
    assert [event["kind"] for event in events] == [
        "session.updated",
        "run.created",
        "conversation.item.created",
        "run.state.changed",
        "tool.state.changed",
        "conversation.item.created",
    ]
    assert [event["session_sequence"] for event in events] == list(range(1, 7))
    snapshot = engine.conversation_snapshot(session["session_id"])
    assert snapshot["snapshot_sequence"] == 6
    assert snapshot["items"][0]["payload"]["content"] == "hello from Android"
    assert snapshot["items"][0]["source_client"] == "android"
    assert snapshot["items"][0]["source_message_id"] == "android-message-integrated"


def test_engine_run_and_input_roll_back_when_journal_projection_fails(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session = engine.create_session("workspace-one", "Atomic engine")
    with journal._connect() as db:
        db.execute(
            "CREATE TRIGGER fail_run_journal BEFORE INSERT ON runtime_session_journal "
            "WHEN NEW.event_kind='run.created' "
            "BEGIN SELECT RAISE(ABORT, 'injected run journal failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="injected run journal failure"):
        engine.create_run(session["session_id"], "agent@1", "must-rollback")
    assert engine.list_session_runs(session["session_id"]) == []
    with journal._connect() as db:
        db.execute("DROP TRIGGER fail_run_journal")

    run, _ = engine.create_run(session["session_id"], "agent@1", "input-rollback")
    with journal._connect() as db:
        db.execute(
            "CREATE TRIGGER fail_input_projection BEFORE INSERT ON runtime_conversation_items "
            "BEGIN SELECT RAISE(ABORT, 'injected input projection failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="injected input projection failure"):
        engine.set_run_input(run["run_id"], "must not persist")
    assert engine.get_run(run["run_id"])["input_message"] == ""


def test_pre_journal_runtime_facts_are_reconciled_once_across_restarts(
    tmp_path: Path,
) -> None:
    database = tmp_path / "upgrade.sqlite3"
    first = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-upgrade", "instance-one"),
        lambda _: True,
    )
    session = first.create_session("workspace-one", "Legacy")
    run, _ = first.create_run(session["session_id"], "agent@1", "legacy-run")
    first.set_run_input(run["run_id"], "legacy user message")
    first.append_backend_event(
        run["run_id"], "tool.complete", {"result": "legacy result"}, "legacy-tool"
    )
    with sqlite3.connect(database) as db:
        db.executescript(
            """
            DROP TRIGGER runtime_session_journal_no_update;
            DROP TRIGGER runtime_session_journal_no_delete;
            DROP TABLE runtime_session_journal;
            DROP TABLE runtime_conversation_items;
            DROP TABLE runtime_session_journal_checkpoints;
            DROP TABLE runtime_session_journal_maintenance;
            DROP TABLE runtime_session_sequences;
            """
        )

    upgraded = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-upgrade", "instance-two"),
        lambda _: True,
    )
    first_events = upgraded.list_session_events(session["session_id"])
    snapshot = upgraded.conversation_snapshot(session["session_id"])
    assert snapshot["items"][0]["payload"]["content"] == "legacy user message"
    assert {event["kind"] for event in first_events} >= {
        "session.updated",
        "run.created",
        "tool.state.changed",
        "conversation.item.created",
    }

    restarted = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-upgrade", "instance-three"),
        lambda _: True,
    )
    assert restarted.list_session_events(session["session_id"]) == first_events
    assert restarted.conversation_snapshot(session["session_id"]) == snapshot


def test_journal_preserves_conversation_text_but_redacts_embedded_credentials(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.set_run_input(
        run["run_id"],
        "normal conversation token=JOURNAL_SECRET_CANARY_12345 remains readable",
        source_client="windows",
        source_message_id="windows-secret-test",
    )
    item = engine.conversation_snapshot(session["session_id"])["items"][0]
    assert item["payload"]["content"] == (
        "normal conversation token=[REDACTED] remains readable"
    )
    assert b"JOURNAL_SECRET_CANARY_12345" not in engine.database.read_bytes()


def test_oaep_projection_redacts_sensitive_backend_payload_values(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    canary = "OAEP_SECRET_CANARY_12345"
    engine.append_backend_event(
        run["run_id"],
        "tool.complete",
        {
            "name": "web",
            "tool_id": "lookup",
            "output": "done",
            "api_key": canary,
            "authorization": f"Bearer {canary}",
        },
        "oaep-secret-tool-1",
    )

    snapshot_json = json.dumps(engine.oaep_snapshot(session["session_id"]), ensure_ascii=False)
    events_json = json.dumps(engine.list_oaep_events(session["session_id"]), ensure_ascii=False)
    assert canary not in snapshot_json
    assert canary not in events_json
    assert "done" in snapshot_json
    assert "done" in events_json


def test_model_tool_artifact_and_approval_projection_reaches_one_session_snapshot(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.transition_run(run["run_id"], "running")
    engine.append_backend_event(
        run["run_id"], "message.delta", {"text": "hello "}, "message-1"
    )
    engine.append_backend_event(
        run["run_id"], "message.delta", {"text": "world"}, "message-2"
    )
    engine.append_backend_event(
        run["run_id"], "message.complete", {}, "message-3"
    )
    engine.append_backend_event(
        run["run_id"],
        "artifact.created",
        {"artifact_id": "artifact-one", "name": "Report"},
        "artifact-1",
    )
    approval = engine.request_approval(
        run["run_id"], {"tool": "shell", "summary": "Allow command"}
    )
    engine.resolve_approval(
        approval["approval_id"],
        "approved",
        {"idempotency_key": "approval-journal-test"},
    )

    snapshot = engine.conversation_snapshot(session["session_id"])
    replayed_items = engine.conversation_journal.project_items(
        engine.list_session_events(session["session_id"])
    )
    assert replayed_items == snapshot["items"]
    assert engine.conversation_journal.projection_hash(replayed_items) == (
        engine.conversation_journal.projection_hash(snapshot["items"])
    )
    items = {item["kind"]: item for item in snapshot["items"]}
    assert items["message"]["payload"]["text"] == "hello world"
    assert items["message"]["payload"]["status"] == "completed"
    assert items["artifact"]["payload"]["artifact_id"] == "artifact-one"
    assert items["approval"]["payload"]["status"] == "approved"
    kinds = [event["kind"] for event in engine.list_session_events(session["session_id"])]
    assert "approval.created" in kinds
    assert "approval.decided" in kinds
    assert "artifact.created" in kinds


def test_oaep_snapshot_and_events_project_runtime_conversation(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.set_run_input(
        run["run_id"],
        "hello oaep",
        source_client="windows",
        source_message_id="windows-oaep-1",
    )
    engine.transition_run(run["run_id"], "running")
    engine.append_backend_event(
        run["run_id"], "agent.message.delta", {"text": "stream "}, "oaep-delta-1"
    )
    engine.append_backend_event(
        run["run_id"], "agent.message.delta", {"text": "text"}, "oaep-delta-2"
    )
    engine.append_backend_event(
        run["run_id"], "agent.completed", {}, "oaep-complete-1"
    )
    engine.transition_run(run["run_id"], "completed")

    snapshot = engine.oaep_snapshot(session["session_id"])
    assert snapshot["version"] == "1.0"
    assert snapshot["session"]["id"] == session["session_id"]
    assert snapshot["runs"][0]["id"] == run["run_id"]
    message_items = [item for item in snapshot["items"] if item["type"] == "message"]
    assert message_items[0]["content"]["text"] == "hello oaep"
    assert message_items[-1]["content"]["text"] == "stream text"
    assert message_items[-1]["status"] == "completed"

    events = engine.list_oaep_events(session["session_id"])
    assert events[0]["type"] == "event.session.updated"
    assert any(event["type"] == "event.run.created" for event in events)
    assert any(event["type"] == "event.run.started" for event in events)
    deltas = [event for event in events if event["type"] == "event.item.delta"]
    assert deltas
    assert deltas[-1]["data"]["delta"]["kind"] == "message.text.append"
    assert deltas[-1]["data"]["delta"]["text"] == "text"
    assert events[-1]["type"] == "event.run.completed"
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))


def test_canonical_oaep_replay_from_zero_equals_snapshot(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.set_run_input(
        run["run_id"],
        "replay me",
        source_client="android",
        source_message_id="oaep-replay-message",
    )
    engine.transition_run(run["run_id"], "running")
    engine.append_backend_event(
        run["run_id"], "agent.message.delta", {"text": "hello "}, "oaep-replay-1"
    )
    engine.append_backend_event(
        run["run_id"], "agent.message.delta", {"text": "world"}, "oaep-replay-2"
    )
    engine.append_backend_event(
        run["run_id"], "agent.completed", {}, "oaep-replay-3"
    )
    engine.transition_run(run["run_id"], "completed")

    snapshot = engine.oaep_snapshot(session["session_id"])
    rebuilt = reduce_oaep_events(engine.list_oaep_events(session["session_id"]))
    assert rebuilt == snapshot


def test_oaep_runtime_projection_matches_protocol_schema(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.set_run_input(
        run["run_id"],
        "schema check",
        source_client="windows",
        source_message_id="windows-oaep-schema-1",
    )
    engine.transition_run(run["run_id"], "running")
    engine.append_backend_event(
        run["run_id"], "agent.message.delta", {"text": "schema "}, "oaep-schema-delta-1"
    )
    engine.append_backend_event(
        run["run_id"], "agent.message.delta", {"text": "ok"}, "oaep-schema-delta-2"
    )
    engine.append_backend_event(run["run_id"], "agent.completed", {}, "oaep-schema-complete-1")
    engine.transition_run(run["run_id"], "completed")

    schema = json.loads(OAEP_SCHEMA.read_text(encoding="utf-8"))
    session_validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/session"})
    run_validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/run"})
    item_validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/item"})
    event_validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/event"})
    snapshot = engine.oaep_snapshot(session["session_id"])
    session_validator.validate(snapshot["session"])
    for projected_run in snapshot["runs"]:
        run_validator.validate(projected_run)
    for item in snapshot["items"]:
        item_validator.validate(item)
    for event in engine.list_oaep_events(session["session_id"]):
        event_validator.validate(event)


def test_oaep_projects_runtime_tool_command_interaction_artifact_and_failure(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"command:{run['run_id']}:pytest",
        kind="tool",
        role="tool",
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "name": "shell",
            "command": ["pytest", "-q"],
            "display_command": "pytest -q",
            "cwd": ".",
            "output": "15 passed",
            "exit_code": 0,
            "status": "completed",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"tool:{run['run_id']}:github",
        kind="tool",
        role="tool",
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "tool_kind": "mcp",
            "tool_name": "github.search_code",
            "call_id": "call-1",
            "arguments": {"query": "OAEP"},
            "result": {"count": 1},
            # Inspection metadata is an internal Runtime concern. OAEP/1
            # tool-call content is strict and must not grow an unversioned
            # top-level field when another Runtime feature adds metadata.
            "inspection": {"kind": "internal-test-metadata"},
            "status": "completed",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"approval:{run['run_id']}:pytest",
        kind="approval",
        role=None,
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "interaction_type": "approval",
            "prompt": "Allow pytest?",
            "options": [{"id": "accept", "label": "Allow"}],
            "decision": {"id": "accept"},
            "status": "approved",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id="artifact:oaep-report",
        kind="artifact",
        role=None,
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "artifact_id": "oaep-report",
            "artifact_type": "report",
            "name": "OAEP report",
            "path": "reports/oaep.md",
            "summary": "verified",
            "status": "completed",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"error:{run['run_id']}:tool",
        kind="error",
        role=None,
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "level": "error",
            "code": "tool_failed",
            "message": "Tool failed",
            "details": {"retryable": False},
            "status": "failed",
        },
    )

    items = {item["id"]: item for item in engine.oaep_snapshot(session["session_id"])["items"]}
    assert items[f"command:{run['run_id']}:pytest"]["type"] == "command_execution"
    assert items[f"command:{run['run_id']}:pytest"]["content"]["display_command"] == "pytest -q"
    assert items[f"tool:{run['run_id']}:github"]["type"] == "tool_call"
    assert items[f"tool:{run['run_id']}:github"]["content"]["tool_name"] == "github.search_code"
    assert items[f"tool:{run['run_id']}:github"]["content"]["arguments"] == {"query": "OAEP"}
    assert items[f"tool:{run['run_id']}:github"]["content"]["result"] == {"count": 1}
    assert "inspection" not in items[f"tool:{run['run_id']}:github"]["content"]
    assert items[f"approval:{run['run_id']}:pytest"]["type"] == "interaction"
    assert items[f"approval:{run['run_id']}:pytest"]["content"]["response"] == {"id": "accept"}
    assert items["artifact:oaep-report"]["type"] == "artifact"
    assert items[f"error:{run['run_id']}:tool"]["type"] == "notice"
    assert items[f"error:{run['run_id']}:tool"]["status"] == "failed"
    assert items[f"error:{run['run_id']}:tool"]["content"]["error"] == {
        "code": "tool_failed",
        "message": "Tool failed",
        "retryable": False,
        "source": "agent_core",
        "safe_details": {"retryable": False},
    }

    event_types_by_item = {
        event.get("item_id"): event["type"]
        for event in engine.list_oaep_events(session["session_id"])
        if event.get("item_id")
    }
    assert event_types_by_item[f"command:{run['run_id']}:pytest"] == "event.item.completed"
    assert event_types_by_item[f"tool:{run['run_id']}:github"] == "event.item.completed"
    assert event_types_by_item[f"approval:{run['run_id']}:pytest"] == "event.item.completed"
    assert event_types_by_item["artifact:oaep-report"] == "event.item.completed"
    assert event_types_by_item[f"error:{run['run_id']}:tool"] == "event.item.failed"
    schema = json.loads(OAEP_SCHEMA.read_text(encoding="utf-8"))
    validator = Draft202012Validator({"$defs": schema["$defs"], "$ref": "#/$defs/item"})
    for item in items.values():
        validator.validate(item)


def test_opendrsai_backend_events_project_tool_commands_and_failures_to_oaep(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    secret = "OAEP_FAILURE_SECRET_CANARY_12345"

    engine.append_backend_event(
        run["run_id"],
        "tool.started",
        {
            "tool_id": "shell-1",
            "name": "shell",
            "args": {"cmd": "python -m pytest -q"},
        },
        "opendrsai-tool-start-1",
    )
    engine.append_backend_event(
        run["run_id"],
        "tool.completed",
        {
            "tool_id": "shell-1",
            "name": "shell",
            "output": "1 passed",
            "exit_code": 0,
        },
        "opendrsai-tool-complete-1",
    )
    engine.append_backend_event(
        run["run_id"],
        "agent.failed",
        {
            "error": {
                "code": "model_rate_limited",
                "message": f"Retry after token={secret}",
                "retryable": True,
                "detail": {"authorization": f"Bearer {secret}"},
            },
            "diagnostic": {"stack": [{"path": "C:/sensitive/internal.py"}]},
        },
        "opendrsai-agent-failed-1",
    )

    snapshot = engine.oaep_snapshot(session["session_id"])
    items = {item["id"]: item for item in snapshot["items"]}
    command = items[f"tool:{run['run_id']}:shell-1"]
    failure = items[f"error:{run['run_id']}:agent"]

    assert command["type"] == "command_execution"
    assert command["status"] == "completed"
    assert command["content"]["command"] == ["python -m pytest -q"]
    assert command["content"]["display_command"] == "python -m pytest -q"
    assert command["content"]["output"] == "1 passed"
    assert command["content"]["exit_code"] == 0
    assert failure["type"] == "notice"
    assert failure["status"] == "failed"
    assert failure["content"]["code"] == "model_rate_limited"
    assert failure["content"]["message"] == "Retry after token=[REDACTED]"
    assert failure["content"]["details"] == {"retryable": True}
    assert failure["content"]["error"]["retryable"] is True

    events = engine.list_oaep_events(session["session_id"])
    event_by_item = {event.get("item_id"): event for event in events if event.get("item_id")}
    assert event_by_item[f"tool:{run['run_id']}:shell-1"]["type"] == "event.item.completed"
    assert event_by_item[f"error:{run['run_id']}:agent"]["type"] == "event.item.failed"
    assert secret not in json.dumps(snapshot, ensure_ascii=False)
    assert "C:/sensitive/internal.py" not in json.dumps(snapshot, ensure_ascii=False)


def test_oaep_stage2_public_projection_redacts_paths_arguments_artifacts_and_errors(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    secret = "OAEP_STAGE2_SECRET_CANARY_12345"

    engine.record_conversation_item(
        session["session_id"],
        item_id=f"command:{run['run_id']}:secret",
        kind="tool",
        role="tool",
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "name": "shell",
            "command": [f"curl -H Authorization:Bearer {secret}"],
            "display_command": f"curl --api-key={secret}",
            "cwd": r"C:\Users\win11\secret-project",
            "stdout_tail": f"token={secret}",
            "stderr_tail": "",
            "status": "completed",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"tool:{run['run_id']}:secret",
        kind="tool",
        role="tool",
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "tool_name": "browser.open",
            "arguments": {
                "url": "https://example.test",
                "authorization": f"Bearer {secret}",
                "token": secret,
            },
            "result": {"message": f"ok token={secret}"},
            "status": "completed",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"file:{run['run_id']}:secret",
        kind="file_change",
        role=None,
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "changes": [{
                "path": r"C:\Users\win11\repo\secrets.txt",
                "old_path": "../outside.txt",
                "operation": "modified",
                "diff": f"+ token={secret}",
            }],
            "summary": "changed file",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"artifact:{run['run_id']}:secret",
        kind="artifact",
        role=None,
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "artifact_id": "artifact-secret",
            "name": "secret report",
            "path": r"C:\Users\win11\repo\reports\secret.md",
            "mime_type": "text/markdown",
            "size": 12,
            "sha256": "a" * 64,
            "previewable": True,
            "downloadable": True,
            "summary": f"token={secret}",
            "status": "completed",
        },
    )
    engine.record_conversation_item(
        session["session_id"],
        item_id=f"error:{run['run_id']}:secret",
        kind="error",
        role=None,
        revision=1,
        source_client="runtime",
        run_id=run["run_id"],
        payload={
            "code": "backend_failed",
            "message": f"authorization Bearer {secret}",
            "details": {
                "retryable": True,
                "path": r"C:\Users\win11\secret.py",
                "api_key": secret,
            },
            "status": "failed",
        },
    )

    snapshot = engine.oaep_snapshot(session["session_id"])
    serialized = json.dumps(snapshot, ensure_ascii=False)
    assert secret not in serialized
    assert "C:/Users/win11" not in serialized
    assert r"C:\Users\win11" not in serialized

    items = {item["id"]: item for item in snapshot["items"]}
    command = items[f"command:{run['run_id']}:secret"]["content"]
    assert command["cwd"] == "secret-project"
    assert command["display_command"] == "curl --api-key=[REDACTED]"
    assert command["stdout_tail"] == "token=[REDACTED]"

    tool = items[f"tool:{run['run_id']}:secret"]["content"]
    assert tool["arguments"] == {"url": "https://example.test"}
    assert tool["result"] == {"message": "ok token=[REDACTED]"}

    file_change = items[f"file:{run['run_id']}:secret"]["content"]["changes"][0]
    assert file_change["path"] == "secrets.txt"
    assert file_change["old_path"] == "outside.txt"
    assert file_change["diff_summary"] == "+ token=[REDACTED]"

    artifact = items[f"artifact:{run['run_id']}:secret"]["content"]
    assert artifact["path"] == "secret.md"
    assert artifact["previewable"] is True
    assert artifact["downloadable"] is True

    error = items[f"error:{run['run_id']}:secret"]["content"]["error"]
    assert error["retryable"] is True
    assert error["safe_details"] == {"retryable": True, "path": "secret.py"}


def test_oaep_stage2_run_terminal_events_carry_safe_reason_and_error(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, failed_run = _session_and_run(engine, key="stage2-run-failed")
    secret = "OAEP_RUN_SECRET_CANARY_12345"
    engine.transition_run(failed_run["run_id"], "running")
    engine.transition_run(
        failed_run["run_id"],
        "failed",
        reason="agent_execution_failed",
        error={
            "code": "agent_execution_failed",
            "message": f"failed with token {secret}",
            "retryable": True,
            "path": r"C:\Users\win11\project\traceback.py",
        },
    )

    cancelled_run, _ = engine.create_run(session["session_id"], "agent@1", "stage2-run-cancelled")
    engine.transition_run(cancelled_run["run_id"], "running")
    engine.cancel_run(cancelled_run["run_id"])

    events = engine.list_oaep_events(session["session_id"])
    serialized = json.dumps(events, ensure_ascii=False)
    assert secret not in serialized
    assert "C:/Users/win11" not in serialized
    assert r"C:\Users\win11" not in serialized

    failed = next(
        event
        for event in events
        if event.get("run_id") == failed_run["run_id"] and event["type"] == "event.run.failed"
    )
    assert failed["data"]["reason"] == "agent_execution_failed"
    assert failed["data"]["error"] == {
        "code": "agent_execution_failed",
        "message": "failed with token [REDACTED]",
        "retryable": True,
        "path": "traceback.py",
    }

    cancelled = [
        event
        for event in events
        if event.get("run_id") == cancelled_run["run_id"] and event["type"] == "event.run.cancelled"
    ]
    assert cancelled
    assert cancelled[-1]["data"]["reason"] == "user_requested"


def test_oaep_auxiliary_tool_events_never_forge_item_identity_and_repair_old_rows(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, journal = runtime
    session, run = _session_and_run(engine, key="oaep-aux-tool-shape")
    engine.append_backend_event(
        run["run_id"],
        "tool.started",
        {"tool": "controlled-acceptance"},
        "oaep-aux-tool-started",
    )

    events = engine.list_oaep_events(session["session_id"])
    assert any(
        event["type"] == "event.session.updated"
        and event.get("run_id") == run["run_id"]
        and "item_id" not in event
        for event in events
    )
    assert all(
        event.get("run_id") and event.get("item_id")
        for event in events
        if event["type"].startswith("event.item.")
    )

    # Simulate the exact envelope written by builds before this normalization.
    candidate = next(
        event
        for event in events
        if event["type"] == "event.session.updated"
        and event.get("run_id") == run["run_id"]
        and "item_id" not in event
    )
    invalid = {**candidate, "type": "event.item.updated"}
    with sqlite3.connect(engine.database) as db:
        db.execute(
            "UPDATE runtime_oaep_events SET envelope_json=? WHERE event_id=?",
            (json.dumps(invalid, separators=(",", ":")), candidate["event_id"]),
        )

    repaired = {
        event["event_id"]: event
        for event in journal.replay_oaep(session["session_id"], after_sequence=0)
    }[candidate["event_id"]]
    assert repaired["type"] == "event.session.updated"
    assert "item_id" not in repaired


def test_oaep_stage2_user_input_preserves_source_and_safe_attachment_refs(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    secret = "token=OAEP_ATTACHMENT_SECRET_CANARY_12345"
    engine.set_run_input(
        run["run_id"],
        "message with attachment",
        attachment_refs=[
            "asset://attachment/image-1",
        rf"C:\Users\win11\Pictures\{secret}.png",
        ],
        correlation_id="corr-stage2-input",
        source_client="android",
        source_message_id="android-message-1",
    )

    snapshot = engine.oaep_snapshot(session["session_id"])
    serialized = json.dumps(snapshot, ensure_ascii=False)
    assert secret not in serialized
    assert "C:/Users/win11" not in serialized
    assert r"C:\Users\win11" not in serialized

    run_projection = next(item for item in snapshot["runs"] if item["id"] == run["run_id"])
    assert run_projection["correlation_id"] == "corr-stage2-input"
    assert run_projection["attachment_refs"] == [
        "asset://attachment/image-1",
        "token=[REDACTED]",
    ]

    user_item = next(item for item in snapshot["items"] if item["id"] == f"user:{run['run_id']}")
    assert user_item["source"]["client"] == "android"
    assert user_item["source"]["message_id"] == "android-message-1"
    assert user_item["content"]["text"] == "message with attachment"


def test_oaep_stage2_approval_interaction_exposes_safe_cross_device_contract(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.transition_run(run["run_id"], "running")
    secret = "OAEP_APPROVAL_SECRET_CANARY_12345"
    approval = engine.request_approval(
        run["run_id"],
        {
            "operation": "shell.execute",
            "risk_summary": "Run test command",
            "command": f"pytest --token={secret}",
            "options": [{"id": "approved", "label": "Allow"}],
            "credential": secret,
        },
        "2099-01-01T00:00:00+00:00",
    )
    engine.resolve_approval(
        approval["approval_id"],
        "approved",
        {"idempotency_key": "approval-stage2", "subject": "android-user"},
    )

    snapshot = engine.oaep_snapshot(session["session_id"])
    serialized = json.dumps(snapshot, ensure_ascii=False)
    assert secret not in serialized
    item = next(item for item in snapshot["items"] if item["id"] == f"approval:{approval['approval_id']}")
    assert item["type"] == "interaction"
    assert item["status"] == "completed"
    assert item["content"]["approval_id"] == approval["approval_id"]
    assert item["content"]["operation"] == "shell.execute"
    assert item["content"]["prompt"] == "Run test command"
    assert item["content"]["options"] == [{"id": "approved", "label": "Allow"}]
    assert item["content"]["request_summary"] == {
        "operation": "shell.execute",
        "risk_summary": "Run test command",
        "options": [{"id": "approved", "label": "Allow"}],
    }
    assert item["content"]["response"] == {"subject": "android-user"}

    events = engine.list_oaep_events(session["session_id"])
    run_event_types = [event["type"] for event in events if event.get("run_id") == run["run_id"]]
    assert "event.run.started" in run_event_types
    assert "event.run.waiting" in run_event_types
    assert "event.run.resumed" in run_event_types


def test_oaep_stage2_replay_carries_item_revision_stream_and_converges_to_snapshot(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.append_backend_event(
        run["run_id"],
        "agent.item.command.delta",
        {
            "backend_metadata": {"item_id": "cmd-1"},
            "delta": "first\n",
            "stream": "stdout",
        },
        "stage2-cmd-delta-1",
    )
    engine.append_backend_event(
        run["run_id"],
        "agent.item.command.delta",
        {
            "backend_metadata": {"item_id": "cmd-1"},
            "delta": "second\n",
            "stream": "stderr",
        },
        "stage2-cmd-delta-2",
    )
    engine.append_backend_event(
        run["run_id"],
        "agent.item.command",
        {
            "backend_metadata": {"item_id": "cmd-1"},
            "phase": "completed",
            "item": {
                "id": "cmd-1",
                "command": ["pytest", "-q"],
                "summary": "pytest -q",
                "exitCode": 0,
            },
        },
        "stage2-cmd-completed",
    )

    snapshot = engine.oaep_snapshot(session["session_id"])
    events = engine.list_oaep_events(session["session_id"])
    command = next(item for item in snapshot["items"] if item["id"] == f"codex:{run['run_id']}:cmd-1")
    item_events = [event for event in events if event.get("item_id") == command["id"]]

    assert [event["sequence"] for event in events] == sorted(event["sequence"] for event in events)
    assert [event["item_revision"] for event in item_events] == [1, 2, 3]
    assert item_events[0]["data"]["delta"] == {
        "kind": "command.output.append",
        "text": "first\n",
        "stream": "stdout",
    }
    assert item_events[1]["data"]["delta"] == {
        "kind": "command.output.append",
        "text": "second\n",
        "stream": "stderr",
    }
    assert item_events[-1]["type"] == "event.item.completed"
    assert item_events[-1]["data"]["item"] == command


def test_oaep_stage2_openai_chat_completion_projection_is_text_only(
    runtime: tuple[RuntimeEngine, RuntimeConversationJournal],
) -> None:
    engine, _ = runtime
    session, run = _session_and_run(engine)
    engine.append_backend_event(
        run["run_id"],
        "agent.message.delta",
        {"text": "hello "},
        "stage2-chat-delta-1",
    )
    engine.append_backend_event(
        run["run_id"],
        "agent.message.delta",
        {"text": "world"},
        "stage2-chat-delta-2",
    )
    engine.append_backend_event(
        run["run_id"],
        "tool.started",
        {"tool_id": "shell-1", "name": "shell", "args": {"cmd": "pwd"}},
        "stage2-chat-tool",
    )
    engine.append_backend_event(
        run["run_id"],
        "agent.completed",
        {},
        "stage2-chat-completed",
    )

    chunks = project_openai_chat_completion_chunks(
        engine.list_oaep_events(session["session_id"])
    )
    assert chunks == [
        {"choices": [{"delta": {"content": "hello "}}]},
        {"choices": [{"delta": {"content": "world"}}]},
        {"choices": [{"finish_reason": "stop", "delta": {}}]},
    ]
    assert "shell" not in json.dumps(chunks)
