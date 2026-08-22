from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.experiments import ExperimentConflict
from drsai.backend.runtime.replay_planner import RUNTIME_CHECKPOINT_SCHEMA_VERSION


def _case(tmp_path: Path, mode: str = "rerun_from_start"):
    engine = RuntimeEngine(
        tmp_path / f"{mode}.sqlite3",
        RuntimeEngineIdentity(f"runtime-{mode}", "instance-replay"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", f"Replay {mode}")
    base, _ = engine.create_run(session["session_id"], "agent@v1", f"base-{mode}", "codex")
    engine.set_run_input(base["run_id"], "baseline replay input")
    if mode == "resume_from_checkpoint":
        resume_payload = {"history": [{"turn": 1, "content": "checkpoint"}]}
        engine.save_checkpoint(base["run_id"], {
            "schema_version": RUNTIME_CHECKPOINT_SCHEMA_VERSION,
            "agent_state_digest": "sha256:" + hashlib.sha256(json.dumps(resume_payload, separators=(",", ":"), sort_keys=True).encode()).hexdigest(),
            "model_context": {"messages_digest": "sha256:" + "b" * 64},
            "resume_payload": resume_payload,
            "compatibility": {"backend_id": "codex", "agent_definition": "agent@v1"},
        })
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key=f"draft-{mode}", replay_mode=mode,
    )
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    return engine, base, draft, plan


def _prepare(engine: RuntimeEngine, plan: dict, key: str = "execute-one"):
    return engine.replay_executions.prepare(
        plan["replay_plan_id"], draft_version=plan["draft_version"],
        plan_digest=plan["plan_digest"], base_manifest_digest=plan["base_manifest_digest"],
        idempotency_key=key,
    )


def test_replay_run_has_immutable_lineage_and_manifest_binding(tmp_path: Path) -> None:
    engine, base, draft, plan = _case(tmp_path)
    prepared = _prepare(engine, plan)
    replay = prepared["run"]
    manifest = engine.get_run_manifest(replay["run_id"], safe=False)["manifest"]
    assert replay["parent_run_id"] == base["run_id"]
    assert replay["run_id"] != base["run_id"]
    assert manifest["replay"]["plan_digest"] == plan["plan_digest"]
    assert manifest["replay"]["replay_mode"] == "rerun_from_start"
    assert engine.experiments.get(draft["experiment_id"])["executed_run_id"] == replay["run_id"]
    relation = engine.experiments.relations(replay["run_id"])["parent"]
    assert relation["relation_type"] == "experiment_replay"


def test_preflight_rejects_stale_binding_before_materializing_execution(tmp_path: Path) -> None:
    engine, _, _, plan = _case(tmp_path)
    with pytest.raises(ExperimentConflict, match="binding"):
        engine.replay_executions.preflight(
            plan["replay_plan_id"], draft_version=plan["draft_version"],
            plan_digest="sha256:" + "0" * 64,
            base_manifest_digest=plan["base_manifest_digest"],
            idempotency_key="preflight-invalid",
        )
    with engine.replay_executions._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM runtime_replay_executions").fetchone()[0] == 0
    assert engine.experiments.get(plan["experiment_id"])["status"] == "draft"


def test_claimed_execution_failure_terminalizes_run_exactly_once(tmp_path: Path) -> None:
    engine, _, _, plan = _case(tmp_path)
    prepared = _prepare(engine, plan, "terminal-failure")
    assert engine.replay_executions.claim_execution(plan["replay_plan_id"]) is True
    engine.transition_run(prepared["run"]["run_id"], "running")

    assert engine.replay_executions.fail_execution(
        plan["replay_plan_id"], phase="tool_binding", code="binding_invalid",
    ) is True
    assert engine.replay_executions.fail_execution(
        plan["replay_plan_id"], phase="tool_binding", code="binding_invalid",
    ) is False
    assert engine.get_run(prepared["run"]["run_id"])["status"] == "failed"
    failures = [
        event for event in engine.list_events(prepared["run"]["run_id"])
        if event["type"] == "run.replay.execution_failed"
    ]
    assert len(failures) == 1
    assert failures[0]["data"]["code"] == "binding_invalid"


def test_supported_overrides_become_candidate_input_and_manifest_evidence(tmp_path: Path) -> None:
    engine, base, draft, _ = _case(tmp_path)
    base_manifest_digest = engine.get_run_manifest(base["run_id"], safe=False)["manifest_digest"]
    updated = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="supported-overrides",
        patch={"overrides": {
            "input": {"message": "candidate input"},
            "attachments": [{"reference": "workspace://candidate.png", "required": True}],
            "model": {"provider_id": "openai", "model_id": "gpt-candidate"},
        }},
    )
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=updated["draft_version"],
        availability={
            "attachments": ["workspace://candidate.png"],
            "models": ["openai/gpt-candidate"],
        },
    )
    prepared = _prepare(engine, plan, "supported-overrides-execute")
    candidate = engine.get_run(prepared["run"]["run_id"])
    manifest = engine.get_run_manifest(candidate["run_id"], safe=False)["manifest"]

    assert prepared["prompt"] == "candidate input"
    assert prepared["model_override"] == "gpt-candidate"
    assert prepared["model_selection"] == {"provider_id": "openai", "model_id": "gpt-candidate"}
    assert candidate["input_message"] == "candidate input"
    assert candidate["attachment_refs"] == ["workspace://candidate.png"]
    assert manifest["model"]["id"] == "gpt-candidate"
    assert manifest["model"]["provider"] == "openai"
    assert manifest["input"]["sha256"]
    assert manifest["attachments"][0]["ref"] == "workspace://candidate.png"
    assert manifest["replay"]["effective_configuration"] == {
        "overrides_digest": updated["overrides_digest"],
        "override_fields": ["attachments", "input", "model"],
        "attachment_count": 1,
        "model": {"provider_id": "openai", "model_id": "gpt-candidate"},
    }
    assert engine.get_run_manifest(base["run_id"], safe=False)["manifest_digest"] == base_manifest_digest


