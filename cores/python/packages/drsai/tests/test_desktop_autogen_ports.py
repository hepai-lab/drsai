from __future__ import annotations

import asyncio

from autogen_core import FunctionCall, Image
from autogen_core.models import CreateResult, RequestUsage, SystemMessage, UserMessage
from PIL import Image as PILImage
import pytest

from drsai.backend.runtime.desktop_autogen_ports import (
    AutogenDesktopModelPort,
    AutogenDesktopToolPort,
    AgentKernelCheckpointPort,
    DESKTOP_MODEL_TEXT_BATCH_CHARS,
    autogen_messages_to_kernel_history,
    autogen_tools_to_kernel_schemas,
    kernel_messages_to_autogen,
)
from drsai.backend.runtime.desktop_kernel_coordinator import DesktopModelDelta, DesktopModelResult, DesktopToolResult


class _Client:
    def __init__(self, chunks):
        self.chunks = chunks
        self.requests = []

    async def create_stream(self, messages, **kwargs):
        self.requests.append((messages, kwargs))
        for chunk in self.chunks:
            yield chunk


class _FlakyClient:
    def __init__(self):
        self.attempts = 0

    async def create_stream(self, _messages, **_kwargs):
        self.attempts += 1
        if self.attempts == 1:
            raise TimeoutError("retry")
        yield _result("recovered")


class _DelayedClient:
    def __init__(self):
        self.release_completion = asyncio.Event()
        self.completed = False

    async def create_stream(self, _messages, **_kwargs):
        yield "first"
        await self.release_completion.wait()
        self.completed = True
        yield " second"
        yield _result("first second")


class _PartialThenFailClient:
    def __init__(self):
        self.attempts = 0

    async def create_stream(self, _messages, **_kwargs):
        self.attempts += 1
        yield "visible"
        raise TimeoutError("disconnect after visible output")


class _ManyTinyChunksClient:
    async def create_stream(self, _messages, **_kwargs):
        for _ in range(DESKTOP_MODEL_TEXT_BATCH_CHARS * 2 + 44):
            yield "x"
        yield _result("x" * (DESKTOP_MODEL_TEXT_BATCH_CHARS * 2 + 44))


class _ToolResult:
    def __init__(self, text: str, is_error: bool = False):
        self.text = text
        self.is_error = is_error

    def to_text(self):
        return self.text


class _Workbench:
    def __init__(self):
        self.calls = []

    async def call_tool(self, **kwargs):
        self.calls.append(kwargs)
        return _ToolResult("12:00")


def _result(content, *, thought=None):
    return CreateResult(
        finish_reason="stop", content=content,
        usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False, thought=thought,
    )


def test_kernel_context_converts_tool_call_and_result_as_paired_autogen_messages() -> None:
    values = kernel_messages_to_autogen([
        {"role": "system", "content": "policy"},
        {"role": "user", "content": "question"},
        {"role": "assistant", "content": "", "tool_calls": [
            {"call_id": "call-1", "name": "clock", "arguments": {"zone": "UTC"}},
        ]},
        {"role": "tool", "tool_call_id": "call-1", "name": "clock", "content": {"time": "12:00"}, "succeeded": True},
    ], assistant_name="OpenDrSai")

    assert [type(value).__name__ for value in values] == [
        "SystemMessage", "UserMessage", "AssistantMessage", "FunctionExecutionResultMessage",
    ]
    assert values[2].content[0].id == values[3].content[0].call_id == "call-1"

    migrated = autogen_messages_to_kernel_history(values)
    assert [value["role"] for value in migrated] == ["user", "assistant", "tool"]
    assert migrated[1]["tool_calls"][0]["call_id"] == migrated[2]["tool_call_id"] == "call-1"


