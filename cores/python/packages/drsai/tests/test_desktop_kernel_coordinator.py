from __future__ import annotations

import asyncio

import pytest

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.desktop_kernel_coordinator import (
    DesktopKernelCoordinator,
    DesktopApprovalResult,
    DesktopModelDelta,
    DesktopModelResult,
    DesktopToolResult,
)
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


def _start(
    *,
    input_text: str = "hello",
    tools: list[dict] | None = None,
    artifacts: list[str] | None = None,
    run_id: str = "run-1",
    session_id: str = "session-1",
) -> RuntimeEnvelope:
    return RuntimeEnvelope(MessageType.START_RUN, f"{run_id}:request-0", run_id, session_id, 0, f"{run_id}:start", {
        "input": input_text,
        "model_id": "model",
        "tools": tools or [],
        "artifacts": artifacts or [],
        "host_port": {
            "schema_version": 1,
            "protocol_version": "p9-host-port-v1",
            "surface": "desktop",
            "capabilities": [{"id": "chat", "version": 1, "required": True}],
        },
    })


def _tool(name: str) -> dict:
    return {
        "name": name, "version": 1, "source": "desktop-host", "classification": "local-equivalent",
        "description": name, "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def _write_tool(name: str) -> dict:
    return {
        **_tool(name), "risk": "external_write", "requires_approval": True,
        "title": "Write file", "summary": "Update a workspace file",
    }


@pytest.mark.asyncio
async def test_desktop_coordinator_direct_answer_is_owned_by_factory_kernel() -> None:
    checkpoints = []

    async def model(_payload):
        return DesktopModelResult(content="done", deltas=("do", "ne"))

    async def no_tool(_payload):
        raise AssertionError("tool must not run")

    async def checkpoint(payload):
        checkpoints.append(payload)

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=no_tool, checkpoint=checkpoint,
    )
    events = [event async for event in coordinator.execute(_start())]

    assert [event.payload["kind"] for event in events] == [
        "run.started", "message.delta", "message.delta", "tool.decision", "message.completed", "run.completed",
    ]
    assert events[0].payload["capability_diagnostics"]["available"]
    assert [value["reason"] for value in checkpoints] == ["before_model", "terminal"]


@pytest.mark.asyncio
async def test_desktop_coordinator_emits_first_model_delta_before_provider_completion() -> None:
    release_completion = asyncio.Event()

    class StreamingModel:
        completed = False

        async def stream(self, _payload):
            yield DesktopModelDelta("first")
            await release_completion.wait()
            self.completed = True
            yield DesktopModelDelta(" second")
            yield DesktopModelResult(content="first second")

    model = StreamingModel()

    async def no_tool(_payload):
        raise AssertionError("tool must not run")

    async def checkpoint(_payload):
        return None

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=no_tool, checkpoint=checkpoint,
    )
    stream = coordinator.execute(_start())

    started = await anext(stream)
    first_delta = await asyncio.wait_for(anext(stream), timeout=0.25)
    assert started.payload["kind"] == "run.started"
    assert first_delta.payload == {"kind": "message.delta", "text": "first"}
    assert model.completed is False

    release_completion.set()
    remaining = [event async for event in stream]
    assert model.completed is True
    assert [event.payload["kind"] for event in remaining] == [
        "message.delta", "tool.decision", "message.completed", "run.completed",
    ]


@pytest.mark.asyncio
async def test_desktop_coordinator_services_kernel_tool_request_then_model_followup() -> None:
    model_calls = 0
    tool_calls = []
    checkpoints = []

    async def model(_payload):
        nonlocal model_calls
        model_calls += 1
        if model_calls == 1:
            return DesktopModelResult(tool_calls=({
                "call_id": "clock-1", "name": "clock", "arguments": {},
            },))
        return DesktopModelResult(content="12:00")

    async def tool(payload):
        tool_calls.append(payload)
        return DesktopToolResult("clock-1", True, {"time": "12:00"})

    async def checkpoint(payload):
        checkpoints.append(payload)

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="tui"), model=model, tool=tool, checkpoint=checkpoint,
    )
    events = [event async for event in coordinator.execute(_start(tools=[_tool("clock")]))]

    assert model_calls == 2
    assert [value["call_id"] for value in tool_calls] == ["clock-1"]
    assert [event.payload["kind"] for event in events] == [
        "run.started", "tool.decision", "tool.started", "tool.result", "tool.decision", "message.completed", "run.completed",
    ]
    reasons = [value["reason"] for value in checkpoints]
    assert reasons == ["before_model", "before_tool", "after_tool", "terminal"]


