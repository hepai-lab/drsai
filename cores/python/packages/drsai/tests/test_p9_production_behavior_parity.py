from __future__ import annotations

import json
import hashlib
from pathlib import Path

from autogen_core import CancellationToken, FunctionCall
from autogen_core.models import CreateResult, RequestUsage, SystemMessage
import pytest

from drsai.backend.runtime.agent_kernel import AgentRunConfig, agent_kernel_identity
from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.desktop_agent_kernel_adapter import run_agent_through_kernel
from drsai.modules.agents.skills_agent.drsai_assistant import DrSaiAssistant
from drsai.modules.managers.messages.agent_messages import AgentLogEvent


ROOT = Path(__file__).parents[5]
FIXTURE = ROOT / "cores/protocol/android-runtime/fixtures/p9-production-behavior-parity-v1.json"


class _Model:
    _create_args = {"model": "fixture-model"}

    def __init__(self) -> None:
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(id="echo-1", name="parity.echo", arguments='{"text":"hello"}')],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
        else:
            yield "echo:hello"
            yield CreateResult(
                finish_reason="stop", content="echo:hello",
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )


class _Result:
    is_error = False

    def to_text(self) -> str:
        return "hello"


class _Workbench:
    def __init__(self, schema: dict) -> None:
        self.schema = {key: value for key, value in schema.items() if key != "schema_sha256"}
        self.calls = 0

    async def list_tools(self):
        return [self.schema]

    async def call_tool(self, **kwargs):
        assert kwargs["name"] == "parity.echo" and kwargs["arguments"] == {"text": "hello"}
        self.calls += 1
        return _Result()


class _Context:
    async def get_messages(self):
        return []


def _agent(fixture: dict) -> DrSaiAssistant:
    agent = object.__new__(DrSaiAssistant)
    agent._name = "OpenDrSai"
    agent._thread_id = "p9-production-parity"
    agent._model_client = _Model()
    agent._workbench = _Workbench(fixture["tool"])
    agent._model_context = _Context()
    agent._system_messages = [SystemMessage(content=AgentRunConfig().authoritative_prompt())]
    agent._handoff_tools = []
    agent._update_user_config_tools = []
    agent._agent_skills_tools = []
    agent._subagent_tools = []
    agent._todo_tools = []
    agent._scheduled_task_tools = []
    agent._tool_approval_handler = None
    agent._shared_agent_kernel = create_agent_kernel(surface="desktop")
    agent._skip_startup_checks = True
    agent._clear_elevated_tools = lambda: None
    agent._init_memory_documents = None
    return agent


def _semantic(output) -> list[str]:
    kinds: list[str] = []
    for value in output:
        if isinstance(value, AgentLogEvent) and value.metadata.get("kernel_event"):
            kinds.append(value.metadata["kernel_event"])
        elif value.__class__.__name__ == "ToolCallRequestEvent":
            kinds.append("tool.started")
        elif value.__class__.__name__ == "ToolCallExecutionEvent":
            kinds.append("tool.result")
        elif value.__class__.__name__ == "TaskResult":
            kinds.append(value.stop_reason)
    return kinds


@pytest.mark.asyncio
async def test_desktop_production_agent_matches_frozen_android_behavior_fixture() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    identity = agent_kernel_identity(surface="desktop")
    for key, expected in fixture["identity"].items():
        assert identity[key] == expected
    agent = _agent(fixture)
    output = [value async for value in run_agent_through_kernel(
        agent, task=fixture["input"], cancellation_token=CancellationToken(),
        policy_resolver=lambda _name, _executor: {
            "version": 1, "source": "shared-core", "classification": "shared",
            "risk": "read_only", "approval_mode": "none", "required_capabilities": [],
        },
    )]
    assert _semantic(output) == fixture["expected_semantic_events"]
    assert output[-1].messages[-1].content == fixture["final_text"]
    assert agent._workbench.calls == 1
    state = agent._agent_kernel_checkpoint["state"]
    assert state["model_tool_snapshot"]["tools"][0]["schema_sha256"] == fixture["tool"]["schema_sha256"]
    assert hashlib.sha256(json.dumps(state["skills"], separators=(",", ":"), sort_keys=True).encode()).hexdigest() == fixture["skill_manifest_sha256"]
