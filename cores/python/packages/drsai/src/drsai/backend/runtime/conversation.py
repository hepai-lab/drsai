"""Versioned structured-conversation projection for streaming agent events."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import re
from typing import Any, Callable


STRUCTURED_CONVERSATION_VERSION = 2
STRUCTURED_SSE_EVENT = "drsai.event"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encode_structured_sse(event: dict[str, Any]) -> str:
    return f"event: {STRUCTURED_SSE_EVENT}\ndata: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"


@dataclass
class _ThinkStreamNormalizer:
    mode: str = "text"
    buffer: str = ""
    native_reasoning_seen: bool = False

    _open_tokens = ("<think>", "&lt;think&gt;")
    _close_tokens = ("</think>", "&lt;/think&gt;")

    def push_content(self, content: str) -> tuple[list[str], list[str]]:
        self.buffer += content
        text: list[str] = []
        reasoning: list[str] = []
        while self.buffer:
            tokens = self._open_tokens if self.mode == "text" else self._close_tokens
            match = self._find_first(tokens)
            if match:
                index, token = match
                self._append(text, reasoning, self.buffer[:index])
                self.buffer = self.buffer[index + len(token):]
                self.mode = "reasoning" if self.mode == "text" else "text"
                continue
            retained = self._longest_prefix_suffix(tokens)
            ready_length = len(self.buffer) - len(retained)
            if ready_length:
                self._append(text, reasoning, self.buffer[:ready_length])
                self.buffer = retained
            break
        return text, reasoning

    def finish(self) -> tuple[list[str], list[str]]:
        text: list[str] = []
        reasoning: list[str] = []
        self._append(text, reasoning, self.buffer)
        self.mode = "text"
        self.buffer = ""
        return text, reasoning

    def _append(self, text: list[str], reasoning: list[str], content: str) -> None:
        if not content:
            return
        if self.mode == "text":
            text.append(content)
        elif not self.native_reasoning_seen:
            reasoning.append(content)

    def _find_first(self, tokens: tuple[str, ...]) -> tuple[int, str] | None:
        matches = ((self.buffer.find(token), token) for token in tokens)
        valid = [(index, token) for index, token in matches if index >= 0]
        return min(valid, key=lambda item: item[0]) if valid else None

    def _longest_prefix_suffix(self, tokens: tuple[str, ...]) -> str:
        max_length = min(len(self.buffer), max(len(token) - 1 for token in tokens))
        for length in range(max_length, 0, -1):
            suffix = self.buffer[-length:]
            if any(token.startswith(suffix) for token in tokens):
                return suffix
        return ""


@dataclass
class StructuredConversationProjector:
    turn_id: str
    now: Callable[[], str] = _utc_now
    sequence: int = 0
    parts: dict[str, dict[str, Any]] = field(default_factory=dict)
    activities: dict[str, dict[str, Any]] = field(default_factory=dict)
    started: bool = False
    completed: bool = False
    reasoning_counter: int = 0
    activity_counter: int = 0
    normalizer: _ThinkStreamNormalizer = field(default_factory=_ThinkStreamNormalizer)

    @property
    def markdown_part_id(self) -> str:
        return f"{self.turn_id}:markdown"

    @property
    def reasoning_part_id(self) -> str:
        return f"{self.turn_id}:reasoning"

    def start(self) -> list[dict[str, Any]]:
        if self.started:
            return []
        self.started = True
        return [self._event("turn.started", "gateway")]

    def project(self, event_type: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
        events = self.start()
        source = str(payload.get("source") or event_type)
        if event_type == "message.delta":
            text_chunks, reasoning_chunks = self.normalizer.push_content(str(payload.get("text") or ""))
            for text in text_chunks:
                events.extend(self._append_markdown(text, source))
            for reasoning in reasoning_chunks:
                events.extend(self._append_reasoning(reasoning, source, "tagged-stream"))
        elif event_type == "thinking.delta":
            reasoning = str(payload.get("text") or "")
            existing = self._reasoning_text().strip()
            self.normalizer.native_reasoning_seen = True
            if reasoning.strip() and reasoning.strip() != existing:
                self.reasoning_counter += 1
                events.extend(self._append_reasoning(reasoning, source, f"native-{self.reasoning_counter}"))
        elif event_type in {"tool.start", "tool.progress", "tool.complete"}:
            events.append(self._tool_activity(event_type, payload, source))
        elif event_type == "status.update":
            self.activity_counter += 1
            activity_id = str(payload.get("id") or f"{self.turn_id}:log:{self.activity_counter}")
            activity = {
                "id": activity_id,
                "turnId": self.turn_id,
                "timestamp": self.now(),
                "source": source,
                "status": "completed",
                "title": str(payload.get("title") or payload.get("kind") or "Agent activity"),
                "kind": "log",
                "level": _normalize_log_level(payload.get("level")),
                "content": str(payload.get("text") or payload.get("content") or ""),
            }
            self.activities[activity_id] = activity
            events.append(self._event("activity.updated", source, activity=activity))
        elif event_type in {"subagent.thinking", "subagent.complete"}:
            events.extend(self._subtask(event_type, payload, source))
        elif event_type == "progress.update":
            events.extend(self._progress(payload, source))
        elif event_type == "artifact.created":
            events.append(self._artifact(payload, source))
        elif event_type == "citation.added":
            events.extend(self._citation(payload, source))
        elif event_type == "interaction.request":
            events.append(self._interaction(payload, source))
        elif event_type == "notice":
            events.append(self._notice(payload, source))
        elif event_type == "message.complete":
            final_text = str(payload.get("text") or "")
            if final_text and not self._markdown_text():
                text_chunks, reasoning_chunks = self.normalizer.push_content(final_text)
                for text in text_chunks:
                    events.extend(self._append_markdown(text, source))
                for reasoning in reasoning_chunks:
                    events.extend(self._append_reasoning(reasoning, source, "tagged-final"))
            events.extend(self.complete(payload, str(payload.get("status") or "complete")))
        return events

    def complete(self, payload: dict[str, Any] | None = None, status: str = "complete") -> list[dict[str, Any]]:
        if self.completed:
            return []
        events: list[dict[str, Any]] = []
        normalized_status = status.lower()
        terminal_part_status = (
            "cancelled" if normalized_status in {"cancelled", "canceled", "aborted", "interrupted"}
            else "error" if normalized_status in {"error", "failed"}
            else "completed"
        )
        text_chunks, reasoning_chunks = self.normalizer.finish()
        for text in text_chunks:
            events.extend(self._append_markdown(text, "gateway"))
        for reasoning in reasoning_chunks:
            events.extend(self._append_reasoning(reasoning, "gateway", "tagged-final"))
        for part_id, part in list(self.parts.items()):
            if part.get("status") in {"pending", "running"}:
                completed_part = {**part, "status": terminal_part_status}
                if completed_part.get("kind") == "reasoning":
                    completed_part["segments"] = [
                        {**segment, "status": terminal_part_status}
                        for segment in completed_part.get("segments", [])
                    ]
                self.parts[part_id] = completed_part
                events.append(self._event("part.completed", "gateway", part=completed_part))
        self.completed = True
        if normalized_status in {"cancelled", "canceled", "aborted", "interrupted"}:
            events.append(self._event("turn.cancelled", "gateway"))
        elif normalized_status in {"error", "failed"}:
            message = str((payload or {}).get("message") or "Agent turn failed.")
            events.append(self._notice({
                "id": "turn-error",
                "level": "error",
                "message": message,
                "debug_ref": (payload or {}).get("debug_ref"),
            }, "gateway"))
            events.append(self._event("turn.error", "gateway", message=message))
        else:
            usage = (payload or {}).get("usage")
            meta = {
                key: value for key, value in {
                    "model": (usage or {}).get("model") if isinstance(usage, dict) else None,
                    "usage": usage if isinstance(usage, dict) else None,
                    "stopReason": (payload or {}).get("stop_reason"),
                }.items() if value not in (None, "", {})
            }
            events.append(self._event("turn.completed", "gateway", **({"meta": meta} if meta else {})))
        return events

    def encode(self, events: list[dict[str, Any]]) -> list[str]:
        return [encode_structured_sse(event) for event in events]

    def _append_markdown(self, text: str, source: str) -> list[dict[str, Any]]:
        if not text:
            return []
        events: list[dict[str, Any]] = []
        part = self.parts.get(self.markdown_part_id)
        if part is None:
            part = {"id": self.markdown_part_id, "kind": "markdown", "status": "running", "markdown": ""}
            self.parts[self.markdown_part_id] = part
            events.append(self._event("part.started", source, part=dict(part)))
        part["markdown"] = f"{part.get('markdown', '')}{text}"
        events.append(self._event(
            "part.delta", source, partId=self.markdown_part_id,
            delta={"kind": "markdown.append", "text": text},
        ))
        return events

    def _append_reasoning(self, text: str, source: str, segment_id: str) -> list[dict[str, Any]]:
        if not text:
            return []
        events: list[dict[str, Any]] = []
        part = self.parts.get(self.reasoning_part_id)
        if part is None:
            part = {"id": self.reasoning_part_id, "kind": "reasoning", "status": "running", "segments": []}
            self.parts[self.reasoning_part_id] = part
            events.append(self._event("part.started", source, part=dict(part)))
        segments = part["segments"]
        segment = next((item for item in segments if item["id"] == segment_id), None)
        if segment is None:
            segment = {"id": segment_id, "text": "", "status": "running", "source": source}
            segments.append(segment)
        segment["text"] += text
        events.append(self._event(
            "part.delta", source, partId=self.reasoning_part_id,
            delta={"kind": "reasoning.append", "segmentId": segment_id, "text": text, "source": source},
        ))
        return events

    def _tool_activity(self, event_type: str, payload: dict[str, Any], source: str) -> dict[str, Any]:
        self.activity_counter += 1
        call_id = str(payload.get("tool_id") or payload.get("call_id") or f"tool-{self.activity_counter}")
        status = "completed" if event_type == "tool.complete" else "running"
        activity = {
            "id": f"{self.turn_id}:tool:{call_id}",
            "turnId": self.turn_id,
            "timestamp": self.now(),
            "source": source,
            "status": status,
            "title": str(payload.get("title") or payload.get("name") or "Tool activity"),
            "kind": "tool",
            "toolName": str(payload.get("name") or payload.get("tool") or "tool"),
            "callId": call_id,
        }
        if payload.get("args") not in (None, {}, ""):
            activity["input"] = payload["args"]
        if payload.get("result") not in (None, ""):
            activity["output"] = payload["result"]
        if payload.get("duration_ms") is not None:
            activity["durationMs"] = payload["duration_ms"]
        self.activities[activity["id"]] = activity
        return self._event("activity.updated", source, activity=activity)

    def _subtask(self, event_type: str, payload: dict[str, Any], source: str) -> list[dict[str, Any]]:
        source_id = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", source).strip("-") or "subtask"
        part_id = f"{self.turn_id}:subtask:{source_id}"
        part = self.parts.get(part_id)
        events: list[dict[str, Any]] = []
        if part is None:
            part = {
                "id": part_id,
                "kind": "subtask",
                "status": "running",
                "taskId": source_id,
                "title": str(payload.get("title") or source.replace("sub:", "") or "Subtask"),
                "agentName": source.replace("sub:", ""),
            }
            self.parts[part_id] = part
            events.append(self._event("part.started", source, part=dict(part)))
        summary = str(payload.get("text") or payload.get("summary") or "")
        if event_type == "subagent.complete":
            part["summary"] = summary
            part["status"] = "completed"
            events.append(self._event("part.completed", source, part=dict(part)))
        else:
            events.append(self._event(
                "part.delta", source, partId=part_id,
                delta={"kind": "subtask.update", "summary": summary, "status": "running"},
            ))
        return events

    def _progress(self, payload: dict[str, Any], source: str) -> list[dict[str, Any]]:
        progress_id = _safe_id(str(payload.get("progress_id") or payload.get("id") or "progress"))
        part_id = f"{self.turn_id}:progress:{progress_id}"
        summary = str(payload.get("summary") or payload.get("text") or "Working")
        status = _normalize_part_status(payload.get("status"), "running")
        events: list[dict[str, Any]] = []
        part = self.parts.get(part_id)
        if part is None:
            part = {
                "id": part_id,
                "kind": "progress",
                "status": "running",
                "summary": summary,
                **({"phase": str(payload["phase"])} if payload.get("phase") else {}),
            }
            self.parts[part_id] = part
            events.append(self._event("part.started", source, part=dict(part)))
        part.update({"summary": summary, "status": status})
        if payload.get("phase"):
            part["phase"] = str(payload["phase"])
        if status in {"completed", "error", "cancelled"}:
            events.append(self._event("part.completed", source, part=dict(part)))
        else:
            events.append(self._event(
                "part.delta", source, partId=part_id,
                delta={
                    "kind": "progress.update",
                    "summary": summary,
                    **({"phase": str(payload["phase"])} if payload.get("phase") else {}),
                },
            ))
        return events

    def _artifact(self, payload: dict[str, Any], source: str) -> dict[str, Any]:
        artifact_id = str(payload.get("artifact_id") or payload.get("id") or f"artifact-{len(self.parts) + 1}")
        artifact_type = str(payload.get("artifact_type") or "file")
        if artifact_type not in {"file", "image", "table", "report", "patch", "web"}:
            artifact_type = "file"
        part = {
            "id": f"{self.turn_id}:artifact:{_safe_id(artifact_id)}",
            "kind": "artifact",
            "status": "completed",
            "artifactId": artifact_id,
            "artifactType": artifact_type,
            "name": str(payload.get("name") or payload.get("title") or "Artifact"),
        }
        for source_key, target_key in (("summary", "summary"), ("path", "path"), ("url", "url"), ("mime", "mime"), ("sha256", "sha256"), ("source_call_id", "sourceCallId")):
            if payload.get(source_key):
                part[target_key] = str(payload[source_key])
        if isinstance(payload.get("size"), int) and not isinstance(payload.get("size"), bool):
            part["size"] = payload["size"]
        for key in ("previewable", "downloadable"):
            if isinstance(payload.get(key), bool):
                part[key] = payload[key]
        if isinstance(payload.get("citation_ids"), list):
            part["citationIds"] = [str(value) for value in payload["citation_ids"] if value]
        self.parts[part["id"]] = part
        return self._event("part.completed", source, part=part)

    def _citation(self, payload: dict[str, Any], source: str) -> list[dict[str, Any]]:
        citation_id = str(payload.get("citation_id") or payload.get("id") or f"citation-{len(self.parts) + 1}")
        part = {
            "id": f"{self.turn_id}:citation:{_safe_id(citation_id)}",
            "kind": "citation",
            "status": "completed",
            "citationId": citation_id,
            "title": str(payload.get("title") or payload.get("url") or payload.get("path") or "Source"),
        }
        for key in ("url", "path", "locator", "excerpt"):
            if payload.get(key):
                part[key] = str(payload[key])
        for key in ("relation", "knowledge_base_id", "revision", "document_path", "corpus_complete"):
            if payload.get(key) is not None:
                part[key] = payload[key]
        part["markdownPartId"] = str(payload.get("markdown_part_id") or self.markdown_part_id)
        if payload.get("artifact_id"):
            part["artifactId"] = str(payload["artifact_id"])
        self.parts[part["id"]] = part
        events = [self._event("part.completed", source, part=part)]
        markdown = self.parts.get(self.markdown_part_id)
        if markdown is not None:
            citation_ids = markdown.setdefault("citationIds", [])
            if citation_id not in citation_ids:
                citation_ids.append(citation_id)
                events.append(self._event(
                    "part.delta",
                    source,
                    partId=self.markdown_part_id,
                    delta={"kind": "markdown.citations", "citationIds": [citation_id]},
                ))
        return events

    def _interaction(self, payload: dict[str, Any], source: str) -> dict[str, Any]:
        request_id = str(payload.get("request_id") or payload.get("id") or f"request-{len(self.parts) + 1}")
        interaction_type = str(payload.get("interaction_type") or "text_input")
        if interaction_type not in {"approval", "text_input", "choice", "confirmation", "capability_configuration"}:
            interaction_type = "text_input"
        part = {
            "id": f"{self.turn_id}:interaction:{_safe_id(request_id)}",
            "kind": "interaction",
            "status": "pending",
            "requestId": request_id,
            "interactionType": interaction_type,
            "prompt": str(payload.get("prompt") or "Input required"),
        }
        if isinstance(payload.get("options"), list):
            part["options"] = payload["options"]
        if isinstance(payload.get("request_summary"), dict):
            summary = payload["request_summary"]
            for source_key, target_key in (
                ("capability", "capability"), ("resource_kind", "resourceKind"),
                ("preferred_adapter", "preferredAdapter"), ("reason", "reason"),
                ("query_disclosed", "queryDisclosed"),
            ):
                if source_key in summary:
                    part[target_key] = summary[source_key]
        self.parts[part["id"]] = part
        return self._event("part.started", source, part=part)

    def _notice(self, payload: dict[str, Any], source: str) -> dict[str, Any]:
        level = str(payload.get("level") or "info").lower()
        if level not in {"info", "success", "warning", "error"}:
            level = "info"
        notice_id = str(payload.get("id") or f"notice-{len(self.parts) + 1}")
        part = {
            "id": f"{self.turn_id}:notice:{_safe_id(notice_id)}",
            "kind": "notice",
            "status": "error" if level == "error" else "completed",
            "level": level,
            "message": str(payload.get("message") or payload.get("text") or ""),
        }
        if payload.get("debug_ref"):
            part["debugRef"] = str(payload["debug_ref"])
        self.parts[part["id"]] = part
        return self._event("part.completed", source, part=part)

    def _event(self, event_type: str, source: str, **payload: Any) -> dict[str, Any]:
        self.sequence += 1
        return {
            "version": STRUCTURED_CONVERSATION_VERSION,
            "type": event_type,
            "turnId": self.turn_id,
            "sequence": self.sequence,
            "dedupeKey": f"{self.turn_id}:{self.sequence}:{event_type}",
            "timestamp": self.now(),
            "source": source or "gateway",
            **payload,
        }

    def _markdown_text(self) -> str:
        return str(self.parts.get(self.markdown_part_id, {}).get("markdown") or "")

    def _reasoning_text(self) -> str:
        part = self.parts.get(self.reasoning_part_id, {})
        return "".join(str(segment.get("text") or "") for segment in part.get("segments", []))


def _normalize_log_level(level: Any) -> str:
    normalized = str(level or "info").lower()
    if "error" in normalized or "fatal" in normalized:
        return "error"
    if "warn" in normalized:
        return "warning"
    if "debug" in normalized or "trace" in normalized:
        return "debug"
    return "info"


def _normalize_part_status(value: Any, fallback: str) -> str:
    normalized = str(value or fallback).lower()
    if normalized in {"complete", "completed", "done", "success", "succeeded"}:
        return "completed"
    if normalized in {"error", "failed", "failure", "timeout"}:
        return "error"
    if normalized in {"cancelled", "canceled", "aborted", "killed"}:
        return "cancelled"
    if normalized in {"pending", "running"}:
        return normalized
    return fallback


def _safe_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.:-]+", "-", value).strip("-")[:200] or "item"
