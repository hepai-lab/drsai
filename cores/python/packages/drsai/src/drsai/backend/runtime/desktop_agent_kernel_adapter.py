"""Bind a production-style Desktop Agent host to the shared Kernel stream."""

from __future__ import annotations

import asyncio
import json
import base64
from dataclasses import dataclass
import hashlib
from typing import Any, AsyncIterator, Callable, Mapping, Sequence
import uuid

from autogen_agentchat.base import TaskResult
from autogen_agentchat.messages import BaseAgentEvent, BaseChatMessage, TextMessage
from autogen_core import CancellationToken, Image

from .desktop_autogen_ports import (
    AgentKernelCheckpointPort,
    AutogenDesktopModelPort,
    AutogenDesktopToolPort,
    autogen_messages_to_kernel_history,
    autogen_tools_to_kernel_schemas,
)
from .desktop_kernel_coordinator import (
    DesktopApprovalResult,
    DesktopKernelCoordinator,
    DesktopToolResult,
)
from .desktop_kernel_run_stream import DesktopKernelRunStream, build_desktop_start_envelope
from .desktop_manager_ports import DesktopAgentManagerPorts
from .web_search.bing_playwright import WebSearchRuntimeError, search_bing_with_playwright


@dataclass(frozen=True)
class DesktopKernelTask:
    input_text: str
    messages: tuple[BaseChatMessage, ...]
    images: tuple[Image, ...]
    artifacts: Mapping[str, Mapping[str, Any]]


def normalize_desktop_kernel_task(task: Any) -> DesktopKernelTask:
    if task is None:
        messages = []
    elif isinstance(task, str):
        messages: list[BaseChatMessage] = [TextMessage(content=task, source="user", metadata={"internal": "yes"})]
    elif isinstance(task, BaseChatMessage):
        messages = [task]
    elif isinstance(task, Sequence) and not isinstance(task, (str, bytes)):
        if not task or not all(isinstance(value, BaseChatMessage) for value in task):
            raise ValueError("desktop_kernel_task_messages_invalid")
        messages = list(task)
    else:
        raise ValueError("desktop_kernel_task_required")
    text_parts: list[str] = []
    images: list[Image] = []
    artifacts: dict[str, Mapping[str, Any]] = {}
    for message in messages:
        content = message.content
        values = content if isinstance(content, list) else [content]
        for value in values:
            if isinstance(value, str) and value.strip():
                text_parts.append(value)
            elif isinstance(value, Image):
                encoded = value.to_base64()
                raw = base64.b64decode(encoded)
                sha = hashlib.sha256(raw).hexdigest()
                artifact_id = f"input-image-{sha[:24]}"
                artifacts[artifact_id] = {
                    "artifact_id": artifact_id, "operation": "describe", "mime_type": "image/png",
                    "size": len(raw), "sha256": sha,
                }
                images.append(value)
            else:
                raise ValueError(f"desktop_kernel_multimodal_part_invalid:{type(value).__name__}")
    return DesktopKernelTask(
        input_text=("\n\n".join(text_parts).strip() or (
            "[Continue the previous task.]" if task is None else "[User supplied multimodal content]"
        )),
        messages=tuple(messages), images=tuple(images), artifacts=artifacts,
    )


async def _desktop_input_artifact(
    artifacts: Mapping[str, Mapping[str, Any]], payload: Mapping[str, Any],
) -> Mapping[str, Any]:
    artifact_id = payload.get("artifact_id")
    operation = payload.get("operation")
    if not isinstance(artifact_id, str) or artifact_id not in artifacts:
        raise ValueError("desktop_input_artifact_unknown")
    if operation != "describe":
        raise ValueError("desktop_input_artifact_operation_denied")
    descriptor = dict(artifacts[artifact_id])
    descriptor["operation"] = operation
    return descriptor


def _desktop_default_subagent_profile(agent: Any) -> str:
    thread_state = getattr(agent, "_thread_state", None)
    default_name = thread_state.get("default_subagent") if isinstance(thread_state, Mapping) else None
    profile_manager = getattr(agent, "_user_profile_manager", None)
    if not default_name and profile_manager is not None and hasattr(profile_manager, "get_default_subagent"):
        default_name = profile_manager.get_default_subagent(str(getattr(agent, "_thread_id", "")))
    subagents = getattr(agent, "_user_sub_agents", {})
    if not isinstance(default_name, str) or not isinstance(subagents, Mapping) or default_name not in subagents:
        return ""
    config = subagents.get(default_name)
    description = config.get("description", "") if isinstance(config, Mapping) else ""
    return (
        f"This session has the default subagent {default_name!r}. "
        f"Delegate the complete user task to that subagent before answering. {description}"
    ).strip()


