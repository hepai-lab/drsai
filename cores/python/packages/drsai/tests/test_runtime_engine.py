from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import time

import pytest

_MODULE_PATH = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "runtime" / "engine.py"
_SPEC = importlib.util.spec_from_file_location("opendrsai_runtime_engine_test", _MODULE_PATH)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)
RuntimeEngine = _MODULE.RuntimeEngine
RuntimeEngineIdentity = _MODULE.RuntimeEngineIdentity


@pytest.fixture()
def engine(tmp_path: Path) -> RuntimeEngine:
    return RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-test", "instance-one"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
        lambda workspace_id: "worktree-two" if workspace_id == "workspace-two" else None,
    )


def test_session_lifecycle_pagination_and_workspace_binding(engine: RuntimeEngine) -> None:
    with pytest.raises(KeyError): engine.create_session("missing")
    with pytest.raises(KeyError): engine.list_sessions("missing")
    sessions = [engine.create_session("workspace-one", f"Session {index}") for index in range(3)]
    assert engine.list_sessions("workspace-one", limit=2)["total"] == 3
    renamed = engine.update_session(sessions[0]["session_id"], title="Renamed", archived=True)
    assert renamed["title"] == "Renamed" and renamed["archived"]
    assert engine.list_sessions("workspace-one")["total"] == 2
    assert engine.update_session(sessions[0]["session_id"], archived=False)["archived"] is False
    worktree_session = engine.create_session("workspace-two", "Derived execution")
    assert worktree_session["worktree_id"] == "worktree-two"
    run, _ = engine.create_run(worktree_session["session_id"], "codex@1", "worktree-run", "codex")
    assert run["workspace_id"] == "workspace-two" and run["worktree_id"] == "worktree-two"
    assert [record["run_id"] for record in engine.list_session_runs(worktree_session["session_id"])] == [run["run_id"]]
    with engine._connect() as db, pytest.raises(Exception):
        db.execute("UPDATE runtime_runs SET worktree_id=NULL WHERE run_id=?", (run["run_id"],))


def test_channel_session_binding_is_atomic_private_and_visible(engine: RuntimeEngine) -> None:
    def resolve(_: int):
        return engine.resolve_or_create_channel_session(
            "workspace-one",
            provider="wechat",
            account_fingerprint="wechat-account:opaque",
            provider_user_key="wechat-user:opaque",
            title_prefix="微信会话",
        )

    with ThreadPoolExecutor(max_workers=10) as pool:
        results = list(pool.map(resolve, range(10)))

    session_ids = {session["session_id"] for session, _created in results}
    assert len(session_ids) == 1
    assert sum(created for _session, created in results) == 1
    session = results[0][0]
    assert session["title"] == "微信会话 1"
    assert session["origin"]["kind"] == "channel"
    assert session["origin"]["provider"] == "wechat"
    assert engine.list_sessions("workspace-one")["data"][0]["session_id"] == session["session_id"]

    with engine._connect() as db:
        serialized = "\n".join(
            str(value)
            for table in ("runtime_sessions", "runtime_channel_bindings")
            for row in db.execute(f"SELECT * FROM {table}").fetchall()
            for value in row
        )
    assert "raw-wechat-user" not in serialized


def test_channel_inbound_reactivates_archived_session(engine: RuntimeEngine) -> None:
    session, _ = engine.resolve_or_create_channel_session(
        "workspace-one", provider="wechat", account_fingerprint="account",
        provider_user_key="user", title_prefix="微信会话",
    )
    engine.update_session(session["session_id"], archived=True)
    restored, created = engine.resolve_or_create_channel_session(
        "workspace-one", provider="wechat", account_fingerprint="account",
        provider_user_key="user", title_prefix="微信会话",
    )
    assert created is False
    assert restored["lifecycle"] == "active"


def test_explicit_channel_delivery_is_visible_idempotent_and_statused(engine: RuntimeEngine) -> None:
    session, _ = engine.resolve_or_create_channel_session(
        "workspace-one", provider="wechat", account_fingerprint="account",
        provider_user_key="user", title_prefix="微信会话",
    )
    pending, created = engine.begin_channel_delivery(
        session["session_id"], provider="wechat", idempotency_key="desktop-outbound-0001",
        text="explicit desktop reply",
    )
    repeated, repeated_created = engine.begin_channel_delivery(
        session["session_id"], provider="wechat", idempotency_key="desktop-outbound-0001",
        text="explicit desktop reply",
    )
    assert created is True and repeated_created is False
    assert pending["delivery_id"] == repeated["delivery_id"]
    sent = engine.complete_channel_delivery(pending["delivery_id"], status="sent")
    assert sent["status"] == "sent" and sent["attempt_count"] == 1
    item = engine.conversation_snapshot(session["session_id"])["items"][-1]
    assert item["payload"]["text"] == "explicit desktop reply"
    assert item["payload"]["author"] == "desktop"
    assert item["payload"]["channel_delivery"]["status"] == "sent"
    with pytest.raises(ValueError):
        engine.begin_channel_delivery(
            session["session_id"], provider="wechat", idempotency_key="desktop-outbound-0001",
            text="different reply",
        )


def test_channel_migration_audit_is_idempotent_and_contains_no_legacy_identity(engine: RuntimeEngine) -> None:
    first = engine.record_channel_migration(
        provider="wechat", source_version="wechat_sessions_v2",
        source_digest="a" * 64, record_count=2, status="unable_to_correlate",
    )
    repeated = engine.record_channel_migration(
        provider="wechat", source_version="wechat_sessions_v2",
        source_digest="a" * 64, record_count=2, status="unable_to_correlate",
    )
    assert first["migration_id"] == repeated["migration_id"]
    with engine._connect() as db:
        row = dict(db.execute("SELECT * FROM runtime_channel_migrations").fetchone())
    assert row["record_count"] == 2 and row["status"] == "unable_to_correlate"
    assert set(row) == {"migration_id", "provider", "source_version", "source_digest", "record_count", "status", "created_at"}


def test_interrupted_channel_delivery_recovers_as_unknown_without_resend(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    first = RuntimeEngine(
        database, RuntimeEngineIdentity("runtime-test", "instance-one"), lambda _: True,
    )
    session, _ = first.resolve_or_create_channel_session(
        "workspace-one", provider="wechat", account_fingerprint="account",
        provider_user_key="user", title_prefix="微信会话",
    )
    pending, _ = first.begin_channel_delivery(
        session["session_id"], provider="wechat", idempotency_key="restart-outbound-1",
        text="may have left the process",
    )
    restored = RuntimeEngine(
        database, RuntimeEngineIdentity("runtime-test", "instance-one"), lambda _: True,
    )
    delivery = restored.get_channel_delivery(pending["delivery_id"])
    assert delivery["status"] == "unknown"
    assert delivery["attempt_count"] == 1
    assert delivery["error_code"] == "runtime_restarted_during_delivery"
    item = restored.conversation_snapshot(session["session_id"])["items"][-1]
    assert item["payload"]["channel_delivery"]["status"] == "unknown"


def test_imported_desktop_session_preserves_identity_and_refreshes_metadata(engine: RuntimeEngine) -> None:
    first, created = engine.import_session(
        "thread-desktop", "workspace-one", "Desktop title",
        agent_definition="codex@1", backend_id="codex",
        created_at="2026-07-01T00:00:00Z", updated_at="2026-07-02T00:00:00Z",
    )
    refreshed, repeated = engine.import_session(
        "thread-desktop", "workspace-one", "Renamed title",
        agent_definition="codex@1", backend_id="codex",
        created_at="2026-07-01T00:00:00Z", updated_at="2026-07-03T00:00:00Z",
    )

    assert created is True
    assert repeated is False
    assert first["session_id"] == refreshed["session_id"] == "thread-desktop"
    assert refreshed["title"] == "Renamed title"
    assert refreshed["updated_at"] == "2026-07-03T00:00:00Z"
    before = engine.conversation_snapshot("thread-desktop")
    unchanged, repeated_again = engine.import_session(
        "thread-desktop", "workspace-one", "Renamed title",
        agent_definition="codex@1", backend_id="codex",
        created_at="2026-07-01T00:00:00Z", updated_at="2026-07-03T00:00:00Z",
    )
    after = engine.conversation_snapshot("thread-desktop")
    assert repeated_again is False
    assert unchanged["revision"] == refreshed["revision"]
    assert after["snapshot_sequence"] == before["snapshot_sequence"]


def test_import_timestamp_drift_and_repeated_updates_are_projection_noops(
    engine: RuntimeEngine,
) -> None:
    imported, _ = engine.import_session(
        "thread-noop", "workspace-one", "Stable title",
        agent_definition="codex@1", backend_id="codex",
        created_at="2026-07-01T00:00:00Z", updated_at="2026-07-02T00:00:00Z",
    )
    before = engine.conversation_snapshot("thread-noop")["snapshot_sequence"]
    timestamp_only, created = engine.import_session(
        "thread-noop", "workspace-one", "Stable title",
        agent_definition="codex@1", backend_id="codex",
        created_at="2026-07-01T00:00:00Z", updated_at="2026-08-04T00:00:00+00:00",
    )
    assert created is False
    assert timestamp_only["revision"] == imported["revision"]
    assert timestamp_only["updated_at"] == imported["updated_at"]
    assert engine.conversation_snapshot("thread-noop")["snapshot_sequence"] == before

    session = engine.create_session("workspace-one", "Original")
    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(
            lambda _: engine.update_session(session["session_id"], title="Renamed"),
            range(20),
        ))
    assert {item["revision"] for item in results} == {session["revision"] + 1}
    stable = engine.update_session(session["session_id"], title="Renamed")
    assert stable["revision"] == session["revision"] + 1
    assert engine.conversation_snapshot(session["session_id"])["snapshot_sequence"] == 2


