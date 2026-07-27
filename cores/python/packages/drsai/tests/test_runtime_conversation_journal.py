from __future__ import annotations

import hashlib
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import (
    RuntimeConversationJournal,
    SessionCursorExpired,
)
from drsai.relay.models import ConversationSnapshot, SessionEvent


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
