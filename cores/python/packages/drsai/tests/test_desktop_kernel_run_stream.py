from __future__ import annotations

import pytest

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.desktop_kernel_coordinator import DesktopKernelCoordinator, DesktopModelResult
from drsai.backend.runtime.desktop_kernel_run_stream import DesktopKernelRunStream, build_desktop_start_envelope
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope


def _start() -> RuntimeEnvelope:
    return RuntimeEnvelope(MessageType.START_RUN, "request-0", "run-1", "session-1", 0, "start", {
        "input": "hello", "model_id": "model", "tools": [],
        "host_port": {
            "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": "desktop",
            "capabilities": [{"id": "chat", "version": 1, "required": True}],
        },
    })


@pytest.mark.asyncio
async def test_kernel_run_stream_emits_legacy_chunks_final_message_and_task_result() -> None:
    async def model(_payload):
        return DesktopModelResult(content="hello", deltas=("hel", "lo"))

    async def unused(_payload):
        raise AssertionError

    async def checkpoint(_payload):
        return None

    stream = DesktopKernelRunStream(DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=unused, checkpoint=checkpoint,
    ), assistant_name="OpenDrSai")
    output = [value async for value in stream.execute(_start())]

    assert [type(value).__name__ for value in output] == [
        "AgentLogEvent", "ModelClientStreamingChunkEvent", "ModelClientStreamingChunkEvent",
        "AgentLogEvent", "TextMessage", "TaskResult",
    ]
    assert output[-2].content == "hello"
    assert output[-1].stop_reason == "run.completed"


@pytest.mark.asyncio
async def test_kernel_run_stream_raises_preserved_model_error_message() -> None:
    async def model(_payload):
        raise RuntimeError('Error code: 400 - {"error":{"message":"invalid input"}}')

    async def unused(_payload):
        raise AssertionError

    async def checkpoint(_payload):
        return None

    stream = DesktopKernelRunStream(DesktopKernelCoordinator(
        create_agent_kernel(surface="desktop"), model=model, tool=unused, checkpoint=checkpoint,
    ), assistant_name="OpenDrSai")

    with pytest.raises(RuntimeError, match="Error code: 400.*invalid input"):
        _ = [value async for value in stream.execute(_start())]


def test_desktop_start_envelope_binds_desktop_host_port_and_context_inputs() -> None:
    start = build_desktop_start_envelope(
        run_id="run-2", session_id="session-2", input_text="question", model_id="model",
        tools=[], history=[{"role": "assistant", "content": "prior"}],
        host_port={
            "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": "desktop",
            "capabilities": [
                {"id": "chat", "version": 1, "required": True},
                {"id": "streaming", "version": 1, "required": False},
            ],
        },
        agent={"schema_version": 1, "prompt_version": "p9-agent-kernel-v1", "system_prompt": "system", "tool_policy": "policy"},
    )

    assert start.payload["host_port"]["surface"] == "desktop"
    assert "host_capabilities" not in start.payload
    assert start.payload["history"] == [{"role": "assistant", "content": "prior"}]
    assert start.payload["agent"]["system_prompt"] == "system"
