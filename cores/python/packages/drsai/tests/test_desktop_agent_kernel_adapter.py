from __future__ import annotations

import json
import base64
import hashlib
from pathlib import Path

from autogen_agentchat.messages import MultiModalMessage, TextMessage
from autogen_core import FunctionCall, Image
from autogen_core.models import CreateResult, RequestUsage, SystemMessage
from autogen_core.tools import FunctionTool
from PIL import Image as PILImage
import pytest

from drsai.backend.runtime.agent_kernel import normalize_kernel_host_port
from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel
from drsai.backend.runtime.web_search import create_web_fetch_tool, create_web_search_tool
import drsai.backend.runtime.desktop_agent_kernel_adapter as desktop_adapter
from drsai.backend.runtime.desktop_agent_kernel_adapter import (
    _desktop_default_subagent_profile,
    _desktop_input_artifact,
    _desktop_memory_candidates,
    _controlled_operation_result,
    _controlled_operation_call_contracts,
    _controlled_command,
    _controlled_command_templates,
    _controlled_basic_tool_names,
    _controlled_write_result,
    _controlled_workspace_write,
    _controlled_tool_allowed,
    desktop_regression_control_scope,
    normalize_desktop_kernel_task,
    run_agent_through_kernel,
)
from drsai.modules.agents.skills_agent.drsai_assistant import DrSaiAssistant
from drsai.modules.agents.skills_agent.managers.get_managers_tools import get_regression_read_tools


class _Client:
    _create_args = {"model": "fixture-model"}

    async def create_stream(self, _messages, **_kwargs):
        yield "done"
        yield CreateResult(
            finish_reason="stop", content="done",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _VisibleRegressionToolsClient(_Client):
    def __init__(self):
        self.tool_names = set()

    async def create_stream(self, _messages, **kwargs):
        self.tool_names = {
            str(getattr(tool, "schema", tool).get("name"))
            for tool in kwargs.get("tools", [])
        }
        async for value in super().create_stream(_messages, **kwargs):
            yield value


class _Workbench:
    async def list_tools(self):
        return []

    async def call_tool(self, **_kwargs):
        raise AssertionError


class _WebSearchWorkbench(_Workbench):
    called = False

    async def list_tools(self):
        return [create_web_search_tool().schema]

    async def call_tool(self, **kwargs):
        assert kwargs["name"] == "web_search"
        self.called = True
        return type("Result", (), {
            "is_error": False,
            # Autogen's FunctionExecutionResult serializes mapping values with
            # Python repr rather than JSON in the production workbench path.
            "to_text": staticmethod(lambda: "{'provider':'tavily','query':'Hepix 2026','results':[{'title':'HEPiX','url':'https://www.hepix.org','snippet':'Global scientific IT forum'}]}"),
        })()


class _WebSearchClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(id="call-search", name="web_search", arguments='{"query":"Hepix2026"}')],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="HEPiX is a global scientific IT forum: https://www.hepix.org",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _WebFetchWorkbench(_Workbench):
    called = False

    async def list_tools(self):
        return [create_web_fetch_tool().schema]

    async def call_tool(self, **kwargs):
        assert kwargs["name"] == "web_fetch"
        self.called = True
        return type("Result", (), {
            "is_error": False,
            "to_text": staticmethod(lambda: "{'final_url':'https://www.hepix.org/','title':'HEPiX','content':'Official forum','truncated':True}"),
        })()


class _WebFetchClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(id="call-fetch", name="web_fetch", arguments='{"url":"https://www.hepix.org/"}')],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Official source: https://www.hepix.org/",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


def test_regression_run_operations_are_digest_bound_and_scope_limited() -> None:
    fixture_path = Path(__file__).resolve().parents[5] / "eval" / "regression" / "assets" / "runs" / "inspect_compare_v1" / "fixture.json"
    raw = fixture_path.read_bytes()
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "run_fixture": {"sha256": hashlib.sha256(raw).hexdigest(), "content_base64": base64.b64encode(raw).decode("ascii")},
        "allowed_operations": [
            {"operation": "run.inspect", "run_ids": ["run-regression-baseline-001", "run-regression-candidate-001"]},
            {"operation": "run.manifest.read", "run_ids": ["run-regression-baseline-001", "run-regression-candidate-001"]},
            {"operation": "run.compare", "baseline_run_id": "run-regression-baseline-001", "candidate_run_id": "run-regression-candidate-001"},
        ],
        "forbidden_operations": ["run.replay"],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]
    with desktop_regression_control_scope(resources):
        assert _controlled_operation_call_contracts() == (
            "run_inspect(run_id=run-regression-baseline-001)",
            "run_inspect(run_id=run-regression-candidate-001)",
            "run_manifest_read(run_id=run-regression-baseline-001)",
            "run_manifest_read(run_id=run-regression-candidate-001)",
            "run_compare(baseline_run_id=run-regression-baseline-001, candidate_run_id=run-regression-candidate-001)",
        )
        inspected = _controlled_operation_result("run_inspect", {"run_id": "run-regression-candidate-001"})
        compared = _controlled_operation_result("run_compare", {
            "baseline_run_id": "run-regression-baseline-001", "candidate_run_id": "run-regression-candidate-001",
        })
        assert inspected["inspection"]["metrics"]["duration_ms"] == 1840
        assert inspected["references"][1]["id"] == "item-regression-candidate-web-search-001"
        assert compared["comparison"]["duration_delta_ms"] == 1420
        with pytest.raises(ValueError, match="operation_scope_denied"):
            _controlled_operation_result("run_inspect", {"run_id": "run-outside-fixture"})