def test_kernel_context_merges_all_system_sections_into_one_leading_message() -> None:
    values = kernel_messages_to_autogen([
        {"role": "system", "content": "base policy"},
        {"role": "user", "content": "question"},
        {"role": "system", "content": "workspace context"},
    ], assistant_name="OpenDrSai")

    assert [type(value).__name__ for value in values] == ["SystemMessage", "UserMessage"]
    assert isinstance(values[0], SystemMessage)
    assert values[0].content == "base policy\n\nworkspace context"


@pytest.mark.asyncio
async def test_autogen_model_port_normalizes_stream_and_tool_calls_for_kernel() -> None:
    client = _Client(["thinking ", _result([
        FunctionCall(id="call-1", name="web_search", arguments='{"query":"HEPiX"}'),
    ], thought="summary")])
    tool = {"name": "web_search", "parameters": {"type": "object", "properties": {}}}
    port = AutogenDesktopModelPort(client, [tool], assistant_name="OpenDrSai")

    result = await port({"messages": [{"role": "user", "content": "HEPiX是什么？"}]})

    assert result.deltas == ("thinking ",)
    assert result.tool_calls == ({"call_id": "call-1", "name": "web_search", "arguments": {"query": "HEPiX"}},)
    assert result.reasoning_summary == "summary"
    assert client.requests[0][1]["tools"] == [tool]


@pytest.mark.asyncio
async def test_autogen_model_port_exposes_provider_delta_before_completion() -> None:
    client = _DelayedClient()
    port = AutogenDesktopModelPort(client, [], assistant_name="OpenDrSai")
    stream = port.stream({"messages": [{"role": "user", "content": "hello"}]})

    first = await asyncio.wait_for(anext(stream), timeout=0.25)
    assert first == DesktopModelDelta("first")
    assert client.completed is False

    client.release_completion.set()
    remaining = [item async for item in stream]
    assert remaining == [
        DesktopModelDelta(" second"),
        DesktopModelResult(content="first second", finish_reason="stop"),
    ]


@pytest.mark.asyncio
async def test_autogen_model_port_does_not_retry_after_visible_delta() -> None:
    client = _PartialThenFailClient()
    port = AutogenDesktopModelPort(
        client, [], assistant_name="OpenDrSai", max_retries=2,
        retryable=lambda error: isinstance(error, TimeoutError),
    )
    received = []

    with pytest.raises(TimeoutError, match="disconnect after visible output"):
        async for item in port.stream({"messages": [{"role": "user", "content": "hello"}]}):
            received.append(item)

    assert received == [DesktopModelDelta("visible")]
    assert client.attempts == 1


@pytest.mark.asyncio
async def test_autogen_model_port_coalesces_tiny_chunks_without_delaying_first_delta() -> None:
    port = AutogenDesktopModelPort(_ManyTinyChunksClient(), [], assistant_name="OpenDrSai")

    items = [item async for item in port.stream({
        "messages": [{"role": "user", "content": "generate"}],
    })]

    deltas = [item.text for item in items if isinstance(item, DesktopModelDelta)]
    assert [len(value) for value in deltas] == [1, 128, 128, 43]
    assert "".join(deltas) == "x" * (DESKTOP_MODEL_TEXT_BATCH_CHARS * 2 + 44)
    assert isinstance(items[-1], DesktopModelResult)


@pytest.mark.asyncio
async def test_autogen_model_port_forces_a_matching_tool_for_required_capability() -> None:
    client = _Client([_result([
        FunctionCall(id="call-1", name="web_search", arguments='{"query":"HEPiX"}'),
    ])])
    tools = [
        {"name": "image_generation", "parameters": {"type": "object", "properties": {}}},
        {"name": "web_search", "parameters": {"type": "object", "properties": {}}},
    ]
    port = AutogenDesktopModelPort(client, tools, assistant_name="OpenDrSai")

    await port({
        "messages": [{"role": "user", "content": "Find current sources."}],
        "tool_choice": {"mode": "required", "matching_tools": ["web_search"]},
    })

    assert client.requests[0][1]["extra_create_args"] == {}
    assert [tool["name"] for tool in client.requests[0][1]["tools"]] == ["web_search"]