def test_session_agent_binding_removed_tombstone_and_revision(engine: RuntimeEngine) -> None:
    session = engine.create_session(
        "workspace-one",
        "Bound",
        agent_definition="mobile@1",
        backend_id="opendrsai",
    )
    assert session["agent_definition"] == "mobile@1"
    assert session["backend_id"] == "opendrsai"
    removed = engine.remove_session(session["session_id"])
    assert removed["lifecycle"] == "removed"
    assert removed["revision"] == session["revision"] + 1
    assert engine.list_sessions("workspace-one")["data"] == []
    with pytest.raises(ValueError, match="terminal"):
        engine.update_session(session["session_id"], lifecycle="active")
    with pytest.raises(ValueError, match="active Session"):
        engine.create_run(session["session_id"], "mobile@1", "removed-session-run")
    imported, created = engine.import_session(
        session["session_id"],
        "workspace-one",
        "Should stay removed",
        agent_definition="mobile@1",
        backend_id="opendrsai",
    )
    assert created is False
    assert imported["lifecycle"] == "removed"


def test_run_state_idempotency_cancel_and_identity(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, created = engine.create_run(session["session_id"], "agent@v1", "same-key")
    repeated, repeated_created = engine.create_run(session["session_id"], "agent@v1", "same-key")
    assert created and not repeated_created and repeated["run_id"] == run["run_id"]
    assert engine.get_run_by_idempotency(session["session_id"], "same-key")["run_id"] == run["run_id"]
    other_session = engine.create_session("workspace-one", "Other Session")
    with pytest.raises(KeyError, match="idempotency result"):
        engine.get_run_by_idempotency(other_session["session_id"], "same-key")
    with pytest.raises(ValueError, match="Idempotency-Key"):
        engine.get_run_by_idempotency(session["session_id"], "bad\nkey")
    assert run["runtime_id"] == "runtime-test" and run["workspace_id"] == "workspace-one" and run["agent_definition"] == "agent@v1"
    assert run["backend_id"] == "opendrsai"
    with engine._connect() as db, pytest.raises(Exception):
        db.execute("UPDATE runtime_runs SET backend_id='codex' WHERE run_id=?", (run["run_id"],))
    with engine._connect() as db, pytest.raises(Exception):
        db.execute("UPDATE runtime_runs SET workspace_id='workspace-two' WHERE run_id=?", (run["run_id"],))
    with pytest.raises(ValueError):
        engine.create_run(session["session_id"], "other@v1", "same-key", "codex")
    with pytest.raises(ValueError): engine.transition_run(run["run_id"], "completed")
    assert engine.transition_run(run["run_id"], "running")["status"] == "running"
    assert engine.cancel_run(run["run_id"])["status"] == "cancelled"
    assert engine.cancel_run(run["run_id"])["status"] == "cancelled"


def test_one_hundred_concurrent_idempotent_run_creates_produce_one_run(engine: RuntimeEngine) -> None:
    session = engine.create_session(
        "workspace-one",
        agent_definition="agent@v1",
        backend_id="opendrsai",
    )

    def create(_: int):
        return engine.create_run(
            session["session_id"],
            "agent@v1",
            "one-hundred-same-key",
            "opendrsai",
        )

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(create, range(100)))
    run_ids = {record["run_id"] for record, _ in results}
    assert len(run_ids) == 1
    assert sum(created for _, created in results) == 1
    assert len(engine.list_session_runs(session["session_id"])) == 1


def test_twenty_concurrent_cancels_are_idempotent_and_isolated(engine: RuntimeEngine) -> None:
    first_session = engine.create_session("workspace-one")
    first, _ = engine.create_run(first_session["session_id"], "agent@v1", "cancel-first")
    engine.transition_run(first["run_id"], "running")
    second_session = engine.create_session("workspace-one")
    second, _ = engine.create_run(second_session["session_id"], "agent@v2", "cancel-second")
    engine.transition_run(second["run_id"], "running")

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _: engine.cancel_run(first["run_id"]), range(20)))
    assert {row["status"] for row in results} == {"cancelled"}
    assert engine.get_run(second["run_id"])["status"] == "running"
    event_types = [event["type"] for event in engine.list_events(first["run_id"])]
    assert event_types.count("run.cancel_requested") == 1
    assert event_types.count("run.cancelled") == 1


def test_active_workspace_resources_require_archived_sessions_and_terminal_runs(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one", "Worktree task")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "active-resource-key")
    resources = engine.active_workspace_resources("workspace-one")
    assert {(item["kind"], item["id"]) for item in resources} == {
        ("session", session["session_id"]), ("run", run["run_id"]),
    }
    engine.cancel_run(run["run_id"])
    assert [item["kind"] for item in engine.active_workspace_resources("workspace-one")] == ["session"]
    engine.update_session(session["session_id"], archived=True)
    assert engine.active_workspace_resources("workspace-one") == []


def test_append_only_concurrent_events_and_resume(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "events-key")
    with ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(lambda index: engine.append_event(run["run_id"], "tool.output", {"index": index}), range(100)))
    events = engine.list_events(run["run_id"])
    assert [event["sequence"] for event in events] == list(range(1, 102))
    assert engine.list_events(run["run_id"], after_sequence=80)[0]["sequence"] == 81
    with engine._connect() as db, pytest.raises(Exception): db.execute("UPDATE runtime_events SET event_type='bad'")
    with engine._connect() as db, pytest.raises(Exception): db.execute("DELETE FROM runtime_events")


def test_conversation_projection_uses_authoritative_input_and_stable_cursor(engine: RuntimeEngine) -> None:
    session = engine.create_session(
        "workspace-one",
        agent_definition="mobile@1",
        backend_id="opendrsai",
    )
    run, _ = engine.create_run(session["session_id"], "mobile@1", "conversation-key")
    engine.set_run_input(
        run["run_id"],
        "hello from Android",
        attachment_refs=["artifact-one"],
        correlation_id="correlation-one",
        input_resources=[{
            "protocol": "oaep.input/1", "resource_id": "selection-one", "kind": "selection",
            "name": "Selected text", "permission": "read", "status": "encoded", "content": "hello",
            "captured_at": "2026-08-05T00:00:00Z",
        }],
    )
    for index in range(650):
        engine.append_event(run["run_id"], "agent.message.delta", {"delta": str(index)})

    first = engine.list_conversation(session["session_id"], limit=500)
    second = engine.list_conversation(
        session["session_id"],
        cursor=first["next_cursor"],
        limit=500,
    )
    items = [*first["data"], *second["data"]]
    assert len(items) == 652
    assert len({item["item_id"] for item in items}) == len(items)
    assert [item["sequence"] for item in items] == list(range(1, len(items) + 1))
    assert items[0]["kind"] == "message.user"
    assert items[0]["payload"]["content"] == "hello from Android"
    assert second["next_cursor"] is None
    stored = engine.get_run(run["run_id"])
    assert stored["input_message"] == "hello from Android"
    assert stored["correlation_id"] == "correlation-one"
    assert stored["attachment_refs"] == ["artifact-one"]
    assert stored["input_resources"] == [{
        "protocol": "oaep.input/1", "resource_id": "selection-one", "kind": "selection",
        "name": "Selected text", "permission": "read", "status": "encoded", "content": "hello",
        "captured_at": "2026-08-05T00:00:00Z",
    }]