class _KnowledgeClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(id="call-knowledge", name="knowledge_search", arguments='{"query":"Session Run"}')],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="A Session contains Runs (opendrsai://regression/knowledge/kb/revisions/1/documents/doc.md).",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _MissingKnowledgeClient(_KnowledgeClient):
    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(id="call-knowledge", name="knowledge_search", arguments='{"query":"OpenDrSai Gateway default port"}')],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="The provided corpus does not state a default Gateway port.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _ControlledWriteClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(
                    id="call-write", name="regression_controlled_write",
                    arguments=json.dumps({
                        "relative_path": "output/approval-proof.txt",
                        "content": "OpenDrSai approval regression passed.",
                    }),
                )],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Created output/approval-proof.txt after approval.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _CommandWorkbench(_Workbench):
    def __init__(self):
        async def run_powershell(command: str, timeout: int = 200, run_in_background: bool = False) -> str:
            return command
        self.tool = FunctionTool(run_powershell, name="run_powershell", description="Execute PowerShell")
        self.called = []

    async def list_tools(self):
        return [self.tool.schema]

    async def call_tool(self, **kwargs):
        self.called.append(kwargs)
        return type("Result", (), {
            "is_error": False,
            "to_text": staticmethod(lambda: "test_success_rate_empty_returns_zero FAILED\nZeroDivisionError\n[exit code: 1]"),
        })()


class _CommandClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(
                    id="call-command", name="run_powershell",
                    arguments=json.dumps({"command": "python -B -m pytest tests/test_runtime_metrics.py"}),
                )],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="The empty list triggers ZeroDivisionError.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _DeniedThenValidCommandClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls <= 2:
            command = (
                "python -B -m pytest tests/test_runtime_metrics.py ; whoami"
                if self.calls == 1 else "python -B -m pytest tests/test_runtime_metrics.py"
            )
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(id=f"call-command-{self.calls}", name="run_powershell", arguments=json.dumps({"command": command}))],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Recovered with one allowlisted command.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _SkillScriptClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(
                    id="call-skill-script", name="run_powershell",
                    arguments=json.dumps({
                        "command": "python scripts/create_deck.py tmp/spec.json artifacts/deck.pptx",
                    }),
                )],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Created the deck.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _KnowledgeAndTodoClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[
                    FunctionCall(
                        id="call-knowledge-batch", name="knowledge_search",
                        arguments='{"query":"Session Run"}',
                    ),
                    FunctionCall(
                        id="call-todo-batch", name="TodoWrite",
                        arguments='{"items":[{"title":"Inspect rendered slides"}]}',
                    ),
                ],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Inspection tracked.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _TodoManager:
    def __init__(self):
        self.items = []

    def update(self, items):
        self.items = list(items)

    def get_task_prompt(self):
        return "Todo list updated."


class _ForbiddenWorkspaceWriteClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(
                    id="call-forbidden-write", name="run_write",
                    arguments='{"path":"scripts/create_deck.py","content":"bypass"}',
                )],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Write was denied.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


class _WriteWorkbench(_Workbench):
    def __init__(self):
        async def run_write(path: str, content: str) -> str:
            return path
        self.tool = FunctionTool(run_write, name="run_write", description="Write file")
        self.called = []

    async def list_tools(self):
        return [self.tool.schema]

    async def call_tool(self, **kwargs):
        self.called.append(kwargs)
        raise AssertionError("controlled write must not reach Workbench")


class _ImageEditClient(_Client):
    def __init__(self):
        self.calls = 0

    async def create_stream(self, _messages, **_kwargs):
        self.calls += 1
        if self.calls == 1:
            yield CreateResult(
                finish_reason="function_calls",
                content=[FunctionCall(
                    id="call-image-edit", name="image_edit",
                    arguments='{"resource_id":"tmp/render/slide1.png","prompt":"inspect"}',
                )],
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )
            return
        yield CreateResult(
            finish_reason="stop", content="Finished with artifacts/deck.pptx.",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )


