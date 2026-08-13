from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import sqlite3
import sys

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