def test_native_user_file_reference_is_persisted_as_an_oaep_message_part(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one", backend_id="opendrsai")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "file-resource-key")
    digest = "a" * 64
    engine.set_run_input(run["run_id"], "请读这个文件", input_resources=[{
        "protocol": "oaep.input/1", "resource_id": "attachment-one", "kind": "file",
        "name": "方案.md", "permission": "read", "status": "encoded",
        "reference": "docs/方案.md", "mime": "text/markdown", "sha256": digest,
        "resource_ref": {
            "protocol": "owop/1", "workspace_id": "workspace-one",
            "resource_type": "file", "resource_id": "opaque-file-one",
            "label": "方案.md", "digest": f"sha256:{digest}",
            "relation": "input_attachment", "presentation": "inline",
        },
    }], input_parts=[
        {"type": "text", "text": "before "},
        {"type": "resource", "resource_id": "attachment-one"},
        {"type": "text", "text": " after"},
    ])

    snapshot = engine.oaep_snapshot(session["session_id"])
    user_item = next(
        item for item in snapshot["items"]
        if item.get("type") == "message" and item.get("content", {}).get("role") == "user"
    )
    resource_part = next(part for part in user_item["content"]["parts"] if part["type"] == "resource_ref")
    assert [part["type"] for part in user_item["content"]["parts"]] == ["text", "resource_ref", "text"]
    assert engine.get_run(run["run_id"])["input_parts"] == [
        {"type": "text", "text": "before "},
        {"type": "resource", "resource_id": "attachment-one"},
        {"type": "text", "text": " after"},
    ]
    assert resource_part["name"] == "方案.md"
    assert resource_part["resource_ref"] == {
        "protocol": "owop/1", "workspace_id": "workspace-one",
        "resource_type": "file", "resource_id": "opaque-file-one",
        "label": "方案.md", "digest": f"sha256:{digest}",
        "relation": "input_attachment", "presentation": "inline",
    }
    assert "C:\\" not in str(user_item)


def test_run_input_is_bound_once_and_idempotent_retries_do_not_revise_it(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "immutable-input-key")
    resource = {
        "protocol": "oaep.input/1", "resource_id": "selection-one", "kind": "selection",
        "name": "Selected text", "permission": "read", "status": "encoded", "content": "hello",
        "captured_at": "2026-08-05T00:00:00Z",
    }

    first = engine.set_run_input(
        run["run_id"], "original prompt", attachment_refs=["artifact-one"],
        input_resources=[resource], correlation_id="correlation-one",
        source_client="windows", source_message_id="message-one",
    )
    before = engine.conversation_snapshot(session["session_id"])
    manifest_before = engine.get_run_manifest(run["run_id"], safe=False)
    repeated = engine.set_run_input(
        run["run_id"], "original prompt", attachment_refs=["artifact-one"],
        input_resources=[resource], correlation_id="correlation-two",
        source_client="windows", source_message_id="message-two",
        evidence={"agent_config_snapshot": {"sha256": "sha256:changed-after-preflight"}},
    )
    after = engine.conversation_snapshot(session["session_id"])
    manifest_after = engine.get_run_manifest(run["run_id"], safe=False)

    assert repeated["input_message"] == first["input_message"] == "original prompt"
    assert repeated["correlation_id"] == "correlation-one"
    assert after["snapshot_sequence"] == before["snapshot_sequence"]
    assert manifest_after["manifest_digest"] == manifest_before["manifest_digest"]
    assert len([item for item in after["items"] if item["item_id"] == f"user:{run['run_id']}"]) == 1

    with pytest.raises(ValueError, match="input is immutable"):
        engine.set_run_input(run["run_id"], "changed prompt", attachment_refs=["artifact-one"])
    with pytest.raises(ValueError, match="input is immutable"):
        engine.set_run_input(
            run["run_id"], "original prompt", attachment_refs=["artifact-two"],
            input_resources=[resource],
        )


def test_agent_events_project_to_assistant_message_snapshot(engine: RuntimeEngine) -> None:
    session = engine.create_session(
        "workspace-one",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
    )
    run, _ = engine.create_run(session["session_id"], "opendrsai@1", "agent-projection-key")
    engine.append_event(run["run_id"], "agent.message.delta", {"delta": "hello "})
    engine.append_event(run["run_id"], "agent.message.delta", {"content": "world"})
    engine.append_event(run["run_id"], "agent.completed", {"content": "hello world"})

    snapshot = engine.conversation_snapshot(session["session_id"])
    assistant = next(item for item in snapshot["items"] if item["item_id"] == f"assistant:{run['run_id']}")
    assert assistant["kind"] == "message"
    assert assistant["role"] == "assistant"
    assert assistant["payload"]["text"] == "hello world"
    assert assistant["payload"]["status"] == "completed"


def test_reconcile_backfills_missing_agent_message_projection(engine: RuntimeEngine) -> None:
    session = engine.create_session(
        "workspace-one",
        agent_definition="opendrsai@1",
        backend_id="opendrsai",
    )
    run, _ = engine.create_run(session["session_id"], "opendrsai@1", "agent-backfill-key")
    with engine._connect() as db:
        db.execute(
            "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) "
            "VALUES(?,?,?,?,?,?,NULL)",
            ("legacy-agent-delta", run["run_id"], 2, "agent.message.delta", '{"delta":"restored "}', "2026-07-01T00:00:01Z"),
        )
        db.execute(
            "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) "
            "VALUES(?,?,?,?,?,?,NULL)",
            ("legacy-agent-completed", run["run_id"], 3, "agent.completed", '{"content":"restored answer"}', "2026-07-01T00:00:02Z"),
        )

    restored = RuntimeEngine(
        engine.database,
        RuntimeEngineIdentity("runtime-test", "instance-one"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
        lambda workspace_id: "worktree-two" if workspace_id == "workspace-two" else None,
    )

    snapshot = restored.conversation_snapshot(session["session_id"])
    assistant = next(item for item in snapshot["items"] if item["item_id"] == f"assistant:{run['run_id']}")
    assert assistant["payload"]["text"] == "restored answer"
    assert assistant["payload"]["status"] == "completed"


@pytest.mark.parametrize("legacy_version", ["v0", "v1"])
def test_legacy_desktop_agent_run_import_is_complete_and_idempotent(
    engine: RuntimeEngine, legacy_version: str,
) -> None:
    if legacy_version == "v0":
        events = [
            {"event": "chunk", "text": "legacy "},
            {"event_type": "chunk", "delta": "answer"},
            {"event": "status", "message": "working"},
            {"event": "file", "file_event": {"action": "modify", "path": "report.md"}},
            {"event": "completed"},
        ]
    else:
        events = [
            {"type": "chunk", "content": "legacy answer"},
            {"type": "plan_adjustment", "planAdjustment": {"reason": "new evidence", "replacementStepTitle": "Re-check"}},
            {"type": "file_event", "fileEvent": {"action": "artifact", "path": "result.pdf", "name": "Result"}},
            {"type": "done"},
        ]
    first = engine.import_legacy_desktop_agent_run(
        "workspace-one", f"thread-{legacy_version}", f"run-{legacy_version}", events,
        title=f"Legacy {legacy_version}", created_at="2026-07-01T00:00:00Z",
        updated_at="2026-07-01T00:00:05Z",
    )
    second = engine.import_legacy_desktop_agent_run(
        "workspace-one", f"thread-{legacy_version}", f"run-{legacy_version}", events,
        title=f"Legacy {legacy_version}", created_at="2026-07-01T00:00:00Z",
        updated_at="2026-07-01T00:00:05Z",
    )

    assert first["session_created"] is True and first["run_created"] is True
    assert second["session_created"] is False and second["run_created"] is False
    assert second["items_created"] == 0
    assert second["oaep_item_count"] == first["oaep_item_count"]
    snapshot = engine.oaep_snapshot(first["session_id"])
    items = snapshot["items"]
    assert len({item["id"] for item in items}) == len(items)
    message = next(item for item in items if item["type"] == "message")
    assert message["content"]["text"] == "legacy answer"
    assert message["status"] == "completed"
    if legacy_version == "v0":
        file_item = next(item for item in items if item["type"] == "file_change")
        assert file_item["content"]["changes"][0]["path"] == "report.md"
        assert any(item["type"] == "notice" for item in items)
    else:
        artifact = next(item for item in items if item["type"] == "artifact")
        assert artifact["content"]["path"] == "result.pdf"
        assert any(item["type"] == "plan" for item in items)
    run = engine.get_run(first["run_id"])
    assert run["status"] == "completed"
    assert run["backend_id"] == "opendrsai"


def test_reconcile_does_not_resurrect_compacted_runtime_events(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "compaction-restart")
    compacted_event = engine.append_event(
        run["run_id"], "tool.started", {"tool": "read"}
    )
    checkpoint = engine.conversation_journal.checkpoint(session["session_id"])
    engine.conversation_journal.compact(
        session["session_id"], through_sequence=checkpoint["checkpoint_sequence"]
    )
    with engine._connect() as db:
        before = int(db.execute(
            "SELECT COUNT(*) FROM runtime_session_journal WHERE session_id=?",
            (session["session_id"],),
        ).fetchone()[0])
        assert db.execute(
            "SELECT 1 FROM runtime_session_journal_compacted_runtime_events "
            "WHERE runtime_event_id=?",
            (compacted_event["event_id"],),
        ).fetchone() is not None

    restored = RuntimeEngine(
        engine.database,
        RuntimeEngineIdentity("runtime-test", "instance-one"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
        lambda workspace_id: "worktree-two" if workspace_id == "workspace-two" else None,
    )
    with restored._connect() as db:
        after = int(db.execute(
            "SELECT COUNT(*) FROM runtime_session_journal WHERE session_id=?",
            (session["session_id"],),
        ).fetchone()[0])
    assert after == before

    new_event = restored.append_event(run["run_id"], "tool.completed", {"ok": True})
    with restored._connect() as db:
        assert db.execute(
            "SELECT 1 FROM runtime_session_journal WHERE dedupe_key=?",
            (f"runtime-event:{new_event['event_id']}",),
        ).fetchone() is not None


@pytest.mark.parametrize("decision,expected", [("approved", "running"), ("denied", "cancelled"), ("timeout", "failed")])
def test_approval_paths(engine: RuntimeEngine, decision: str, expected: str) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", f"approval-{decision}")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"})
    engine.resolve_approval(approval["approval_id"], decision)
    assert engine.get_run(run["run_id"])["status"] == expected


def test_approval_response_loss_replays_same_persisted_decision_without_new_event(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "approval-response-loss")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"})
    detail = {"subject": "android", "idempotency_key": "stable-approval-response-loss"}

    first = engine.resolve_approval(approval["approval_id"], "approved", detail)
    replay = engine.resolve_approval(approval["approval_id"], "approved", detail)

    assert replay == first
    decision_events = [
        event for event in engine.list_events(run["run_id"])
        if event["type"] == "approval.approved"
    ]
    assert len(decision_events) == 1
    with pytest.raises(ValueError):
        engine.resolve_approval(
            approval["approval_id"],
            "denied",
            {"subject": "android", "idempotency_key": "another-key"},
        )


def test_runtime_persistence_redacts_secret_canaries_but_keeps_normal_content(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "secret-persistence")
    engine.set_run_input(
        run["run_id"],
        "please continue token=DRS_RUNTIME_TOKEN_CANARY_8f17 normal text",
    )
    engine.append_event(
        run["run_id"],
        "tool.started",
        {
            "arguments": "curl -H 'Authorization: Bearer DRS_COMMAND_CANARY_2bd9' https://example.test",
            "summary": "normal summary",
        },
    )
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(
        run["run_id"],
        {
            "command": "password=DRS_APPROVAL_CANARY_57ac",
            "summary": "normal approval",
        },
    )
    checkpoint = engine.save_checkpoint(
        run["run_id"],
        {
            "next_tool": {
                "command": "echo DRS_CHECKPOINT_CANARY_9c31",
                "display_name": "normal checkpoint",
            }
        },
    )

    persisted = engine.database.read_bytes()
    for canary in (
        b"DRS_RUNTIME_TOKEN_CANARY_8f17",
        b"DRS_COMMAND_CANARY_2bd9",
        b"DRS_APPROVAL_CANARY_57ac",
        b"DRS_CHECKPOINT_CANARY_9c31",
    ):
        assert canary not in persisted
    assert engine.get_run(run["run_id"])["input_message"] == (
        "please continue token=[REDACTED] normal text"
    )
    tool_event = next(
        item for item in engine.list_events(run["run_id"]) if item["type"] == "tool.started"
    )
    assert tool_event["data"]["summary"] == "normal summary"
    assert engine.get_approval(approval["approval_id"])["request"]["summary"] == "normal approval"
    assert engine.latest_checkpoint(run["run_id"]) == checkpoint


def test_runtime_persistence_redacts_cookie_and_url_userinfo_canaries(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "secret-url-persistence")
    engine.append_event(run["run_id"], "tool.completed", {
        "header": "Cookie: session=P3_COOKIE_PERSISTENCE_CANARY",
        "url": "https://user:P3_URL_PERSISTENCE_CANARY@example.test/path",
    })
    persisted = engine.database.read_bytes()
    assert b"P3_COOKIE_PERSISTENCE_CANARY" not in persisted
    assert b"P3_URL_PERSISTENCE_CANARY" not in persisted


def test_pending_approval_query_atomically_expires_elapsed_deadline(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "approval-expired")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"}, "2000-01-01T00:00:00+00:00")

    assert engine.list_pending_approvals(run["run_id"]) == []
    assert engine.get_approval(approval["approval_id"])["status"] == "expired"
    assert engine.get_run(run["run_id"])["status"] == "failed"


def test_concurrent_approval_decisions_have_one_atomic_winner(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "approval-race")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"})

    def decide(index: int):
        decision = "approved" if index % 2 == 0 else "denied"
        try:
            return ("success", decision, engine.resolve_approval(
                approval["approval_id"],
                decision,
                {"client": index},
            ))
        except ValueError:
            return ("conflict", decision, None)

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(decide, range(20)))
    winners = [result for result in results if result[0] == "success"]
    assert len(winners) == 1
    stored = engine.get_approval(approval["approval_id"])
    assert stored["status"] == winners[0][1]
    expected_status = "running" if stored["status"] == "approved" else "cancelled"
    assert engine.get_run(run["run_id"])["status"] == expected_status
    decision_events = [
        event for event in engine.list_events(run["run_id"])
        if event["type"] in {"approval.approved", "approval.denied"}
    ]
    assert len(decision_events) == 1


