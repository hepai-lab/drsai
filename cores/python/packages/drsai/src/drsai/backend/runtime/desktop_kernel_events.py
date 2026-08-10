"""Translate shared Kernel events to the existing Desktop/TUI Autogen stream."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any

from autogen_core import FunctionCall
from autogen_core.models import FunctionExecutionResult
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ThoughtEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
)

from drsai.modules.managers.messages.agent_messages import AgentLogEvent

from .mobile_core import MessageType, RuntimeEnvelope


@dataclass(slots=True)
class DesktopKernelTurnState:
    assistant_name: str
    text_parts: list[str] = field(default_factory=list)
    terminal_kind: str | None = None
    terminal_payload: dict[str, Any] = field(default_factory=dict)

    @property
    def final_text(self) -> str:
        return "".join(self.text_parts)


def translate_kernel_event(
    envelope: RuntimeEnvelope,
    state: DesktopKernelTurnState,
) -> tuple[BaseAgentEvent | BaseChatMessage, ...]:
    if envelope.message_type is not MessageType.RUNTIME_EVENT:
        raise ValueError("desktop_kernel_runtime_event_required")
    payload = dict(envelope.payload)
    kind = payload.get("kind")
    if kind == "message.delta":
        text = str(payload.get("text") or "")
        state.text_parts.append(text)
        return (ModelClientStreamingChunkEvent(content=text, source=state.assistant_name),)
    if kind == "message.completed":
        text = str(payload.get("text") or "")
        if text and text != state.final_text:
            state.text_parts[:] = [text]
        return (TextMessage(content=text, source=state.assistant_name, metadata={"internal": "no"}),)
    if kind in {"reasoning.delta", "reasoning.completed"}:
        text = str(payload.get("text") or "")
        if kind == "reasoning.completed" and not text:
            segments = payload.get("segments")
            if isinstance(segments, list):
                text = "\n".join(str(value.get("text") or "") for value in segments if isinstance(value, dict))
        return () if not text else (ThoughtEvent(content=text, source=state.assistant_name),)
    if kind == "tool.started":
        call_id = str(payload.get("call_id") or "")
        name = str(payload.get("name") or "")
        arguments = payload.get("arguments") if isinstance(payload.get("arguments"), dict) else {}
        return (ToolCallRequestEvent(content=[FunctionCall(
            id=call_id,
            name=name,
            arguments=json.dumps(arguments, ensure_ascii=False, separators=(",", ":")),
        )], source=state.assistant_name),)
    if kind in {"tool.result", "tool.error"}:
        result = payload.get("result")
        public_result = (
            {"result": result, "_inspection": payload["inspection"]}
            if isinstance(payload.get("inspection"), dict)
            else result
        )
        return (ToolCallExecutionEvent(content=[FunctionExecutionResult(
            content=json.dumps(public_result, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            name=str(payload.get("name") or "tool"),
            call_id=str(payload.get("call_id") or ""),
            is_error=kind == "tool.error",
        )], source=state.assistant_name),)
    if kind in {"run.completed", "run.cancelled", "run.failed"}:
        state.terminal_kind = kind
        state.terminal_payload = payload
        return ()
    if kind in {
        "run.started", "tool.decision", "verification.required", "verification.unavailable",
        "approval.requested", "approval.decided", "runtime.degraded", "runtime.lifecycle_changed",
    }:
        level = "warning" if kind in {
            "verification.required", "verification.unavailable", "runtime.degraded",
        } else "info"
        return (AgentLogEvent(
            source=state.assistant_name,
            title=kind,
            content=json.dumps({key: value for key, value in payload.items() if key != "kind"}, ensure_ascii=False, sort_keys=True),
            content_type="runtime",
            metadata={"kernel_event": kind, "level": level},
        ),)
    # OAEP extensions not yet rendered by the legacy UI remain observable as
    # structured logs instead of being silently discarded.
    return (AgentLogEvent(
        source=state.assistant_name,
        title=str(kind or "runtime.event"),
        content=json.dumps({key: value for key, value in payload.items() if key != "kind"}, ensure_ascii=False, sort_keys=True),
        content_type="runtime",
        metadata={"kernel_event": str(kind or "unknown")},
    ),)
