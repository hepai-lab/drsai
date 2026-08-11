from __future__ import annotations

import asyncio
import hashlib
import json
import subprocess
from pathlib import Path

from drsai.backend.runtime.agent import (
    AgentDefinitionStore,
    OpenDrSaiAgentBackend,
    RuntimeAgentService,
    RuntimeToolDispatcher,
)
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry
from drsai.backend.runtime.replay_planner import RUNTIME_CHECKPOINT_SCHEMA_VERSION
from drsai.backend.workspace.git_worktree_service import GitWorktreeService


def _digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def test_controlled_model_replay_uses_real_execute_dispatcher_oaep_and_manifest(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    workspace_record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda workspace_id: registry.get_workspace(workspace_id) is not None,
    )
    assets = tmp_path / "agents"
    definition_path = assets / "controlled" / "1.json"
    definition_path.parent.mkdir(parents=True)
    definition_path.write_text(json.dumps({
        "id": "controlled", "version": "1", "backend": "opendrsai",
        "instructions": "deterministic", "permissions": ["tool:calculator"],
    }), encoding="utf-8")
    definitions = AgentDefinitionStore(assets, allowed_backends=("opendrsai",))
    calls: list[dict[str, int]] = []
    observed_models: list[str] = []
    implementation_digest = _digest("calculator-v1")
    schema_digest = _digest({"value": "integer"})

    def calculator(_context, arguments):
        clean_arguments = {"value": int(arguments["value"])}
        result = {"value": clean_arguments["value"] * 2}
        calls.append(clean_arguments)
        return {
            **result,
            "_replay_policy": {
                "classification": "pure", "tool_reference": "tool://calculator",
                "input_digest": _digest(clean_arguments),
                "implementation_digest": implementation_digest,
                "schema_digest": schema_digest,
                "result_digest": _digest(result),
                "current": {
                    "input_digest": _digest(clean_arguments),
                    "implementation_digest": implementation_digest,
                    "schema_digest": schema_digest,
                    "result_digest": _digest(result),
                },
            },
        }

    def model(_prompt, _definition, _context, history):
        observed_models.append(str(_definition.model or ""))
        if not history:
            return {"calls": [{"kind": "tool", "name": "calculator", "arguments": {"value": 21}}], "done": False}
        return {"calls": [], "content": "42", "done": True}

    dispatcher = RuntimeToolDispatcher(engine, tools={"calculator": calculator})
    service = RuntimeAgentService(
        engine, registry, definitions, dispatcher,
        {"opendrsai": OpenDrSaiAgentBackend(model)},
    )
    session = engine.create_session(workspace_record.workspace_id, "Controlled Replay")
    base, _ = engine.create_run(session["session_id"], "controlled@1", "base-controlled", "opendrsai")
    engine.set_run_input(base["run_id"], "calculate")
    asyncio.run(service.execute(base["run_id"], "calculate"))
    base_manifest_digest = engine.get_run_manifest(base["run_id"], safe=False)["manifest_digest"]
    assert calls == [{"value": 21}]

    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="controlled-draft", replay_mode="reuse_recorded_results",
    )
    draft = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="controlled-overrides",
        patch={"overrides": {
            "input": {"message": "calculate candidate"},
            "attachments": [{"reference": "workspace://controlled-input.txt", "required": True}],
            "model": {"provider_id": "test-provider", "model_id": "test-model"},
        }},
    )
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=draft["draft_version"],
        availability={
            "attachments": ["workspace://controlled-input.txt"],
            "models": ["test-provider/test-model"],
        },
    )
    pure_step = next(step for step in plan["steps"] if step["kind"] == "tool_call")
    assert pure_step["decision"] == "reuse"
    assert pure_step["source_event_id"].startswith("event-")
    assert "_replay_capability" not in pure_step

    prepared = engine.replay_executions.prepare(
        plan["replay_plan_id"], draft_version=draft["draft_version"], plan_digest=plan["plan_digest"],
        base_manifest_digest=plan["base_manifest_digest"], idempotency_key="controlled-execute",
    )
    internal = engine.replay_plans.get_execution_plan(plan["replay_plan_id"])
    reusable = next(step for step in internal["steps"] if step["kind"] == "tool_call")
    capability = reusable["_replay_capability"]
    dispatcher.install_replay_results(prepared["run"]["run_id"], [{
        "kind": capability["tool_kind"], "name": capability["tool_name"],
        "arguments": capability["arguments"], "result": capability["historical_result"],
        "source_event_id": reusable["source_event_id"],
    }])
    asyncio.run(service.execute(
        prepared["run"]["run_id"], prepared["prompt"], model_override=prepared["model_override"],
    ))

    assert calls == [{"value": 21}], "Pure Tool handler was called again during Replay"
    assert prepared["prompt"] == "calculate candidate"
    assert observed_models[-1] == "test-model"
    candidate_manifest = engine.get_run_manifest(prepared["run"]["run_id"], safe=False)["manifest"]
    assert candidate_manifest["model"] == {"id": "test-model", "provider": "test-provider"}
    assert candidate_manifest["attachments"][0]["ref"] == "workspace://controlled-input.txt"
    assert candidate_manifest["replay"]["effective_configuration"]["override_fields"] == [
        "attachments", "input", "model",
    ]
    replay_events = engine.list_events(prepared["run"]["run_id"])
    reused = next(event for event in replay_events if event["type"] == "tool.completed")
    assert reused["data"]["replay_decision"] == "reuse"
    assert reused["data"]["reused_from_event_id"] == pure_step["source_event_id"]
    assert engine.get_run_manifest(base["run_id"], safe=False)["manifest_digest"] == base_manifest_digest
    comparison = engine.run_comparisons.create(base["run_id"], prepared["run"]["run_id"])
    assert comparison["baseline_run_id"] == base["run_id"]
    assert engine.experiments.relations(prepared["run"]["run_id"])["parent"]["source_run_id"] == base["run_id"]

    resume_payload = {"history": [{"turn": 1, "content": "42", "results": [{"kind": "tool", "name": "calculator", "result": {"value": 42}}]}]}
    checkpoint = engine.save_checkpoint(base["run_id"], {
        "schema_version": RUNTIME_CHECKPOINT_SCHEMA_VERSION,
        "agent_state_digest": _digest(resume_payload),
        "model_context": {"messages_digest": _digest(["calculate", "42"])},
        "resume_payload": resume_payload,
        "compatibility": {"backend_id": "opendrsai", "agent_definition": "controlled@1"},
    })
    resume_draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="controlled-resume-draft",
        replay_mode="resume_from_checkpoint",
    )
    resume_plan = engine.replay_plans.create(
        resume_draft["experiment_id"], expected_draft_version=1,
        availability={"checkpoint_restore": True},
    )
    resume_internal = engine.replay_plans.get_execution_plan(resume_plan["replay_plan_id"])
    covered = next(step for step in resume_internal["steps"] if step["kind"] == "tool_call")
    assert covered["checkpoint_covered"] is True
    assert "_replay_capability" not in covered
    resumed = engine.replay_executions.prepare(
        resume_plan["replay_plan_id"], draft_version=1,
        plan_digest=resume_plan["plan_digest"], base_manifest_digest=resume_plan["base_manifest_digest"],
        idempotency_key="controlled-resume-execute",
    )
    asyncio.run(service.execute(
        resumed["run"]["run_id"], resumed["prompt"], checkpoint_state=checkpoint["state"],
    ))
    assert calls == [{"value": 21}], "Checkpoint-covered Pure Tool was invoked again"
    resume_events = engine.list_events(resumed["run"]["run_id"])
    assert sum(event["type"] == "agent.checkpoint.restored" for event in resume_events) == 1
    assert not any(event["type"] == "tool.completed" for event in resume_events)


