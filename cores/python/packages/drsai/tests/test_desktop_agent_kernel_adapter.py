from __future__ import annotations

from autogen_agentchat.messages import MultiModalMessage, TextMessage
from autogen_core import Image
from autogen_core.models import CreateResult, RequestUsage, SystemMessage
from PIL import Image as PILImage
import pytest

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.desktop_agent_kernel_adapter import (
    _desktop_default_subagent_profile,
    _desktop_input_artifact,
    _desktop_memory_candidates,
    normalize_desktop_kernel_task,
    run_agent_through_kernel,
)
from drsai.modules.agents.skills_agent.drsai_assistant import DrSaiAssistant


class _Client:
    _create_args = {"model": "fixture-model"}

    async def create_stream(self, _messages, **_kwargs):
        yield "done"
        yield CreateResult(
            finish_reason="stop", content="done",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _Workbench:
    async def list_tools(self):
        return []

    async def call_tool(self, **_kwargs):
        raise AssertionError


class _Context:
    async def get_messages(self):
        return []


class _Agent:
    name = "OpenDrSai"
    _thread_id = "session-1"
    _model_client = _Client()
    _workbench = _Workbench()
    _model_context = _Context()
    _system_messages = [SystemMessage(content="You are OpenDrSai.")]
    _handoff_tools = []
    _update_user_config_tools = []
    _agent_skills_tools = []
    _subagent_tools = []
    _todo_tools = []
    _scheduled_task_tools = []
    _tool_approval_handler = None

    def __init__(self):
        self._shared_agent_kernel = create_agent_kernel(surface="desktop")


def _policy(name, executor):
    return {
        "version": 1, "source": "desktop-host", "classification": "local-equivalent",
        "risk": "read_only", "approval_mode": "none", "executor_id": executor,
        "required_capabilities": [],
    }


@pytest.mark.asyncio
async def test_production_shaped_agent_pilot_is_actually_driven_by_shared_kernel() -> None:
    agent = _Agent()
    output = [value async for value in run_agent_through_kernel(
        agent, task="hello", cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=_policy,
    )]

    assert [type(value).__name__ for value in output] == [
        "TextMessage", "AgentLogEvent", "ModelClientStreamingChunkEvent", "AgentLogEvent",
        "TextMessage", "TaskResult",
    ]
    assert output[-1].stop_reason == "run.completed"
    assert output[-1].messages[0].source == "user"
    assert output[-1].messages[0].content == "hello"
    assert agent._agent_kernel_checkpoint["reason"] == "terminal"


@pytest.mark.asyncio
async def test_desktop_production_entry_selects_only_relevant_curated_memory() -> None:
    agent = _Agent()
    agent._curated_memory = type("Store", (), {
        "memory_entries": ["I prefer concise answers in Chinese.", "My favorite color is blue."],
        "system_prompt_block": staticmethod(lambda: ""),
    })()

    _ = [value async for value in run_agent_through_kernel(
        agent, task="How should you format my answers?",
        cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=_policy,
    )]

    selection = agent._agent_kernel_checkpoint["state"]["memory_selection"]
    assert len(selection["selected"]) == 1
    assert selection["selected"][0]["id"].startswith("memory-")
    assert {item["reason"] for item in selection["omitted"]} == {"irrelevant"}


def test_desktop_task_normalization_preserves_message_sequence_and_opaque_image() -> None:
    image = Image.from_pil(PILImage.new("RGB", (2, 2), color="red"))
    task = [
        TextMessage(content="context", source="user"),
        MultiModalMessage(content=["inspect this", image], source="user"),
    ]

    normalized = normalize_desktop_kernel_task(task)

    assert normalized.messages == tuple(task)
    assert normalized.input_text == "context\n\ninspect this"
    assert normalized.images == (image,)
    assert len(normalized.artifacts) == 1
    descriptor = next(iter(normalized.artifacts.values()))
    assert descriptor["size"] > 0
    assert len(descriptor["sha256"]) == 64


@pytest.mark.asyncio
async def test_desktop_input_image_artifact_is_describe_only() -> None:
    artifacts = {"image-1": {"artifact_id": "image-1", "mime_type": "image/png", "size": 8, "sha256": "a" * 64}}

    described = await _desktop_input_artifact(artifacts, {"artifact_id": "image-1", "operation": "describe"})
    assert described["operation"] == "describe"
    with pytest.raises(ValueError, match="operation_denied"):
        await _desktop_input_artifact(artifacts, {"artifact_id": "image-1", "operation": "read"})


def test_desktop_curated_memory_becomes_bounded_kernel_candidates() -> None:
    store = type("Store", (), {"memory_entries": ["prefers concise answers", "favorite color is blue"]})()

    candidates = _desktop_memory_candidates(type("Agent", (), {"_curated_memory": store})())

    assert len(candidates) == 2
    assert candidates[0]["id"].startswith("memory-")
    assert candidates[0]["content"] == "prefers concise answers"


def test_default_subagent_becomes_kernel_agent_profile() -> None:
    agent = type("Agent", (), {
        "_thread_state": {"default_subagent": "researcher"},
        "_user_sub_agents": {"researcher": {"description": "Search and verify sources."}},
    })()

    profile = _desktop_default_subagent_profile(agent)

    assert "researcher" in profile
    assert "Delegate the complete user task" in profile


@pytest.mark.asyncio
@pytest.mark.parametrize("task", [
    "hello",
    TextMessage(content="hello", source="user"),
    [TextMessage(content="first", source="user"), TextMessage(content="second", source="user")],
    None,
])
async def test_desktop_production_entry_routes_every_non_command_task_shape_to_kernel(monkeypatch, task) -> None:
    captured = []

    async def fake_kernel(_agent, **kwargs):
        captured.append(kwargs["task"])
        yield TextMessage(content="kernel", source="OpenDrSai")

    monkeypatch.setattr(
        "drsai.backend.runtime.desktop_agent_kernel_adapter.run_agent_through_kernel", fake_kernel,
    )
    agent = type("Agent", (), {
        "_shared_agent_kernel": object(),
        "is_commands_mode": staticmethod(lambda text: str(text).startswith("/")),
    })()

    output = [value async for value in DrSaiAssistant.run_stream(agent, task=task)]

    assert captured == [task]
    assert output[0].content == "kernel"