def test_desktop_coordinator_rejects_android_kernel() -> None:
    async def unused(_payload):
        raise AssertionError

    with pytest.raises(ValueError, match="desktop_kernel_surface_required"):
        DesktopKernelCoordinator(create_agent_kernel(surface="android"), model=unused, tool=unused, checkpoint=unused)


@pytest.mark.asyncio
@pytest.mark.parametrize("decision, expected_terminal", [
    ("approved", "run.completed"),
    ("rejected", "run.cancelled"),
])
async def test_desktop_coordinator_keeps_write_tool_behind_kernel_approval(
    decision: str, expected_terminal: str,
) -> None:
    model_calls = 0
    tool_calls = []
    approval_calls = []

    async def model(_payload):
        nonlocal model_calls
        model_calls += 1
        if model_calls == 1:
            return DesktopModelResult(tool_calls=({
                "call_id": "write-1", "name": "workspace.write", "arguments": {"path": "a.txt"},
            },))
        return DesktopModelResult(content="saved")

    async def tool(payload):
        tool_calls.append(payload)
        return DesktopToolResult("write-1", True, {"updated": "a.txt"})

    async def approval(payload):
        approval_calls.append(payload)
        return DesktopApprovalResult(payload["approval_id"], payload["call_id"], decision)

    async def checkpoint(_payload):
        return None

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=tool,
        checkpoint=checkpoint, approval=approval,
    )
    events = [event async for event in coordinator.execute(_start(tools=[_write_tool("workspace.write")]))]

    assert len(approval_calls) == 1
    assert len(tool_calls) == (1 if decision == "approved" else 0)
    if decision == "approved":
        assert tool_calls[0]["runtime_approval_granted"] is True
    assert events[-1].payload["kind"] == expected_terminal


@pytest.mark.asyncio
async def test_desktop_coordinator_splits_todo_and_artifact_delivery_batch() -> None:
    model_calls = 0
    tool_calls = []
    approval_calls = []

    async def model(_payload):
        nonlocal model_calls
        model_calls += 1
        if model_calls == 1:
            return DesktopModelResult(tool_calls=(
                {"call_id": "todo-1", "name": "TodoWrite", "arguments": {"items": []}},
                {
                    "call_id": "deliver-1", "name": "deliver_artifact",
                    "arguments": {"path": "artifacts/result.docx"},
                },
            ))
        if model_calls == 2:
            return DesktopModelResult(tool_calls=({
                "call_id": "deliver-2", "name": "deliver_artifact",
                "arguments": {"path": "artifacts/result.docx"},
            },))
        return DesktopModelResult(content="delivered")

    async def tool(payload):
        tool_calls.append(dict(payload))
        return DesktopToolResult(payload["call_id"], True, {"ok": True})

    async def approval(payload):
        approval_calls.append(dict(payload))
        return DesktopApprovalResult(payload["approval_id"], payload["call_id"], "approved")

    async def checkpoint(_payload):
        return None

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=tool,
        checkpoint=checkpoint, approval=approval,
    )
    events = [event async for event in coordinator.execute(_start(tools=[
        _tool("TodoWrite"), _write_tool("deliver_artifact"),
    ]))]

    assert [value["name"] for value in tool_calls] == ["TodoWrite", "deliver_artifact"]
    assert [value["name"] for value in approval_calls] == ["deliver_artifact"]
    assert tool_calls[-1]["runtime_approval_granted"] is True
    assert events[-1].payload["kind"] == "run.completed"