@pytest.mark.asyncio
async def test_autogen_model_port_pins_single_specified_tool_without_vendor_tool_choice() -> None:
    client = _Client([_result([
        FunctionCall(id="call-1", name="run_powershell", arguments='{"command":"pytest"}'),
    ])])
    tools = [
        {"name": "run_read", "parameters": {"type": "object", "properties": {}}},
        {"name": "run_powershell", "parameters": {"type": "object", "properties": {}}},
    ]
    port = AutogenDesktopModelPort(client, tools, assistant_name="OpenDrSai")

    await port({
        "messages": [{"role": "user", "content": "Run the failing test."}],
        "tool_choice": {
            "mode": "specified", "specified_tool": "run_powershell",
            "matching_tools": ["run_powershell"],
        },
    })

    assert client.requests[0][1]["extra_create_args"] == {}
    assert [tool["name"] for tool in client.requests[0][1]["tools"]] == ["run_powershell"]


@pytest.mark.asyncio
async def test_autogen_model_port_honors_request_level_empty_tool_snapshot() -> None:
    client = _Client([_result("final answer")])
    tool = {"name": "run_read", "parameters": {"type": "object", "properties": {}}}
    port = AutogenDesktopModelPort(client, [tool], assistant_name="OpenDrSai")

    result = await port({
        "messages": [{"role": "system", "content": "Finalize without tools."}],
        "tools": [],
    })

    assert result.content == "final answer"
    assert client.requests[0][1]["tools"] == []


@pytest.mark.asyncio
async def test_autogen_model_port_honors_request_level_tool_subset() -> None:
    client = _Client([_result("done")])
    tools = [
        {"name": "run_read", "parameters": {"type": "object", "properties": {}}},
        {"name": "run_write", "parameters": {"type": "object", "properties": {}}},
    ]
    port = AutogenDesktopModelPort(client, tools, assistant_name="OpenDrSai")

    await port({
        "messages": [{"role": "user", "content": "read"}],
        "tools": [{"name": "run_read", "parameters": tools[0]["parameters"]}],
    })

    assert [tool["name"] for tool in client.requests[0][1]["tools"]] == ["run_read"]


@pytest.mark.asyncio
async def test_autogen_model_port_attaches_input_image_to_last_user_message() -> None:
    image = Image.from_pil(PILImage.new("RGB", (2, 2), color="blue"))
    client = _Client([_result("seen")])
    port = AutogenDesktopModelPort(client, [], assistant_name="OpenDrSai", input_images=[image])

    await port({"messages": [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "ack"},
        {"role": "user", "content": "inspect"},
    ]})

    sent = client.requests[0][0]
    user_messages = [message for message in sent if isinstance(message, UserMessage)]
    assert user_messages[0].content == "first"
    assert user_messages[-1].content == ["inspect", image]


@pytest.mark.asyncio
async def test_autogen_model_port_rejects_non_object_tool_arguments() -> None:
    client = _Client([_result([FunctionCall(id="call-1", name="clock", arguments="[]")])])
    port = AutogenDesktopModelPort(client, [], assistant_name="OpenDrSai")

    with pytest.raises(RuntimeError, match="desktop_model_tool_arguments_invalid:clock"):
        await port({"messages": [{"role": "user", "content": "time"}]})


@pytest.mark.asyncio
async def test_autogen_model_port_retries_only_explicit_retryable_failures() -> None:
    client = _FlakyClient()
    port = AutogenDesktopModelPort(
        client, [], assistant_name="OpenDrSai", max_retries=1,
        retryable=lambda error: isinstance(error, TimeoutError),
    )

    result = await port({"messages": [{"role": "user", "content": "hello"}]})

    assert result.content == "recovered"
    assert client.attempts == 2