def test_sixty_four_way_approval_cancel_race_has_one_terminal_projection(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "approval-cancel-race")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"operation": "tool:write"})

    def race(index: int) -> str:
        try:
            if index % 3 == 0:
                return engine.resolve_approval(approval["approval_id"], "approved")["status"]
            if index % 3 == 1:
                return engine.resolve_approval(approval["approval_id"], "denied")["status"]
            return engine.cancel_run(run["run_id"])["status"]
        except ValueError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=64) as pool:
        results = list(pool.map(race, range(64)))
    assert len(results) == 64
    assert engine.get_run(run["run_id"])["status"] == "cancelled"
    stored = engine.get_approval(approval["approval_id"])
    assert stored["status"] in {"approved", "denied"}
    assert engine.get_side_effect(approval["approval_id"])["status"] == "rejected"
    events = engine.list_events(run["run_id"])
    assert len([event for event in events if event["type"].startswith("approval.") and event["type"] != "approval.requested"]) == 1
    assert len([event for event in events if event["type"] == "run.cancelled"]) == 1
    item = next(
        item for item in engine.conversation_snapshot(session["session_id"])["items"]
        if item["item_id"] == f"approval:{approval['approval_id']}"
    )
    assert item["payload"]["status"] == stored["status"]


def test_approved_side_effect_claim_and_cancel_race_executes_at_most_once(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "claim-cancel-race")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"operation": "tool:write"})
    engine.resolve_approval(approval["approval_id"], "approved")

    def race(index: int) -> str:
        try:
            if index % 2 == 0:
                return engine.claim_side_effect(
                    approval["approval_id"], run["run_id"], "tool:write",
                )["status"]
            return engine.cancel_run(run["run_id"])["status"]
        except ValueError:
            return "conflict"

    with ThreadPoolExecutor(max_workers=64) as pool:
        results = list(pool.map(race, range(64)))
    assert results.count("executing") <= 1
    effect = engine.get_side_effect(approval["approval_id"])
    if effect["status"] == "executing":
        effect = engine.complete_side_effect(approval["approval_id"], {"ok": True})
    assert effect["status"] in {"completed", "rejected"}
    assert engine.get_run(run["run_id"])["status"] == "cancelled"


def test_side_effect_digest_uses_raw_request_and_revalidates_actual_request(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "raw-request-binding")
    engine.transition_run(run["run_id"], "running")
    requested = {
        "operation": "tool:write",
        "command": "deploy alpha",
        "arguments": {"token": "secret-a"},
    }
    changed = {
        "operation": "tool:write",
        "command": "deploy beta",
        "arguments": {"token": "secret-b"},
    }
    approval = engine.request_approval(run["run_id"], requested)
    proposal = engine.get_action_proposal(approval["approval_id"])
    assert proposal.run_id == run["run_id"]
    assert proposal.operation == "tool:write"
    assert proposal.matches_payload(requested)
    assert "secret-a" not in str(proposal.display_payload)
    first_digest = engine.get_side_effect(approval["approval_id"])["request_digest"]
    assert "secret-a" not in str(approval)
    engine.resolve_approval(approval["approval_id"], "approved")

    with pytest.raises(ValueError, match="differs from the approved proposal"):
        engine.claim_side_effect(
            approval["approval_id"], run["run_id"], "tool:write", actual_request=changed,
        )
    claimed = engine.claim_side_effect(
        approval["approval_id"], run["run_id"], "tool:write", actual_request=requested,
    )
    assert claimed["status"] == "executing"

    second_run, _ = engine.create_run(session["session_id"], "agent@v1", "raw-request-binding-2")
    engine.transition_run(second_run["run_id"], "running")
    second = engine.request_approval(second_run["run_id"], changed)
    assert engine.get_side_effect(second["approval_id"])["request_digest"] != first_digest


def test_run_security_profile_is_durable_and_monotonic(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "security-profile")
    first = ResolvedCapabilityProfile(
        profile_id="manual-safe",
        version=1,
        workspace_root="C:/workspace",
        capabilities=frozenset({"file.read"}),
    )
    bound = engine.bind_run_security_profile(run["run_id"], first, reason="run.created")
    assert bound == first
    assert engine.get_run_security_profile(run["run_id"]) == first