@pytest.mark.asyncio
async def test_desktop_coordinator_reads_text_artifact_before_first_model_request() -> None:
    artifact_calls = []
    model_messages = []

    async def model(payload):
        model_messages.append(payload["messages"])
        return DesktopModelResult(content="read")

    async def no_tool(_payload):
        raise AssertionError

    async def checkpoint(_payload):
        return None

    async def artifact(payload):
        artifact_calls.append(dict(payload))
        if payload["operation"] == "describe":
            return {"artifact_id": payload["artifact_id"], "operation": "describe", "mime_type": "text/plain", "size": 5, "sha256": "a" * 64}
        return {"artifact_id": payload["artifact_id"], "operation": "read", "offset": 0, "data_base64": "aGVsbG8="}

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=no_tool,
        checkpoint=checkpoint, artifact=artifact,
    )
    events = [event async for event in coordinator.execute(_start(artifacts=["artifact-1"]))]

    assert [value["operation"] for value in artifact_calls] == ["describe", "read"]
    assert any("hello" in message["content"] for message in model_messages[0] if message["role"] == "system")
    assert events[-1].payload["kind"] == "run.completed"


@pytest.mark.asyncio
async def test_desktop_coordinator_converts_exhausted_model_failure_to_kernel_terminal_checkpoint() -> None:
    checkpoints = []

    async def model(_payload):
        raise TimeoutError("provider unavailable")

    async def unused(_payload):
        raise AssertionError

    async def checkpoint(payload):
        checkpoints.append(payload)

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=unused, checkpoint=checkpoint,
    )
    events = [event async for event in coordinator.execute(_start())]

    assert [event.payload["kind"] for event in events] == ["run.started", "run.failed"]
    assert events[-1].payload["code"] == "TimeoutError"
    assert events[-1].payload["message"] == "provider unavailable"
    assert checkpoints[-1]["reason"] == "terminal"
    assert checkpoints[-1]["state"]["phase"] == "failed"


@pytest.mark.asyncio
async def test_desktop_coordinator_preserves_provider_body_but_redacts_credentials() -> None:
    async def model(_payload):
        raise RuntimeError(
            'Error code: 400 - {"error":{"message":"unsupported field"}} '
            'access_token=private-token tail'
        )

    async def unused(_payload):
        raise AssertionError

    async def checkpoint(_payload):
        return None

    coordinator = DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=unused, checkpoint=checkpoint,
    )
    events = [event async for event in coordinator.execute(_start())]
    failure = events[-1].payload

    assert failure["code"] == "RuntimeError"
    assert failure["message"].endswith("access_token=[REDACTED] tail")
    assert "unsupported field" in failure["message"]
    assert "private-token" not in failure["message"]


@pytest.mark.asyncio
async def test_desktop_coordinator_releases_session_after_host_tool_failure() -> None:
    kernel = create_agent_kernel(surface="desktop")

    async def model(_payload):
        return DesktopModelResult(tool_calls=({
            "call_id": "clock-1", "name": "clock", "arguments": {},
        },))

    async def tool(_payload):
        raise RuntimeError("tool exploded")

    async def checkpoint(_payload):
        return None

    coordinator = DesktopKernelCoordinator(
        kernel, model=model, tool=tool, checkpoint=checkpoint,
    )
    with pytest.raises(RuntimeError, match="tool exploded"):
        _ = [event async for event in coordinator.execute(_start(tools=[_tool("clock")]))]
    assert kernel.active_run_id_for_session("session-1") is None

    async def followup_model(_payload):
        return DesktopModelResult(content="ok")

    async def unused(_payload):
        raise AssertionError("follow-up turn must not call tools")

    followup = DesktopKernelCoordinator(
        kernel, model=followup_model, tool=unused, checkpoint=checkpoint,
    )
    events = [event async for event in followup.execute(_start(run_id="run-2"))]
    assert events[-1].payload["kind"] == "run.completed"


@pytest.mark.asyncio
async def test_desktop_coordinator_replaces_stale_session_run_on_next_turn() -> None:
    kernel = create_agent_kernel(surface="desktop")
    kernel.handle(_start())
    assert kernel.active_run_id_for_session("session-1") == "run-1"

    async def model(_payload):
        return DesktopModelResult(content="ok")

    async def unused(_payload):
        raise AssertionError

    async def checkpoint(_payload):
        return None

    coordinator = DesktopKernelCoordinator(
        kernel, model=model, tool=unused, checkpoint=checkpoint,
    )
    events = [event async for event in coordinator.execute(_start(run_id="run-2"))]
    assert events[-1].payload["kind"] == "run.completed"
    assert kernel.active_run_id_for_session("session-1") is None
