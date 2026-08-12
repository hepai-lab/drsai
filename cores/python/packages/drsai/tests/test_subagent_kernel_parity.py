from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel, kernel_factory_identity
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


def _tool(name: str, *, risk: str = "read_only", approval: bool = False) -> dict:
    return {
        "name": name, "version": 1, "source": "shared-core" if name == "delegate" else "android-host",
        "classification": "shared" if name == "delegate" else "local-equivalent",
        "description": name, "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": risk, "requires_approval": approval,
    }


def _command(message_type: MessageType, sequence: int, payload: dict) -> RuntimeEnvelope:
    return RuntimeEnvelope(
        message_type, f"request-{sequence}", "parent-run", "parent-session", sequence,
        f"command-{sequence}", payload,
    )


def _delegate(kernel, *, requested: list[str]) -> tuple:
    kernel.handle(_command(MessageType.START_RUN, 0, {
        "input": "parent private context", "model_id": "model",
        "tools": [
            _tool("delegate"), _tool("web.search"),
            _tool("workspace.write", risk="external_write", approval=True),
        ],
    }))
    return kernel.handle(_command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [{
        "call_id": "delegate-call", "name": "delegate", "arguments": {"tasks": [{
            "task_id": "child", "type": "explore", "prompt": "Inspect public facts",
            "allowed_tools": requested,
        }]},
    }]}))


@pytest.mark.parametrize("surface", ["android", "desktop"])
def test_subagent_is_created_by_same_kernel_factory_with_controlled_context_and_read_only_tools(surface: str) -> None:
    parent = create_agent_kernel(surface=surface)
    delegated = _delegate(parent, requested=["web.search"])
    started = next(item for item in delegated if item.payload.get("kind") == "subagent.started")
    request = next(item for item in delegated if item.message_type is MessageType.MODEL_REQUEST)
    parent_identity = kernel_factory_identity(parent)

    assert started.payload["kernel_id"] == parent_identity["kernel_id"]
    assert started.payload["kernel_sha256"] == parent_identity["kernel_sha256"]
    assert started.payload["subagent_type"] == "explore"
    assert started.payload["allowed_tools"] == ["web.search"]
    assert request.payload["subagent_kernel_sha256"] == parent_identity["kernel_sha256"]
    assert [tool["name"] for tool in request.payload["tools"]] == ["web.search"]
    assert request.payload["messages"][0]["role"] == "system"
    assert request.payload["messages"][-1] == {"role": "user", "content": "Inspect public facts"}
    assert "parent private context" not in str(request.payload["messages"])

    completed = parent.handle(_command(MessageType.MODEL_COMPLETED, 2, {
        "subagent_id": "child", "content": "verified result",
    }))
    child_done = next(item for item in completed if item.payload.get("kind") == "subagent.completed")
    assert child_done.payload["kernel_sha256"] == parent_identity["kernel_sha256"]
    assert child_done.payload["allowed_tools"] == ["web.search"]


def test_subagent_cannot_elevate_to_parent_write_or_approval_tools() -> None:
    kernel = create_agent_kernel(surface="android")
    with pytest.raises(ValueError, match="subagent_tool_whitelist_denied"):
        _delegate(kernel, requested=["workspace.write"])


def test_subagent_accepts_provider_encoded_aliases_only_for_safe_parent_tools() -> None:
    parent = create_agent_kernel(surface="android")
    delegated = _delegate(parent, requested=["web__dot__search"])
    started = next(item for item in delegated if item.payload.get("kind") == "subagent.started")
    request = next(item for item in delegated if item.message_type is MessageType.MODEL_REQUEST)
    assert started.payload["allowed_tools"] == ["web.search"]
    assert [tool["name"] for tool in request.payload["tools"]] == ["web.search"]

    with pytest.raises(ValueError, match="subagent_tool_whitelist_denied"):
        _delegate(create_agent_kernel(surface="android"), requested=["workspace__dot__write"])


def test_android_and_desktop_subagent_kernel_digest_match() -> None:
    values = []
    for surface in ("android", "desktop"):
        delegated = _delegate(create_agent_kernel(surface=surface), requested=[])
        values.append(next(item for item in delegated if item.payload.get("kind") == "subagent.started").payload["kernel_sha256"])
    assert values[0] == values[1]