def _image_edit_handoff_tool() -> FunctionTool:
    async def image_edit(resource_id: str, prompt: str) -> str:
        raise AssertionError("controlled presentation image_edit must never reach the Host")

    return FunctionTool(image_edit, name="image_edit", description="Edit an image")


class _ImageEditWorkbench(_Workbench):
    def __init__(self):
        self.tool = _image_edit_handoff_tool()
        self.called = []

    async def list_tools(self):
        return [self.tool.schema]

    async def call_tool(self, **kwargs):
        self.called.append(kwargs)
        raise AssertionError("controlled presentation image_edit must never reach the Host")


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
    _regression_tools = []
    _tool_approval_handler = None

    def __init__(self):
        self._shared_agent_kernel = create_agent_kernel(surface="desktop")
        self._kernel_host_port = _host_port(
            ["chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts"]
        )


def _host_port(capabilities):
    return normalize_kernel_host_port({
        "schema_version": 1,
        "protocol_version": "p9-host-port-v1",
        "surface": "desktop",
        "capabilities": [
            {"id": capability, "version": 1, "required": capability == "chat"}
            for capability in capabilities
        ],
    }, surface="desktop")


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
async def test_kernel_checkpoint_history_is_bound_to_its_session() -> None:
    agent = _Agent()
    agent._agent_kernel_checkpoint = {
        "reason": "terminal",
        "state": {
            "session_id": "session-other",
            "messages": [{"role": "user", "content": "must-not-leak"}],
        },
    }

    output = [value async for value in run_agent_through_kernel(
        agent, task="hello", cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=_policy,
    )]

    assert output[-1].stop_reason == "run.completed"
    messages = agent._agent_kernel_checkpoint["state"]["messages"]
    assert all(value.get("content") != "must-not-leak" for value in messages)


@pytest.mark.asyncio
async def test_ordinary_desktop_kernel_exposes_native_regression_tools() -> None:
    agent = _Agent()
    client = _VisibleRegressionToolsClient()
    agent._model_client = client
    agent._regression_tools = get_regression_read_tools()

    output = [value async for value in run_agent_through_kernel(
        agent, task="hello", cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=_policy,
    )]

    assert output[-1].stop_reason == "run.completed"
    assert {
        "regression_list_suites", "regression_list_cases", "regression_get_case",
        "regression_preflight", "regression_start", "regression_history",
        "regression_get", "regression_events", "regression_cancel",
    }.issubset(client.tool_names)


@pytest.mark.asyncio
async def test_gateway_trusted_evidence_satisfies_kernel_retrieval_requirement() -> None:
    agent = _Agent()
    resources = [{
        "protocol": "oaep.input/1",
        "resource_id": "trusted-image-understanding",
        "kind": "selection",
        "name": "OpenDrSai trusted evidence",
        "permission": "read",
        "status": "encoded",
        "content": '{"satisfied_capability_domains":["retrieval","workspace"]}',
        "captured_at": "2026-08-10T00:00:00+00:00",
    }]

    with desktop_regression_control_scope(resources):
        # The production Gateway enters a second manager scope without
        # repeating its trusted evidence resources.
        with desktop_regression_control_scope([]):
            output = [value async for value in run_agent_through_kernel(
                agent, task="Describe the current source file in the workspace shown in the supplied evidence.",
                cancellation_token=__import__("autogen_core").CancellationToken(),
                policy_resolver=_policy,
            )]

    assert output[-1].stop_reason == "run.completed"
    assert output[-1].messages[-1].content == "done"
    assert agent._agent_kernel_checkpoint["state"]["tool_decision_requirement"]["required_domains"] == []


@pytest.mark.asyncio
async def test_plain_chat_preserves_negotiated_capabilities_when_web_search_is_available() -> None:
    """Regression: merely exposing WebSearch must not make a plain `hello` Run fail."""
    agent = _Agent()
    agent._workbench = _WebSearchWorkbench()
    agent._kernel_host_port = _host_port([
            "chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts",
            "web_search", "network.public_https",
    ])

    def web_policy(name, executor):
        policy = _policy(name, executor)
        if name == "web_search":
            policy["required_capabilities"] = ["web_search", "network.public_https"]
        return policy

    output = [value async for value in run_agent_through_kernel(
        agent, task="hello", cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=web_policy,
    )]

    assert output[-1].stop_reason == "run.completed"
    assert agent._agent_kernel_checkpoint["state"]["host_capabilities"] == sorted(
        agent._kernel_host_port["capabilities"]
    )