def test_formal_agent_workspace_write_flows_to_snapshot_comparison_and_adoption_preview(tmp_path: Path) -> None:
    source_path = tmp_path / "source"
    source_path.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=source_path, check=True)
    subprocess.run(["git", "config", "user.name", "OpenDrSai Test"], cwd=source_path, check=True)
    subprocess.run(["git", "config", "user.email", "test@opendrsai.local"], cwd=source_path, check=True)
    (source_path / "README.md").write_text("baseline\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=source_path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "baseline"], cwd=source_path, check=True)

    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    source = registry.open_workspace(str(source_path))
    worktrees = GitWorktreeService(registry, tmp_path / "worktrees")
    candidate_worktree = worktrees.create(
        source_workspace_id=source.workspace_id, idempotency_key="formal-agent-candidate", intent="experiment",
    )
    assert candidate_worktree.workspace_id
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda workspace_id: registry.get_workspace(workspace_id) is not None,
        lambda workspace_id: (record.worktree_id if (record := registry.get_worktree_by_workspace(workspace_id)) else None),
    )
    assets = tmp_path / "agents"
    definition_path = assets / "writer" / "1.json"
    definition_path.parent.mkdir(parents=True)
    definition_path.write_text(json.dumps({
        "id": "writer", "version": "1", "backend": "opendrsai",
        "instructions": "controlled writer", "permissions": ["tool:file_writer"],
    }), encoding="utf-8")

    def file_writer(context, arguments):
        relative = str(arguments["path"])
        destination = (context.workspace_path / relative).resolve()
        destination.relative_to(context.workspace_path.resolve())
        destination.write_text(str(arguments["content"]), encoding="utf-8")
        return {"path": relative, "written": True}

    def model(prompt, _definition, _context, history):
        if "candidate" in prompt and not history:
            return {"calls": [{"kind": "tool", "name": "file_writer", "arguments": {"path": "agent-result.txt", "content": "created by formal Agent execute\n"}}], "done": False}
        return {"calls": [], "content": "candidate complete" if "candidate" in prompt else "baseline complete", "done": True}

    service = RuntimeAgentService(
        engine, registry, AgentDefinitionStore(assets, allowed_backends=("opendrsai",)),
        RuntimeToolDispatcher(engine, tools={"file_writer": file_writer}),
        {"opendrsai": OpenDrSaiAgentBackend(model)},
    )
    baseline_session = engine.create_session(source.workspace_id, "Baseline")
    baseline, _ = engine.create_run(baseline_session["session_id"], "writer@1", "formal-baseline", "opendrsai")
    engine.set_run_input(baseline["run_id"], "baseline")
    asyncio.run(service.execute(baseline["run_id"], "baseline"))

    candidate_session = engine.create_session(candidate_worktree.workspace_id, "Candidate")
    candidate, _ = engine.create_run(candidate_session["session_id"], "writer@1", "formal-candidate", "opendrsai")
    engine.set_run_input(candidate["run_id"], "candidate")
    asyncio.run(service.execute(candidate["run_id"], "candidate"))
    assert not (source_path / "agent-result.txt").exists(), "Source Workspace changed before adoption"

    experiment, _ = engine.experiments.create(
        baseline["run_id"], created_by="controlled-e2e", idempotency_key="formal-agent-experiment",
    )
    engine.experiments.mark_executed(experiment["experiment_id"], candidate["run_id"])

    snapshot = worktrees.finalize_candidate_snapshot(
        source.workspace_id, candidate_worktree.worktree_id,
        experiment_id=experiment["experiment_id"], run_id=candidate["run_id"],
    )
    assert snapshot["snapshot_created"] is True
    assert snapshot["candidate_head"]
    engine.append_backend_event(candidate["run_id"], "run.experiment.candidate_snapshot", {
        "experiment_id": experiment["experiment_id"], "worktree_id": candidate_worktree.worktree_id,
        "candidate_head": snapshot["candidate_head"], "status_digest": snapshot["status_digest"],
        "change_count": snapshot["change_count"], "snapshot_created": snapshot["snapshot_created"],
    }, f"experiment-candidate-snapshot:{experiment['experiment_id']}")
    comparison = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    assert comparison["candidate_snapshot"]["candidate_head"] == snapshot["candidate_head"]
    preview = worktrees.adoption_preview(source.workspace_id, candidate_worktree.worktree_id)
    assert any(change.get("path") == "agent-result.txt" for change in preview["changes"])
    adoption = engine.adoptions.record_preview(
        comparison["comparison_id"], source.workspace_id, candidate_worktree.worktree_id, preview,
    )
    assert adoption["status"] == "previewed"
    assert not (source_path / "agent-result.txt").exists(), "Preview mutated the source Workspace"