@pytest.mark.parametrize("mode,event_type", [
    ("rerun_from_start", None),
    ("reuse_recorded_results", "run.replay.context_reused"),
    ("resume_from_checkpoint", "run.replay.checkpoint_restored"),
])
def test_replay_modes_materialize_reviewed_behavior(tmp_path: Path, mode: str, event_type: str | None) -> None:
    engine, _, _, plan = _case(tmp_path, mode)
    prepared = _prepare(engine, plan)
    assert prepared["run"]["status"] == "queued"
    event_types = {event["type"] for event in engine.list_events(prepared["run"]["run_id"])}
    if event_type:
        assert event_type in event_types


def test_reexecute_safe_steps_waits_for_approval(tmp_path: Path) -> None:
    engine, _, _, plan = _case(tmp_path, "reexecute_safe_steps")
    prepared = _prepare(engine, plan)
    assert prepared["run"]["status"] == "waiting_approval"
    assert prepared["approval"]["status"] == "pending"


def test_reexecute_safe_steps_continues_once_after_bound_approval(tmp_path: Path) -> None:
    engine, _, _, plan = _case(tmp_path, "reexecute_safe_steps")
    prepared = _prepare(engine, plan)
    approval_id = prepared["approval"]["approval_id"]
    engine.resolve_approval(approval_id, "approved", {"idempotency_key": "approve-replay-step"})

    resumed = _prepare(engine, plan)
    assert resumed["created"] is False
    assert resumed["prompt"] == "baseline replay input"

    assert engine.replay_executions.claim_execution(
        plan["replay_plan_id"], runtime_approval_id=approval_id,
    ) is True
    assert engine.replay_executions.claim_execution(
        plan["replay_plan_id"], runtime_approval_id=approval_id,
    ) is False


