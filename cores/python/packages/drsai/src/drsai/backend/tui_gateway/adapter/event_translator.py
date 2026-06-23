"""Translate autogen events from ``DrSaiAssistant.run_stream`` to gateway events.

Each translation produces zero or more ``(event_type, payload)`` tuples that
the prompt handler emits via :func:`server._emit`. The translator is **pure**
(no I/O, no global state apart from a per-turn :class:`TurnState`) so it's
trivially testable.

Event mapping (matches design doc Section "关键事件翻译表"):

| autogen                              | gateway              | notes |
|--------------------------------------|----------------------|-------|
| ModelClientStreamingChunkEvent       | message.delta        | source.startswith("sub:") → subagent.thinking |
| TextMessage (assistant)              | message.complete or skip if streamed | metadata.internal="yes" skips |
| TextMessage (user)                   | (skipped)            | UI already showed the prompt |
| ToolCallRequestEvent                 | tool.start (per call) | args parsed from JSON-string |
| ToolCallExecutionEvent               | tool.complete (per call) |   |
| ToolCallSummaryMessage               | tool.complete (fallback) | DrSaiAgent path |
| Response                             | message.complete + usage |   |
| TaskResult                           | (turn boundary)      | swept for usage |
| AgentLogEvent                        | status.update kind=log |   |
| ThoughtEvent                         | thinking.delta       |   |
| MemoryQueryEvent                     | status.update kind=memory |   |
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

# Autogen / DrSai imports kept lazy so this module loads quickly when the agent
# backend isn't yet imported (helps Phase 0 server start-up).


@dataclass
class TurnState:
    """Per-turn book-keeping for event translation.

    Tracks whether we've already streamed visible text in this turn (used to
    skip the duplicate final ``TextMessage``), tool start times, and prompt/
    completion token usage gathered across multiple message types.
    """

    streamed_visible: bool = False
    streamed_sources: set[str] = field(default_factory=set)
    pending_tool_calls: dict[str, tuple[str, dict, float]] = field(default_factory=dict)  # tool_id → (name, args, start_ts)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    last_model: str = ""
    last_reasoning: str = ""

    def usage_payload(self, status: str = "complete") -> dict:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens,
            "model": self.last_model,
            "status": status,
        }


def _safe_str(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, (str, int, float, bool)):
        return str(val)
    try:
        return json.dumps(val, ensure_ascii=False, default=str)
    except Exception:
        return str(val)


def _parse_tool_args(raw: Any) -> dict:
    """Tools receive ``arguments`` either as a JSON string or a dict."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {"_raw": parsed}
        except (json.JSONDecodeError, ValueError):
            return {"_raw": raw}
    if isinstance(raw, dict):
        return raw
    return {}


def _capture_usage(message: Any, state: TurnState) -> None:
    """Best-effort harvest of prompt/completion tokens from any message type."""
    models_usage = getattr(message, "models_usage", None)
    if models_usage:
        prompt = getattr(models_usage, "prompt_tokens", 0) or 0
        completion = getattr(models_usage, "completion_tokens", 0) or 0
        if prompt:
            state.prompt_tokens = prompt
        if completion:
            state.completion_tokens = completion

    # Some message types expose tokens directly.
    for attr in ("prompt_tokens", "completion_tokens"):
        val = getattr(message, attr, None)
        if isinstance(val, int) and val > 0:
            if attr == "prompt_tokens":
                state.prompt_tokens = val
            else:
                state.completion_tokens = val

    model = getattr(message, "model", None) or getattr(message, "model_name", None)
    if isinstance(model, str) and model:
        state.last_model = model


def _is_subagent_source(source: str | None) -> bool:
    return bool(source) and source.startswith("sub:")


# ── Main translation entry ───────────────────────────────────────────


