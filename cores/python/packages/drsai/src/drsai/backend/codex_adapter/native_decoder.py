"""Decode stable Codex app-server notifications into typed adapter events."""

from __future__ import annotations

import hashlib
import ast
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
    NormalizedTerminalStatus,
)


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

    def __init__(self, *, max_field_chars: int = 8000) -> None:
        self.max_field_chars = max(256, max_field_chars)
        self._ordinals: dict[tuple[str, str, str], int] = defaultdict(int)

    def decode(self, message: Mapping[str, Any]) -> NormalizedAgentEvent | None:
        method = str(message.get("method") or "")
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        thread_id, turn_id, item_id = self.identities(params)
        binding = BackendBinding(thread_id, turn_id or None, item_id or None)

        if method == "turn/started":
            # A replayed turn begins the same deterministic ordinal space as
            # the original stream.  This keeps dedupe keys stable across
            # reconnect/replay while still distinguishing equal adjacent
            # chunks inside one delivery.
            for key in [key for key in self._ordinals if key[0] == turn_id]:
                del self._ordinals[key]
            return self._event(NormalizedEventKind.RUN_STARTED, binding, method)
        if method == "turn/completed":
            turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else params
            status = str(turn.get("status") or "failed")
            kind, terminal = {
                "completed": (NormalizedEventKind.RUN_COMPLETED, NormalizedTerminalStatus.COMPLETED),
                "interrupted": (NormalizedEventKind.RUN_CANCELLED, NormalizedTerminalStatus.CANCELLED),
                "failed": (NormalizedEventKind.RUN_FAILED, NormalizedTerminalStatus.FAILED),
            }.get(status, (NormalizedEventKind.RUN_FAILED, NormalizedTerminalStatus.FAILED))
            return self._event(kind, binding, method, terminal_status=terminal, payload=self.safe(turn))
        if method in {"thread/started", "thread/archived", "thread/unarchived", "thread/deleted"}:
            kind = {
                "thread/started": NormalizedEventKind.SESSION_CREATED,
                "thread/archived": NormalizedEventKind.SESSION_ARCHIVED,
                "thread/unarchived": NormalizedEventKind.SESSION_UNARCHIVED,
                "thread/deleted": NormalizedEventKind.SESSION_DELETED,
            }[method]
            return self._event(kind, BackendBinding(thread_id), method, payload=self.safe(params))

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
            item_type, delta_kind, text, stream = delta
            ordinal = self._next_ordinal(turn_id, item_id, method)
            return self._event(
                NormalizedEventKind.ITEM_DELTA,
                binding,
                method,
                item_type=item_type,
                delta_kind=delta_kind,
                stream=stream,
                payload={"text": text, "ordinal": ordinal},
                ordinal=ordinal,
            )

        if method in {"item/started", "item/completed"}:
            item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
            native_type = str(item.get("type") or "unknown")
            item_type = _ITEM_TYPES.get(native_type, NormalizedItemType.NOTICE)
            phase = self._phase(item) if item_type is NormalizedItemType.MESSAGE else None
            payload = self._item_payload(native_type, item)
            if native_type not in _ITEM_TYPES:
                payload = {
                    "level": "warning",
                    "code": "codex_item_unknown",
                    "message": native_type,
                    "native_summary": payload,
                }
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
                payload=payload,
            )
        if not method or method in {
            "thread/status/changed",
            "thread/tokenUsage/updated",
            "account/rateLimits/updated",
        }:
            return None
        safe_params = self.safe(params)
        digest = self._digest(safe_params)
        if turn_id:
            notice_id = item_id or f"notice:{digest}"
            return self._event(
                NormalizedEventKind.ITEM_COMPLETED,
                BackendBinding(thread_id, turn_id, notice_id),
                method,
                item_type=NormalizedItemType.NOTICE,
                payload={
                    "level": "info",
                    "code": "codex_notification_unknown",
                    "message": method,
                    "details": {"method": method, "digest": digest},
                },
            )
        return self._event(
            NormalizedEventKind.SESSION_UPDATED,
            BackendBinding(thread_id),
            method,
            payload={"code": "codex_notification_unknown", "method": method, "digest": digest},
        )

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
            parsed = self._legacy_message_parts(candidate)
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
                nested = self._legacy_message_parts(raw.get("text"))
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

    def _legacy_message_parts(self, value: Any) -> list[Mapping[str, Any]] | None:
        if not isinstance(value, str) or len(value) > self.max_field_chars * 4:
            return None
        stripped = value.strip()
        if not (stripped.startswith("[") and stripped.endswith("]")):
            return None
        parsed: Any = None
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            try:
                parsed = ast.literal_eval(stripped)
            except (ValueError, SyntaxError, MemoryError, RecursionError):
                return None
        if isinstance(parsed, list) and all(isinstance(part, Mapping) for part in parsed):
            return parsed
        return None

    def _reasoning_segments(self, item: Mapping[str, Any]) -> list[dict[str, str]]:
        values = item.get("summary") or item.get("summaryParts") or item.get("segments") or item.get("text") or []
        if not isinstance(values, list):
            values = [values]
        segments: list[dict[str, str]] = []
        for index, value in enumerate(values[:100]):
            if isinstance(value, Mapping):
                text = value.get("text") or value.get("summary") or ""
                segment_id = str(value.get("id") or f"summary-{index + 1}")
            else:
                text = value
                segment_id = f"summary-{index + 1}"
            safe_text = self.safe(text)
            if isinstance(safe_text, str) and safe_text:
                segments.append({"id": segment_id, "text": safe_text})
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
    ) -> tuple[NormalizedItemType, NormalizedDeltaKind, str, str | None] | None:
        value = params.get("delta")
        if value is None:
            value = params.get("text") or params.get("output") or params.get("chunk")
        text = str(value) if isinstance(value, str) else ""
        if method == "item/agentMessage/delta" and isinstance(value, str):
            return NormalizedItemType.MESSAGE, NormalizedDeltaKind.MESSAGE_TEXT_APPEND, text, None
        if method == "item/plan/delta" and isinstance(value, str):
            return NormalizedItemType.PLAN, NormalizedDeltaKind.PLAN_TEXT_APPEND, text, None
        if method == "item/reasoning/summaryPartAdded":
            return NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_SEGMENT_ADDED, text, None
        if method in {"item/reasoning/summaryTextDelta", "item/reasoning/textDelta"} and isinstance(value, str):
            return NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_TEXT_APPEND, text, None
        if method == "item/commandExecution/outputDelta" and isinstance(value, str):
            stream = str(params.get("stream") or "combined")
            if stream not in {"stdout", "stderr", "combined"}:
                stream = "combined"
            return NormalizedItemType.COMMAND_EXECUTION, NormalizedDeltaKind.COMMAND_OUTPUT_APPEND, text, stream
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
        terminal_status: NormalizedTerminalStatus | None = None,
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
            terminal_status=terminal_status,
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
