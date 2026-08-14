import asyncio
import hashlib
import json
from types import SimpleNamespace

import pytest
from autogen_core import CancellationToken, FunctionCall
from autogen_core.models import CreateResult, FunctionExecutionResult, RequestUsage
from autogen_agentchat.messages import TextMessage

from drsai.backend.runtime.agent_kernel import build_execution_tool_registry, freeze_model_tool_snapshot
from drsai.modules.agents.skills_agent.drsai_assistant import DrSaiAssistant
from drsai.modules.managers.messages import FilesEvent


def test_reasoning_effort_reaches_single_model_request_without_mutating_client_defaults() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant._reasoning_effort = "max"
    captured = {}

    class ModelClient:
        model_info = {
            "reasoning_config": SimpleNamespace(
                supported=True,
                effort_levels=["high", "max"],
                param_type="reasoning_effort",
            ),
        }

        async def create_stream(self, *_args, **kwargs):
            captured.update(kwargs["extra_create_args"])
            yield CreateResult(
                content="done", finish_reason="stop",
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )

    async def consume() -> list:
        return [item async for item in assistant.call_llm(
            agent_name="OpenDrSai", model_client=ModelClient(), llm_messages=[], tools=[],
            model_client_stream=True, cancellation_token=CancellationToken(), output_content_type=None,
        )]

    result = asyncio.run(consume())
    assert result[0].content == "done"
    assert captured == {
        "stream_options": {"include_usage": True},
        "reasoning_effort": "max",
    }


def test_deepseek_none_effort_explicitly_disables_thinking() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant._reasoning_effort = "none"
    captured = {}

    class ModelClient:
        model_info = {
            "reasoning_config": SimpleNamespace(
                supported=True,
                effort_levels=["none", "high", "max"],
                param_type="deepseek_reasoning_effort",
            ),
        }

        async def create_stream(self, *_args, **kwargs):
            captured.update(kwargs["extra_create_args"])
            yield CreateResult(
                content="done", finish_reason="stop",
                usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
            )

    async def consume() -> list:
        return [item async for item in assistant.call_llm(
            agent_name="OpenDrSai", model_client=ModelClient(), llm_messages=[], tools=[],
            model_client_stream=True, cancellation_token=CancellationToken(), output_content_type=None,
        )]

    result = asyncio.run(consume())
    assert result[0].content == "done"
    assert captured == {
        "stream_options": {"include_usage": True},
        "thinking": {"type": "disabled"},
    }


def test_desktop_production_dispatch_rejects_model_tool_outside_last_request_snapshot() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant._active_model_tool_snapshot = freeze_model_tool_snapshot("desktop", [{
        "name": "run_read",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
    }])
    result = CreateResult(
        content=[FunctionCall(id="phantom-1", name="UpdateUserConfig", arguments="{}")],
        finish_reason="function_calls",
        usage=RequestUsage(prompt_tokens=1, completion_tokens=1),
        cached=False,
    )

    async def consume() -> None:
        stream = assistant._process_model_result(
            result, [], CancellationToken(), "OpenDrSai", [], None, None, [], {}, None, True,
            False, "{result}", None, None,
        )
        await anext(stream)

    with pytest.raises(ValueError, match="model_tool_not_in_snapshot:UpdateUserConfig"):
        asyncio.run(consume())