@pytest.mark.asyncio
async def test_web_search_executes_the_registered_workbench_tool() -> None:
    agent = _Agent()
    agent._model_client = _WebSearchClient()
    agent._workbench = _WebSearchWorkbench()
    agent._kernel_host_port = _host_port([
        "chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts",
        "web_search", "network.public_https",
    ])

    def web_policy(name, executor):
        policy = _policy(name, executor)
        if name == "web_search":
            policy["required_capabilities"] = ["web_search", "network.public_https"]
        return policy

    output = [value async for value in run_agent_through_kernel(
        agent, task="Hepix2026是什么", cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=web_policy,
    )]

    assert agent._workbench.called is True
    assert any(isinstance(value, TextMessage) and "HEPiX" in str(value.content) for value in output)
    tool_messages = [
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    ]
    assert tool_messages[0]["content"]["provider"] == "tavily"
    assert tool_messages[0]["content"]["results"][0]["url"] == "https://www.hepix.org"


@pytest.mark.asyncio
async def test_web_fetch_preserves_structured_source_evidence() -> None:
    agent = _Agent()
    agent._model_client = _WebFetchClient()
    agent._workbench = _WebFetchWorkbench()
    agent._kernel_host_port = _host_port([
        "chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts",
        "web_fetch", "network.public_https",
    ])

    def web_policy(name, executor):
        policy = _policy(name, executor)
        if name == "web_fetch":
            policy["required_capabilities"] = ["web_fetch", "network.public_https"]
        return policy

    output = [value async for value in run_agent_through_kernel(
        agent, task="Open the official source", cancellation_token=__import__("autogen_core").CancellationToken(),
        policy_resolver=web_policy,
    )]

    assert agent._workbench.called is True
    tool_messages = [
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    ]
    assert tool_messages[0]["content"]["final_url"] == "https://www.hepix.org/"
    assert tool_messages[0]["content"]["source_content_truncated"] is True
    assert "truncated" not in tool_messages[0]["content"]
    final = next(value for value in output if isinstance(value, TextMessage) and "Official source" in str(value.content))
    assert json.loads(final.metadata["citations_json"])[0]["url"] == "https://www.hepix.org/"


@pytest.mark.asyncio
async def test_regression_fixture_exposes_web_search_without_production_provider() -> None:
    agent = _Agent()
    agent._model_client = _WebSearchClient()
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "case_id": "tool.failure.recovery",
        "network": "disabled",
        "tool_faults": [{
            "tool": "web_search", "fail_invocations": [1],
            "error": {"code": "service_unavailable", "retryable": True},
        }],
        "tool_fixtures": {"web_search": {
            "successful_result": {"results": [{
                "title": "Controlled result", "url": "https://regression.test/result",
                "snippet": "fixture",
            }]},
        }},
    }
    resources = [{
        "kind": "selection", "name": "OpenDrSai regression control",
        "content": json.dumps(control),
    }]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="search for the controlled result",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    tool_messages = [
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    ]
    assert tool_messages[0]["name"] == "web_search"
    assert tool_messages[0]["content"]["regression_fixture"] is True
    assert tool_messages[0]["content"]["attempts"] == [
        {
            "tool": "web_search", "status": "failed",
            "error_code": "service_unavailable", "retryable": True,
        },
        {"tool": "web_search", "status": "completed"},
    ]


