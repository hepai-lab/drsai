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
import hashlib
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

# Autogen / OpenDrSai imports kept lazy so this module loads quickly when the agent
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
    citation_ids: set[str] = field(default_factory=set)

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


def _artifact_type(name: str, mime: str | None) -> str:
    normalized_mime = (mime or "").lower()
    suffix = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if normalized_mime.startswith("image/") or suffix in {"png", "jpg", "jpeg", "gif", "webp", "svg"}:
        return "image"
    if suffix in {"csv", "tsv", "xlsx", "xls", "parquet"}:
        return "table"
    if suffix in {"md", "pdf", "doc", "docx", "ppt", "pptx"}:
        return "report"
    if suffix in {"patch", "diff"}:
        return "patch"
    return "file"


def _normalize_task_status(value: Any) -> str:
    normalized = str(getattr(value, "value", value) or "running").lower()
    if normalized in {"completed", "complete", "success", "succeeded", "done"}:
        return "completed"
    if normalized in {"failed", "error", "timeout", "killed"}:
        return "error"
    if normalized in {"cancelled", "canceled", "aborted"}:
        return "cancelled"
    return "running"


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


def extract_citation_payloads(metadata: Any, state: TurnState) -> list[dict[str, Any]]:
    """Normalize provider citation/annotation metadata without guessing from prose."""
    if not isinstance(metadata, dict):
        return []
    candidates: list[Any] = []
    for key in ("citations", "annotations", "sources"):
        value = metadata.get(key)
        if isinstance(value, list):
            candidates.extend(value)
    payloads: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        nested = candidate.get("url_citation") or candidate.get("citation") or candidate.get("source")
        value = {**candidate, **nested} if isinstance(nested, dict) else candidate
        url = value.get("url") or value.get("uri")
        path = value.get("path") or value.get("file_path")
        if not url and not path:
            continue
        locator = value.get("locator") or value.get("page")
        if locator is None and value.get("start_index") is not None:
            locator = f"chars {value.get('start_index')}-{value.get('end_index', '?')}"
        stable_source = "|".join(str(item or "") for item in (
            url, path, locator, value.get("title"), value.get("artifact_id"),
        ))
        citation_id = str(value.get("citation_id") or value.get("id") or hashlib.sha256(stable_source.encode("utf-8")).hexdigest()[:16])
        if citation_id in state.citation_ids:
            continue
        state.citation_ids.add(citation_id)
        payloads.append({
            "citation_id": citation_id,
            "title": str(value.get("title") or value.get("name") or url or path),
            **({"url": str(url)} if url else {}),
            **({"path": str(path)} if path else {}),
            **({"locator": str(locator)} if locator is not None else {}),
            **({"excerpt": str(value["excerpt"])} if value.get("excerpt") else {}),
            **({"artifact_id": str(value["artifact_id"])} if value.get("artifact_id") else {}),
        })
    return payloads


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
        UserInputRequestedEvent,
    )

    try:
        from drsai.modules.managers.messages.agent_messages import (
            AgentLogEvent,
            AgentLongTaskMessage,
            BackgroundTaskEvent,
            FilesEvent,
            LongTaskQueryMessage,
            ToolLongTaskEvent,
        )
    except Exception:
        AgentLogEvent = None  # type: ignore[assignment]
        AgentLongTaskMessage = None  # type: ignore[assignment]
        BackgroundTaskEvent = None  # type: ignore[assignment]
        FilesEvent = None  # type: ignore[assignment]
        LongTaskQueryMessage = None  # type: ignore[assignment]
        ToolLongTaskEvent = None  # type: ignore[assignment]

    try:
        from drsai.modules.agents.skills_agent.drsai_assistant import (
            ThoughtEvent,
            MemoryQueryEvent,
        )
    except Exception:
        ThoughtEvent = None  # type: ignore[assignment]
        MemoryQueryEvent = None  # type: ignore[assignment]

    out: list[tuple[str, dict]] = []

    if FilesEvent is not None and isinstance(message, FilesEvent):
        content = getattr(message, "content", None)
        files = getattr(content, "files", None) or []
        title = getattr(content, "title", None) or "Agent files"
        description = getattr(content, "description", None) or ""
        for index, file_info in enumerate(files):
            name = getattr(file_info, "name", None) or f"artifact-{index + 1}"
            out.append(("artifact.created", {
                "artifact_id": f"file:{name}:{index}",
                "artifact_type": _artifact_type(name, getattr(file_info, "mime_type", None)),
                "name": name,
                "title": title,
                "summary": getattr(file_info, "description", None) or description,
                "url": getattr(file_info, "url", None),
                "mime": getattr(file_info, "mime_type", None),
                "size": getattr(file_info, "size", None),
                "source": getattr(message, "source", "") or "agent",
            }))
        return out

    if ToolLongTaskEvent is not None and isinstance(message, ToolLongTaskEvent):
        out.append(("progress.update", {
            "progress_id": f"tool:{getattr(message, 'tool_name', None) or 'long-task'}",
            "summary": _safe_str(getattr(message, "content", None)),
            "phase": getattr(message, "tool_name", None) or "long-task",
            "status": _normalize_task_status(getattr(message, "task_status", None)),
            "source": getattr(message, "source", "") or "agent",
        }))
        return out

    if BackgroundTaskEvent is not None and isinstance(message, BackgroundTaskEvent):
        status = str(getattr(message, "status", "running") or "running")
        event_type = "tool.complete" if status in {"completed", "timeout", "killed", "failed"} else "tool.progress"
        out.append((event_type, {
            "tool_id": getattr(message, "task_id", "") or "background-task",
            "name": "background_command",
            "args": {"command": getattr(message, "command", "")},
            "result": _safe_str(getattr(message, "content", None)),
            "status": "failed" if status in {"timeout", "killed", "failed"} else status,
            "source": getattr(message, "source", "") or "agent",
        }))
        return out

    if AgentLongTaskMessage is not None and isinstance(message, AgentLongTaskMessage):
        out.append(("progress.update", {
            "progress_id": f"agent:{getattr(message, 'tool_name', None) or 'long-task'}",
            "summary": _safe_str(getattr(message, "content", None)),
            "phase": getattr(message, "tool_name", None) or "long-task",
            "status": _normalize_task_status(getattr(message, "task_status", None)),
            "source": getattr(message, "source", "") or "agent",
        }))
        return out

    if LongTaskQueryMessage is not None and isinstance(message, LongTaskQueryMessage):
        out.append(("interaction.request", {
            "request_id": f"query:{int(time.time() * 1000)}",
            "interaction_type": "text_input",
            "prompt": _safe_str(getattr(message, "content", None)),
            "source": getattr(message, "source", "") or "agent",
        }))
        return out

    if isinstance(message, UserInputRequestedEvent):
        out.append(("interaction.request", {
            "request_id": getattr(message, "request_id", "") or f"input:{int(time.time() * 1000)}",
            "interaction_type": "text_input",
            "prompt": _safe_str(getattr(message, "content", None)) or "Input required",
            "source": getattr(message, "source", "") or "agent",
        }))
        return out

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

        out.extend(("citation.added", payload) for payload in extract_citation_payloads(metadata, state))

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
            out.extend(("citation.added", payload) for payload in extract_citation_payloads(metadata, state))
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