def test_reexecute_safe_steps_rejects_missing_or_mismatched_approval(tmp_path: Path) -> None:
    engine, _, _, plan = _case(tmp_path, "reexecute_safe_steps")
    prepared = _prepare(engine, plan)
    with pytest.raises(ExperimentConflict, match="approval binding"):
        engine.replay_executions.claim_execution(plan["replay_plan_id"])
    with pytest.raises(ExperimentConflict, match="approval binding"):
        engine.replay_executions.claim_execution(
            plan["replay_plan_id"], runtime_approval_id="approval-other",
        )
    with pytest.raises(ExperimentConflict, match="has not been approved"):
        engine.replay_executions.claim_execution(
            plan["replay_plan_id"], runtime_approval_id=prepared["approval"]["approval_id"],
        )


@pytest.mark.parametrize("phase", ["model_stream", "tool_execution"])
def test_restart_fails_inflight_replay_without_automatic_retry(
    tmp_path: Path, phase: str,
) -> None:
    database = tmp_path / "restart.sqlite3"
    identity = RuntimeEngineIdentity("runtime-restart", "instance-restart")
    engine = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
    session = engine.create_session("workspace-one", "Restart replay")
    base, _ = engine.create_run(session["session_id"], "agent@v1", "restart-base", "codex")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user", idempotency_key="restart-draft",
    )
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    replay = _prepare(engine, plan)["run"]
    assert engine.replay_executions.claim_execution(plan["replay_plan_id"]) is True
    engine.transition_run(replay["run_id"], "running")
    engine.mark_replay_execution_phase(replay["run_id"], phase)

    recovered = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
    assert recovered.get_run(replay["run_id"])["status"] == "failed"
    interrupted = [event for event in recovered.list_events(replay["run_id"]) if event["type"] == "run.replay.interrupted"]
    assert len(interrupted) == 1
    assert interrupted[0]["data"]["automatic_retry"] is False
    assert interrupted[0]["data"]["phase"] == phase
    notices = [item for item in recovered.inspect_run(replay["run_id"])["timeline"] if item["type"] == "notice"]
    assert len(notices) == 1
    assert notices[0]["status"] == "failed"
    assert notices[0]["content"]["code"] == "replay_interrupted"
    assert notices[0]["content"]["message"] == (
        "Replay was interrupted because the Runtime process restarted. "
        "Automatic retry was not attempted."
    )
    assert recovered.replay_executions.claim_execution(plan["replay_plan_id"]) is False


def test_restart_after_terminal_commit_finishes_execution_without_corrupting_run(tmp_path: Path) -> None:
    database = tmp_path / "terminal-restart.sqlite3"
    identity = RuntimeEngineIdentity("runtime-terminal-restart", "instance-restart")
    engine = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
    session = engine.create_session("workspace-one", "Terminal restart replay")
    base, _ = engine.create_run(session["session_id"], "agent@v1", "terminal-base", "codex")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user", idempotency_key="terminal-restart-draft",
    )
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    replay = _prepare(engine, plan)["run"]
    assert engine.replay_executions.claim_execution(plan["replay_plan_id"]) is True
    engine.transition_run(replay["run_id"], "running")
    engine.mark_replay_execution_phase(replay["run_id"], "terminal_finalization")
    engine.transition_run(replay["run_id"], "completed")

    recovered = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
    assert recovered.get_run(replay["run_id"])["status"] == "completed"
    assert not [
        event for event in recovered.list_events(replay["run_id"])
        if event["type"] == "run.replay.interrupted"
    ]
    with recovered.replay_executions._connect() as db:
        execution = db.execute(
            "SELECT status,execution_phase FROM runtime_replay_executions WHERE replay_plan_id=?",
            (plan["replay_plan_id"],),
        ).fetchone()
    assert execution is not None
    assert execution["status"] == "finished"
    assert execution["execution_phase"] == "terminal_finalization"