@pytest.mark.asyncio
async def test_regression_fixture_exposes_digest_verified_knowledge(tmp_path) -> None:
    document = tmp_path / "doc.md"
    document.write_text("A Session can contain multiple Runs.", encoding="utf-8")
    digest = __import__("hashlib").sha256(document.read_bytes()).hexdigest()
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._model_client = _KnowledgeClient()
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "case_id": "knowledge.grounded", "network": "disabled",
        "knowledge_bases": [{
            "knowledge_base_id": "kb", "knowledge_base_revision": 1,
            "document_path": "doc.md", "reference": "doc.md", "sha256": digest,
            "corpus_complete": True,
        }],
    }
    resources = [{
        "kind": "selection", "name": "OpenDrSai regression control",
        "content": json.dumps(control),
    }]

    with desktop_regression_control_scope(resources):
        def unknown_tool_policy(name, executor):
            policy = _policy(name, executor)
            policy.update({"risk": "external_write", "approval_mode": "required"})
            return policy

        output = [value async for value in run_agent_through_kernel(
            agent, task="Explain Session and Run from the knowledge base",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=unknown_tool_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    tool_messages = [
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    ]
    content = tool_messages[0]["content"]
    assert tool_messages[0]["name"] == "knowledge_search"
    assert content["documents"][0]["sha256"] == digest
    assert content["evidence"][0]["content"] == "A Session can contain multiple Runs."
    assert content["status"] == "completed"
    assert content["corpus_complete"] is True
    assert content["supporting_match"] is True


@pytest.mark.asyncio
async def test_regression_knowledge_records_completed_search_without_support(tmp_path) -> None:
    document = tmp_path / "doc.md"
    document.write_text("A Session can contain multiple Runs.", encoding="utf-8")
    digest = __import__("hashlib").sha256(document.read_bytes()).hexdigest()
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._model_client = _MissingKnowledgeClient()
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "case_id": "knowledge.absent", "network": "disabled",
        "knowledge_bases": [{
            "knowledge_base_id": "kb", "knowledge_base_revision": 1,
            "document_path": "doc.md", "reference": "doc.md", "sha256": digest,
            "corpus_complete": True,
        }],
    }
    resources = [{
        "kind": "selection", "name": "OpenDrSai regression control",
        "content": json.dumps(control),
    }]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="What is the default Gateway port?",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    tool_message = next(
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    )
    content = tool_message["content"]
    assert content["completed"] is True
    assert content["corpus_complete"] is True
    assert content["supporting_match"] is False
    assert content["supporting_matches"] == []
    assert content["evidence"][0]["relation"] == "searched_scope"
    assert content["evidence"][0]["supporting_match"] is False
    assert content["documents"][0]["sha256"] == digest


@pytest.mark.asyncio
async def test_regression_read_and_todo_batch_does_not_require_single_tool_approval(tmp_path) -> None:
    document = tmp_path / "doc.md"
    document.write_text("A Session can contain multiple Runs.", encoding="utf-8")
    digest = hashlib.sha256(document.read_bytes()).hexdigest()

    async def todo_write(items: list[dict]) -> str:
        return "Todo list updated."

    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._model_client = _KnowledgeAndTodoClient()
    agent._todo_manager = _TodoManager()
    agent._todo_tools = [FunctionTool(todo_write, name="TodoWrite", description="Update todo list")]
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "case_id": "skill.presentation.runtime-concepts",
        "network": "disabled",
        "knowledge_bases": [{
            "knowledge_base_id": "kb", "knowledge_base_revision": 1,
            "document_path": "doc.md", "reference": "doc.md", "sha256": digest,
            "corpus_complete": True,
        }],
    }
    resources = [{
        "kind": "selection", "name": "OpenDrSai regression control",
        "content": json.dumps(control),
    }]

    def unknown_manager_policy(name, executor):
        policy = _policy(name, executor)
        if name == "TodoWrite":
            policy.update({"risk": "external_write", "approval_mode": "required"})
        return policy

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="Inspect the evidence and track completion",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=unknown_manager_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    assert agent._todo_manager.items == [{"title": "Inspect rendered slides"}]
    tool_messages = [
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    ]
    assert {message["name"] for message in tool_messages} == {"knowledge_search", "TodoWrite"}
    assert all(message["succeeded"] is True for message in tool_messages)


@pytest.mark.asyncio
async def test_regression_controlled_write_requires_approval_and_stays_in_isolated_root(tmp_path) -> None:
    (tmp_path / "output").mkdir()
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._model_client = _ControlledWriteClient()
    approvals = []

    async def approve(payload, arguments):
        approvals.append((payload, arguments))
        return True

    agent._tool_approval_handler = approve
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "tools": [{
            "id": "regression_controlled_write", "revision": 1,
            "effect": "write_local_mutable", "approval": "always_required",
            "allowed_root": "output/", "idempotency": "required",
        }],
        "controlled_write_target": {
            "relative_path": "output/approval-proof.txt",
            "content_utf8": "OpenDrSai approval regression passed.\n",
        },
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="create the approval proof",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]
        replay = _controlled_write_result({
            "relative_path": "output/approval-proof.txt",
            "content": "OpenDrSai approval regression passed.\n",
        }, str(tmp_path))
        with pytest.raises(ValueError, match="write_scope_denied"):
            _controlled_write_result({"relative_path": "outside.txt", "content": "bad"}, str(tmp_path))

    assert output[-1].stop_reason == "run.completed"
    assert len(approvals) == 1
    assert (tmp_path / "output" / "approval-proof.txt").read_text(encoding="utf-8") == "OpenDrSai approval regression passed.\n"
    assert replay["idempotent_replay"] is True
    assert replay["handler_execution_count"] == 1
    tool_message = next(
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    )
    assert tool_message["name"] == "regression_controlled_write"
    assert tool_message["content"]["handler_execution_count"] == 1


