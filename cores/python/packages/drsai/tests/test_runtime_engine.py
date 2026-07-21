from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import sqlite3
import sys

import pytest

_MODULE_PATH = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "runtime_engine.py"
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


@pytest.mark.parametrize("decision,expected", [("approved", "running"), ("denied", "cancelled"), ("timeout", "failed")])
def test_approval_paths(engine: RuntimeEngine, decision: str, expected: str) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", f"approval-{decision}")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"})
    engine.resolve_approval(approval["approval_id"], decision)
    assert engine.get_run(run["run_id"])["status"] == expected


def test_pending_approval_query_atomically_expires_elapsed_deadline(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "approval-expired")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"tool": "shell"}, "2000-01-01T00:00:00+00:00")

    assert engine.list_pending_approvals(run["run_id"]) == []
    assert engine.get_approval(approval["approval_id"])["status"] == "timeout"
    assert engine.get_run(run["run_id"])["status"] == "failed"


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