@pytest.mark.asyncio
async def test_autogen_tool_port_executes_kernel_request_through_workbench() -> None:
    workbench = _Workbench()
    port = AutogenDesktopToolPort(workbench)

    result = await port({"call_id": "clock-1", "name": "clock", "arguments": {"zone": "UTC"}})

    assert result == DesktopToolResult("clock-1", True, {"content": "12:00"})
    assert workbench.calls[0]["name"] == "clock"
    assert workbench.calls[0]["arguments"] == {"zone": "UTC"}


@pytest.mark.asyncio
async def test_web_search_tool_failure_preserves_actionable_error_code() -> None:
    class FailedWorkbench(_Workbench):
        async def call_tool(self, **kwargs):
            self.calls.append(kwargs)
            return _ToolResult(
                "WebSearchRuntimeError: browser_unavailable: Install Microsoft Edge.",
                is_error=True,
            )

    result = await AutogenDesktopToolPort(FailedWorkbench())({
        "call_id": "search-1",
        "name": "web_search",
        "arguments": {"query": "HEPiX 2026"},
    })

    assert result.succeeded is False
    assert result.error_code == "browser_unavailable"


@pytest.mark.asyncio
async def test_autogen_tool_port_requires_explicit_special_tool_adapter() -> None:
    async def special(payload):
        return DesktopToolResult(payload["call_id"], True, {"plan": "updated"})

    workbench = _Workbench()
    port = AutogenDesktopToolPort(workbench, special_tools={"TodoWrite": special})
    result = await port({"call_id": "todo-1", "name": "TodoWrite", "arguments": {"items": []}})

    assert result.content == {"plan": "updated"}
    assert workbench.calls == []


@pytest.mark.asyncio
async def test_large_tool_output_is_bound_to_complete_artifact_descriptor() -> None:
    class LargeWorkbench(_Workbench):
        async def call_tool(self, **kwargs):
            self.calls.append(kwargs)
            return _ToolResult("x" * 20_000)

    persisted = []

    async def artifact(metadata, data):
        persisted.append((metadata, data))
        return {
            "artifact_id": "artifact-1", "mime_type": "application/json; charset=utf-8",
            "size": len(data), "sha256": "a" * 64,
        }

    port = AutogenDesktopToolPort(LargeWorkbench(), output_artifact_handler=artifact)
    result = await port({"call_id": "large-1", "name": "run_read", "arguments": {}})

    assert result.artifact_ids == ("artifact-1",)
    assert result.artifacts[0]["size"] == len(persisted[0][1])
    assert len(persisted[0][1]) > 16_384


@pytest.mark.asyncio
async def test_checkpoint_port_deep_copies_kernel_state_into_agent() -> None:
    agent = type("Agent", (), {})()
    port = AgentKernelCheckpointPort(agent)
    state = {"run_id": "run-1", "messages": [{"role": "user", "content": "hello"}]}

    await port({"reason": "before_model", "state": state})
    state["messages"][0]["content"] = "mutated"

    assert agent._agent_kernel_checkpoint["reason"] == "before_model"
    assert agent._agent_kernel_checkpoint["state"]["messages"][0]["content"] == "hello"


def test_autogen_tool_schema_conversion_binds_risk_and_fails_safe_for_sensitive_tools() -> None:
    tools = [{"name": "run_read", "description": "read", "parameters": {"type": "object", "properties": {}}},
             {"name": "run_bash", "description": "shell", "parameters": {"type": "object", "properties": {}}}]
    metadata = {
        "run_read": {"version": 1, "source": "desktop-host", "classification": "local-equivalent", "risk": "read_only"},
        "run_bash": {"version": 1, "source": "desktop-host", "classification": "local-equivalent", "risk": "sensitive", "approval_mode": "conditional"},
    }

    converted = autogen_tools_to_kernel_schemas(tools, metadata)

    assert converted[0]["requires_approval"] is False
    assert converted[1]["requires_approval"] is False
    assert converted[1]["approval_mode"] == "conditional"
