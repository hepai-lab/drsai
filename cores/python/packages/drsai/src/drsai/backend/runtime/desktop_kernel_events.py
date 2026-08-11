"""Translate shared Kernel events to the existing Desktop/TUI Autogen stream."""

from __future__ import annotations

from dataclasses import dataclass, field
import ast
import hashlib
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


def _web_citation_candidates(value: Any) -> list[dict[str, str]]:
    """Extract only URL/title facts returned by successful Web tools."""
    candidates: list[dict[str, str]] = []

    def visit(item: Any) -> None:
        if isinstance(item, str) and item.lstrip().startswith("{"):
            try:
                decoded = json.loads(item)
            except json.JSONDecodeError:
                try:
                    decoded = ast.literal_eval(item)
                except (SyntaxError, ValueError):
                    return
            visit(decoded)
            return
        if isinstance(item, dict):
            url = item.get("final_url") or item.get("url")
            if isinstance(url, str) and url.startswith("https://"):
                candidates.append({
                    "url": url,
                    "title": str(item.get("title") or url)[:300],
                })
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    unique: dict[str, dict[str, str]] = {}
    for candidate in candidates:
        unique.setdefault(candidate["url"], candidate)
    return list(unique.values())


@dataclass(slots=True)
class DesktopKernelTurnState:
    assistant_name: str
    text_parts: list[str] = field(default_factory=list)
    terminal_kind: str | None = None
    terminal_payload: dict[str, Any] = field(default_factory=dict)
    citation_candidates: list[dict[str, Any]] = field(default_factory=list)

    @property
    def final_text(self) -> str:
        return "".join(self.text_parts)

    def message_metadata(self, text: str) -> dict[str, str]:
        citations = [item for item in self.citation_candidates if str(item.get("url") or "") in text]
        return {
            "internal": "no",
            **({"citations_json": json.dumps(citations, ensure_ascii=False, separators=(",", ":"), sort_keys=True)} if citations else {}),
        }


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
        return (TextMessage(content=text, source=state.assistant_name, metadata=state.message_metadata(text)),)
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
        if kind == "tool.result" and payload.get("name") == "knowledge_search" and isinstance(result, dict):
            documents = {
                str(item.get("document_path") or ""): item
                for item in result.get("documents") or [] if isinstance(item, dict)
            }
            for item in result.get("evidence") or []:
                if not isinstance(item, dict) or not item.get("source"):
                    continue
                document_path = str(item.get("document_path") or item.get("document_id") or "")
                document = documents.get(document_path, {})
                stable = "|".join(str(value or "") for value in (
                    item.get("source"), item.get("chunk_id"), item.get("content_sha256"),
                ))
                state.citation_candidates.append({
                    "citation_id": hashlib.sha256(stable.encode("utf-8")).hexdigest()[:16],
                    "title": str(item.get("title") or document_path or item.get("source")),
                    "url": str(item["source"]), "excerpt": str(item.get("content") or ""),
                    "relation": str(item.get("relation") or "supports_claim"),
                    "knowledge_base_id": str(item.get("knowledge_id") or document.get("knowledge_base_id") or ""),
                    "revision": item.get("knowledge_base_revision") or document.get("knowledge_base_revision"),
                    "document_path": document_path,
                    "corpus_complete": document.get("corpus_complete") is True,
                })
        if kind == "tool.result" and payload.get("name") in {"web_search", "web_fetch"}:
            existing = {str(item.get("url") or "") for item in state.citation_candidates}
            for item in _web_citation_candidates(result):
                if item["url"] in existing:
                    continue
                stable = f"web|{item['url']}|{item['title']}"
                state.citation_candidates.append({
                    "citation_id": hashlib.sha256(stable.encode("utf-8")).hexdigest()[:16],
                    "title": item["title"],
                    "url": item["url"],
                    "relation": "supports_claim",
                })
                existing.add(item["url"])
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
