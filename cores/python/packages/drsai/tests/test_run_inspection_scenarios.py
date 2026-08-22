from __future__ import annotations

from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.oaep import reduce_oaep_events
from drsai.oaep.digest import oaep_items_digest


@pytest.fixture()
def runtime(tmp_path: Path) -> RuntimeEngine:
    return RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-scenarios", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )


def _run(runtime: RuntimeEngine, key: str) -> tuple[dict, dict]:
    session = runtime.create_session("workspace-one", key)
    run, _ = runtime.create_run(session["session_id"], "agent@v1", key, "codex")
    runtime.set_run_input(
        run["run_id"], key, model="gpt-test",
        evidence={
            "runtime": {"version": "1.0.0"},
            "backend": {"version": "1.0.0"},
            "protocol": {
                "oaep_version": "1.0",
                "adapter_version": "adapter-1.0.0",
                "mapping_version": "mapping-1.0.0",
            },
            "agent": {"definition_digest": "a" * 64},
            "prompt": {"digest": "p" * 64},
            "model": {
                "provider": "test-provider", "version": "test-model-v1",
                "revision_digest": "m" * 64,
            },
            "workspace": {"revision": "revision-one", "dirty": False},
            "environment": {
                "os": "Windows", "arch": "x64",
                "runtime_versions": {"python": "3.12"}, "image_digest": "e" * 64,
            },
            "security": {"policy_version": "policy-v1"},
            "evidence_declarations": {
                "attachments_recorded": True, "tools_recorded": True,
                "skills_recorded": True, "external_dependencies_recorded": True,
            },
        },
    )
    return session, run


def test_scenario_a_successful_tool_file_and_artifact_run(runtime: RuntimeEngine) -> None:
    session, run = _run(runtime, "scenario-a")
    runtime.transition_run(run["run_id"], "running")
    runtime.append_event(run["run_id"], "agent.item.command.delta", {"item_id": "command-a", "delta": "ok"})
    runtime.append_event(run["run_id"], "agent.item.file_change", {"item": {"id": "file-a", "status": "completed", "changes": [{"path": "result.txt"}], "summary": "Created result"}})
    runtime.append_event(run["run_id"], "artifact.created", {"artifact_id": "artifact-a", "status": "completed", "name": "result.txt"})
    runtime.append_event(run["run_id"], "agent.completed", {"content": "done"})
    runtime.transition_run(run["run_id"], "completed")

    inspection = runtime.inspect_run(run["run_id"])
    assert inspection["run"]["status"] == "completed"
    assert inspection["summary"]["artifact_count"] == 1
    assert inspection["manifest"]["reproducibility_level"] == "exact"
    assert [item["sequence"] for item in inspection["timeline"]] == sorted(item["sequence"] for item in inspection["timeline"])
    with runtime._connect() as db:
        identities = db.execute("SELECT DISTINCT session_id,run_id FROM runtime_oaep_items WHERE run_id=?", (run["run_id"],)).fetchall()
    assert [(row["session_id"], row["run_id"]) for row in identities] == [(session["session_id"], run["run_id"])]
    outcome = runtime.get_run_manifest(run["run_id"], safe=False)["manifest"]["outcome"]
    assert outcome["counts_by_item_type"]["artifact"] == 1
    assert outcome["artifacts"][0]["artifact_id"] == "artifact-a"
    assert outcome["result"]["length"] == 4


def test_scenario_b_failed_tool_keeps_trace_and_manifest(runtime: RuntimeEngine) -> None:
    _, run = _run(runtime, "scenario-b")
    runtime.transition_run(run["run_id"], "running")
    runtime.append_event(run["run_id"], "tool.failed", {"tool_id": "tool-b", "status": "failed", "summary": "Read failed"})
    runtime.transition_run(run["run_id"], "failed", error={"code": "tool.failed", "message": "Read failed", "retryable": False})
    inspection = runtime.inspect_run(run["run_id"])
    assert inspection["summary"]["error"]["code"] == "tool.failed"
    assert inspection["timeline"]
    assert inspection["manifest"]["finalized_at"]


def test_scenario_c_approval_denial_is_stable_after_restart(runtime: RuntimeEngine) -> None:
    _, run = _run(runtime, "scenario-c")
    runtime.transition_run(run["run_id"], "running")
    approval = runtime.request_approval(run["run_id"], {"operation": "file.write", "path": "result.txt"})
    runtime.resolve_approval(approval["approval_id"], "denied")
    before = runtime.get_run_manifest(run["run_id"], safe=True)
    restarted = RuntimeEngine(runtime.database, RuntimeEngineIdentity("runtime-scenarios", "instance-two"), lambda workspace_id: workspace_id == "workspace-one")
    after = restarted.get_run_manifest(run["run_id"], safe=True)
    assert restarted.get_run(run["run_id"])["status"] == "cancelled"
    assert before["manifest_digest"] == after["manifest_digest"]


def test_scenario_d_cancel_preserves_committed_items_and_rejects_late_delta(runtime: RuntimeEngine) -> None:
    _, run = _run(runtime, "scenario-d")
    runtime.transition_run(run["run_id"], "running")
    runtime.append_event(run["run_id"], "agent.item.command.delta", {"item_id": "command-d", "delta": "partial"})
    runtime.cancel_run(run["run_id"])
    inspection = runtime.inspect_run(run["run_id"])
    command = next(item for item in inspection["timeline"] if item["type"] == "command_execution")
    assert command["status"] == "cancelled"
    assert command["content"]["output"] == "partial"
    with pytest.raises(ValueError, match="terminal status|after reaching|cannot transition"):
        runtime.append_event(run["run_id"], "agent.item.command.delta", {"item_id": "command-d", "delta": "late"})


def test_scenario_e_replay_snapshot_and_restart_do_not_reexecute(runtime: RuntimeEngine) -> None:
    session, run = _run(runtime, "scenario-e")
    runtime.transition_run(run["run_id"], "running")
    runtime.append_event(run["run_id"], "agent.message.delta", {"delta": "stable"})
    runtime.append_event(run["run_id"], "agent.completed", {"content": "stable"})
    runtime.transition_run(run["run_id"], "completed")
    events = runtime.list_oaep_events(session["session_id"], limit=500)
    snapshot = runtime.oaep_snapshot(session["session_id"])
    restarted = RuntimeEngine(runtime.database, RuntimeEngineIdentity("runtime-scenarios", "instance-three"), lambda workspace_id: workspace_id == "workspace-one")
    after = restarted.oaep_snapshot(session["session_id"])
    assert oaep_items_digest(reduce_oaep_events(events)["items"]) == oaep_items_digest(snapshot["items"]) == oaep_items_digest(after["items"])
    assert len(restarted.list_session_runs(session["session_id"])) == 1


def test_scenario_f_historical_run_degrades_without_fabricating_evidence(runtime: RuntimeEngine) -> None:
    session = runtime.create_session("workspace-one", "scenario-f")
    run, _ = runtime.import_backend_run(session["session_id"], "codex", "legacy-backend-run", status="failed")
    manifest = runtime.get_run_manifest(run["run_id"], safe=True)
    inspection = runtime.inspect_run(run["run_id"])
    assert manifest["reproducibility_level"] == "unavailable"
    assert "model.id" in manifest["missing_evidence"]
    assert inspection["run"]["status"] == "failed"