def test_subagent_checkpoint_resume_preserves_child_kernel_request_and_schedule() -> None:
    parent = create_agent_kernel(surface="android")
    delegated = _delegate(parent, requested=["web.search"])
    original = next(item for item in delegated if item.message_type is MessageType.MODEL_REQUEST)
    snapshot = parent.snapshot("parent-run")
    restored = create_agent_kernel(surface="android")
    recovered = restored.handle(RuntimeEnvelope(
        MessageType.RESUME_RUN, "resume", "parent-run", "parent-session", 2, "resume", {"state": snapshot},
    ))
    resumed = next(item for item in recovered if item.message_type is MessageType.MODEL_REQUEST)

    assert resumed.payload == original.payload
    assert snapshot["subagent_scheduling_policy"]["max_parallel"] == 2
    assert len(snapshot["subagent_scheduling_policy"]["sha256"]) == 64


def test_lifecycle_change_updates_durable_subagent_schedule() -> None:
    parent = create_agent_kernel(surface="android")
    parent.handle(_command(MessageType.START_RUN, 0, {
        "input": "parent", "model_id": "model", "subagent_max_active": 3, "subagent_max_parallel": 2,
    }))
    changed = parent.handle(_command(MessageType.LIFECYCLE_CHANGED, 1, {"state": "thermal_limited"}))
    event = next(item for item in changed if item.payload.get("kind") == "runtime.lifecycle_changed")
    snapshot = parent.snapshot("parent-run")

    assert event.payload["max_parallel_agents"] == 1
    assert event.payload["subagent_scheduling"]["mode"] == "serial"
    assert snapshot["subagent_scheduling_policy"] == event.payload["subagent_scheduling"]


def test_parent_cancellation_closes_all_subagent_state_without_orphans() -> None:
    parent = create_agent_kernel(surface="android")
    _delegate(parent, requested=[])
    cancelled = parent.handle(_command(MessageType.CANCEL_RUN, 2, {}))
    snapshot = parent.snapshot("parent-run")

    assert cancelled[-2].payload["kind"] == "run.cancelled"
    assert snapshot["phase"] == "cancelled"
    assert snapshot["pending_subagents"] == {}
    assert snapshot["delegate_call_id"] is None
    assert "delegate-call" in snapshot["completed_side_effects"]


def test_partial_subagent_failure_is_structured_and_prevents_false_parent_success() -> None:
    parent = create_agent_kernel(surface="android")
    parent.handle(_command(MessageType.START_RUN, 0, {
        "input": "research", "model_id": "model", "tools": [_tool("delegate")],
    }))
    parent.handle(_command(MessageType.MODEL_COMPLETED, 1, {"tool_calls": [{
        "call_id": "delegate-call", "name": "delegate", "arguments": {"tasks": [
            {"task_id": "ok", "type": "explore", "prompt": "A", "allowed_tools": []},
            {"task_id": "late", "type": "general", "prompt": "B", "allowed_tools": []},
        ]},
    }]}))
    parent.handle(_command(MessageType.MODEL_COMPLETED, 2, {"subagent_id": "ok", "content": "result A"}))
    failed = parent.handle(_command(MessageType.MODEL_FAILED, 3, {
        "subagent_id": "late", "code": "model_timeout", "retryable": True,
    }))
    final = parent.handle(_command(MessageType.MODEL_COMPLETED, 4, {"content": "Everything succeeded"}))

    failure = next(item for item in failed if item.payload.get("kind") == "subagent.failed")
    request = next(item for item in failed if item.message_type is MessageType.MODEL_REQUEST)
    assert failure.payload["code"] == "model_timeout"
    assert failure.payload["child_run_id"].endswith(":subagent:late")
    assert request.payload["messages"][-1]["content"] == "[ok] completed: result A\n[late] failed: model_timeout"
    assert any(item.payload.get("kind") == "run.failed" for item in final)
    assert not any(item.payload.get("kind") == "run.completed" for item in final)