def test_runtime_security_metrics_snapshot_is_internal_and_low_cardinality(engine: RuntimeEngine) -> None:
    engine.security_metrics.journal.append(
        "hard_deny.blocked", "proposal-private-id",
        {"category": "host_persistence", "run_id": "run-private-id", "operation": "private-command"},
        now=100,
    )
    snapshot = engine.security_metrics_snapshot()
    assert {
        "name": "security_hard_deny_total",
        "labels": {"category": "host_persistence"},
        "value": 1,
    } in snapshot
    serialized = str(snapshot)
    assert "private-id" not in serialized
    assert "private-command" not in serialized


def test_runtime_permission_mode_path_is_internal_and_does_not_change_run_state(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy,
        DEVELOPMENT_CAPABILITIES,
        ModeSelection,
        PlatformBoundary,
        WorkspaceContext,
    )

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "permission-mode-internal")
    engine.transition_run(run["run_id"], "running")
    result = engine.apply_permission_mode(
        run["run_id"], ModeSelection("manual_safe", "user", False),
        administrator=AdministratorPolicy(
            "organization-default", 1, True,
            capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True),
    )
    assert result.effective.mode.mode_id == "manual_safe"
    assert engine.effective_permission_descriptor(run["run_id"]) == result.effective.as_descriptor()
    assert engine.get_run(run["run_id"])["status"] == "running"
    assert {item["mode_id"] for item in engine.permission_mode_descriptors()} == {
        "manual_safe", "auto_reviewed", "isolated_full_access",
    }


def test_desktop_security_binding_is_runtime_owned_and_revalidated(engine: RuntimeEngine) -> None:
    from dataclasses import replace

    from drsai.backend.runtime.agent import RuntimeRunContext
    from drsai.backend.runtime.desktop_security_binding import (
        DesktopSecurityBindingError,
        create_desktop_security_execution_binding,
        validate_desktop_authorization_grant,
        validate_desktop_security_execution_binding,
    )
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
        PlatformBoundary, WorkspaceContext,
    )

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "desktop-binding")
    engine.transition_run(run["run_id"], "running")
    engine.apply_permission_mode(
        run["run_id"], ModeSelection("manual_safe", "user", False),
        administrator=AdministratorPolicy(
            "organization-default", 1, True,
            capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True),
    )
    context = RuntimeRunContext(
        "runtime-test", "instance-one", "workspace-one", Path("C:/workspace"),
        session["session_id"], run["run_id"], "agent", "v1",
    )
    binding = create_desktop_security_execution_binding(engine, context, now=100)

    assert binding.runtime_run_id == run["run_id"]
    assert binding.profile.digest == engine.get_run_security_profile(run["run_id"]).digest
    assert binding.mode_id == "manual_safe" and binding.reviewer_route == "human"
    validate_desktop_security_execution_binding(
        binding, expected_session_id=session["session_id"],
        expected_workspace_root="C:/workspace",
    )
    with pytest.raises(DesktopSecurityBindingError) as tampered:
        validate_desktop_security_execution_binding(
            replace(binding, workspace_id="workspace-two"),
            expected_session_id=session["session_id"], expected_workspace_root="C:/workspace",
        )
    assert tampered.value.code == "desktop_security_binding_tampered"
    with pytest.raises(DesktopSecurityBindingError) as wrong_session:
        validate_desktop_security_execution_binding(
            binding, expected_session_id="another-session", expected_workspace_root="C:/workspace",
        )
    assert wrong_session.value.code == "desktop_security_session_mismatch"
    from drsai.backend.runtime.security_boundary import ActionProposal, AuthorizationGrantStore
    unreviewed = AuthorizationGrantStore(engine.database).issue(
        ActionProposal.create(
            proposal_id="proposal-unreviewed", run_id=run["run_id"], operation="file.read",
            payload={"relative_path": "notes.txt", "max_bytes": 10}, risk="read",
            required_capabilities=("filesystem.read",),
        ),
        binding.profile,
    )
    with pytest.raises(DesktopSecurityBindingError) as untrusted_grant:
        validate_desktop_authorization_grant(
            binding, grant_id=unreviewed.grant_id, proposal_id="proposal-unreviewed",
        )
    assert untrusted_grant.value.code == "desktop_workspace_grant_scope_mismatch"
    engine.apply_permission_mode(
        run["run_id"], ModeSelection("auto_reviewed", "user", True),
        administrator=AdministratorPolicy(
            "organization-default", 1, True,
            capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True),
    )
    with pytest.raises(DesktopSecurityBindingError) as stale:
        validate_desktop_security_execution_binding(
            binding, expected_session_id=session["session_id"],
            expected_workspace_root="C:/workspace",
        )
    assert stale.value.code == "desktop_security_binding_stale"


def test_auto_reviewed_desktop_grants_accept_direct_auto_and_proven_human_escalation(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.agent import RuntimeRunContext
    from drsai.backend.runtime.desktop_security_binding import (
        create_desktop_security_execution_binding,
        validate_desktop_authorization_grant,
    )
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
        PlatformBoundary, WorkspaceContext,
    )
    from drsai.backend.runtime.security_boundary import ActionProposal

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "auto-binding")
    engine.transition_run(run["run_id"], "running")
    engine.apply_permission_mode(
        run["run_id"], ModeSelection(
            "auto_reviewed", "user", False,
            requested_capabilities=frozenset({"filesystem.write"}),
        ),
        administrator=AdministratorPolicy(
            "organization-default", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True),
    )
    binding = create_desktop_security_execution_binding(
        engine,
        RuntimeRunContext(
            "runtime", "instance", "workspace-one", Path("C:/workspace"),
            session["session_id"], run["run_id"], "agent", "v1",
        ),
    )

    direct = ActionProposal.create(
        proposal_id="proposal-auto-direct", run_id=run["run_id"], operation="file.write",
        payload={
            "relative_path": "notes.txt", "content_digest": "sha256:direct", "size_bytes": 6,
        },
        risk="write", required_capabilities=("filesystem.write",),
    )
    direct_route = engine.route_auto_authorization_review(
        direct, binding.profile, idempotency_key="auto-direct",
    )
    assert direct_route.route == "approved"
    direct_grant = engine.issue_authorization_grant(
        direct_route.request_id, binding.profile, review_requirement="auto",
    )
    validate_desktop_authorization_grant(
        binding, grant_id=direct_grant.grant_id, proposal_id=direct.proposal_id,
    )

    escalated = ActionProposal.create(
        proposal_id="proposal-auto-escalated", run_id=run["run_id"], operation="file.write",
        payload={
            "relative_path": "release.txt", "content_digest": "sha256:release", "size_bytes": 7,
        },
        risk="write", required_capabilities=("filesystem.write",),
        effect_categories=("production_target",),
    )
    escalated_route = engine.route_auto_authorization_review(
        escalated, binding.profile, idempotency_key="auto-escalated",
    )
    assert escalated_route.route == "escalated" and escalated_route.human_request is not None
    engine.decide_authorization_review(
        escalated_route.human_request.request_id, "approved", reviewer_kind="human",
        reviewer_id="test-user", reason_code="approved_escalation",
        idempotency_key="auto-escalated-human",
    )
    escalated_grant = engine.issue_authorization_grant(
        escalated_route.human_request.request_id, binding.profile, review_requirement="human",
    )
    validate_desktop_authorization_grant(
        binding, grant_id=escalated_grant.grant_id, proposal_id=escalated.proposal_id,
    )


