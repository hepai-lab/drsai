from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from drsai.backend import gateway
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.oaep import reduce_oaep_events
from drsai.oaep.digest import oaep_items_digest


def complete_evidence() -> dict:
    return {
        "runtime": {"version": "1.0.0"},
        "backend": {"version": "1.0.0"},
        "prompt": {"digest": "p" * 64},
        "model": {
            "provider": "fixture-provider", "version": "fixture-model-v1",
            "revision_digest": "m" * 64,
        },
        "workspace": {"revision": "fixture-revision", "dirty": False},
        "environment": {
            "os": "Windows", "arch": "x64",
            "runtime_versions": {"python": "fixture"}, "image_digest": "e" * 64,
        },
        "security": {"policy_version": "policy-v1"},
        "evidence_declarations": {
            "attachments_recorded": True, "tools_recorded": True,
            "skills_recorded": True, "external_dependencies_recorded": True,
        },
    }


def create_run(engine: RuntimeEngine, session_id: str, key: str) -> dict:
    run, _ = engine.create_run(session_id, "opendrsai@1", key, "opendrsai")
    engine.set_run_input(run["run_id"], key, model="fixture-model", evidence=complete_evidence())
    return run


def scenario_record(engine: RuntimeEngine, scenario_id: str, run: dict, *, focus_type: str | None = None) -> dict:
    inspection = engine.inspect_run(run["run_id"], limit=500)
    focus = next((item["id"] for item in inspection["timeline"] if item["type"] == focus_type), None)
    return {
        "id": scenario_id,
        "run_id": run["run_id"],
        "session_id": run["session_id"],
        "run_status": inspection["run"]["status"],
        "reproducibility_level": inspection["manifest"]["reproducibility_level"],
        "item_ids": [item["id"] for item in inspection["timeline"]],
        **({"focus_item_id": focus} if focus else {}),
    }