def translate(message: Any, state: TurnState) -> list[tuple[str, dict]]:
    """Translate one autogen event into zero or more gateway events.

    Returns ``[(event_type, payload), ...]``. Empty list means "skip this".

    Caller (prompt handler) is responsible for emitting via ``_emit``.
    """
    # Lazy imports — avoid heavy autogen/drsai import cost at module load.
    from autogen_agentchat.base import Response, TaskResult
    from autogen_agentchat.messages import (
        BaseAgentEvent,
        FunctionCall,
        ModelClientStreamingChunkEvent,
        TextMessage,
        ToolCallExecutionEvent,
        ToolCallRequestEvent,
        ToolCallSummaryMessage,
    )

    try:
        from drsai.modules.managers.messages.agent_messages import AgentLogEvent
    except Exception:
        AgentLogEvent = None  # type: ignore[assignment]

    try:
        from drsai.modules.agents.skills_agent.drsai_assistant import (
            ThoughtEvent,
            MemoryQueryEvent,
        )
    except Exception:
        ThoughtEvent = None  # type: ignore[assignment]
        MemoryQueryEvent = None  # type: ignore[assignment]

    out: list[tuple[str, dict]] = []

    # ── Streaming visible chunk ──────────────────────────────────────
    if isinstance(message, ModelClientStreamingChunkEvent):
        content = message.content or ""
        if not content:
            return out
        source = getattr(message, "source", "") or ""
        if source:
            state.streamed_sources.add(source)
        if _is_subagent_source(source):
            out.append(("subagent.thinking", {"text": content, "source": source}))
            return out
        state.streamed_visible = True
        out.append(("message.delta", {"text": content}))
        return out

    # ── Thought / extended thinking ──────────────────────────────────
    if ThoughtEvent is not None and isinstance(message, ThoughtEvent):
        text = getattr(message, "content", "") or ""
        source = getattr(message, "source", "") or ""
        if not text:
            return out
        if text.strip():
            state.last_reasoning = text
        if _is_subagent_source(source):
            out.append(("subagent.thinking", {"text": text, "source": source}))
        else:
            out.append(("thinking.delta", {"text": text}))
        return out

    # ── Memory query event ───────────────────────────────────────────
    if MemoryQueryEvent is not None and isinstance(message, MemoryQueryEvent):
        out.append(("status.update", {
            "kind": "memory",
            "text": _safe_str(getattr(message, "content", None)),
        }))
        return out

    # ── Tool call request ────────────────────────────────────────────
    if isinstance(message, ToolCallRequestEvent):
        msg_source = getattr(message, "source", "") or ""
        is_sub = _is_subagent_source(msg_source)
        calls = message.content or []
        for call in calls:
            if not isinstance(call, FunctionCall):
                continue
            tool_id = getattr(call, "id", None) or f"tool-{int(time.time() * 1000)}"
            name = getattr(call, "name", "?")
            args = _parse_tool_args(getattr(call, "arguments", {}))
            state.pending_tool_calls[tool_id] = (name, args, time.time())
            payload: dict = {
                "tool_id": tool_id,
                "name": name,
                "args": args,
            }
            if is_sub:
                payload["source"] = msg_source
                payload["name"] = f"[{msg_source.replace('sub:', '')}] {name}"
            out.append(("tool.start", payload))
        return out

    # ── Tool call result ─────────────────────────────────────────────
    if isinstance(message, ToolCallExecutionEvent):
        msg_source = getattr(message, "source", "") or ""
        is_sub = _is_subagent_source(msg_source)
        results = message.content or []
        for r in results:
            tool_id = getattr(r, "call_id", None) or getattr(r, "id", None) or ""
            name = getattr(r, "name", "") or ""
            content = getattr(r, "content", None)
            result_str = _safe_str(content)
            duration_ms = 0
            args: dict = {}
            if tool_id and tool_id in state.pending_tool_calls:
                pname, pargs, started = state.pending_tool_calls.pop(tool_id)
                if not name:
                    name = pname
                args = pargs
                duration_ms = int((time.time() - started) * 1000)
            payload = {
                "tool_id": tool_id,
                "name": name,
                "args": args,
                "result": result_str,
                "duration_ms": duration_ms,
            }
            if is_sub:
                payload["source"] = msg_source
                payload["name"] = f"[{msg_source.replace('sub:', '')}] {name}"
            out.append(("tool.complete", payload))
        return out

    # ── Tool call summary (DrSaiAgent path) ──────────────────────────
    if isinstance(message, ToolCallSummaryMessage):
        msg_source = getattr(message, "source", "") or ""
        is_sub = _is_subagent_source(msg_source)
        # Drain any pending tool calls without explicit ExecutionEvent.
        content = getattr(message, "content", None)
        result_str = _safe_str(content)
        if state.pending_tool_calls:
            for tool_id, (name, args, started) in list(state.pending_tool_calls.items()):
                duration_ms = int((time.time() - started) * 1000)
                payload = {
                    "tool_id": tool_id,
                    "name": name,
                    "args": args,
                    "result": result_str,
                    "duration_ms": duration_ms,
                }
                if is_sub:
                    payload["source"] = msg_source
                    payload["name"] = f"[{msg_source.replace('sub:', '')}] {name}"
                out.append(("tool.complete", payload))
                state.pending_tool_calls.pop(tool_id, None)
        else:
            name = getattr(message, "source", "") or "tool"
            payload = {
                "tool_id": "",
                "name": name,
                "args": {},
                "result": result_str,
                "duration_ms": 0,
            }
            if is_sub:
                payload["source"] = msg_source
                payload["name"] = f"[{msg_source.replace('sub:', '')}] {name}"
            out.append(("tool.complete", payload))
        return out

    # ── TextMessage ──────────────────────────────────────────────────
    if isinstance(message, TextMessage):
        _capture_usage(message, state)
        source = getattr(message, "source", "") or ""
        metadata = getattr(message, "metadata", None) or {}

        # Skip user echo (UI already displayed it).
        if source.lower() == "user":
            return out

        # Skip internal markers (system notifications routed elsewhere).
        if metadata.get("internal") == "yes":
            return out

        # Skip if we've already streamed this turn's visible content — the
        # final TextMessage is just a duplicate from the assistant.
        if state.streamed_visible and (
            not state.streamed_sources or source in state.streamed_sources
        ):
            return out

        # Subagent final text
        text = getattr(message, "content", "") or ""
        if _is_subagent_source(source):
            out.append(("subagent.complete", {"text": text, "source": source}))
            return out

        if not text:
            return out

        # Otherwise treat as a delayed message.complete-ish chunk.
        out.append(("message.delta", {"text": text}))
        state.streamed_visible = True
        return out

    # ── Response (final assistant reply with usage) ──────────────────
    if isinstance(message, Response):
        _capture_usage(message, state)
        chat = getattr(message, "chat_message", None)
        if chat is not None:
            _capture_usage(chat, state)
            chat_src = getattr(chat, "source", "") or ""
            metadata = getattr(chat, "metadata", None) or {}
            if (
                chat_src.lower() != "user"
                and metadata.get("internal") != "yes"
                and not _is_subagent_source(chat_src)
            ):
                text = getattr(chat, "content", "") or ""
                if text and not state.streamed_visible:
                    out.append(("message.delta", {"text": text}))
                    state.streamed_visible = True
        return out

    # ── TaskResult (end-of-turn) ─────────────────────────────────────
    if isinstance(message, TaskResult):
        for m in getattr(message, "messages", []) or []:
            _capture_usage(m, state)
        return out  # Caller emits ``message.complete`` after the stream finishes.

    # ── AgentLogEvent ────────────────────────────────────────────────
    if AgentLogEvent is not None and isinstance(message, AgentLogEvent):
        content = getattr(message, "content", None) or getattr(message, "message", None)
        log_text = _safe_str(content)
        # Truncate long log texts (e.g. FunctionCall with big arguments)
        # to avoid flooding the TUI status bar.  Max ~3 terminal lines ≈ 300 chars.
        MAX_LOG_CHARS = 300
        if len(log_text) > MAX_LOG_CHARS:
            log_text = log_text[:MAX_LOG_CHARS - 1] + "…"
        out.append(("status.update", {
            "kind": "log",
            "text": log_text,
        }))
        return out

    # ── Unknown BaseAgentEvent — silently pass through ──────────────
    if isinstance(message, BaseAgentEvent):
        return out

    return out


def finalize(state: TurnState, status: str = "complete") -> tuple[str, dict]:
    """Build the terminal ``message.complete`` event for a turn.

    Always emitted by the prompt handler after ``run_stream`` finishes (success
    or interrupted).  ``text`` is empty because we already streamed via deltas.
    """
    payload = {
        "text": "",
        "usage": state.usage_payload(status),
        "status": status,
    }
    if state.last_reasoning:
        payload["reasoning"] = state.last_reasoning
    return ("message.complete", payload)
