from __future__ import annotations

import sqlite3
import hashlib
import json
from pathlib import Path

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.replay_planner import RUNTIME_CHECKPOINT_SCHEMA_VERSION


def _runtime(tmp_path: Path):
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-planner", "instance-planner"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Planner")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "planner-run", "codex")
    engine.set_run_input(run["run_id"], "baseline")
    draft, _ = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key="planner-draft",
    )
    return engine, engine.get_run(run["run_id"]), draft


def test_only_compatible_runtime_checkpoint_is_resumable(tmp_path: Path) -> None:
    engine, run, _ = _runtime(tmp_path)
    without = engine.replay_plans.boundaries(run["run_id"])
    assert without["runtime_checkpoint"] is None
    assert without["items"] and all(not item["resumable"] for item in without["items"])

    engine.save_checkpoint(run["run_id"], {"turn": 1})
    legacy = engine.replay_plans.boundaries(run["run_id"])
    assert legacy["runtime_checkpoint"]["resumable"] is False
    resume_payload = {"history": [{"turn": 1, "content": "checkpoint"}]}
    compatible_state = {
        "schema_version": RUNTIME_CHECKPOINT_SCHEMA_VERSION,
        "agent_state_digest": "sha256:" + hashlib.sha256(json.dumps(resume_payload, separators=(",", ":"), sort_keys=True).encode()).hexdigest(),
        "model_context": {"messages_digest": "sha256:" + "b" * 64},
        "resume_payload": resume_payload,
        "compatibility": {"backend_id": "codex", "agent_definition": "agent@v1"},
    }
    engine.save_checkpoint(run["run_id"], compatible_state)
    compatible = engine.replay_plans.boundaries(run["run_id"])
    assert compatible["runtime_checkpoint"]["resumable"] is True


def test_checkpoint_schema_is_fail_closed_for_n_minus_one_and_tolerates_optional_fields(tmp_path: Path) -> None:
    engine, run, _ = _runtime(tmp_path)
    resume_payload = {"history": [{"turn": 1}]}
    previous_schema = {
        "schema_version": "opendrsai.runtime-checkpoint/0",
        "agent_state_digest": "sha256:" + hashlib.sha256(json.dumps(resume_payload, separators=(",", ":"), sort_keys=True).encode()).hexdigest(),
        "model_context": {"messages_digest": "sha256:" + "b" * 64},
        "resume_payload": resume_payload,
        "compatibility": {"backend_id": "codex", "agent_definition": "agent@v1"},
    }
    engine.save_checkpoint(run["run_id"], previous_schema)
    legacy = engine.replay_plans.boundaries(run["run_id"])["runtime_checkpoint"]
    assert legacy["resumable"] is False
    assert "schema_version" in legacy["missing_or_incompatible"]

    current_with_future_optional = {
        **previous_schema,
        "schema_version": RUNTIME_CHECKPOINT_SCHEMA_VERSION,
        "future_optional": {"producer_hint": "ignored-by-v1"},
    }
    engine.save_checkpoint(run["run_id"], current_with_future_optional)
    current = engine.replay_plans.boundaries(run["run_id"])["runtime_checkpoint"]
    assert current["resumable"] is True
    assert current["missing_or_incompatible"] == []


def test_plan_has_explicit_decisions_blockers_risks_and_honest_estimate(tmp_path: Path) -> None:
    engine, run, draft = _runtime(tmp_path)
    engine.append_event(run["run_id"], "agent.item.tool.delta", {
        "item_id": "tool-one", "name": "unknown-external-tool", "status": "completed",
    })
    changed = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="plan-overrides",
        patch={"overrides": {
            "model": {"provider_id": "openai", "model_id": "missing-model"},
            "attachments": [{"reference": "workspace://missing.csv", "required": True}],
        }},
    )
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=changed["draft_version"], availability={},
    )
    assert {step["decision"] for step in plan["steps"]} <= {"reuse", "reexecute", "isolate", "block"}
    assert any(step["decision"] == "block" for step in plan["steps"])
    assert {blocker["code"] for blocker in plan["blockers"]} >= {"model_unavailable", "resource_unavailable"}
    assert plan["estimate"]["monetary_cost"] is None
    assert plan["estimate"]["monetary_cost_known"] is False
    assert plan["executable"] is False