def test_desktop_production_model_request_freezes_exact_visible_tool_set() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant._memory_function = None
    assistant._reply_function = None
    assistant._metadata = {}
    assistant._active_model_tool_snapshot = None
    assistant._active_execution_tool_registry = None

    async def messages(*_args):
        yield []

    captured = {}

    async def model_call(**kwargs):
        captured["tools"] = kwargs["tools"]
        yield CreateResult(
            content="done", finish_reason="stop",
            usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
        )

    class Workbench:
        async def list_tools(self):
            return [{
                "name": "run_read",
                "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
            }, {
                "name": "web.search",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
            }]

    assistant._get_messages_with_compression_notification = messages
    assistant._get_compatible_context = lambda **kwargs: kwargs["messages"]
    assistant.call_llm = model_call

    async def consume() -> list:
        return [item async for item in assistant._call_llm(
            model_client=object(), model_client_stream=False, system_messages=[], model_context=object(),
            workbench=Workbench(), handoff_tools=[], manager_tools=[{
                "name": "TodoWrite",
                "parameters": {"type": "object", "properties": {"items": {"type": "array"}}},
            }], agent_name="OpenDrSai", cancellation_token=CancellationToken(), output_content_type=None,
        )]

    output = asyncio.run(consume())
    assert output[0].content == "done"
    assert [tool["name"] for tool in captured["tools"]] == ["run_read", "web.search", "TodoWrite"]
    assert [item["name"] for item in assistant._active_model_tool_snapshot["tools"]] == ["TodoWrite", "run_read", "web.search"]
    assert assistant._metadata["model_tool_snapshot_version"] == "p9-model-tools-v1"
    assert len(assistant._metadata["model_tool_snapshot_sha256"]) == 64
    assert assistant._metadata["model_tool_count"] == "3"
    assert assistant._metadata["execution_tool_registry_version"] == "p9-execution-tools-v1"
    assert len(assistant._metadata["execution_tool_registry_sha256"]) == 64
    records = {item["name"]: item for item in assistant._active_execution_tool_registry["tools"]}
    assert records["run_read"]["executor_id"] == "workbench:run_read"
    assert records["run_read"]["risk"] == "read_only"
    assert records["TodoWrite"]["executor_id"] == "manager:TodoWrite"
    assert records["TodoWrite"]["risk"] == "local_write"
    assert records["web.search"]["executor_id"] == "workbench:web.search"
    assert records["web.search"]["risk"] == "external_write"


def test_required_approval_tool_runs_in_compatibility_mode_without_handler() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant.is_paused = False
    assistant._tool_approval_handler = None
    schema = {
        "name": "external.publish",
        "parameters": {"type": "object", "properties": {"value": {"type": "string"}}},
    }
    assistant._active_model_tool_snapshot = freeze_model_tool_snapshot("desktop", [schema])
    assistant._active_execution_tool_registry = build_execution_tool_registry("desktop", [schema], {
        "external.publish": {
            "version": 1, "source": "desktop-host", "classification": "local-equivalent",
            "risk": "external_write", "approval_mode": "required",
            "executor_id": "workbench:external.publish", "required_capabilities": [],
        },
    })
    result = CreateResult(
        content=[FunctionCall(id="external-1", name="external.publish", arguments='{"value":"x"}')],
        finish_reason="function_calls", usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
    )

    class Context:
        added = []

        async def add_message(self, message):
            self.added.append(message)

    calls = []

    async def execute_tool_call(**kwargs):
        calls.append(kwargs)
        return None, FunctionExecutionResult(
            content="published", name="external.publish", call_id="external-1", is_error=False,
        )

    assistant._execute_tool_call = execute_tool_call

    context = Context()

    async def consume() -> list:
        return [item async for item in assistant._process_model_result(
            result, [], CancellationToken(), "OpenDrSai", [], context, None, [], {}, None, True,
            False, "{result}", None, None,
        )]

    output = asyncio.run(consume())
    execution_result = context.added[0].content[0]
    assert len(calls) == 1
    assert execution_result.is_error is False
    assert execution_result.content == "published"
    assert output[-1].chat_message.content.startswith("The results of execution:")


