from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
from pathlib import Path

from drsai.backend import gateway
from drsai.backend.runtime.replay_planner import RUNTIME_CHECKPOINT_SCHEMA_VERSION
from drsai.backend.workspace.git_worktree_service import GitWorktreeService


def digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def terminal_run(engine, session_id: str, key: str, *, status: str = "completed") -> dict:
    run, _ = engine.create_run(session_id, "opendrsai@1", key, "opendrsai")
    engine.set_run_input(run["run_id"], key)
    engine.transition_run(run["run_id"], "running")
    engine.transition_run(run["run_id"], status)
    return engine.get_run(run["run_id"])


def isolated_candidate(engine, service, source_workspace_id: str, base: dict, key: str, filename: str) -> tuple[dict, dict]:
    worktree = service.create(
        source_workspace_id=source_workspace_id, idempotency_key=key,
        intent=key, location="local",
    )
    derived = Path(worktree.canonical_path)
    (derived / filename).write_text(f"{key}\n", encoding="utf-8")
    git(derived, "add", filename)
    git(derived, "commit", "-m", f"fixture {key}")
    session = engine.create_session(str(worktree.workspace_id), f"Phase2 {key}")
    candidate = terminal_run(engine, session["session_id"], f"run-{key}")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="phase2-fixture", idempotency_key=f"draft-{key}",
    )
    engine.experiments.mark_executed(draft["experiment_id"], candidate["run_id"])
    comparison = engine.run_comparisons.create(base["run_id"], candidate["run_id"])
    return engine.get_run(candidate["run_id"]), comparison