def test_plan_is_immutable_and_becomes_stale_after_draft_manifest_or_expiry(tmp_path: Path) -> None:
    engine, run, draft = _runtime(tmp_path)
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=1, availability={}, expires_in_seconds=60,
    )
    first_digest = plan["plan_digest"]
    changed = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="later-edit",
        patch={"title": "Edited after plan"},
    )
    stale = engine.replay_plans.get(plan["replay_plan_id"])
    assert stale["stale"] and "draft_version_changed" in stale["stale_reasons"]
    assert stale["plan_digest"] == first_digest
    newer = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=changed["draft_version"], availability={},
    )
    engine.update_run_manifest(run["run_id"], {"environment": {"image_digest": "changed"}})
    assert "base_manifest_changed" in engine.replay_plans.get(newer["replay_plan_id"])["stale_reasons"]
    with sqlite3.connect(engine.database) as db:
        db.execute(
            "UPDATE runtime_replay_plans SET expires_at='2000-01-01T00:00:00+00:00' WHERE replay_plan_id=?",
            (newer["replay_plan_id"],),
        )
    assert "expired" in engine.replay_plans.get(newer["replay_plan_id"])["stale_reasons"]


def test_resume_mode_blocks_without_compatible_checkpoint(tmp_path: Path) -> None:
    engine, _, draft = _runtime(tmp_path)
    changed = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="resume-mode",
        patch={"replay_mode": "resume_from_checkpoint"},
    )
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=changed["draft_version"], availability={},
    )
    assert plan["steps"][0]["kind"] == "runtime_checkpoint"
    assert plan["steps"][0]["decision"] == "block"
    assert any(blocker["code"] == "checkpoint_incompatible" for blocker in plan["blockers"])


def test_plan_applies_tool_policy_for_pure_mutable_and_external_tools(tmp_path: Path) -> None:
    engine, run, draft = _runtime(tmp_path)
    digest = lambda char: "sha256:" + char * 64
    value_digest = lambda value: "sha256:" + hashlib.sha256(
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()
    policies = {
        "pure": {
            "classification": "pure", "tool_reference": "tool://calculator",
            "input_digest": value_digest({"value": 2}), "implementation_digest": digest("2"),
            "schema_digest": digest("3"), "result_digest": value_digest({"value": 4}),
            "source_event_id": "event-pure",
            "current": {"input_digest": value_digest({"value": 2}), "implementation_digest": digest("2"),
                        "schema_digest": digest("3"), "result_digest": value_digest({"value": 4})},
        },
        "mutable": {"classification": "read_only_mutable", "tool_reference": "tool://weather", "source_event_id": "event-weather"},
        "external": {"classification": "external_write", "tool_reference": "tool://email-send"},
    }
    for name, replay_policy in policies.items():
        engine.append_event(run["run_id"], "agent.item.tool.delta", {
            "item_id": f"tool-{name}", "name": name, "status": "completed",
            "arguments": {"value": 2}, "result": {"value": 4},
            "replay_policy": replay_policy,
        })
    engine.record_tool_replay_evidence(
        run["run_id"], f"codex:{run['run_id']}:tool-pure", "event-pure",
        {"value": 2}, {"value": 4}, policies["pure"],
    )
    engine.record_tool_replay_evidence(
        run["run_id"], f"codex:{run['run_id']}:tool-mutable", "event-weather",
        {"value": 2}, {"value": 4}, policies["mutable"],
    )
    draft = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="reuse-policy-mode",
        patch={"replay_mode": "reuse_recorded_results"},
    )
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=draft["draft_version"],
    )
    by_item = {str(step.get("item_id")).rsplit(":", 1)[-1]: step for step in plan["steps"]}
    assert by_item["tool-pure"]["decision"] == "reuse"
    assert by_item["tool-pure"]["source_event_id"] == "event-pure"
    assert "_replay_capability" not in by_item["tool-pure"]
    internal = engine.replay_plans.get_execution_plan(plan["replay_plan_id"])
    pure = next(step for step in internal["steps"] if step.get("source_event_id") == "event-pure")
    assert pure["_replay_capability"]["arguments"] == {"value": 2}
    assert pure["_replay_capability"]["historical_result"] == {"value": 4}
    assert by_item["tool-mutable"]["decision"] == "reexecute"
    mutable = next(step for step in internal["steps"] if step.get("item_id", "").endswith("tool-mutable"))
    assert mutable["_replay_capability"]["arguments"] == {"value": 2}
    assert by_item["tool-mutable"]["comparison_required"] is True
    assert by_item["tool-external"]["decision"] == "block"
    assert any(blocker["code"] == "external_side_effect_requires_approval" for blocker in plan["blockers"])
    assert plan["executable"] is False


