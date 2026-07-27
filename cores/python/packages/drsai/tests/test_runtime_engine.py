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


def test_pending_approval_query_atomically_expires_elapsed_deadline(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "approval-expired")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"}, "2000-01-01T00:00:00+00:00")

    assert engine.list_pending_approvals(run["run_id"]) == []
    assert engine.get_approval(approval["approval_id"])["status"] == "timeout"
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