def seed(home: Path, workspace: Path, output: Path) -> None:
    os.environ["DRSAI_HOME"] = str(home)
    workspace.mkdir(parents=True, exist_ok=True)
    git(workspace, "init")
    git(workspace, "config", "user.name", "OpenDrSai E2E")
    git(workspace, "config", "user.email", "e2e@opendrsai.local")
    (workspace / "README.md").write_text("phase2 baseline\n", encoding="utf-8")
    (workspace / "p3-delete-me.txt").write_text("delete in candidate\n", encoding="utf-8")
    git(workspace, "add", "README.md", "p3-delete-me.txt")
    git(workspace, "commit", "-m", "phase2 baseline")

    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_security_instance = None
    gateway._git_worktree_service_instance = None
    gateway._runtime_agent_service_instance = None
    gateway._runtime_tool_dispatcher_instance = None
    opened = gateway._runtime_registry().open_workspace(str(workspace))
    principal = os.environ.get("OPENDRSAI_E2E_AUTH_USER_ID", "")
    if principal:
        gateway._runtime_security().permissions.set_role(opened.workspace_id, principal, "owner")
    engine = gateway._runtime_engine()
    session = engine.create_session(opened.workspace_id, "Phase2 baseline")
    base = terminal_run(engine, session["session_id"], "phase2-base")
    model_session = engine.create_session(opened.workspace_id, "Phase3 model baseline")
    model_base = terminal_run(engine, model_session["session_id"], "phase3-model-base")

    # Leave one claimed Replay execution in-flight. This fixture process then
    # exits; the separately spawned Gateway must reconcile it without retrying
    # model or Tool side effects.
    recovery_draft, _ = engine.experiments.create(
        base["run_id"], created_by="phase2-fixture",
        idempotency_key="phase2-recovery-draft",
    )
    recovery_plan = engine.replay_plans.create(
        recovery_draft["experiment_id"], expected_draft_version=1,
    )
    recovery_prepared = engine.replay_executions.prepare(
        recovery_plan["replay_plan_id"], draft_version=1,
        plan_digest=recovery_plan["plan_digest"],
        base_manifest_digest=recovery_plan["base_manifest_digest"],
        idempotency_key="phase2-recovery-execute",
    )
    assert engine.replay_executions.claim_execution(recovery_plan["replay_plan_id"])
    engine.transition_run(recovery_prepared["run"]["run_id"], "running")

    checkpoint_session = engine.create_session(
        opened.workspace_id, "Phase2 checkpoint",
        agent_definition="phase2-acceptance@1", backend_id="opendrsai",
    )
    checkpoint_run, _ = engine.create_run(
        checkpoint_session["session_id"], "phase2-acceptance@1", "phase2-checkpoint", "opendrsai",
    )
    engine.set_run_input(checkpoint_run["run_id"], "checkpoint continuation")
    engine.transition_run(checkpoint_run["run_id"], "running")
    service = gateway._runtime_agent_service()
    definition = service.definitions.load("phase2-acceptance@1")
    checkpoint_context = service._context(engine.get_run(checkpoint_run["run_id"]), definition)
    gateway._runtime_tool_dispatcher().dispatch(
        checkpoint_context, "tool", "phase2.calculator", {"value": 21},
    )
    resume_payload = {"history": [{"turn": 1, "content": "checkpoint", "results": [{"kind": "tool", "name": "phase2.calculator", "result": {"value": 42}}]}]}
    engine.save_checkpoint(checkpoint_run["run_id"], {
        "schema_version": RUNTIME_CHECKPOINT_SCHEMA_VERSION,
        "agent_state_digest": digest(resume_payload),
        "model_context": {"messages_digest": "sha256:" + "b" * 64},
        "resume_payload": resume_payload,
        "compatibility": {"backend_id": "opendrsai", "agent_definition": "phase2-acceptance@1"},
    })
    engine.transition_run(checkpoint_run["run_id"], "completed")

    phase3_session = engine.create_session(
        opened.workspace_id, "Phase3 candidate baseline",
        agent_definition="phase3-acceptance@1", backend_id="opendrsai",
    )
    phase3_base, _ = engine.create_run(
        phase3_session["session_id"], "phase3-acceptance@1", "phase3-base", "opendrsai",
    )
    engine.set_run_input(phase3_base["run_id"], "prepare candidate changes")
    engine.transition_run(phase3_base["run_id"], "running")
    engine.transition_run(phase3_base["run_id"], "completed")

    failed_session = engine.create_session(
        opened.workspace_id, "Phase3 failed before message",
        agent_definition="phase3-failing@1", backend_id="opendrsai",
    )
    failed_run, _ = engine.create_run(
        failed_session["session_id"], "phase3-failing@1", "phase3-failed", "opendrsai",
    )
    engine.set_run_input(failed_run["run_id"], "fail before Assistant output")
    try:
        asyncio.run(service.execute(failed_run["run_id"], "fail before Assistant output"))
    except gateway.RuntimeExecutionError:
        pass
    else:
        raise AssertionError("Phase 3 failing Agent unexpectedly completed")

    secret_canaries = [
        "p3-bearer-canary-91f7", "p3-api-canary-82e6",
        "p3-cookie-canary-73d5", "p3-url-canary-64c4",
        "p3-raw-cot-canary-55b3", "p3-private-user-canary-46a2",
        "p3-private-home-canary-37d1",
    ]
    secret_session = engine.create_session(opened.workspace_id, "Phase3 secret corpus")
    secret_run, _ = engine.create_run(
        secret_session["session_id"], "opendrsai@1", "phase3-secret-corpus", "opendrsai",
    )
    engine.set_run_input(secret_run["run_id"], (
        f"Bearer {secret_canaries[0]} api_key={secret_canaries[1]} "
        f"Cookie: session={secret_canaries[2]} "
        f"https://user:{secret_canaries[3]}@example.test/path "
        f"C:\\Users\\{secret_canaries[5]}\\OpenDrSai\\secret.txt "
        f"/home/{secret_canaries[6]}/opendrsai/secret.txt"
    ))
    engine.transition_run(secret_run["run_id"], "running")
    engine.append_event(secret_run["run_id"], "tool.completed", {
        "kind": "tool", "name": "secret.corpus", "arguments": {
            "authorization": f"Bearer {secret_canaries[0]}",
            "header": f"Cookie: session={secret_canaries[2]}",
            "url": f"https://user:{secret_canaries[3]}@example.test/path",
        },
        "result": {"message": (
            f"api_key={secret_canaries[1]} "
            f"C:\\Users\\{secret_canaries[5]}\\OpenDrSai\\tool.log "
            f"/home/{secret_canaries[6]}/opendrsai/tool.log"
        )},
    })
    engine.append_event(secret_run["run_id"], "agent.item.reasoning.delta", {
        "item_id": "secret-reasoning", "delta": secret_canaries[4],
        "chain_of_thought": secret_canaries[4],
    })
    engine.transition_run(secret_run["run_id"], "completed")

    policy_session = engine.create_session(opened.workspace_id, "Phase2 policy", agent_definition="phase2-acceptance@1", backend_id="opendrsai")
    policy_run, _ = engine.create_run(policy_session["session_id"], "phase2-acceptance@1", "phase2-policy", "opendrsai")
    engine.set_run_input(policy_run["run_id"], "policy")
    asyncio.run(gateway._runtime_agent_service().execute(policy_run["run_id"], "policy"))

    blocked_session = engine.create_session(opened.workspace_id, "Phase2 blocked")
    blocked_run, _ = engine.create_run(blocked_session["session_id"], "opendrsai@1", "phase2-blocked", "opendrsai")
    engine.transition_run(blocked_run["run_id"], "running")
    engine.append_event(blocked_run["run_id"], "agent.item.tool.delta", {
        "item_id": "external", "name": "email-send", "status": "completed",
        "replay_policy": {"classification": "external_write", "tool_reference": "tool://email-send"},
    })
    engine.transition_run(blocked_run["run_id"], "completed")

    service = gateway._git_worktree_service()
    adoption_candidate, adoption_comparison = isolated_candidate(
        engine, service, opened.workspace_id, base, "adopt", "adopted.txt",
    )
    discard_candidate, discard_comparison = isolated_candidate(
        engine, service, opened.workspace_id, base, "discard", "discarded.txt",
    )
    crash_candidate, crash_comparison = isolated_candidate(
        engine, service, opened.workspace_id, base, "crash-adopt", "crash-adopted.txt",
    )
    crash_preview = service.adoption_preview(opened.workspace_id, crash_candidate["worktree_id"])
    crash_adoption = engine.adoptions.record_preview(
        crash_comparison["comparison_id"], opened.workspace_id,
        crash_candidate["worktree_id"], crash_preview,
    )
    crash_paths = sorted({
        str(change[key]) for change in crash_preview["changes"]
        for key in ("path", "old_path", "new_path") if change.get(key)
    })
    engine.adoptions.begin_apply(crash_adoption["adoption_id"], crash_paths)

    class SimulatedAdoptionCrash(BaseException):
        pass

    def crash_after_commit(stage: str) -> None:
        if stage == "after_commit":
            raise SimulatedAdoptionCrash(stage)

    crash_service = GitWorktreeService(
        gateway._runtime_registry(), service.worktree_root,
        fault_injector=crash_after_commit,
    )
    try:
        crash_service.adopt_selection(
            opened.workspace_id, crash_candidate["worktree_id"],
            preview_digest=crash_preview["preview_digest"],
            selected_paths=crash_paths, operation_id=crash_adoption["adoption_id"],
        )
    except SimulatedAdoptionCrash:
        pass
    else:
        raise AssertionError("Adoption crash fixture did not stop after Git commit")
    output.write_text(json.dumps({
        "schema_version": "opendrsai.run-editable-phase2-windows-e2e/1",
        "workspace_path": str(workspace), "workspace_id": opened.workspace_id,
        "base_run_id": base["run_id"], "checkpoint_run_id": checkpoint_run["run_id"],
        "phase3_model_base_run_id": model_base["run_id"],
        "phase3_base_run_id": phase3_base["run_id"],
        "phase3_failed_run_id": failed_run["run_id"],
        "phase3_session_id": phase3_session["session_id"],
        "phase3_failed_session_id": failed_session["session_id"],
        "phase3_secret_run_id": secret_run["run_id"],
        "phase3_secret_canaries": secret_canaries,
        "recovery_run_id": recovery_prepared["run"]["run_id"],
        "recovery_plan_id": recovery_plan["replay_plan_id"],
        "policy_run_id": policy_run["run_id"], "blocked_run_id": blocked_run["run_id"],
        "adoption_candidate_run_id": adoption_candidate["run_id"],
        "adoption_comparison_id": adoption_comparison["comparison_id"],
        "discard_candidate_run_id": discard_candidate["run_id"],
        "discard_comparison_id": discard_comparison["comparison_id"],
        "crash_adoption_id": crash_adoption["adoption_id"],
        "crash_adoption_paths": crash_paths,
        "base_manifest_digest": engine.get_run_manifest(base["run_id"], safe=False)["manifest_digest"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def verify(home: Path, fixture: Path, desktop_result: Path) -> None:
    os.environ["DRSAI_HOME"] = str(home)
    expected = json.loads(fixture.read_text(encoding="utf-8"))
    result = json.loads(desktop_result.read_text(encoding="utf-8"))
    assert result.get("ok") is True and all(result.get("checks", {}).values()), result
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    engine = gateway._runtime_engine()
    assert engine.get_run_manifest(expected["base_run_id"], safe=False)["manifest_digest"] == expected["base_manifest_digest"]
    scenarios = {item["id"]: item for item in result.get("details", {}).get("scenarios", [])}
    if "O" in scenarios:
        failed = engine.get_run(expected["phase3_failed_run_id"])
        assert failed["status"] == "failed"
        assert not any(
            event["type"] == "agent.item.completed" and event["data"].get("item_type") == "message"
            for event in engine.list_events(failed["run_id"])
        )
        p_run = engine.get_run(scenarios["P"]["runId"])
        p_manifest = engine.get_run_manifest(p_run["run_id"], safe=False)["manifest"]
        assert p_run["status"] == "completed" and p_manifest["model"]["id"] == "controlled-candidate"
        s_run = engine.get_run(scenarios["S"]["runId"])
        assert s_run["status"] == "completed" and s_run["worktree_id"]
        s_events = engine.list_events(s_run["run_id"])
        snapshot_events = [event for event in s_events if event["type"] == "run.experiment.candidate_snapshot"]
        assert len(snapshot_events) == 1 and snapshot_events[0]["data"]["change_count"] == 3
        with engine.run_comparisons._connect() as db:
            comparison_row = db.execute(
                "SELECT comparison_id FROM runtime_run_comparisons WHERE baseline_run_id=? AND candidate_run_id=?",
                (expected["phase3_base_run_id"], s_run["run_id"]),
            ).fetchone()
        assert comparison_row is not None
        with engine.adoptions._connect() as db:
            adoption_row = db.execute(
                "SELECT * FROM runtime_run_adoptions WHERE comparison_id=?",
                (comparison_row["comparison_id"],),
            ).fetchone()
        assert adoption_row is not None and adoption_row["status"] == "applied"
        selected_paths = json.loads(adoption_row["selected_paths_json"])
        assert len(selected_paths) == 1
        source = Path(expected["workspace_path"])
        observed = {
            "README.md": "phase3 candidate change" in (source / "README.md").read_text(encoding="utf-8"),
            "p3-created.txt": (source / "p3-created.txt").exists(),
            "p3-delete-me.txt": not (source / "p3-delete-me.txt").exists(),
        }
        assert sum(observed.values()) == 1 and observed[selected_paths[0]] is True
        recovery = engine.get_run(expected["recovery_run_id"])
        assert recovery["status"] == "failed"
        persisted = engine.database.read_bytes()
        for canary in expected["phase3_secret_canaries"]:
            assert canary.encode() not in persisted
        return
    g_run = engine.get_run(scenarios["G"]["runId"])
    assert g_run["status"] == "completed" and g_run["input_message"] == "Phase 2 edited prompt"
    assert engine.experiments.relations(g_run["run_id"])["parent"]["source_run_id"] == expected["base_run_id"]
    h_events = engine.list_events(scenarios["H"]["runId"])
    assert sum(event["type"] == "run.replay.checkpoint_restored" for event in h_events) == 1
    assert sum(event["type"] == "agent.checkpoint.restored" for event in h_events) == 1
    assert sum(event["type"] == "tool.completed" for event in h_events) == 0
    j_events = engine.list_events(scenarios["J"]["runId"])
    completed_tools = [event for event in j_events if event["type"] == "tool.completed"]
    assert len(completed_tools) == 2
    assert sum(event["data"].get("replay_decision") == "reuse" for event in completed_tools) == 1
    assert sum(event["data"].get("name") == "workspace.inspect" for event in completed_tools) == 1
    approved_run_id = scenarios["J"].get("approvalRunId")
    assert approved_run_id and engine.get_run(approved_run_id)["status"] == "completed"
    approved_events = engine.list_events(approved_run_id)
    assert sum(event["type"] == "approval.requested" for event in approved_events) == 1
    assert sum(event["type"] == "approval.approved" for event in approved_events) == 1
    assert sum(event["type"] == "tool.completed" for event in approved_events) == 2
    recovery = engine.get_run(expected["recovery_run_id"])
    assert recovery["status"] == "failed"
    recovery_events = engine.list_events(recovery["run_id"])
    interrupted = [event for event in recovery_events if event["type"] == "run.replay.interrupted"]
    assert len(interrupted) == 1
    assert interrupted[0]["data"] == {
        "replay_plan_id": expected["recovery_plan_id"],
        "reason": "runtime_process_restarted", "automatic_retry": False,
        "phase": "model_stream",
    }
    with engine.replay_executions._connect() as db:
        execution = db.execute(
            "SELECT status FROM runtime_replay_executions WHERE replay_plan_id=?",
            (expected["recovery_plan_id"],),
        ).fetchone()
    assert execution is not None and execution["status"] == "interrupted"
    assert (Path(expected["workspace_path"]) / "adopted.txt").exists()
    assert not (Path(expected["workspace_path"]) / "discarded.txt").exists()
    assert (Path(expected["workspace_path"]) / "crash-adopted.txt").exists()
    crash_adoption = engine.adoptions.get(expected["crash_adoption_id"])
    assert crash_adoption["status"] == "applied"
    assert crash_adoption["operation"]["status"] == "completed"
    messages = git(Path(expected["workspace_path"]), "log", "--format=%B", "-20")
    assert messages.count(f"OpenDrSai-Adoption: {expected['crash_adoption_id']}") == 1
    audit = json.dumps(gateway._runtime_security().audit.list(), ensure_ascii=False)
    assert "run.experiment" in audit and "run.adoption" in audit


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--desktop-result", type=Path)
    args = parser.parse_args()
    if args.verify:
        verify(args.home, args.output, args.desktop_result)
    else:
        args.home.mkdir(parents=True, exist_ok=True)
        seed(args.home, args.workspace, args.output)


if __name__ == "__main__":
    main()