def test_fresh_and_safe_reexecute_modes_do_not_reuse_matching_pure_tool_results(tmp_path: Path) -> None:
    for mode in ("rerun_from_start", "reexecute_safe_steps"):
        engine, run, draft = _runtime(tmp_path / mode)
        arguments, result = {"value": 2}, {"value": 4}
        value_digest = lambda value: "sha256:" + hashlib.sha256(
            json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
        ).hexdigest()
        policy = {
            "classification": "pure", "tool_reference": "tool://calculator",
            "input_digest": value_digest(arguments), "implementation_digest": "sha256:" + "2" * 64,
            "schema_digest": "sha256:" + "3" * 64, "result_digest": value_digest(result),
            "source_event_id": "event-pure",
            "current": {
                "input_digest": value_digest(arguments), "implementation_digest": "sha256:" + "2" * 64,
                "schema_digest": "sha256:" + "3" * 64, "result_digest": value_digest(result),
            },
        }
        engine.append_event(run["run_id"], "agent.item.tool.delta", {
            "item_id": "tool-pure", "name": "calculator", "status": "completed",
            "arguments": arguments, "result": result, "replay_policy": policy,
        })
        engine.record_tool_replay_evidence(
            run["run_id"], f"codex:{run['run_id']}:tool-pure", "event-pure",
            arguments, result, policy,
        )
        if mode != draft["replay_mode"]:
            draft = engine.experiments.update(
                draft["experiment_id"], expected_version=1, idempotency_key=f"mode-{mode}",
                patch={"replay_mode": mode},
            )
        plan = engine.replay_plans.create(
            draft["experiment_id"], expected_draft_version=draft["draft_version"],
        )
        pure = next(step for step in plan["steps"] if step.get("item_id", "").endswith(":tool-pure"))
        assert pure["decision"] == "reexecute"
        assert pure["reason_code"] == "replay_mode_requires_reexecution"


def test_missing_remote_worktree_capability_degrades_isolated_replay_to_read_only(tmp_path: Path) -> None:
    engine, run, draft = _runtime(tmp_path)
    engine.append_event(run["run_id"], "agent.item.file_change", {
        "item_id": "write-one", "phase": "completed", "item": {
            "id": "write-one", "type": "file_change",
            "changes": [{"path": "result.txt", "operation": "modify"}],
        },
    })
    plan = engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=1,
        availability={"worktree": False, "runtime_location": "remote"},
    )
    write_step = next(step for step in plan["steps"] if step.get("item_id", "").endswith(":write-one"))
    assert write_step["decision"] == "block"
    assert plan["executable"] is False
    assert any(blocker["code"] == "worktree_capability_unavailable" for blocker in plan["blockers"])