def test_concurrent_restart_reconciliation_has_one_winner(tmp_path: Path) -> None:
    database = tmp_path / "concurrent-restart.sqlite3"
    identity = RuntimeEngineIdentity("runtime-concurrent-restart", "instance-restart")
    engine = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
    session = engine.create_session("workspace-one", "Concurrent restart replay")
    base, _ = engine.create_run(session["session_id"], "agent@v1", "concurrent-base", "codex")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user", idempotency_key="concurrent-restart-draft",
    )
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    replay = _prepare(engine, plan)["run"]
    assert engine.replay_executions.claim_execution(plan["replay_plan_id"]) is True
    engine.transition_run(replay["run_id"], "running")
    engine.mark_replay_execution_phase(replay["run_id"], "tool_execution")

    def recover() -> str:
        recovered = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
        return recovered.get_run(replay["run_id"])["status"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda _: recover(), range(2)))
    assert statuses == ["failed", "failed"]
    inspected = RuntimeEngine(database, identity, lambda workspace_id: workspace_id == "workspace-one")
    interrupted = [
        event for event in inspected.list_events(replay["run_id"])
        if event["type"] == "run.replay.interrupted"
    ]
    assert len(interrupted) == 1
    assert interrupted[0]["data"]["phase"] == "tool_execution"


def test_execution_is_idempotent_under_double_click_and_retry(tmp_path: Path) -> None:
    engine, _, _, plan = _case(tmp_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: _prepare(engine, plan), range(2)))
    assert {result["run"]["run_id"] for result in results}.__len__() == 1
    assert sorted(result["created"] for result in results) == [False, True]
    with pytest.raises(ExperimentConflict):
        _prepare(engine, plan, key="different-execution-key")


def test_binding_mismatch_and_stale_plan_fail_before_new_run(tmp_path: Path) -> None:
    engine, _, draft, plan = _case(tmp_path)
    before = len(engine.list_session_runs(draft["session_id"]))
    with pytest.raises(ExperimentConflict):
        engine.replay_executions.prepare(
            plan["replay_plan_id"], draft_version=1,
            plan_digest="sha256:" + "f" * 64,
            base_manifest_digest=plan["base_manifest_digest"], idempotency_key="bad-binding",
        )
    engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="stale-plan",
        patch={"title": "changed"},
    )
    with pytest.raises(ExperimentConflict):
        _prepare(engine, plan)
    assert len(engine.list_session_runs(draft["session_id"])) == before


def test_created_replay_run_supports_success_failure_and_cancellation_lifecycle(tmp_path: Path) -> None:
    for index, terminal in enumerate(("completed", "failed", "cancelled")):
        engine, _, _, plan = _case(tmp_path / str(index))
        replay = _prepare(engine, plan)["run"]
        if terminal == "completed":
            engine.transition_run(replay["run_id"], "running")
            result = engine.transition_run(replay["run_id"], "completed")
        else:
            result = engine.transition_run(replay["run_id"], terminal)
        assert result["status"] == terminal


def test_workspace_writes_run_in_a_separate_worktree_session(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "isolated.sqlite3",
        RuntimeEngineIdentity("runtime-isolated", "instance-isolated"),
        lambda workspace_id: workspace_id in {"workspace-source", "workspace-derived"},
        lambda workspace_id: "worktree-experiment" if workspace_id == "workspace-derived" else None,
    )
    session = engine.create_session("workspace-source", "Baseline")
    base, _ = engine.create_run(session["session_id"], "agent@v1", "isolated-base", "codex")
    engine.set_run_input(base["run_id"], "baseline")
    engine.append_event(base["run_id"], "agent.item.command.delta", {
        "item_id": "command-one", "command": ["git", "status"], "status": "completed",
    })
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="isolated-draft",
    )
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    assert any(step["decision"] == "isolate" for step in plan["steps"])

    prepared = engine.replay_executions.prepare(
        plan["replay_plan_id"], draft_version=plan["draft_version"],
        plan_digest=plan["plan_digest"], base_manifest_digest=plan["base_manifest_digest"],
        idempotency_key="isolated-execution", approval_id="approval-one",
        isolated_worktree_id="worktree-experiment", isolated_workspace_id="workspace-derived",
    )
    replay = prepared["run"]
    assert replay["workspace_id"] == "workspace-derived"
    assert replay["worktree_id"] == "worktree-experiment"
    assert replay["session_id"] != base["session_id"]
    assert replay["parent_run_id"] is None
    assert engine.experiments.relations(replay["run_id"])["parent"]["source_run_id"] == base["run_id"]