@pytest.mark.asyncio
async def test_regression_readonly_workspace_executes_only_exact_allowlisted_command(tmp_path) -> None:
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_runtime_metrics.py").write_text("def test_expected_failure():\n    assert False\n", encoding="utf-8")
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._model_client = _CommandClient()
    agent._workbench = _CommandWorkbench()
    dangerous_state = {"dangerous_allowed": False}
    transitions = []

    def get_dangerous_status():
        return dict(dangerous_state)

    def set_dangerous_allowed(enabled):
        dangerous_state["dangerous_allowed"] = bool(enabled)
        transitions.append(bool(enabled))

    agent._workspace_toggle_funcs = [get_dangerous_status, set_dangerous_allowed]
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "workspace": {"permission": "read_only"},
        "allowed_commands": [{
            "executable": "python",
            "args": ["-B", "-m", "pytest", "tests/test_runtime_metrics.py"],
        }],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="diagnose the failing test",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]
        with pytest.raises(ValueError, match="command_.*_denied"):
            _controlled_command({"command": "python -c print(1)"})
        with pytest.raises(ValueError, match="background_command_forbidden"):
            _controlled_command({
                "command": "python -B -m pytest tests/test_runtime_metrics.py",
                "run_in_background": True,
            })

    assert output[-1].stop_reason == "run.completed"
    assert agent._workbench.called == []
    assert transitions == []
    assert dangerous_state == {"dangerous_allowed": False}
    tool_message = next(
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    )
    assert tool_message["content"]["exit_code"] == 1
    assert tool_message["content"]["policy"] == "read_only"


@pytest.mark.asyncio
async def test_regression_command_policy_denial_returns_tool_error_and_agent_can_recover(tmp_path) -> None:
    tests_dir = tmp_path / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_runtime_metrics.py").write_text("def test_expected_failure():\n    assert False\n", encoding="utf-8")
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._model_client = _DeniedThenValidCommandClient()
    agent._workbench = _CommandWorkbench()
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "allowed_commands": [{
            "executable": "python", "args": ["-B", "-m", "pytest", "tests/test_runtime_metrics.py"],
        }],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="diagnose the failing test",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    assert agent._workbench.called == []
    tool_messages = [value for value in agent._agent_kernel_checkpoint["state"]["messages"] if value.get("role") == "tool"]
    assert tool_messages[0]["succeeded"] is False
    assert tool_messages[0]["content"]["error"]["code"] == "desktop_regression_command_shell_control_denied"
    assert tool_messages[0]["content"]["error"]["category"] == "command_policy"
    assert "Keep safe mode enabled" in tool_messages[0]["content"]["error"]["actionable"]
    assert "do not request /dangerous on" in tool_messages[0]["content"]["error"]["actionable"]
    assert "exactly one allowlisted command" in tool_messages[0]["content"]["details"]["recovery"]
    assert tool_messages[0]["content"]["details"]["allowed_command_templates"] == [
        "python -B -m pytest tests/test_runtime_metrics.py"
    ]
    assert tool_messages[1]["succeeded"] is True


@pytest.mark.asyncio
async def test_regression_skill_script_uses_current_runtime_python_without_shell(tmp_path) -> None:
    skill_root = tmp_path / "installed" / "pptx"
    script = skill_root / "scripts" / "create_deck.py"
    script.parent.mkdir(parents=True)
    script.write_text(
        "import pathlib, sys\npathlib.Path(sys.argv[2]).write_text('created', encoding='utf-8')\nprint('ok')\n",
        encoding="utf-8",
    )
    (tmp_path / "tmp").mkdir()
    (tmp_path / "tmp" / "spec.json").write_text("{}", encoding="utf-8")
    (tmp_path / "artifacts").mkdir()
    agent = _Agent()
    config_dir = tmp_path / "agent-config" / "user"
    config_dir.mkdir(parents=True)
    agent._work_dir = str(config_dir)
    agent._runtime_workspace_path = tmp_path
    agent._model_client = _SkillScriptClient()
    agent._workbench = _CommandWorkbench()
    agent._cached_skills_loader = type("Loader", (), {
        "skills": {"pptx": {"dir": skill_root}},
    })()
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "allowed_commands": [{
            "skill_script": {
                "skill_id": "pptx", "relative_path": "scripts/create_deck.py",
                "sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
            },
            "args": [{"exact": "tmp/spec.json"}, {"exact": "artifacts/deck.pptx"}],
        }],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="create deck",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    assert agent._workbench.called == []
    assert (tmp_path / "artifacts" / "deck.pptx").read_text(encoding="utf-8") == "created"
    system_prompt = agent._agent_kernel_checkpoint["state"]["messages"][0]["content"]
    assert "Relative scripts/ paths are intentional" in system_prompt
    assert "python scripts/create_deck.py tmp/spec.json artifacts/deck.pptx" in system_prompt
    tool_message = next(
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    )
    assert tool_message["succeeded"] is True
    assert tool_message["content"]["exit_code"] == 0
    assert tool_message["content"]["policy"] == "regression_skill_script"


