from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.agent_kernel import build_tool_choice_policy, build_tool_decision_requirement
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope
from drsai.backend.runtime.mobile_core.plan_state import (
    PLAN_SCHEMA_VERSION,
    event_kind,
    normalize_plan_state,
    normalize_plan_update,
)


def _update(version: int, statuses: list[str]) -> dict:
    return {
        "expected_version": version,
        "text": "Implement and verify",
        "explanation": "Shared deterministic plan",
        "steps": [
            {"id": f"step-{index + 1}", "title": f"Step {index + 1}", "status": status}
            for index, status in enumerate(statuses)
        ],
    }


def _command(message_type: MessageType, sequence: int, payload: dict, *, key: str | None = None) -> RuntimeEnvelope:
    return RuntimeEnvelope(
        message_type, f"request-{sequence}", "run-plan", "session-plan", sequence,
        key or f"command-{sequence}", payload,
    )


def _tool() -> dict:
    return {
        "name": "core.update_plan", "version": 1, "source": "shared-core", "classification": "shared",
        "description": "Plan", "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def test_create_update_complete_and_fail_use_one_versioned_state_machine() -> None:
    created = normalize_plan_update({}, {**_update(0, ["in_progress", "pending"]), "item_id": "run:plan"})
    assert created["schema_version"] == PLAN_SCHEMA_VERSION
    assert created["version"] == 1 and created["status"] == "running"
    assert event_kind(created) == "plan.started"

    updated = normalize_plan_update(created, _update(1, ["completed", "in_progress"]))
    assert updated["version"] == 2 and event_kind(updated) == "plan.updated"
    completed = normalize_plan_update(updated, _update(2, ["completed", "completed"]))
    assert completed["status"] == "completed" and event_kind(completed) == "plan.completed"
    assert normalize_plan_state(completed) == completed

    failed = normalize_plan_update({}, _update(0, ["failed", "pending"]))
    assert failed["status"] == "failed" and event_kind(failed) == "plan.failed"


def test_invalid_steps_terminal_regression_and_concurrent_version_fail_closed() -> None:
    with pytest.raises(ValueError, match="multiple_in_progress"):
        normalize_plan_update({}, _update(0, ["in_progress", "in_progress"]))
    with pytest.raises(ValueError, match="step_invalid"):
        normalize_plan_update({}, {"expected_version": 0, "steps": [
            {"id": "same", "title": "A", "status": "pending"},
            {"id": "same", "title": "B", "status": "pending"},
        ]})
    created = normalize_plan_update({}, _update(0, ["completed"]))
    with pytest.raises(ValueError, match="version_conflict"):
        normalize_plan_update(created, _update(0, ["completed"]))
    with pytest.raises(ValueError, match="terminal_step_changed"):
        normalize_plan_update(created, _update(1, ["in_progress"]))


@pytest.mark.parametrize("surface", ["android", "desktop"])
def test_kernel_replay_and_checkpoint_recovery_keep_one_identical_plan(surface: str) -> None:
    kernel = create_agent_kernel(surface=surface)
    kernel.handle(_command(MessageType.START_RUN, 0, {
        "input": "plan", "model_id": "model", "tools": [_tool()],
    }))
    plan_command = _command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [{
        "call_id": "plan-call", "name": "core.update_plan", "arguments": _update(0, ["in_progress", "pending"]),
    }]})
    first = kernel.handle(plan_command)
    replay = kernel.handle(plan_command)
    assert replay == first
    snapshot = kernel.snapshot("run-plan")
    assert snapshot["plan_state"]["version"] == 1
    assert len([item for item in first if item.payload.get("kind") == "plan.started"]) == 1

    recovered = create_agent_kernel(surface=surface)
    recovered.handle(_command(MessageType.RESUME_RUN, 2, {"state": snapshot}, key="resume"))
    assert recovered.snapshot("run-plan")["plan_state"] == snapshot["plan_state"]


def test_android_and_desktop_plan_digest_match_for_the_same_update() -> None:
    states = []
    for surface in ("android", "desktop"):
        kernel = create_agent_kernel(surface=surface)
        kernel.handle(_command(MessageType.START_RUN, 0, {"input": "plan", "model_id": "model", "tools": [_tool()]}))
        kernel.handle(_command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [{
            "call_id": "plan-call", "name": "core.update_plan", "arguments": _update(0, ["completed"]),
        }]}))
        states.append(kernel.snapshot("run-plan")["plan_state"])
    assert states[0] == states[1]


def test_plan_tool_is_forced_only_for_explicit_multi_step_tasks() -> None:
    simple = build_tool_decision_requirement("Read README.md", ["core.update_plan"])
    complex_task = build_tool_decision_requirement(
        "Create a plan for this multi-step migration, implementation, and verification.",
        ["core.update_plan"],
    )

    assert simple["required_domains"] == []
    assert build_tool_choice_policy(simple, ["core.update_plan"])["mode"] == "auto"
    assert complex_task["required_domains"] == ["plan"]
    choice = build_tool_choice_policy(complex_task, ["core.update_plan"])
    assert choice["mode"] == "specified"
    assert choice["specified_tool"] == "core.update_plan"
