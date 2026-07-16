from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
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
    return RuntimeEngine(tmp_path / "runtime.sqlite3", RuntimeEngineIdentity("runtime-test", "instance-one"), lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"})


def test_session_lifecycle_pagination_and_workspace_binding(engine: RuntimeEngine) -> None:
    with pytest.raises(KeyError): engine.create_session("missing")
    sessions = [engine.create_session("workspace-one", f"Session {index}") for index in range(3)]
    assert engine.list_sessions("workspace-one", limit=2)["total"] == 3
    renamed = engine.update_session(sessions[0]["session_id"], title="Renamed", archived=True)
    assert renamed["title"] == "Renamed" and renamed["archived"]
    assert engine.list_sessions("workspace-one")["total"] == 2
    assert engine.update_session(sessions[0]["session_id"], archived=False)["archived"] is False


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