def test_regression_skill_script_allowlist_binds_digest_arguments_and_workspace(tmp_path) -> None:
    script = tmp_path / "installed" / "pptx" / "scripts" / "create_deck.py"
    script.parent.mkdir(parents=True)
    script.write_text("print('safe')", encoding="utf-8")
    spec = tmp_path / "tmp" / "presentation-render" / "spec.json"
    spec.parent.mkdir(parents=True)
    spec.write_text("{}", encoding="utf-8")
    output = tmp_path / "artifacts" / "deck.pptx"
    control = {
        "schema_version": "opendrsai.regression-control/1", "network": "disabled",
        "allowed_commands": [{
            "skill_script": {
                "skill_id": "pptx", "relative_path": "scripts/create_deck.py",
                "sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
            },
            "args": [{"exact": "tmp/presentation-render/spec.json"}, {"exact": "artifacts/deck.pptx"}],
        }],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        assert _controlled_command_templates() == [
            "python scripts/create_deck.py tmp/presentation-render/spec.json artifacts/deck.pptx"
        ]
        command = f'& python "{script}" "{spec}" "{output}"'
        _, argv = _controlled_command({"command": command}, str(tmp_path))
        assert Path(argv[1]) == script
        relative_command = 'python scripts/create_deck.py tmp/presentation-render/spec.json artifacts/deck.pptx'
        _, relative_argv = _controlled_command(
            {"command": relative_command}, str(tmp_path), {"pptx": script.parent.parent},
        )
        assert Path(relative_argv[1]) == script
        assert Path(relative_argv[2]) == Path("tmp/presentation-render/spec.json")
        with pytest.raises(ValueError, match="command_script_identity_denied"):
            _controlled_command({"command": relative_command}, str(tmp_path), {})
        with pytest.raises(ValueError, match="command_.*_denied"):
            _controlled_command({"command": f'{command} ; whoami'}, str(tmp_path))
        with pytest.raises(ValueError, match="command_.*_denied"):
            _controlled_command({"command": f'{command} & whoami'}, str(tmp_path))
        with pytest.raises(ValueError, match="command_.*_denied"):
            _controlled_command({"command": f'python "{script}" "{spec}" "{tmp_path / "outside.pptx"}"'}, str(tmp_path))


def test_read_only_case_elevates_only_reads_and_allowlisted_foreground_shell() -> None:
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "workspace": {"fixture": "fixture-v1", "permission": "read_only"},
        "allowed_commands": [{
            "executable": "python",
            "args": ["-B", "-m", "pytest", "tests/test_runtime_metrics.py"],
        }],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        names = _controlled_basic_tool_names()
        assert names[:3] == ["run_read", "run_grep", "run_glob"]
        assert names[-1] in {"run_powershell", "run_bash"}
        assert "run_write" not in names
        assert "run_edit" not in names
        assert _controlled_command_templates() == [
            "python -B -m pytest tests/test_runtime_metrics.py"
        ]


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


def test_regression_workspace_write_is_limited_to_declared_output_roots(tmp_path) -> None:
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "workspace": {"isolation": "required", "allowed_write_paths": ["artifacts/", "tmp/render/"]},
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        result = _controlled_workspace_write(
            {"path": "tmp/render/spec.json", "content": "{}"}, str(tmp_path),
        )
        with pytest.raises(ValueError, match="workspace_write_scope_denied"):
            _controlled_workspace_write(
                {"path": "scripts/create_deck.py", "content": "print('bypass')"}, str(tmp_path),
            )

    assert result["relative_path"] == "tmp/render/spec.json"
    assert (tmp_path / "tmp" / "render" / "spec.json").read_text(encoding="utf-8") == "{}"
    assert not (tmp_path / "scripts" / "create_deck.py").exists()


def test_presentation_regression_never_exposes_image_edit_as_a_viewer() -> None:
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "network": "disabled",
        "forbidden_capabilities": ["image_generation"],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        assert _controlled_tool_allowed("image_generation") is False
        assert _controlled_tool_allowed("image_edit") is False
        assert _controlled_tool_allowed("run_read") is True


def test_presentation_regression_keeps_image_edit_protocol_endpoint_for_safe_denial() -> None:
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "network": "disabled",
        "required_skills": ["pptx"],
        "forbidden_capabilities": ["image_generation"],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        assert _controlled_tool_allowed("image_generation") is False
        assert _controlled_tool_allowed("image_edit") is True


@pytest.mark.asyncio
async def test_presentation_image_edit_metadata_is_denied_without_approval(tmp_path, monkeypatch) -> None:
    agent = _Agent()
    agent._model_client = _Client()
    agent._workbench = _ImageEditWorkbench()
    agent._handoff_tools = []
    agent._work_dir = str(tmp_path)
    agent._runtime_workspace_path = tmp_path
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "network": "disabled",
        "required_skills": ["pptx"],
        "forbidden_capabilities": ["image_generation"],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    def approval_policy(name, executor):
        policy = dict(_policy(name, executor))
        if name == "image_edit":
            policy.update({"risk": "external_write", "approval_mode": "required"})
        return policy

    captured = {}
    original = desktop_adapter.autogen_tools_to_kernel_schemas

    def capture_schemas(tools, metadata):
        captured.update(metadata)
        return original(tools, metadata)

    monkeypatch.setattr(desktop_adapter, "autogen_tools_to_kernel_schemas", capture_schemas)

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="finish the presentation",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=approval_policy,
        )]

    assert any("done" in str(getattr(value, "content", "")) for value in output)
    assert captured["image_edit"]["approval_mode"] == "none"
    assert captured["image_edit"]["risk"] == "read_only"
    assert captured["image_edit"]["source"] == "desktop-host"


