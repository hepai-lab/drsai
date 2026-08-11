from __future__ import annotations

from pathlib import Path

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.oaep import reduce_oaep_events
from drsai.oaep.digest import oaep_items_digest


def _engine(path: Path, instance: str) -> RuntimeEngine:
    return RuntimeEngine(
        path,
        RuntimeEngineIdentity("runtime-four-path", instance),
        lambda workspace_id: workspace_id == "workspace-one",
    )


def test_realtime_replay_snapshot_and_restart_converge_to_one_digest(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    live = _engine(database, "instance-one")
    session = live.create_session("workspace-one", "Four paths")
    run, _ = live.create_run(session["session_id"], "agent@v1", "four-path", "codex")
    live.set_run_input(run["run_id"], "hello", model="gpt-test")
    live.transition_run(run["run_id"], "running")
    live.append_event(run["run_id"], "agent.item.reasoning.delta", {"item_id": "r1", "delta": "public summary"})
    live.append_event(run["run_id"], "agent.item.command.delta", {"item_id": "c1", "delta": "ok"})
    live.append_event(run["run_id"], "agent.message.delta", {"delta": "answer"})
    live.append_event(run["run_id"], "agent.completed", {"content": "answer"})
    live.transition_run(run["run_id"], "completed")

    events = live.list_oaep_events(session["session_id"], limit=500)
    replay = reduce_oaep_events(events)
    snapshot = live.oaep_snapshot(session["session_id"])
    restarted = _engine(database, "instance-two").oaep_snapshot(session["session_id"])

    # Applying every prefix models the realtime reducer; its terminal state is
    # required to equal a cold replay, an authoritative Snapshot, and restart.
    realtime = None
    for index in range(1, len(events) + 1):
        realtime = reduce_oaep_events(events[:index])
    assert realtime is not None
    digests = {
        "realtime": oaep_items_digest(realtime["items"]),
        "replay": oaep_items_digest(replay["items"]),
        "snapshot": oaep_items_digest(snapshot["items"]),
        "restart": oaep_items_digest(restarted["items"]),
    }
    assert replay["items"] == snapshot["items"]
    assert len(set(digests.values())) == 1, digests
    assert realtime["runs"] == replay["runs"] == snapshot["runs"] == restarted["runs"]