def test_from_start_execution_honors_gateway_bound_isolated_worktree(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "from-start-isolated.sqlite3",
        RuntimeEngineIdentity("runtime-from-start", "instance-isolated"),
        lambda workspace_id: workspace_id in {"workspace-source", "workspace-derived"},
        lambda workspace_id: "worktree-experiment" if workspace_id == "workspace-derived" else None,
    )
    session = engine.create_session("workspace-source", "Baseline")
    base, _ = engine.create_run(session["session_id"], "agent@v1", "from-start-base", "codex")
    engine.set_run_input(base["run_id"], "baseline")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="from-start-draft",
        replay_mode="rerun_from_start",
    )
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    assert not any(step["decision"] == "isolate" for step in plan["steps"])

    prepared = engine.replay_executions.prepare(
        plan["replay_plan_id"], draft_version=plan["draft_version"],
        plan_digest=plan["plan_digest"], base_manifest_digest=plan["base_manifest_digest"],
        idempotency_key="from-start-execution", approval_id="approval-one",
        isolated_worktree_id="worktree-experiment", isolated_workspace_id="workspace-derived",
    )

    replay = prepared["run"]
    assert replay["workspace_id"] == "workspace-derived"
    assert replay["worktree_id"] == "worktree-experiment"
    assert replay["session_id"] != base["session_id"]
    assert replay["parent_run_id"] is None


def test_isolated_execution_retry_reuses_reserved_session_and_run(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "isolated-retry.sqlite3",
        RuntimeEngineIdentity("runtime-isolated-retry", "instance-isolated"),
        lambda workspace_id: workspace_id in {"workspace-source", "workspace-derived"},
        lambda workspace_id: "worktree-experiment" if workspace_id == "workspace-derived" else None,
    )
    session = engine.create_session("workspace-source", "Baseline")
    base, _ = engine.create_run(session["session_id"], "agent@v1", "retry-base", "codex")
    engine.append_event(base["run_id"], "agent.item.command.delta", {
        "item_id": "command-one", "command": ["git", "status"], "status": "completed",
    })
    draft, _ = engine.experiments.create(base["run_id"], created_by="user", idempotency_key="retry-draft")
    plan = engine.replay_plans.create(draft["experiment_id"], expected_draft_version=1)
    arguments = dict(
        draft_version=1, plan_digest=plan["plan_digest"],
        base_manifest_digest=plan["base_manifest_digest"], idempotency_key="retry-execution",
        approval_id="approval", isolated_worktree_id="worktree-experiment",
        isolated_workspace_id="workspace-derived",
    )
    original = engine.replay_executions._set_run_input
    engine.replay_executions._set_run_input = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("fault"))
    with pytest.raises(RuntimeError, match="fault"):
        engine.replay_executions.prepare(plan["replay_plan_id"], **arguments)
    engine.replay_executions._set_run_input = original

    recovered = engine.replay_executions.prepare(plan["replay_plan_id"], **arguments)
    derived_sessions = engine.list_sessions("workspace-derived")["data"]
    assert len(derived_sessions) == 1
    assert len(engine.list_session_runs(derived_sessions[0]["session_id"])) == 1
    assert recovered["run"]["worktree_id"] == "worktree-experiment"