@pytest.mark.asyncio
async def test_presentation_image_edit_manager_tool_uses_safe_denial_without_approval(tmp_path) -> None:
    agent = _Agent()
    agent._model_client = _ImageEditClient()
    agent._workbench = _Workbench()
    agent._agent_skills_tools = [_image_edit_handoff_tool()]
    agent._work_dir = str(tmp_path)
    agent._runtime_workspace_path = tmp_path
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "network": "disabled",
        "required_skills": ["pptx"],
        "forbidden_capabilities": ["image_generation"],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="finish the presentation",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    system_prompt = agent._agent_kernel_checkpoint["state"]["messages"][0]["content"]
    assert "Local Artifact interaction does not require network access" in system_prompt
    tool_message = next(
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    )
    assert tool_message["succeeded"] is False
    assert tool_message["content"]["error"]["code"] == "presentation_visual_inspection_delegated"


@pytest.mark.asyncio
async def test_regression_keeps_exact_required_image_generation_handoff(tmp_path, monkeypatch) -> None:
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._runtime_workspace_path = tmp_path
    image_tool = _image_edit_handoff_tool()
    image_tool._name = "image_generation"
    image_tool._schema = {**image_tool.schema, "name": "image_generation"}
    agent._handoff_tools = [image_tool]
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "required_capabilities": ["image_generation"],
        "artifact_targets": ["artifacts/generated.png"],
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]
    captured = {}
    original = desktop_adapter.autogen_tools_to_kernel_schemas

    def capture(tools, metadata):
        captured.update(metadata)
        return original(tools, metadata)

    monkeypatch.setattr(desktop_adapter, "autogen_tools_to_kernel_schemas", capture)
    with desktop_regression_control_scope(resources):
        try:
            [value async for value in run_agent_through_kernel(
                agent, task="generate", cancellation_token=__import__("autogen_core").CancellationToken(),
                policy_resolver=_policy,
            )]
        except Exception:
            pass
    assert "image_generation" in captured


@pytest.mark.asyncio
async def test_regression_run_write_denial_never_reaches_legacy_workbench(tmp_path) -> None:
    agent = _Agent()
    agent._work_dir = str(tmp_path)
    agent._runtime_workspace_path = tmp_path
    agent._model_client = _ForbiddenWorkspaceWriteClient()
    agent._workbench = _WriteWorkbench()
    control = {
        "schema_version": "opendrsai.regression-control/1",
        "workspace": {"isolation": "required", "allowed_write_paths": ["artifacts/", "tmp/render/"]},
    }
    resources = [{"kind": "selection", "name": "OpenDrSai regression control", "content": json.dumps(control)}]

    with desktop_regression_control_scope(resources):
        output = [value async for value in run_agent_through_kernel(
            agent, task="write outside scope",
            cancellation_token=__import__("autogen_core").CancellationToken(),
            policy_resolver=_policy,
        )]

    assert output[-1].stop_reason == "run.completed"
    assert agent._workbench.called == []
    assert not (tmp_path / "scripts" / "create_deck.py").exists()
    tool_message = next(
        value for value in agent._agent_kernel_checkpoint["state"]["messages"]
        if value.get("role") == "tool"
    )
    assert tool_message["succeeded"] is False
    assert tool_message["content"]["error"]["code"] == "desktop_regression_workspace_write_scope_denied"
