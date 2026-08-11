"""Autogen Host Port adapters for the shared Desktop/TUI Agent Kernel."""

from __future__ import annotations

import copy
import asyncio
import json
from typing import Any, Awaitable, Callable, Mapping, Sequence

from autogen_core import CancellationToken, FunctionCall, Image
from autogen_core.models import (
    AssistantMessage,
    CreateResult,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    SystemMessage,
    UserMessage,
)

from .desktop_kernel_coordinator import DesktopModelResult, DesktopToolResult
from .agent_kernel import MAX_INLINE_TOOL_OUTPUT_CHARS


def kernel_messages_to_autogen(messages: Sequence[Mapping[str, Any]], *, assistant_name: str) -> list[Any]:
    """Convert the Kernel's canonical context without consulting legacy Agent state."""

    converted: list[Any] = []
    system_parts: list[str] = []
    for value in messages:
        role = value.get("role")
        content = value.get("content", "")
        if role == "system":
            system_parts.append(str(content))
        elif role == "user":
            converted.append(UserMessage(content=str(content), source="user"))
        elif role == "assistant":
            raw_calls = value.get("tool_calls")
            if isinstance(raw_calls, list) and raw_calls:
                converted.append(AssistantMessage(content=[
                    FunctionCall(
                        id=str(call["call_id"]), name=str(call["name"]),
                        arguments=json.dumps(call.get("arguments", {}), ensure_ascii=False, separators=(",", ":")),
                    )
                    for call in raw_calls if isinstance(call, Mapping)
                ], source=assistant_name))
            else:
                converted.append(AssistantMessage(content=str(content), source=assistant_name))
        elif role == "tool":
            converted.append(FunctionExecutionResultMessage(content=[FunctionExecutionResult(
                content=json.dumps(content, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                name=str(value.get("name") or "tool"),
                call_id=str(value.get("tool_call_id") or "missing"),
                is_error=value.get("succeeded") is False,
            )]))
        else:
            raise ValueError(f"desktop_model_message_role_invalid:{role}")
    if system_parts:
        converted.insert(0, SystemMessage(content="\n\n".join(system_parts)))
    return converted


def autogen_messages_to_kernel_history(messages: Sequence[Any]) -> list[dict[str, Any]]:
    """Migrate existing Desktop/TUI conversation state into Kernel history."""

    history: list[dict[str, Any]] = []
    for message in messages:
        if isinstance(message, SystemMessage):
            # The current authoritative System Prompt comes from AgentRunConfig;
            # old System messages must not be able to override it as history.
            continue
        if isinstance(message, UserMessage):
            content = message.content
            if not isinstance(content, str):
                raise ValueError("desktop_history_multimodal_requires_artifact_migration")
            history.append({"role": "user", "content": content})
        elif isinstance(message, AssistantMessage):
            if isinstance(message.content, str):
                history.append({"role": "assistant", "content": message.content})
            else:
                history.append({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "call_id": call.id,
                            "name": call.name,
                            "arguments": json.loads(call.arguments),
                        }
                        for call in message.content
                    ],
                })
        elif isinstance(message, FunctionExecutionResultMessage):
            for result in message.content:
                history.append({
                    "role": "tool",
                    "content": result.content,
                    "tool_call_id": result.call_id,
                    "name": result.name,
                })
        else:
            raise ValueError(f"desktop_history_message_invalid:{type(message).__name__}")
    return history