def test_auto_decision_cannot_cross_mode_transition_or_kill_switch_into_effect(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.authorization import GrantServiceError
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
        PlatformBoundary, WorkspaceContext,
    )
    from drsai.backend.runtime.security_boundary import ActionProposal, AuthorizationGrantStore
    from drsai.backend.runtime.security_boundary.filesystem_execution import AuthorizedFilesystemExecutionService

    administrator = AdministratorPolicy(
        "organization-default", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
    )
    platform = PlatformBoundary(DEVELOPMENT_CAPABILITIES)
    workspace = WorkspaceContext("C:/workspace", True)

    class NoWriteFilesystem:
        root = Path("C:/workspace")

        def __init__(self):
            self.writes: list[tuple[str, bytes]] = []

        def atomic_write(self, relative: str, content: bytes) -> None:
            self.writes.append((relative, content))

    def create_auto_run(label: str):
        session = engine.create_session("workspace-one")
        run, _ = engine.create_run(session["session_id"], "agent@v1", label)
        engine.transition_run(run["run_id"], "running")
        transition = engine.apply_permission_mode(
            run["run_id"], ModeSelection(
                "auto_reviewed", "user", False,
                requested_capabilities=frozenset({"filesystem.write"}),
            ), administrator=administrator, platform=platform, workspace=workspace,
        )
        action = ActionProposal.create(
            proposal_id=f"proposal-{label}", run_id=run["run_id"], operation="file.write",
            payload={
                "relative_path": f"{label}.txt",
                "content_digest": "sha256:" + hashlib.sha256(b"content").hexdigest(),
                "size_bytes": 7,
            }, risk="write", required_capabilities=("filesystem.write",),
        )
        route = engine.route_auto_authorization_review(
            action, transition.effective.capability_profile, idempotency_key=label,
        )
        assert route.route == "approved"
        return run, transition.effective.capability_profile, action, route

    run_before_grant, old_profile, action_before_grant, route_before_grant = create_auto_run("before-grant")
    engine.apply_permission_mode(
        run_before_grant["run_id"], ModeSelection("manual_safe", "user", False),
        administrator=administrator, platform=platform, workspace=workspace,
    )
    with pytest.raises((GrantServiceError, ValueError)):
        engine.issue_authorization_grant(
            route_before_grant.request_id, old_profile, review_requirement="auto",
        )
    assert engine.authorization_grants.get_for_request(route_before_grant.request_id) is None

    run_after_grant, transition_profile, action_after_grant, route_after_grant = create_auto_run("after-grant")
    transition_grant = engine.issue_authorization_grant(
        route_after_grant.request_id, transition_profile, review_requirement="auto",
    )
    engine.apply_permission_mode(
        run_after_grant["run_id"], ModeSelection("manual_safe", "user", False),
        administrator=administrator, platform=platform, workspace=workspace,
    )
    transition_filesystem = NoWriteFilesystem()
    with pytest.raises(Exception) as revoked:
        AuthorizedFilesystemExecutionService(
            transition_filesystem, AuthorizationGrantStore(engine.database),
        ).write(
            grant_id=transition_grant.grant_id, proposal=action_after_grant,
            profile=transition_profile, relative_path="after-grant.txt", content=b"content",
            execution_id="auto-effect-after-mode-transition",
        )
    assert getattr(revoked.value, "code", "") == "grant_revoked"
    assert transition_filesystem.writes == []

    run_before_effect, effect_profile, action_before_effect, route_before_effect = create_auto_run("before-effect")
    grant = engine.issue_authorization_grant(
        route_before_effect.request_id, effect_profile, review_requirement="auto",
    )
    switched = engine.set_permission_kill_switch(
        "auto_reviewer", active=True, reason_code="test_incident",
    )
    assert switched.revoked_grants >= 1

    filesystem = NoWriteFilesystem()
    service = AuthorizedFilesystemExecutionService(
        filesystem, AuthorizationGrantStore(engine.database),
    )
    with pytest.raises(Exception) as blocked:
        service.write(
            grant_id=grant.grant_id, proposal=action_before_effect,
            profile=effect_profile, relative_path="before-effect.txt", content=b"content",
            execution_id="auto-effect-after-kill-switch",
        )
    assert getattr(blocked.value, "code", "") in {
        "permission_kill_switch_active", "grant_revoked",
    }
    assert filesystem.writes == []


def test_isolated_full_desktop_binding_requires_live_scoped_attestation(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.agent import RuntimeRunContext
    from drsai.backend.runtime.desktop_security_binding import (
        DesktopSecurityBindingError,
        create_desktop_security_execution_binding,
        validate_desktop_security_execution_binding,
    )
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
        PlatformBoundary, WorkspaceContext,
    )
    from drsai.backend.runtime.security_boundary import IsolationAttestation

    now = time.time()
    isolation = IsolationAttestation(
        "windows-appcontainer-session", "1", "windows", now - 1, now + 60,
        frozenset({
            "non_admin_identity", "process_tree_controlled",
            "filesystem_enforced", "environment_sanitized",
        }),
        "sha256:runtime-isolation-evidence",
    )
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "isolated-binding")
    engine.transition_run(run["run_id"], "running")
    transition = engine.apply_permission_mode(
        run["run_id"], ModeSelection("isolated_full_access", "user", True),
        administrator=AdministratorPolicy(
            "organization-default", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES, isolation_attestation=isolation),
        workspace=WorkspaceContext("C:/workspace", True),
    )
    binding = create_desktop_security_execution_binding(
        engine,
        RuntimeRunContext(
            "runtime", "instance", "workspace-one", Path("C:/workspace"),
            session["session_id"], run["run_id"], "agent", "v1",
        ),
    )
    assert binding.reviewer_route == "none"
    assert binding.isolation_attestation_digest == isolation.evidence_digest
    validate_desktop_security_execution_binding(
        binding, expected_session_id=session["session_id"],
        expected_workspace_root="C:/workspace",
    )

    lease = engine.assert_isolated_full_access_authority(
        run["run_id"], workspace_root="C:/workspace",
        profile_digest=transition.effective.capability_profile.digest,
        attestation_digest=isolation.evidence_digest,
    )
    assert lease.run_id == run["run_id"]
    assert engine.revoke_isolated_full_access_authority(
        run["run_id"], reason_code="worker_exited",
    ) == 1
    with pytest.raises(DesktopSecurityBindingError) as revoked:
        validate_desktop_security_execution_binding(
            binding, expected_session_id=session["session_id"],
            expected_workspace_root="C:/workspace",
        )
    assert revoked.value.code == "isolation_lease_revoked"
    assert transition.effective.isolation_attestation_digest == isolation.evidence_digest


def test_runtime_owns_windows_isolated_session_authority_revoker(
    engine: RuntimeEngine, monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(
        engine,
        "revoke_isolated_full_access_authority",
        lambda run_id, *, reason_code: calls.append((run_id, reason_code)) or 1,
    )
    service = engine.create_windows_isolated_execution_session_service()
    assert service.authority_revoker is not None
    assert service.authority_revoker("run-one", "worker_terminal") == 1
    assert calls == [("run-one", "worker_terminal")]
    with pytest.raises(ValueError, match="owns the isolation authority revoker"):
        engine.create_windows_isolated_execution_session_service(
            authority_revoker=lambda _run_id, _reason: 0,
        )


def test_runtime_isolated_effect_executor_requires_explicit_packaged_worker(
    engine: RuntimeEngine, tmp_path: Path,
) -> None:
    from drsai.backend.runtime.security_boundary import (
        AuthenticodeEvidence, IsolatedWorkerArtifactError, canonical_digest,
    )

    with pytest.raises(IsolatedWorkerArtifactError) as missing:
        engine.create_isolated_effect_execution_service(
            artifact_manifest=tmp_path / "missing.json",
            expected_manifest_digest="sha256:" + "0" * 64,
            trusted_publisher_subjects=("CN=OpenDrSai Security Publisher",),
        )
    assert missing.value.code == "isolated_worker_manifest_missing"
    worker = tmp_path / "isolated-effect-worker.exe"
    worker.write_bytes(b"packaged-worker")
    worker_digest = "sha256:" + hashlib.sha256(worker.read_bytes()).hexdigest()
    manifest = {
        "schema_version": "isolated-effect-worker-manifest/1",
        "protocol_version": "isolated-effect/1",
        "receipt_version": "isolated-effect-receipt/1",
        "platform": "windows-x64",
        "worker_version": "1.0.0",
        "executable": worker.name,
        "sha256": worker_digest,
    }
    manifest_path = tmp_path / "isolated-effect-worker.manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    service = engine.create_isolated_effect_execution_service(
        artifact_manifest=manifest_path,
        expected_manifest_digest=canonical_digest(manifest),
        trusted_publisher_subjects=("CN=OpenDrSai Security Publisher",),
        signature_verifier=lambda _path: AuthenticodeEvidence(
            "Valid", "CN=OpenDrSai Security Publisher", "A" * 40,
        ),
    )
    assert service.worker_argv_prefix == (str(worker),)
    assert service.expected_worker_sha256 == worker_digest
    assert service.sessions.authority_revoker is not None