def seed(home: Path, workspace: Path, output: Path) -> None:
    os.environ["DRSAI_HOME"] = str(home)
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_security_instance = None
    opened = gateway._runtime_registry().open_workspace(str(workspace))
    principal_id = os.environ.get("OPENDRSAI_E2E_AUTH_USER_ID", "")
    if principal_id:
        gateway._runtime_security().permissions.set_role(opened.workspace_id, principal_id, "viewer")
    engine = gateway._runtime_engine()
    records: list[dict] = []

    session_a = engine.create_session(opened.workspace_id, "Traceability A")
    run_a = create_run(engine, session_a["session_id"], "phase1-a")
    engine.transition_run(run_a["run_id"], "running")
    engine.append_event(run_a["run_id"], "agent.item.command.delta", {"item_id": "command-a", "delta": "fixture output"})
    engine.append_event(run_a["run_id"], "agent.item.file_change", {"item": {"id": "file-a", "status": "completed", "summary": "Created report", "changes": [{"path": "report.md"}]}})
    engine.append_event(run_a["run_id"], "artifact.created", {"artifact_id": "artifact-a", "status": "completed", "name": "report.md", "sha256": "a" * 64})
    engine.append_event(run_a["run_id"], "agent.completed", {"content": "Scenario A complete"})
    engine.transition_run(run_a["run_id"], "completed")
    records.append(scenario_record(engine, "A", run_a, focus_type="file_change"))

    session_b = engine.create_session(opened.workspace_id, "Traceability B")
    run_b = create_run(engine, session_b["session_id"], "phase1-b")
    engine.transition_run(run_b["run_id"], "running")
    engine.append_event(run_b["run_id"], "tool.failed", {"tool_id": "tool-b", "status": "failed", "summary": "Fixture tool failed"})
    engine.transition_run(run_b["run_id"], "failed", error={"code": "tool.failed", "message": "Bearer traceability-secret-canary", "retryable": False})
    records.append(scenario_record(engine, "B", run_b, focus_type="tool_call"))

    session_c_wait = engine.create_session(opened.workspace_id, "Traceability C waiting")
    run_c_wait = create_run(engine, session_c_wait["session_id"], "phase1-c-waiting")
    engine.transition_run(run_c_wait["run_id"], "running")
    engine.request_approval(run_c_wait["run_id"], {"operation": "file.write", "path": "report.md"})
    records.append(scenario_record(engine, "C-waiting", run_c_wait, focus_type="interaction"))

    session_c = engine.create_session(opened.workspace_id, "Traceability C denied")
    run_c = create_run(engine, session_c["session_id"], "phase1-c-denied")
    engine.transition_run(run_c["run_id"], "running")
    approval = engine.request_approval(run_c["run_id"], {"operation": "file.write", "path": "report.md"})
    engine.resolve_approval(approval["approval_id"], "denied")
    records.append(scenario_record(engine, "C-denied", run_c, focus_type="interaction"))

    session_d = engine.create_session(opened.workspace_id, "Traceability D")
    run_d = create_run(engine, session_d["session_id"], "phase1-d")
    engine.transition_run(run_d["run_id"], "running")
    engine.append_event(run_d["run_id"], "agent.item.command.delta", {"item_id": "command-d", "delta": "partial output"})
    engine.cancel_run(run_d["run_id"])
    late_delta_rejected = False
    try:
        engine.append_event(run_d["run_id"], "agent.item.command.delta", {"item_id": "command-d", "delta": "late"})
    except ValueError:
        late_delta_rejected = True
    records.append({**scenario_record(engine, "D", run_d, focus_type="command_execution"), "late_delta_rejected": late_delta_rejected})

    session_e = engine.create_session(opened.workspace_id, "Traceability E")
    run_e = create_run(engine, session_e["session_id"], "phase1-e")
    engine.transition_run(run_e["run_id"], "running")
    engine.append_event(run_e["run_id"], "agent.message.delta", {"delta": "restart stable"})
    engine.append_event(run_e["run_id"], "agent.completed", {"content": "restart stable"})
    engine.transition_run(run_e["run_id"], "completed")
    events = engine.list_oaep_events(session_e["session_id"], limit=500)
    snapshot = engine.oaep_snapshot(session_e["session_id"])
    restarted = RuntimeEngine(engine.database, RuntimeEngineIdentity(engine.identity.runtime_id, "phase1-restart"), lambda workspace_id: workspace_id == opened.workspace_id)
    digests = {
        "replay": oaep_items_digest(reduce_oaep_events(events)["items"]),
        "snapshot": oaep_items_digest(snapshot["items"]),
        "restart": oaep_items_digest(restarted.oaep_snapshot(session_e["session_id"])["items"]),
    }
    records.append({**scenario_record(engine, "E", run_e, focus_type="message"), "digests": digests})

    session_f = engine.create_session(opened.workspace_id, "Traceability F")
    run_f, _ = engine.import_backend_run(session_f["session_id"], "legacy", "legacy-phase1", status="failed")
    records.append(scenario_record(engine, "F", run_f))

    payload = {
        "schema_version": "opendrsai.run-traceability-windows-e2e/1",
        "home": str(home),
        "workspace_path": str(workspace),
        "workspace_id": opened.workspace_id,
        "database": str(engine.database),
        "scenarios": records,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def verify(home: Path, fixture_path: Path, desktop_result_path: Path) -> None:
    os.environ["DRSAI_HOME"] = str(home)
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    desktop = json.loads(desktop_result_path.read_text(encoding="utf-8"))
    assert desktop.get("ok") is True and all(desktop.get("checks", {}).values()), desktop
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_security_instance = None
    engine = gateway._runtime_engine()
    for scenario in fixture["scenarios"]:
        inspection = engine.inspect_run(scenario["run_id"], limit=500)
        assert inspection["run"]["status"] == scenario["run_status"]
        assert inspection["manifest"]["reproducibility_level"] == scenario["reproducibility_level"]
        assert [item["id"] for item in inspection["timeline"]] == scenario["item_ids"]
        assert all(item["run_id"] == scenario["run_id"] for item in inspection["timeline"])
        if inspection["timeline"]:
            assert all(item["event_refs"] for item in inspection["timeline"])
        assert all(ref["event_id"] and ref["sequence"] > 0 for item in inspection["timeline"] for ref in item["event_refs"])
    assert next(row for row in fixture["scenarios"] if row["id"] == "D")["late_delta_rejected"] is True
    assert len(set(next(row for row in fixture["scenarios"] if row["id"] == "E")["digests"].values())) == 1
    audit = gateway._runtime_security().audit.list()
    operations = {
        row.get("detail", {}).get("resource", {}).get("operation")
        for row in audit if row.get("event") == "operation.authorized"
    }
    assert "run.inspection.read" in operations and "run.manifest.export" in operations, json.dumps(audit, ensure_ascii=False)
    assert "traceability-secret-canary" not in json.dumps(audit)
    print("Real Windows Runtime/Desktop traceability A-F verification passed.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--desktop-result", type=Path)
    args = parser.parse_args()
    if args.verify:
        if args.desktop_result is None:
            parser.error("--desktop-result is required with --verify")
        verify(args.home, args.output, args.desktop_result)
    else:
        if args.workspace is None:
            parser.error("--workspace is required when seeding")
        args.home.mkdir(parents=True, exist_ok=True)
        args.workspace.mkdir(parents=True, exist_ok=True)
        seed(args.home, args.workspace, args.output)


if __name__ == "__main__":
    main()