def test_desktop_parallel_delegate_batch_cannot_bypass_required_approval() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant.is_paused = False
    assistant._max_agent_concurrent = 2
    approval_requests = []

    async def deny(record, arguments):
        approval_requests.append((record, arguments))
        return False

    async def forbidden_parallel(**_kwargs):
        raise AssertionError("parallel executor must not run after approval denial")
        yield  # pragma: no cover

    async def forbidden_single(**_kwargs):
        raise AssertionError("single executor must not run after batch approval denial")
        yield  # pragma: no cover

    assistant._tool_approval_handler = deny
    assistant._execute_subagents_parallel = forbidden_parallel
    assistant._execute_subagent = forbidden_single
    schema = {
        "name": "Delegate",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_type": {"type": "string"},
                "prompt": {"type": "string"},
            },
            "required": ["agent_type", "prompt"],
        },
    }
    assistant._active_model_tool_snapshot = freeze_model_tool_snapshot("desktop", [schema])
    assistant._active_execution_tool_registry = build_execution_tool_registry("desktop", [schema], {
        "Delegate": {
            "version": 1, "source": "desktop-host", "classification": "local-equivalent",
            "risk": "external_write", "approval_mode": "required",
            "executor_id": "manager:Delegate", "required_capabilities": [],
        },
    })
    result = CreateResult(
        content=[
            FunctionCall(id="delegate-1", name="Delegate", arguments='{"agent_type":"research","prompt":"one"}'),
            FunctionCall(id="delegate-2", name="Delegate", arguments='{"agent_type":"review","prompt":"two"}'),
        ],
        finish_reason="function_calls", usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
    )

    class Context:
        def __init__(self):
            self.added = []

        async def add_message(self, message):
            self.added.append(message)

    context = Context()

    async def consume() -> list:
        return [item async for item in assistant._process_model_result(
            result, [], CancellationToken(), "OpenDrSai", [], context, None, [], {}, None, True,
            False, "{result}", None, None,
        )]

    output = asyncio.run(consume())
    assert len(approval_requests) == 1
    assert approval_requests[0][0]["executor_id"] == "manager:Delegate"
    assert len(approval_requests[0][1]["parallel_calls"]) == 2
    execution_results = context.added[0].content
    assert len(execution_results) == 2
    assert all(item.is_error for item in execution_results)
    assert all("denied or unavailable" in item.content for item in execution_results)
    assert output[-1].chat_message.content.startswith("The results of execution:")