def test_isolated_mode_binding_and_lease_commit_atomically_and_recover_after_crash(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
        ModeTransitionInterrupted, PlatformBoundary, WorkspaceContext,
    )
    from drsai.backend.runtime.security_boundary import IsolationAttestation

    now = time.time()
    attestation = IsolationAttestation(
        "windows-appcontainer-session", "1", "windows", now - 1, now + 300,
        frozenset({
            "non_admin_identity", "process_tree_controlled",
            "filesystem_enforced", "environment_sanitized",
        }),
        "sha256:atomic-mode-lease",
    )
    administrator = AdministratorPolicy(
        "organization-default", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
    )
    platform = PlatformBoundary(DEVELOPMENT_CAPABILITIES, isolation_attestation=attestation)
    workspace = WorkspaceContext("C:/workspace", True)
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "atomic-isolation")
    engine.transition_run(run["run_id"], "running")

    with pytest.raises(ModeTransitionInterrupted, match="authority_staged"):
        engine.apply_permission_mode(
            run["run_id"], ModeSelection("isolated_full_access", "user", True),
            administrator=administrator, platform=platform, workspace=workspace,
            fault_after="authority_staged",
        )
    assert engine.effective_permission_descriptor(run["run_id"]) is None
    with engine._connect() as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_isolation_attestation_leases WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()[0] == 0
        transition = db.execute(
            "SELECT status FROM runtime_permission_mode_transitions WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()
    assert transition[0] == "profile_bound"

    recovered = engine.apply_permission_mode(
        run["run_id"], ModeSelection("isolated_full_access", "user", True),
        administrator=administrator, platform=platform, workspace=workspace,
    )
    descriptor = engine.effective_permission_descriptor(run["run_id"])
    assert descriptor is not None and descriptor["mode_id"] == "isolated_full_access"
    lease = engine.assert_isolated_full_access_authority(
        run["run_id"], workspace_root="C:/workspace",
        profile_digest=recovered.effective.capability_profile.digest,
        attestation_digest=attestation.evidence_digest,
    )
    assert lease.status == "active"
    rebound = engine.apply_permission_mode(
        run["run_id"], ModeSelection("isolated_full_access", "user", True),
        administrator=administrator, platform=platform, workspace=workspace,
    )
    with pytest.raises(Exception) as old_scope:
        engine.assert_isolated_full_access_authority(
            run["run_id"], workspace_root="C:/workspace",
            profile_digest=recovered.effective.capability_profile.digest,
            attestation_digest=attestation.evidence_digest,
        )
    assert getattr(old_scope.value, "code", "") == "isolation_lease_revoked"
    assert engine.assert_isolated_full_access_authority(
        run["run_id"], workspace_root="C:/workspace",
        profile_digest=rebound.effective.capability_profile.digest,
        attestation_digest=attestation.evidence_digest,
    ).status == "active"


def test_failed_atomic_downgrade_cannot_leave_old_full_binding_usable(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.permission_modes import (
        AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
        ModeTransitionInterrupted, PlatformBoundary, WorkspaceContext,
    )
    from drsai.backend.runtime.security_boundary import IsolationAttestation, SandboxError
    from drsai.backend.runtime.agent import RuntimeRunContext
    from drsai.backend.runtime.desktop_security_binding import (
        DesktopSecurityBindingError,
        create_desktop_security_execution_binding,
        validate_desktop_security_execution_binding,
    )

    now = time.time()
    attestation = IsolationAttestation(
        "windows-appcontainer-session", "1", "windows", now - 1, now + 300,
        frozenset({
            "non_admin_identity", "process_tree_controlled",
            "filesystem_enforced", "environment_sanitized",
        }),
        "sha256:atomic-downgrade",
    )
    administrator = AdministratorPolicy(
        "organization-default", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
    )
    workspace = WorkspaceContext("C:/workspace", True)
    full_platform = PlatformBoundary(DEVELOPMENT_CAPABILITIES, isolation_attestation=attestation)
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "atomic-downgrade")
    engine.transition_run(run["run_id"], "running")
    full = engine.apply_permission_mode(
        run["run_id"], ModeSelection("isolated_full_access", "user", True),
        administrator=administrator, platform=full_platform, workspace=workspace,
    )
    binding = create_desktop_security_execution_binding(
        engine,
        RuntimeRunContext(
            "runtime", "instance", "workspace-one", Path("C:/workspace"),
            session["session_id"], run["run_id"], "agent", "v1",
        ),
    )
    with pytest.raises(ModeTransitionInterrupted, match="authority_staged"):
        engine.apply_permission_mode(
            run["run_id"], ModeSelection("manual_safe", "user", False),
            administrator=administrator,
            platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES), workspace=workspace,
            fault_after="authority_staged",
        )
    with pytest.raises(ValueError, match="descriptor and active Profile disagree"):
        engine.effective_permission_profile(run["run_id"])
    with pytest.raises(DesktopSecurityBindingError) as stale:
        validate_desktop_security_execution_binding(
            binding, expected_session_id=session["session_id"],
            expected_workspace_root="C:/workspace",
        )
    assert stale.value.code == "desktop_security_binding_stale"
    assert engine.assert_isolated_full_access_authority(
        run["run_id"], workspace_root="C:/workspace",
        profile_digest=full.effective.capability_profile.digest,
        attestation_digest=attestation.evidence_digest,
    ).status == "active"

    engine.apply_permission_mode(
        run["run_id"], ModeSelection("manual_safe", "user", False),
        administrator=administrator,
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES), workspace=workspace,
    )
    with pytest.raises(SandboxError) as revoked:
        engine.assert_isolated_full_access_authority(
            run["run_id"], workspace_root="C:/workspace",
            profile_digest=full.effective.capability_profile.digest,
            attestation_digest=attestation.evidence_digest,
        )
    assert revoked.value.code == "isolation_lease_revoked"


def test_desktop_security_binding_requires_mode_and_matching_workspace(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.agent import RuntimeRunContext
    from drsai.backend.runtime.desktop_security_binding import (
        DesktopSecurityBindingError, create_desktop_security_execution_binding,
    )
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "desktop-binding-denied")
    engine.transition_run(run["run_id"], "running")
    engine.bind_run_security_profile(
        run["run_id"], ResolvedCapabilityProfile(
            "profile", 1, "C:/workspace", frozenset({"filesystem.read"}),
        ), reason="test",
    )
    context = RuntimeRunContext(
        "runtime-test", "instance-one", "workspace-one", Path("C:/workspace"),
        session["session_id"], run["run_id"], "agent", "v1",
    )
    with pytest.raises(DesktopSecurityBindingError) as missing_mode:
        create_desktop_security_execution_binding(engine, context)
    assert missing_mode.value.code == "desktop_permission_mode_missing"


def test_runtime_legacy_permission_config_migration_does_not_apply_mode_or_change_run(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "legacy-permission-config")
    engine.transition_run(run["run_id"], "running")
    migrated = engine.migrate_legacy_permission_config(
        "account:workspace-one", {"legacy_runtime": "never", "repository": "full-access"},
    )
    assert migrated.mode_id == "manual_safe" and migrated.requires_reselection
    assert engine.effective_permission_descriptor(run["run_id"]) is None
    assert engine.get_run(run["run_id"])["status"] == "running"
    assert engine.acknowledge_permission_config_migration("account:workspace-one").acknowledged


def test_operation_level_approval_denial_does_not_cancel_or_resume_run(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.security_boundary import ActionProposal, ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "operation-review")
    engine.transition_run(run["run_id"], "running")
    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    proposal = ActionProposal.create(
        proposal_id="proposal-operation-review", run_id=run["run_id"], operation="file.write",
        payload={"path": "safe.txt", "content": "value"}, risk="local_write",
        required_capabilities=("file.write",),
    )
    request = engine.request_authorization_review(
        proposal, profile, reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="review-1",
    )
    assert engine.get_run(run["run_id"])["status"] == "running"
    engine.decide_authorization_review(
        request.request_id, "denied", reviewer_kind="human", reviewer_id="reviewer-1",
        reason_code="user_denied", idempotency_key="decision-1",
    )
    assert engine.get_run(run["run_id"])["status"] == "running"
    assert engine.authorization_approvals.get_request(request.request_id).status == "denied"


def test_operation_level_approval_issues_one_grant_without_changing_run(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.security_boundary import ActionProposal, ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "operation-grant")
    engine.transition_run(run["run_id"], "running")
    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], profile, reason="test")
    proposal = ActionProposal.create(
        proposal_id="proposal-operation-grant", run_id=run["run_id"], operation="file.write",
        payload={"path": "safe.txt", "content": "value"}, risk="local_write",
        required_capabilities=("file.write",),
    )
    request = engine.request_authorization_review(
        proposal, profile, reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="review-grant-1",
    )
    engine.decide_authorization_review(
        request.request_id, "approved", reviewer_kind="human", reviewer_id="reviewer-1",
        reason_code="user_approved", idempotency_key="decision-grant-1",
    )

    first = engine.issue_authorization_grant(request.request_id, profile, review_requirement="human")
    second = engine.issue_authorization_grant(request.request_id, profile, review_requirement="human")

    assert first == second
    assert first.proposal_digest == proposal.payload_digest
    assert engine.get_run(run["run_id"])["status"] == "running"


def test_operation_level_grant_uses_active_profile_not_caller_snapshot(engine: RuntimeEngine) -> None:
    from drsai.backend.runtime.security_boundary import ActionProposal, ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "operation-profile-change")
    engine.transition_run(run["run_id"], "running")
    reviewed = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], reviewed, reason="initial")
    proposal = ActionProposal.create(
        proposal_id="proposal-profile-change", run_id=run["run_id"], operation="file.write",
        payload={"path": "safe.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    request = engine.request_authorization_review(
        proposal, reviewed, reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="review-profile-change",
    )
    engine.decide_authorization_review(
        request.request_id, "approved", reviewer_kind="human", reviewer_id="reviewer-1",
        reason_code="user_approved", idempotency_key="decision-profile-change",
    )
    tightened = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=2, workspace_root="C:/workspace",
        capabilities=frozenset(), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], tightened, reason="policy-tightened")

    with pytest.raises(ValueError, match="Active capability profile"):
        engine.issue_authorization_grant(request.request_id, reviewed, review_requirement="human")
    assert engine.authorization_grants.get_for_request(request.request_id) is None