def _desktop_memory_candidates(agent: Any) -> list[dict[str, str]]:
    store = getattr(agent, "_curated_memory", None)
    entries = getattr(store, "memory_entries", ())
    if not isinstance(entries, Sequence) or isinstance(entries, (str, bytes)):
        return []
    candidates: list[dict[str, str]] = []
    for content in entries[-100:]:
        if not isinstance(content, str) or not content.strip():
            continue
        normalized = content.strip()
        sha = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        candidates.append({"id": f"memory-{sha[:24]}", "content": normalized})
    return candidates


async def run_agent_through_kernel(
    agent: Any,
    *,
    task: Any,
    cancellation_token: CancellationToken,
    policy_resolver: Callable[[str, str], Mapping[str, Any]],
    model_retryable: Callable[[BaseException], bool] | None = None,
) -> AsyncIterator[BaseAgentEvent | BaseChatMessage | TaskResult]:
    """Pilot the real Agent Host through Kernel-owned Model/Tool decisions.

    This path intentionally rejects unsupported manager tools before switching
    the production default; it is used to finish and prove each Host adapter.
    """

    normalized_task = normalize_desktop_kernel_task(task)
    prefix_messages: list[BaseAgentEvent | BaseChatMessage] = list(normalized_task.messages)
    for user_message in normalized_task.messages:
        yield user_message
    if bool(getattr(agent, "is_paused", False)):
        paused = TextMessage(
            content=f"The {getattr(agent, 'name', 'OpenDrSai')} is paused.",
            source=str(getattr(agent, "name", "OpenDrSai")), metadata={"internal": "yes"},
        )
        yield paused
        yield TaskResult(messages=[*normalized_task.messages, paused], stop_reason="agent_paused")
        return
    clear_elevated = getattr(agent, "_clear_elevated_tools", None)
    if callable(clear_elevated):
        clear_elevated()
    initialize_memory = getattr(agent, "_init_memory_documents", None)
    if callable(initialize_memory):
        await initialize_memory()
    task_manager = getattr(agent, "_task_manager", None)
    if task_manager is not None and hasattr(task_manager, "get_pending_notifications"):
        notifications = await task_manager.get_pending_notifications(str(getattr(agent, "_user_id", "")))
        if notifications and hasattr(agent, "_emit_notification") and hasattr(agent, "_format_task_notifications"):
            message = await agent._emit_notification(agent._format_task_notifications(notifications))
            prefix_messages.append(message)
            yield message
    startup = getattr(agent, "_run_startup_checks", None)
    if callable(startup) and not bool(getattr(agent, "_skip_startup_checks", False)):
        for warning in await startup():
            if hasattr(agent, "_emit_notification"):
                message = await agent._emit_notification(warning)
            else:
                message = TextMessage(
                    content=str(warning), source=str(getattr(agent, "name", "OpenDrSai")),
                    metadata={"internal": "no"},
                )
            prefix_messages.append(message)
            yield message
    kernel = getattr(agent, "_shared_agent_kernel", None)
    if kernel is None:
        raise RuntimeError("desktop_shared_agent_kernel_missing")
    workbench_tools = list(await agent._workbench.list_tools())
    handoff_tools = list(getattr(agent, "_handoff_tools", ()))
    manager_tools = list(getattr(agent, "_update_user_config_tools", ())) + list(
        getattr(agent, "_agent_skills_tools", ())
    ) + list(getattr(agent, "_subagent_tools", ())) + list(getattr(agent, "_todo_tools", ())) + list(
        getattr(agent, "_scheduled_task_tools", ())
    )
    all_tools = [*workbench_tools, *handoff_tools, *manager_tools]
    metadata: dict[str, Mapping[str, Any]] = {}
    normal_names = set()
    for tool in workbench_tools:
        name = str(getattr(tool, "schema", tool)["name"])
        normal_names.add(name)
        metadata[name] = policy_resolver(name, f"workbench:{name}")
    for tool in handoff_tools:
        name = str(getattr(tool, "schema", tool)["name"])
        normal_names.add(name)
        metadata[name] = policy_resolver(name, f"handoff:{name}")
    unsupported_manager_names = set()
    for tool in manager_tools:
        name = str(getattr(tool, "schema", tool)["name"])
        unsupported_manager_names.add(name)
        metadata[name] = policy_resolver(name, f"manager:{name}")
    schemas = autogen_tools_to_kernel_schemas(all_tools, metadata)

    special = DesktopAgentManagerPorts(agent, cancellation_token).ports(unsupported_manager_names)
    if "web_search" in normal_names:
        async def desktop_web_search(payload: Mapping[str, Any]) -> DesktopToolResult:
            call_id = str(payload["call_id"])
            arguments = payload.get("arguments")
            if not isinstance(arguments, Mapping):
                raise ValueError("desktop_web_search_arguments_invalid")
            task = asyncio.create_task(search_bing_with_playwright(
                str(arguments.get("query") or ""),
                int(arguments.get("max_results", 8)),
            ))
            loop = asyncio.get_running_loop()
            cancellation_token.add_callback(lambda: loop.call_soon_threadsafe(task.cancel))
            try:
                response = await task
            except WebSearchRuntimeError as exc:
                return DesktopToolResult(
                    call_id, False, {"content": str(exc)}, exc.code,
                )
            content = response.public_dict()
            return DesktopToolResult(call_id, True, content, inspection=response.inspection_dict())

        special["web_search"] = desktop_web_search
    approval_handler = getattr(agent, "_tool_approval_handler", None)

    async def approval(payload: Mapping[str, Any]) -> DesktopApprovalResult:
        if approval_handler is None:
            decision = "rejected"
        else:
            decision = "approved" if await approval_handler(dict(payload), dict(payload.get("arguments") or {})) else "rejected"
        return DesktopApprovalResult(str(payload["approval_id"]), str(payload["call_id"]), decision)

    checkpoint = AgentKernelCheckpointPort(agent)
    model = AutogenDesktopModelPort(
        agent._model_client, all_tools,
        assistant_name=str(getattr(agent, "name", "OpenDrSai")),
        cancellation_token=cancellation_token,
        max_retries=int(getattr(agent, "_llm_max_retries", 0)),
        retryable=model_retryable,
        retry_base_delay=float(getattr(agent, "_llm_retry_base_delay", 0.0)),
        input_images=normalized_task.images,
    )
    tool = AutogenDesktopToolPort(
        agent._workbench, handoff_tools,
        special_tools=special,
        output_artifact_handler=getattr(agent, "_tool_output_artifact_handler", None),
        cancellation_token=cancellation_token,
    )
    coordinator = DesktopKernelCoordinator(
        kernel, model=model, tool=tool, checkpoint=checkpoint,
        approval=approval,
        artifact=(lambda payload: _desktop_input_artifact(normalized_task.artifacts, payload)) if normalized_task.artifacts else None,
    )

    persisted = getattr(agent, "_agent_kernel_checkpoint", None)
    history = []
    if isinstance(persisted, Mapping) and isinstance(persisted.get("state"), Mapping):
        raw_messages = persisted["state"].get("messages", [])
        if isinstance(raw_messages, list):
            for value in raw_messages:
                if not isinstance(value, Mapping) or value.get("role") == "system":
                    continue
                content = value.get("content", "")
                history.append({
                    **dict(value),
                    "content": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, sort_keys=True),
                })
    elif getattr(agent, "_model_context", None) is not None:
        history = autogen_messages_to_kernel_history(await agent._model_context.get_messages())

    model_args = getattr(agent._model_client, "_create_args", {})
    model_id = str(model_args.get("model") or getattr(agent, "_defult_config_name", None) or "desktop-model")
    system_messages = getattr(agent, "_system_messages", ())
    system_prompt = str(system_messages[0].content) if system_messages else "You are OpenDrSai."
    memory_store = getattr(agent, "_curated_memory", None)
    memory_block = memory_store.system_prompt_block() if memory_store is not None and hasattr(memory_store, "system_prompt_block") else ""
    if memory_block:
        system_prompt = system_prompt.replace(memory_block, "").strip()
    kernel_host_port = getattr(agent, "_kernel_host_port", None)
    if not isinstance(kernel_host_port, Mapping):
        raise RuntimeError("desktop_kernel_host_port_missing")
    host_capabilities = kernel_host_port.get("capabilities")
    if not isinstance(host_capabilities, Sequence) or isinstance(host_capabilities, (str, bytes)):
        raise RuntimeError("desktop_kernel_host_capabilities_missing")
    run_id = f"desktop-{uuid.uuid4()}"
    start = build_desktop_start_envelope(
        run_id=run_id,
        session_id=str(getattr(agent, "_thread_id", "desktop-session")),
        input_text=normalized_task.input_text,
        model_id=model_id,
        tools=schemas,
        host_port=kernel_host_port,
        artifacts=list(normalized_task.artifacts),
        history=history,
        context_budget=getattr(agent, "_p9_context_budget", None),
        memory_candidates=_desktop_memory_candidates(agent),
        agent={
            "schema_version": 1,
            "prompt_version": "p9-agent-kernel-v1",
            "system_prompt": system_prompt,
            "tool_policy": "Use tools when required for correctness; never invent Tool results.",
            "agent_profile": _desktop_default_subagent_profile(agent),
        },
    )
    async for event in DesktopKernelRunStream(
        coordinator, assistant_name=str(getattr(agent, "name", "OpenDrSai")),
    ).execute(start):
        if isinstance(event, TaskResult):
            yield TaskResult(messages=[*prefix_messages, *event.messages], stop_reason=event.stop_reason)
        else:
            yield event