def autogen_tools_to_kernel_schemas(
    tools: Sequence[Any],
    metadata: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Build the exact model-visible/executable Desktop Run Tool contract."""

    result: list[dict[str, Any]] = []
    for value in tools:
        schema = getattr(value, "schema", value)
        if not isinstance(schema, Mapping):
            raise ValueError("desktop_tool_schema_invalid")
        name = schema.get("name")
        parameters = schema.get("parameters")
        if not isinstance(name, str) or not name or not isinstance(parameters, Mapping):
            raise ValueError("desktop_tool_schema_invalid")
        policy = metadata.get(name)
        if not isinstance(policy, Mapping):
            raise ValueError(f"desktop_tool_metadata_missing:{name}")
        risk = policy.get("risk")
        if risk not in {"read_only", "local_write", "external_write", "sensitive"}:
            raise ValueError(f"desktop_tool_risk_invalid:{name}")
        result.append({
            "name": name,
            "version": int(policy.get("version", 1)),
            "source": str(policy.get("source") or "desktop-host"),
            "classification": str(policy.get("classification") or "local-equivalent"),
            "description": str(schema.get("description") or name),
            "parameters": dict(parameters),
            "required_capabilities": list(policy.get("required_capabilities") or []),
            "risk": risk,
            # Kernel approval is deliberately fail-safe: Desktop's historical
            # "conditional" sensitive tools require a Host decision per call.
            "requires_approval": str(policy.get("approval_mode") or "none") == "required",
            "approval_mode": str(policy.get("approval_mode") or "none"),
            "title": str(schema.get("description") or name),
            "summary": f"Allow {name} to run on Desktop Host",
        })
    if set(metadata) != {value["name"] for value in result}:
        raise ValueError("desktop_tool_metadata_drift")
    return result


class AutogenDesktopModelPort:
    """Service Kernel model requests through one existing Autogen client."""

    def __init__(
        self,
        model_client: Any,
        tools: Sequence[Any],
        *,
        assistant_name: str,
        cancellation_token: CancellationToken | None = None,
        max_retries: int = 0,
        retryable: Callable[[BaseException], bool] | None = None,
        retry_base_delay: float = 0.0,
        input_images: Sequence[Image] = (),
    ) -> None:
        self._model_client = model_client
        self._tools = tuple(tools)
        self._assistant_name = assistant_name
        self._cancellation_token = cancellation_token or CancellationToken()
        self._max_retries = max(0, int(max_retries))
        self._retryable = retryable or (lambda _error: False)
        self._retry_base_delay = max(0.0, float(retry_base_delay))
        self._input_images = tuple(input_images)

    async def __call__(self, payload: Mapping[str, Any]) -> DesktopModelResult:
        messages = payload.get("messages")
        if not isinstance(messages, list) or not all(isinstance(value, Mapping) for value in messages):
            raise ValueError("desktop_model_messages_invalid")
        attempt = 0
        while True:
            deltas: list[str] = []
            completed: CreateResult | None = None
            try:
                converted = kernel_messages_to_autogen(messages, assistant_name=self._assistant_name)
                if self._input_images:
                    user_index = next((index for index in range(len(converted) - 1, -1, -1) if isinstance(converted[index], UserMessage)), None)
                    if user_index is None:
                        raise ValueError("desktop_multimodal_user_message_missing")
                    current = converted[user_index]
                    converted[user_index] = UserMessage(
                        content=[str(current.content), *self._input_images], source=current.source,
                    )
                async for chunk in self._model_client.create_stream(
                    converted,
                    tools=list(self._tools),
                    cancellation_token=self._cancellation_token,
                ):
                    if isinstance(chunk, str):
                        deltas.append(chunk)
                    elif isinstance(chunk, CreateResult):
                        completed = chunk
                    else:
                        raise RuntimeError(f"desktop_model_chunk_invalid:{type(chunk).__name__}")
                if completed is None:
                    raise RuntimeError("desktop_model_result_missing")
                if isinstance(completed.content, str) and not completed.content.strip():
                    raise RuntimeError("desktop_model_empty_output")
                break
            except Exception as error:
                if attempt >= self._max_retries or not self._retryable(error):
                    raise
                attempt += 1
                if self._retry_base_delay:
                    await asyncio.sleep(min(self._retry_base_delay * (2 ** (attempt - 1)), 60.0))
        content = completed.content
        tool_calls: tuple[dict[str, Any], ...] = ()
        text = content if isinstance(content, str) else ""
        if isinstance(content, list):
            if not all(isinstance(value, FunctionCall) for value in content):
                raise RuntimeError("desktop_model_tool_calls_invalid")
            parsed = []
            for call in content:
                try:
                    arguments = json.loads(call.arguments)
                except json.JSONDecodeError as error:
                    raise RuntimeError(f"desktop_model_tool_arguments_invalid:{call.name}") from error
                if not isinstance(arguments, dict):
                    raise RuntimeError(f"desktop_model_tool_arguments_invalid:{call.name}")
                parsed.append({"call_id": call.id, "name": call.name, "arguments": arguments})
            tool_calls = tuple(parsed)
        return DesktopModelResult(
            content=text,
            deltas=tuple(deltas),
            tool_calls=tool_calls,
            finish_reason=completed.finish_reason,
            reasoning_summary=str(completed.thought or ""),
        )


SpecialToolPort = Callable[[Mapping[str, Any]], Awaitable[DesktopToolResult]]


class AutogenDesktopToolPort:
    """Execute normal Workbench/handoff tools requested by the Kernel.

    Manager tools (Skill, Delegate, Todo, scheduled tasks) are explicit Host
    adapters supplied through ``special_tools``; they never fall through to a
    Workbench by accident.
    """

    def __init__(
        self,
        workbench: Any,
        handoff_tools: Sequence[Any] = (),
        *,
        special_tools: Mapping[str, SpecialToolPort] | None = None,
        output_artifact_handler: Callable[[dict[str, Any], bytes], Awaitable[Mapping[str, Any]]] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> None:
        self._workbench = workbench
        self._handoff_tools = {str(value.name): value for value in handoff_tools}
        self._special_tools = dict(special_tools or {})
        self._output_artifact_handler = output_artifact_handler
        self._cancellation_token = cancellation_token or CancellationToken()

    async def __call__(self, payload: Mapping[str, Any]) -> DesktopToolResult:
        call_id = payload.get("call_id")
        name = payload.get("name")
        arguments = payload.get("arguments")
        if not isinstance(call_id, str) or not call_id:
            raise ValueError("desktop_tool_call_id_invalid")
        if not isinstance(name, str) or not name:
            raise ValueError("desktop_tool_name_invalid")
        if not isinstance(arguments, Mapping):
            raise ValueError("desktop_tool_arguments_invalid")
        if name in self._special_tools:
            result = await self._special_tools[name](payload)
            if result.call_id != call_id:
                raise RuntimeError("desktop_special_tool_identity_mismatch")
            return await self._artifactize(result, name)
        if name in self._handoff_tools:
            tool = self._handoff_tools[name]
            value = await tool.run_json(dict(arguments), self._cancellation_token)
            text = tool.return_value_as_string(value)
            return await self._artifactize(DesktopToolResult(call_id, True, {"content": text}), name)
        result = await self._workbench.call_tool(
            name=name, arguments=dict(arguments), cancellation_token=self._cancellation_token,
        )
        return await self._artifactize(DesktopToolResult(
            call_id, not bool(result.is_error), {"content": result.to_text()},
            None if not result.is_error else "tool_failed",
        ), name)

    async def _artifactize(self, result: DesktopToolResult, name: str) -> DesktopToolResult:
        encoded = json.dumps(dict(result.content), ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        if len(encoded) <= MAX_INLINE_TOOL_OUTPUT_CHARS or result.artifacts:
            return result
        if self._output_artifact_handler is None:
            return DesktopToolResult(
                result.call_id, False,
                {"content": "tool_output_artifact_channel_unavailable: complete tool output was not exposed"},
                "artifact_channel_unavailable",
            )
        descriptor = dict(await self._output_artifact_handler({
            "tool_name": name,
            "call_id": result.call_id,
            "mime_type": "application/json; charset=utf-8",
        }, encoded))
        artifact_id = descriptor.get("artifact_id")
        if not isinstance(artifact_id, str) or not artifact_id:
            raise RuntimeError("desktop_tool_artifact_identity_invalid")
        return DesktopToolResult(
            result.call_id, result.succeeded, result.content, result.error_code,
            (artifact_id,), (descriptor,),
        )


class AgentKernelCheckpointPort:
    """Persist the latest durable Kernel checkpoint inside Agent state."""

    def __init__(self, agent: Any) -> None:
        self._agent = agent

    async def __call__(self, payload: Mapping[str, Any]) -> None:
        reason = payload.get("reason")
        state = payload.get("state")
        if not isinstance(reason, str) or not reason:
            raise ValueError("desktop_checkpoint_reason_invalid")
        if not isinstance(state, Mapping):
            raise ValueError("desktop_checkpoint_state_invalid")
        self._agent._agent_kernel_checkpoint = {
            "reason": reason,
            "state": copy.deepcopy(dict(state)),
        }