def test_legacy_approval_migration_is_restartable_and_preserves_pending_without_decision(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "legacy-migrate-pending")
    engine.transition_run(run["run_id"], "running")
    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], profile, reason="migration-test")
    legacy = engine.request_approval(run["run_id"], {
        "operation": "file.write", "path": "safe.txt", "required_capabilities": ["file.write"],
    })

    first = engine.migrate_legacy_approvals(limit=1)
    second = engine.migrate_legacy_approvals()
    assert first.migrated == 1
    assert second.already_migrated == 1
    rows = engine.approval_compatibility_rows()
    imported = next(row for row in rows if row["approval_id"] == legacy["approval_id"])
    assert imported["source"] == "legacy" and imported["migration_status"] == "migrated"
    request = engine.authorization_approvals.get_request(str(imported["new_request_id"]))
    assert request.status == "pending"
    assert engine.authorization_approvals.get_decision(request.request_id) is None


def test_legacy_pending_can_sync_once_to_terminal_but_never_becomes_a_reviewer_decision(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.authorization import GrantServiceError
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "legacy-sync-terminal")
    engine.transition_run(run["run_id"], "running")
    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], profile, reason="migration-test")
    legacy = engine.request_approval(run["run_id"], {
        "operation": "file.write", "path": "safe.txt", "required_capabilities": ["file.write"],
    })
    engine.migrate_legacy_approvals()
    request_id = str(engine.approval_compatibility_rows()[0]["new_request_id"])
    before = engine.legacy_approval_retirement_status(quiet_since=0)
    assert not before.ready
    assert {"pending_rows", "legacy_path_used_since_cutoff"}.issubset(before.blockers)

    engine.resolve_approval(legacy["approval_id"], "approved", {"idempotency_key": "legacy-decision"})
    synced = engine.migrate_legacy_approvals()
    assert synced.migrated == 1
    assert engine.authorization_approvals.get_request(request_id).status == "approved"
    assert engine.authorization_approvals.get_decision(request_id) is None
    with pytest.raises(GrantServiceError, match="no approved Decision"):
        engine.authorization_grants.issue_for_approved_request(
            request_id, profile, review_requirement="human",
        )
    assert engine.get_run(run["run_id"])["status"] == "running"
    still_used = engine.legacy_approval_retirement_status(quiet_since=0)
    assert not still_used.ready and still_used.uses_since_cutoff == 2
    quiet = engine.legacy_approval_retirement_status(quiet_since=time.time() + 1)
    assert quiet.ready and quiet.blockers == ()


def test_legacy_migration_defers_unprovable_pending_then_recovers_when_profile_exists(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "legacy-deferred")
    engine.transition_run(run["run_id"], "running")
    legacy = engine.request_approval(run["run_id"], {"operation": "file.write"})
    deferred = engine.migrate_legacy_approvals()
    assert deferred.deferred_reasons == {"active_profile_missing": 1}
    row = next(row for row in engine.approval_compatibility_rows() if row["approval_id"] == legacy["approval_id"])
    assert row["migration_status"] == "deferred" and row["new_request_id"] is None

    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], profile, reason="migration-recovery")
    recovered = engine.migrate_legacy_approvals()
    assert recovered.migrated == 1 and recovered.deferred == 0


def test_legacy_migration_detects_identity_mutation_and_compat_view_is_read_only(
    engine: RuntimeEngine,
) -> None:
    from drsai.backend.runtime.authorization import LegacyApprovalMigrationError
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "legacy-tamper")
    engine.transition_run(run["run_id"], "running")
    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    engine.bind_run_security_profile(run["run_id"], profile, reason="migration-test")
    legacy = engine.request_approval(run["run_id"], {"operation": "file.write"})
    engine.migrate_legacy_approvals()
    with sqlite3.connect(engine.database) as db:
        with pytest.raises(sqlite3.OperationalError, match="view"):
            db.execute(
                "INSERT INTO runtime_approval_compat_v1(approval_id,run_id,status) VALUES('x','y','pending')",
            )
        db.execute(
            "UPDATE runtime_approvals SET request_json=? WHERE approval_id=?",
            ('{"operation":"different"}', legacy["approval_id"]),
        )
    with pytest.raises(LegacyApprovalMigrationError) as changed:
        engine.migrate_legacy_approvals()
    assert changed.value.code == "legacy_identity_changed_after_migration"


def test_legacy_migration_limit_can_resume_across_runtime_restart(tmp_path: Path) -> None:
    from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile

    database = tmp_path / "runtime.sqlite3"
    first = RuntimeEngine(database, RuntimeEngineIdentity("runtime-test", "instance-one"), lambda _: True)
    profile = ResolvedCapabilityProfile(
        profile_id="manual-safe", version=1, workspace_root="C:/workspace",
        capabilities=frozenset({"file.write"}), trusted_workspace=True,
    )
    legacy_ids = []
    for index in range(2):
        session = first.create_session("workspace-one")
        run, _ = first.create_run(session["session_id"], "agent@v1", f"legacy-restart-{index}")
        first.transition_run(run["run_id"], "running")
        first.bind_run_security_profile(run["run_id"], profile, reason="migration-test")
        legacy_ids.append(first.request_approval(run["run_id"], {"operation": "file.write"})["approval_id"])
    partial = first.migrate_legacy_approvals(limit=1)
    assert partial.migrated == 1

    restarted = RuntimeEngine(database, RuntimeEngineIdentity("runtime-test", "instance-two"), lambda _: True)
    completed = restarted.migrate_legacy_approvals()
    assert completed.migrated == 1 and completed.already_migrated == 1
    rows = restarted.approval_compatibility_rows()
    assert {row["approval_id"] for row in rows} == set(legacy_ids)
    assert all(row["migration_status"] == "migrated" for row in rows)


@pytest.mark.parametrize("terminal", ["cancelled", "failed"])
def test_terminal_run_atomically_closes_pending_approval_and_unclaimed_effect(
    engine: RuntimeEngine, terminal: str,
) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", f"terminal-{terminal}")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"operation": "tool:write"})

    assert engine.transition_run(run["run_id"], terminal)["status"] == terminal
    assert engine.get_approval(approval["approval_id"])["status"] == "cancelled"
    assert engine.get_side_effect(approval["approval_id"])["status"] == "rejected"
    with pytest.raises(ValueError, match="not approved|authorization is no longer active"):
        engine.claim_side_effect(approval["approval_id"], run["run_id"], "tool:write")
    events = engine.list_events(run["run_id"])
    assert len([event for event in events if event["type"] == "approval.cancelled"]) == 1
    item = next(
        item for item in engine.conversation_snapshot(session["session_id"])["items"]
        if item["item_id"] == f"approval:{approval['approval_id']}"
    )
    assert item["payload"]["status"] == "cancelled"


def test_checkpoint_and_run_survive_runtime_restart(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    first = RuntimeEngine(database, RuntimeEngineIdentity("runtime-test", "instance-one"), lambda _: True)
    session = first.create_session("workspace-one")
    run, _ = first.create_run(session["session_id"], "agent@v1", "restart-key")
    first.transition_run(run["run_id"], "running")
    state = {"agent": {"step": 4}, "tools": {"shell": "waiting"}, "subagents": [{"id": "child-one", "status": "running"}]}
    saved = first.save_checkpoint(run["run_id"], state)
    second = RuntimeEngine(database, RuntimeEngineIdentity("runtime-test", "instance-two"), lambda _: True)
    assert second.get_run(run["run_id"])["status"] == "running"
    assert second.get_run_by_idempotency(session["session_id"], "restart-key")["run_id"] == run["run_id"]
    assert second.get_run(run["run_id"])["backend_id"] == "opendrsai"
    assert second.latest_checkpoint(run["run_id"])["state"] == state
    second.append_event(run["run_id"], "run.resumed", {"checkpoint_id": saved["checkpoint_id"]})
    assert second.transition_run(run["run_id"], "completed")["status"] == "completed"


def test_existing_session_and_run_are_backfilled_with_authoritative_worktree_identity(tmp_path: Path) -> None:
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as db:
        db.executescript(
            """
            CREATE TABLE runtime_sessions(session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
              archived INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE runtime_runs(run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
              runtime_id TEXT NOT NULL, instance_id TEXT NOT NULL, agent_definition TEXT NOT NULL, backend_id TEXT NOT NULL,
              status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, started_at TEXT,
              completed_at TEXT, cancel_requested_at TEXT);
            INSERT INTO runtime_sessions VALUES('session-old','workspace-derived','old',0,'now','now');
            INSERT INTO runtime_runs VALUES('run-old','session-old','workspace-derived','runtime-old','instance-old','codex@1','codex','queued','old-key','now',NULL,NULL,NULL);
            """
        )
    engine = RuntimeEngine(
        database, RuntimeEngineIdentity("runtime-new", "instance-new"), lambda _: True,
        lambda workspace_id: "worktree-authoritative" if workspace_id == "workspace-derived" else None,
    )
    assert engine.get_session("session-old")["worktree_id"] == "worktree-authoritative"
    assert engine.get_run("run-old")["worktree_id"] == "worktree-authoritative"