def test_desktop_parallel_delegate_results_remain_bound_to_call_id() -> None:
    assistant = object.__new__(DrSaiAssistant)
    active = 0
    peak = 0

    async def execute_subagent(*, prompt, **_kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        yield TextMessage(content=f"result:{prompt}", source="sub")
        active -= 1

    assistant._execute_subagent = execute_subagent

    async def consume() -> list:
        return [item async for item in assistant._execute_subagents_parallel(
            delegate_calls=[
                ("delegate-1", "research", "one", None, None),
                ("delegate-2", "research", "two", None, None),
            ],
            cancellation_token=CancellationToken(),
            max_concurrent=2,
        )]

    output = asyncio.run(consume())
    results = {
        item.metadata["subagent_result_call_id"]: item.content
        for item in output if isinstance(item, TextMessage) and (item.metadata or {}).get("subagent_result_call_id")
    }
    assert peak == 2
    assert set(results) == {"delegate-1", "delegate-2"}
    assert "result:one" in results["delegate-1"]
    assert "result:two" in results["delegate-2"]


@pytest.mark.parametrize(("name", "risk", "expected_attempts"), [
    ("run_read", "read_only", 2), ("run_write", "local_write", 1),
])
def test_desktop_tool_retry_is_limited_to_read_only_transient_failures(
    name: str, risk: str, expected_attempts: int,
) -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant.is_paused = False
    assistant._tool_approval_handler = None
    schema = {"name": name, "parameters": {"type": "object", "properties": {}}}
    assistant._active_model_tool_snapshot = freeze_model_tool_snapshot("desktop", [schema])
    assistant._active_execution_tool_registry = build_execution_tool_registry("desktop", [schema], {
        name: {
            "version": 1, "source": "desktop-host", "classification": "local-equivalent",
            "risk": risk, "approval_mode": "none", "executor_id": f"workbench:{name}",
            "required_capabilities": [],
        },
    })
    attempts = 0

    async def execute_tool_call(**_kwargs):
        nonlocal attempts
        attempts += 1
        failed = attempts < 2 or expected_attempts == 1
        return None, FunctionExecutionResult(
            content="HTTP 503 temporarily unavailable" if failed else "ok",
            name=name, call_id="call-1", is_error=failed,
        )

    assistant._execute_tool_call = execute_tool_call
    result = CreateResult(
        content=[FunctionCall(id="call-1", name=name, arguments="{}")],
        finish_reason="function_calls", usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
    )

    class Context:
        def __init__(self): self.added = []
        async def add_message(self, message): self.added.append(message)

    context = Context()

    async def consume() -> list:
        return [item async for item in assistant._process_model_result(
            result, [], CancellationToken(), "OpenDrSai", [], context, None, [], {}, None, True,
            False, "{result}", None, None,
        )]

    asyncio.run(consume())
    assert attempts == expected_attempts
    execution = context.added[0].content[0]
    if expected_attempts == 2:
        assert execution.is_error is False
        assert execution.content == "ok"
    else:
        assert execution.is_error is True
        assert "Action:" in execution.content


def test_desktop_large_tool_output_becomes_complete_artifact_and_bounded_preview() -> None:
    assistant = object.__new__(DrSaiAssistant)
    assistant.is_paused = False
    assistant._tool_approval_handler = None
    schema = {"name": "run_read", "parameters": {"type": "object", "properties": {}}}
    assistant._active_model_tool_snapshot = freeze_model_tool_snapshot("desktop", [schema])
    assistant._active_execution_tool_registry = build_execution_tool_registry("desktop", [schema], {
        "run_read": {
            "version": 1, "source": "desktop-host", "classification": "local-equivalent",
            "risk": "read_only", "approval_mode": "none", "executor_id": "workbench:run_read",
            "required_capabilities": [],
        },
    })
    complete = "full-output-" + "x" * 20_000
    persisted = []

    async def execute_tool_call(**_kwargs):
        return None, FunctionExecutionResult(
            content=complete, name="run_read", call_id="call-large", is_error=False,
        )

    async def persist(metadata, content):
        persisted.append((metadata, content))
        return {
            "artifact_id": "artifact-large", "display_name": "run-read.txt",
            "mime_type": "text/plain; charset=utf-8", "size": len(content),
            "sha256": hashlib.sha256(content).hexdigest(), "downloadable": True,
        }

    assistant._execute_tool_call = execute_tool_call
    assistant._tool_output_artifact_handler = persist
    result = CreateResult(
        content=[FunctionCall(id="call-large", name="run_read", arguments="{}")],
        finish_reason="function_calls", usage=RequestUsage(prompt_tokens=1, completion_tokens=1), cached=False,
    )

    class Context:
        def __init__(self): self.added = []
        async def add_message(self, message): self.added.append(message)

    context = Context()

    async def consume() -> list:
        return [item async for item in assistant._process_model_result(
            result, [], CancellationToken(), "OpenDrSai", [], context, None, [], {}, None, True,
            False, "{result}", None, None,
        )]

    output = asyncio.run(consume())
    assert persisted[0][1] == complete.encode()
    model_content = json.loads(context.added[0].content[0].content)
    assert model_content["truncated"] is True
    assert len(model_content["preview"]) == 4096
    assert model_content["artifact_ids"] == ["artifact-large"]
    artifact_event = next(item for item in output if isinstance(item, FilesEvent))
    artifact = artifact_event.content.files[0]
    assert artifact.artifact_id == "artifact-large"
    assert artifact.sha256 == hashlib.sha256(complete.encode()).hexdigest()
    assert artifact.source_call_id == "call-large"
