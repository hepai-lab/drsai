"""Decode stable Codex app-server notifications into typed adapter events."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any, Mapping

from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
    NormalizedReasoningKind,
    NormalizedReasoningSource,
    NormalizedReasoningVisibility,
    NormalizedTerminalStatus,
)
from drsai.backend.codex_adapter.stable_contract import NotificationClass, classify_notification
from drsai.backend.codex_adapter.history_migration import decode_legacy_message_parts


_SECRET = re.compile(r"(?:token|secret|password|cookie|authorization|api.?key|credential)", re.I)
_ITEM_TYPES = {
    "userMessage": NormalizedItemType.MESSAGE,
    "hookPrompt": NormalizedItemType.INTERACTION,
    "agentMessage": NormalizedItemType.MESSAGE,
    "reasoning": NormalizedItemType.REASONING,
    "plan": NormalizedItemType.PLAN,
    "commandExecution": NormalizedItemType.COMMAND_EXECUTION,
    "fileChange": NormalizedItemType.FILE_CHANGE,
    "mcpToolCall": NormalizedItemType.TOOL_CALL,
    "dynamicToolCall": NormalizedItemType.TOOL_CALL,
    "webSearch": NormalizedItemType.TOOL_CALL,
    "imageView": NormalizedItemType.TOOL_CALL,
    "sleep": NormalizedItemType.TOOL_CALL,
    "collabToolCall": NormalizedItemType.SUBTASK,
    "collabAgentToolCall": NormalizedItemType.SUBTASK,
    "subAgentActivity": NormalizedItemType.SUBTASK,
    "imageGeneration": NormalizedItemType.ARTIFACT,
    "enteredReviewMode": NormalizedItemType.NOTICE,
    "exitedReviewMode": NormalizedItemType.NOTICE,
    "contextCompaction": NormalizedItemType.NOTICE,
    "error": NormalizedItemType.NOTICE,
}


class CodexNativeEventDecoder:
    """Stateful only for deterministic per-stream delta ordinals."""

    backend_id = "codex"

    def __init__(self, *, max_field_chars: int = 8000, history_mode: bool = False) -> None:
        self.max_field_chars = max(256, max_field_chars)
        self.history_mode = history_mode
        self._ordinals: dict[tuple[str, str, str], int] = defaultdict(int)
        self._message_phases: dict[tuple[str, str], str] = {}

    def decode(self, message: Mapping[str, Any]) -> NormalizedAgentEvent | None:
        method = str(message.get("method") or "")
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        thread_id, turn_id, item_id = self.identities(params)
        if not item_id and turn_id:
            item_id = {
                "item/agentMessage/delta": f"agent-message:{turn_id}",
                "item/plan/delta": f"plan:{turn_id}",
                "item/reasoning/summaryPartAdded": f"reasoning:{turn_id}",
                "item/reasoning/summaryTextDelta": f"reasoning:{turn_id}",
                "item/reasoning/textDelta": f"reasoning:{turn_id}",
                "item/commandExecution/outputDelta": f"command:{turn_id}",
                "item/commandExecution/terminalInteraction": f"command:{turn_id}",
                "item/fileChange/patchUpdated": f"file-change:{turn_id}",
                "item/mcpToolCall/progress": f"mcp-tool:{turn_id}",
                "turn/diff/updated": f"turn-diff:{turn_id}",
            }.get(method, "")
        binding = BackendBinding(thread_id, turn_id or None, item_id or None)
        classification = classify_notification(method)
        if classification in {
            NotificationClass.KNOWN_IGNORED,
            NotificationClass.SERVER_REQUEST,
            NotificationClass.DIAGNOSTIC,
            NotificationClass.UNKNOWN,
        }:
            return None
        if classification is NotificationClass.USER_NOTICE:
            safe_params = self.safe(params)
            digest = self._digest(safe_params)
            message = str(safe_params.get("message") or safe_params.get("reason") or self._notice_message(method))
            details = self._notice_details(method, safe_params)
            return self._event(
                NormalizedEventKind.ITEM_COMPLETED,
                BackendBinding(
                    thread_id,
                    turn_id or f"notice:{thread_id}",
                    item_id or f"notice:{method}:{digest}",
                ),
                method,
                item_type=NormalizedItemType.NOTICE,
                payload={
                    "code": self._notice_code(method),
                    "level": "info" if method in {"model/verification", "thread/compacted"} else "warning",
                    "message": message[:1000],
                    "details": details,
                },
            )
        if classification is NotificationClass.FATAL:
            safe_params = self.safe(params)
            if turn_id:
                return self._event(
                    NormalizedEventKind.RUN_FAILED, BackendBinding(thread_id, turn_id), method,
                    terminal_status=NormalizedTerminalStatus.FAILED,
                    payload={"code": "codex_app_server_fatal", "digest": self._digest(safe_params)},
                )
            return None

        if method == "turn/started":
            # A replayed turn begins the same deterministic ordinal space as
            # the original stream.  This keeps dedupe keys stable across
            # reconnect/replay while still distinguishing equal adjacent
            # chunks inside one delivery.
            for key in [key for key in self._ordinals if key[0] == turn_id]:
                del self._ordinals[key]
            for key in [key for key in self._message_phases if key[0] == turn_id]:
                del self._message_phases[key]
            return self._event(NormalizedEventKind.RUN_STARTED, binding, method)
        if method == "turn/completed":
            turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else params
            status = str(turn.get("status") or "failed")
            kind, terminal = {
                "completed": (NormalizedEventKind.RUN_COMPLETED, NormalizedTerminalStatus.COMPLETED),
                "interrupted": (NormalizedEventKind.RUN_CANCELLED, NormalizedTerminalStatus.CANCELLED),
                "failed": (NormalizedEventKind.RUN_FAILED, NormalizedTerminalStatus.FAILED),
            }.get(status, (NormalizedEventKind.RUN_FAILED, NormalizedTerminalStatus.FAILED))
            event = self._event(kind, binding, method, terminal_status=terminal, payload=self.safe(turn))
            self._clear_turn_state(turn_id)
            return event
        if method in {"thread/started", "thread/archived", "thread/unarchived", "thread/deleted", "thread/closed"}:
            kind = {
                "thread/started": NormalizedEventKind.SESSION_CREATED,
                "thread/archived": NormalizedEventKind.SESSION_ARCHIVED,
                "thread/unarchived": NormalizedEventKind.SESSION_UNARCHIVED,
                "thread/deleted": NormalizedEventKind.SESSION_DELETED,
                "thread/closed": NormalizedEventKind.SESSION_UPDATED,
            }[method]
            payload = self.safe(params)
            if method == "thread/closed":
                payload = {**payload, "status": "closed"}
            return self._event(kind, BackendBinding(thread_id), method, payload=payload)
        if method in {"hook/started", "hook/completed"}:
            run = params.get("run") if isinstance(params.get("run"), Mapping) else {}
            hook_id = str(run.get("id") or self._digest(self.safe(run)))
            hook_turn_id = turn_id or f"thread-hook:{thread_id}"
            hook_binding = BackendBinding(thread_id, hook_turn_id, f"hook:{hook_id}")
            status = str(run.get("status") or ("running" if method.endswith("started") else "completed"))
            event_kind = NormalizedEventKind.ITEM_STARTED
            if method == "hook/completed":
                event_kind = {
                    "failed": NormalizedEventKind.ITEM_FAILED,
                    "blocked": NormalizedEventKind.ITEM_FAILED,
                    "stopped": NormalizedEventKind.ITEM_CANCELLED,
                }.get(status, NormalizedEventKind.ITEM_COMPLETED)
            source_path = str(run.get("sourcePath") or "").replace("\\", "/")
            source_name = PurePosixPath(source_path).name if source_path else ""
            return self._event(
                event_kind,
                hook_binding,
                method,
                item_type=NormalizedItemType.INTERACTION,
                payload={
                    "id": f"hook:{hook_id}",
                    "interaction_type": "hook",
                    "event_name": self.safe(run.get("eventName") or "hook"),
                    "handler_type": self.safe(run.get("handlerType") or "unknown"),
                    "execution_mode": self.safe(run.get("executionMode") or "unknown"),
                    "scope": self.safe(run.get("scope") or "turn"),
                    "source": self.safe(run.get("source") or "unknown"),
                    "source_name": self.safe(source_name),
                    "entries": self.safe(run.get("entries") if isinstance(run.get("entries"), list) else []),
                    "duration_ms": run.get("durationMs"),
                    "status": status,
                    "status_message": self.safe(run.get("statusMessage") or ""),
                },
            )
        if method == "item/commandExecution/terminalInteraction":
            stdin = params.get("stdin") if isinstance(params.get("stdin"), str) else ""
            return self._event(
                NormalizedEventKind.ITEM_UPDATED,
                binding,
                method,
                item_type=NormalizedItemType.COMMAND_EXECUTION,
                payload={
                    "id": item_id,
                    "status": "running",
                    "terminal_interaction": "stdin",
                    "process_id": self.safe(params.get("processId") or ""),
                    "input_bytes": len(stdin.encode("utf-8")),
                    "input_redacted": True,
                },
            )
        if method == "item/fileChange/patchUpdated":
            return self._event(
                NormalizedEventKind.ITEM_UPDATED,
                binding,
                method,
                item_type=NormalizedItemType.FILE_CHANGE,
                payload={
                    "id": item_id,
                    "status": "running",
                    "changes": self.safe(params.get("changes") if isinstance(params.get("changes"), list) else []),
                },
            )
        if method == "turn/diff/updated":
            return self._event(
                NormalizedEventKind.ITEM_UPDATED,
                binding,
                method,
                item_type=NormalizedItemType.FILE_CHANGE,
                payload={
                    "id": item_id,
                    "status": "running",
                    "aggregate": True,
                    "diff": self.safe(params.get("diff") or ""),
                },
            )
        if method == "turn/plan/updated":
            plan_item_id = item_id or f"plan:{turn_id}"
            plan_binding = BackendBinding(thread_id, turn_id, plan_item_id)
            return self._event(
                NormalizedEventKind.ITEM_UPDATED,
                plan_binding,
                method,
                item_type=NormalizedItemType.PLAN,
                payload={
                    "id": plan_item_id,
                    "type": "plan",
                    "explanation": self.safe(params.get("explanation") or ""),
                    "steps": self.safe(params.get("plan") if isinstance(params.get("plan"), list) else []),
                },
            )

        delta = self._delta(method, params)
        if delta is not None:
            item_type, delta_kind, text, stream, segment_id, reasoning_kind, reasoning_visibility = delta
            ordinal = self._next_ordinal(turn_id, item_id, method)
            phase = self._message_phases.get((turn_id, item_id)) if item_type is NormalizedItemType.MESSAGE else None
            return self._event(
                NormalizedEventKind.ITEM_DELTA,
                binding,
                method,
                item_type=item_type,
                delta_kind=delta_kind,
                phase=phase,
                stream=stream,
                segment_id=segment_id,
                reasoning_kind=reasoning_kind,
                reasoning_visibility=reasoning_visibility,
                reasoning_source=NormalizedReasoningSource.BACKEND if item_type is NormalizedItemType.REASONING else None,
                payload={"text": text, "ordinal": ordinal, **({"segment_id": segment_id} if segment_id else {})},
                ordinal=ordinal,
            )

        if method in {"item/started", "item/completed"}:
            item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
            native_type = str(item.get("type") or "unknown")
            item_type = _ITEM_TYPES.get(native_type, NormalizedItemType.NOTICE)
            phase = self._phase(item) if item_type is NormalizedItemType.MESSAGE else None
            if phase and turn_id and item_id:
                self._message_phases[(turn_id, item_id)] = phase
            payload = self._item_payload(native_type, item)
            if native_type not in _ITEM_TYPES:
                return None
            event_kind = NormalizedEventKind.ITEM_STARTED
            if method == "item/completed":
                event_kind = {
                    "failed": NormalizedEventKind.ITEM_FAILED,
                    "cancelled": NormalizedEventKind.ITEM_CANCELLED,
                    "declined": NormalizedEventKind.ITEM_CANCELLED,
                }.get(str(item.get("status") or "completed"), NormalizedEventKind.ITEM_COMPLETED)
            return self._event(
                event_kind,
                binding,
                method,
                item_type=item_type,
                phase=phase,
                reasoning_kind=NormalizedReasoningKind.SUMMARY if item_type is NormalizedItemType.REASONING else None,
                reasoning_visibility=(
                    NormalizedReasoningVisibility.USER
                    if item_type is NormalizedItemType.REASONING and payload.get("segments")
                    else NormalizedReasoningVisibility.DIAGNOSTIC
                    if item_type is NormalizedItemType.REASONING
                    else None
                ),
                reasoning_source=NormalizedReasoningSource.BACKEND if item_type is NormalizedItemType.REASONING else None,
                payload=payload,
            )
        if not method:
            return None
        return None

    def state_diagnostics(self) -> dict[str, int]:
        return {"ordinals": len(self._ordinals), "message_phases": len(self._message_phases)}

    def discard_turn(self, turn_id: str) -> None:
        if turn_id:
            self._clear_turn_state(turn_id)

    def terminal_agent_messages(self, message: Mapping[str, Any]) -> list[NormalizedAgentEvent]:
        """Decode terminal fallback messages without exposing Codex fields to the Mapper."""
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        thread_id, turn_id, _item_id = self.identities(params)
        turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
        items = turn.get("items") if isinstance(turn.get("items"), list) else []
        events: list[NormalizedAgentEvent] = []
        for item in items:
            if not isinstance(item, Mapping) or str(item.get("type") or "") != "agentMessage":
                continue
            decoded = self.decode({
                "method": "item/completed",
                "params": {"threadId": thread_id, "turnId": turn_id, "item": item},
            })
            if decoded is not None:
                events.append(decoded)
        return events

    @staticmethod
    def unmapped_identity(message: Mapping[str, Any]) -> str:
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        method = str(message.get("method") or "unknown")
        if method in {"item/started", "item/completed"}:
            item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
            return f"{method}:{str(item.get('type') or 'unknown')[:120]}"
        return method[:160]

    @staticmethod
    def _notice_code(method: str) -> str:
        return {
            "deprecationNotice": "codex_deprecation",
            "model/rerouted": "model_rerouted",
            "thread/compacted": "codex_context_compacted",
        }.get(method, f"codex_{method.replace('/', '_')}")

    @staticmethod
    def _notice_message(method: str) -> str:
        return {
            "deprecationNotice": "Codex reported a deprecated capability.",
            "model/rerouted": "Codex adjusted the model used for this task.",
            "thread/compacted": "Codex compacted the task context.",
            "model/safetyBuffering/updated": "Codex adjusted model safety buffering.",
            "model/verification": "Codex model verification was updated.",
        }.get(method, "Codex reported an operational notice.")

    @staticmethod
    def _notice_details(method: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
        if method == "model/rerouted":
            return {
                "from_model": params.get("fromModel") or "",
                "to_model": params.get("toModel") or "",
                "reason": params.get("reason") or "unspecified",
            }
        return {"category": method}

    def _clear_turn_state(self, turn_id: str) -> None:
        for key in [key for key in self._ordinals if key[0] == turn_id]:
            del self._ordinals[key]
        for key in [key for key in self._message_phases if key[0] == turn_id]:
            del self._message_phases[key]

    def _item_payload(self, native_type: str, item: Mapping[str, Any]) -> Mapping[str, Any]:
        safe = self.safe(item)
        if native_type in {"userMessage", "agentMessage"}:
            text, parts = self._message_content(item)
            return {
                **safe,
                "role": "user" if native_type == "userMessage" else "assistant",
                "text": text,
                "parts": parts,
                "status": self._item_status(item),
            }
        if native_type == "reasoning":
            segments = self._reasoning_segments(item)
            return {
                "id": safe.get("id"),
                "summary": "\n\n".join(segment["text"] for segment in segments),
                "segments": segments,
                "status": self._item_status(item),
            }
        if native_type == "plan":
            return {
                **safe,
                "steps": safe.get("steps") or safe.get("plan") or [],
                "text": safe.get("text") or "",
            }
        if native_type == "commandExecution":
            return {
                **safe,
                "output": safe.get("aggregatedOutput") or safe.get("output") or "",
                "exit_code": safe.get("exitCode"),
                "duration_ms": safe.get("durationMs"),
                "status": self._item_status(item),
            }
        if native_type == "fileChange":
            changes = safe.get("changes")
            if not isinstance(changes, list):
                changes = [{"path": safe.get("path"), "operation": safe.get("operation") or "modify"}]
            return {**safe, "changes": changes, "status": self._item_status(item)}
        if native_type == "hookPrompt":
            return {
                "id": safe.get("id"), "interaction_type": "approval",
                "prompt": safe.get("prompt") or safe.get("message") or "Codex requests input",
                "options": safe.get("options") or [], "status": self._item_status(item),
            }
        if native_type in {"mcpToolCall", "dynamicToolCall", "webSearch", "imageView"}:
            return {
                **safe,
                "tool_kind": {
                    "mcpToolCall": "mcp",
                    "dynamicToolCall": "dynamic",
                    "webSearch": "web_search",
                    "imageView": "image_view",
                }[native_type],
                "name": safe.get("name") or safe.get("tool") or native_type,
                "arguments": safe.get("arguments") or safe.get("input") or safe.get("query"),
                "result": safe.get("result") if safe.get("result") is not None else safe.get("output"),
                "status": self._item_status(item),
            }
        if native_type == "sleep":
            return {
                **safe,
                "tool_kind": "tool",
                "name": "sleep",
                "arguments": {"duration_ms": safe.get("durationMs")},
                "result": None,
                "status": self._item_status(item),
            }
        if native_type in {"collabToolCall", "collabAgentToolCall", "subAgentActivity"}:
            return {
                **safe,
                "title": safe.get("prompt") or safe.get("tool") or "Subtask",
                "agent_name": safe.get("agentName"),
                "child_run_id": safe.get("newThreadId") or safe.get("receiverThreadId"),
                "summary": safe.get("summary") or safe.get("result") or "",
                "status": self._item_status(item),
            }
        if native_type == "imageGeneration":
            return {
                "id": safe.get("id"), "artifact_type": "image",
                "artifact_id": safe.get("imageId") or safe.get("id"),
                "name": safe.get("name") or "Generated image",
                "summary": safe.get("summary") or safe.get("prompt") or "",
                "resource_refs": safe.get("resourceRefs") or [], "status": self._item_status(item),
            }
        if native_type == "error":
            return {
                "id": safe.get("id"), "level": "error", "code": safe.get("code") or "codex_error",
                "message": safe.get("message") or safe.get("error") or "Codex item failed",
                "status": "failed",
            }
        if native_type in {"enteredReviewMode", "exitedReviewMode", "contextCompaction"}:
            return {
                "id": safe.get("id"),
                "level": "info",
                "code": f"codex_{native_type}",
                "message": safe.get("message") or native_type,
            }
        return safe

    def _message_content(self, item: Mapping[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        direct = item.get("text")
        content = item.get("content")
        for candidate in (content, direct):
            parsed = self._history_message_parts(candidate)
            if parsed is not None:
                content = parsed
                direct = None
                break
        if isinstance(content, str):
            return str(direct or content), [{"type": "text", "text": str(direct or content)}]
        if not isinstance(content, list):
            text = str(direct or "")
            return text, ([{"type": "text", "text": text}] if text else [])
        parts: list[dict[str, Any]] = []
        texts: list[str] = []
        for raw in content[:100]:
            if not isinstance(raw, Mapping):
                continue
            kind = str(raw.get("type") or "")
            if kind == "text":
                nested = self._history_message_parts(raw.get("text"))
                if nested is not None:
                    for nested_part in nested:
                        if str(nested_part.get("type") or "") != "text":
                            continue
                        nested_text = self.safe(nested_part.get("text") or "")
                        if isinstance(nested_text, str) and nested_text:
                            texts.append(nested_text)
                            parts.append({"type": "text", "text": nested_text})
                    continue
                text = self.safe(raw.get("text") or "")
                if isinstance(text, str):
                    texts.append(text)
                    parts.append({"type": "text", "text": text})
            elif kind == "image":
                url = self.safe(raw.get("url") or "")
                parts.append({"type": "image", **({"url": url} if isinstance(url, str) and url else {})})
            elif kind in {"localImage", "localAudio"}:
                raw_path = str(raw.get("path") or "").replace("\\", "/")
                name = PureWindowsPath(raw_path).name or PurePosixPath(raw_path).name
                parts.append({"type": "image" if kind == "localImage" else "audio", "name": self.safe(name)})
            elif kind == "audio":
                url = self.safe(raw.get("url") or "")
                parts.append({"type": "audio", **({"url": url} if isinstance(url, str) and url else {})})
        text = "\n".join(value for value in texts if value)
        if not text and isinstance(direct, str):
            text = self.safe(direct)
        return str(text or ""), parts

    def _history_message_parts(self, value: Any) -> list[Mapping[str, Any]] | None:
        if not self.history_mode:
            return None
        return decode_legacy_message_parts(value, max_chars=self.max_field_chars * 4)

    def _reasoning_segments(self, item: Mapping[str, Any]) -> list[dict[str, str]]:
        segments: list[dict[str, str]] = []
        summary = item.get("summary") or item.get("summaryParts")
        sources = [("summary", summary)] if summary is not None else []
        # Codex `content`/`text` is raw model analysis.  It is deliberately not
        # projected into OAEP user-visible reasoning; only public summaries are.
        for prefix, raw_values in sources:
            values = raw_values if isinstance(raw_values, list) else [raw_values]
            for index, value in enumerate(values[:100]):
                if isinstance(value, Mapping):
                    text = value.get("text") or value.get("summary") or ""
                    segment_id = str(value.get("id") or f"{prefix}-{index + 1}")
                else:
                    text = value
                    segment_id = f"{prefix}-{index + 1}"
                safe_text = self.safe(text)
                if isinstance(safe_text, str) and safe_text:
                    segments.append({
                        "id": segment_id,
                        "text": safe_text,
                        "kind": "summary",
                        "visibility": "user",
                        "source": "backend",
                    })
        return segments

    @staticmethod
    def _item_status(item: Mapping[str, Any]) -> str:
        return {
            "inProgress": "running",
            "completed": "completed",
            "failed": "failed",
            "declined": "cancelled",
            "cancelled": "cancelled",
        }.get(str(item.get("status") or "completed"), "completed")

    def _delta(
        self, method: str, params: Mapping[str, Any]
    ) -> tuple[
        NormalizedItemType,
        NormalizedDeltaKind,
        str,
        str | None,
        str | None,
        NormalizedReasoningKind | None,
        NormalizedReasoningVisibility | None,
    ] | None:
        value = params.get("delta")
        if value is None:
            value = params.get("text") or params.get("output") or params.get("chunk")
        text = str(value) if isinstance(value, str) else ""
        if method == "item/agentMessage/delta" and isinstance(value, str):
            return NormalizedItemType.MESSAGE, NormalizedDeltaKind.MESSAGE_TEXT_APPEND, text, None, None, None, None
        if method == "item/plan/delta" and isinstance(value, str):
            return NormalizedItemType.PLAN, NormalizedDeltaKind.PLAN_TEXT_APPEND, text, None, None, None, None
        if method == "item/reasoning/summaryPartAdded":
            index = params.get("summaryIndex")
            segment_id = f"summary-{int(index) + 1}" if isinstance(index, int) and index >= 0 else "summary-1"
            return (
                NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_SEGMENT_ADDED,
                text, None, segment_id, NormalizedReasoningKind.SUMMARY, NormalizedReasoningVisibility.USER,
            )
        if method in {"item/reasoning/summaryTextDelta", "item/reasoning/textDelta"} and isinstance(value, str):
            is_summary = method.endswith("summaryTextDelta")
            index = params.get("summaryIndex") if is_summary else params.get("contentIndex")
            prefix = "summary" if is_summary else "content"
            segment_id = f"{prefix}-{int(index) + 1}" if isinstance(index, int) and index >= 0 else f"{prefix}-1"
            return (
                NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_TEXT_APPEND,
                text, None, segment_id,
                NormalizedReasoningKind.SUMMARY if is_summary else NormalizedReasoningKind.ANALYSIS,
                NormalizedReasoningVisibility.USER if is_summary else NormalizedReasoningVisibility.DIAGNOSTIC,
            )
        if method == "item/commandExecution/outputDelta" and isinstance(value, str):
            stream = str(params.get("stream") or "combined")
            if stream not in {"stdout", "stderr", "combined"}:
                stream = "combined"
            return NormalizedItemType.COMMAND_EXECUTION, NormalizedDeltaKind.COMMAND_OUTPUT_APPEND, text, stream, None, None, None
        if method == "item/mcpToolCall/progress" and isinstance(params.get("message"), str):
            return (
                NormalizedItemType.TOOL_CALL,
                NormalizedDeltaKind.TOOL_OUTPUT_APPEND,
                str(params["message"]),
                None,
                None,
                None,
                None,
            )
        return None

    def _event(
        self,
        kind: NormalizedEventKind,
        binding: BackendBinding,
        method: str,
        *,
        item_type: NormalizedItemType | None = None,
        delta_kind: NormalizedDeltaKind | None = None,
        phase: str | None = None,
        stream: str | None = None,
        segment_id: str | None = None,
        terminal_status: NormalizedTerminalStatus | None = None,
        reasoning_kind: NormalizedReasoningKind | None = None,
        reasoning_visibility: NormalizedReasoningVisibility | None = None,
        reasoning_source: NormalizedReasoningSource | None = None,
        payload: Mapping[str, Any] | None = None,
        ordinal: int | None = None,
    ) -> NormalizedAgentEvent:
        identity = ":".join(filter(None, (binding.session_id, binding.run_id, binding.item_id)))
        suffix = str(ordinal) if ordinal is not None else self._digest(payload or {})
        return NormalizedAgentEvent(
            kind=kind,
            backend="codex",
            binding=binding,
            item_type=item_type,
            delta_kind=delta_kind,
            phase=phase,
            stream=stream,
            segment_id=segment_id,
            terminal_status=terminal_status,
            reasoning_kind=reasoning_kind,
            reasoning_visibility=reasoning_visibility,
            reasoning_source=reasoning_source,
            dedupe_key=f"codex:{identity}:{method}:{suffix}",
            payload=payload or {},
        )

    def _next_ordinal(self, turn_id: str, item_id: str, method: str) -> int:
        key = (turn_id, item_id, method)
        self._ordinals[key] += 1
        return self._ordinals[key]

    @staticmethod
    def _digest(payload: Mapping[str, Any]) -> str:
        encoded = json.dumps(dict(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        return hashlib.sha256(encoded).hexdigest()[:16]

    @staticmethod
    def _phase(item: Mapping[str, Any]) -> str:
        return "commentary" if str(item.get("phase") or "") == "commentary" else "final"

    @staticmethod
    def identities(params: Mapping[str, Any]) -> tuple[str, str, str]:
        thread = params.get("thread") if isinstance(params.get("thread"), Mapping) else {}
        turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
        item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
        return (
            str(params.get("threadId") or thread.get("id") or "unknown-thread"),
            str(params.get("turnId") or turn.get("id") or ""),
            str(params.get("itemId") or item.get("id") or ""),
        )

    def safe(self, value: Any, key: str = "") -> Any:
        if _SECRET.search(key):
            return "[REDACTED]"
        if isinstance(value, Mapping):
            return {str(k): self.safe(v, str(k)) for k, v in value.items()}
        if isinstance(value, list):
            return [self.safe(v) for v in value[:100]]
        if isinstance(value, str):
            return value if len(value) <= self.max_field_chars else value[: self.max_field_chars] + "…[truncated]"
        return value if isinstance(value, (int, float, bool, type(None))) else type(value).__name__
