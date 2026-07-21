"""Bounded, replay-safe Codex notification to Runtime Event mapping."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Mapping

from drsai.backend.agent_runtime import AgentExecutionServices, RuntimeRunContext


_SECRET_KEY = re.compile(r"(?:token|secret|password|cookie|authorization|api.?key|credential)", re.I)
_ITEM_TYPES = {
    "agentMessage": "agent.item.message",
    "reasoning": "agent.item.reasoning",
    "commandExecution": "agent.item.command",
    "fileChange": "agent.item.file_change",
    "mcpToolCall": "agent.item.tool",
    "dynamicToolCall": "agent.item.tool",
    "webSearch": "agent.item.tool",
}


@dataclass
class _DeltaState:
    thread_id: str = "unknown-thread"
    content: str = ""
    received_bytes: int = 0
    truncated_prefix_bytes: int = 0


class CodexEventMapper:
    def __init__(self, *, batch_bytes: int = 4096, max_buffer_bytes: int = 64 * 1024, max_field_chars: int = 8000):
        self.batch_bytes = max(256, batch_bytes)
        self.max_buffer_bytes = max(self.batch_bytes, max_buffer_bytes)
        self.max_field_chars = max(256, max_field_chars)
        self._deltas: dict[tuple[str, str, str], _DeltaState] = {}

    def handle(
        self, context: RuntimeRunContext, services: AgentExecutionServices, message: Mapping[str, Any],
    ) -> None:
        method = str(message.get("method") or "")
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        thread_id, turn_id, item_id = self._identities(params)
        if method == "item/agentMessage/delta" and isinstance(params.get("delta"), str):
            self._append_delta(context, services, thread_id, turn_id, item_id, params["delta"])
            return
        if method in {"item/started", "item/completed"}:
            item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
            item_type = str(item.get("type") or params.get("type") or "unknown")
            event_type = _ITEM_TYPES.get(item_type, "agent.item.unknown")
            phase = "started" if method.endswith("started") else "completed"
            services.emit_backend(
                context, event_type,
                {"backend": "codex", "phase": phase,
                 "backend_metadata": {"thread_id": thread_id, "turn_id": turn_id, "item_id": item_id,
                                      "item_type": item_type},
                 "item": self._safe(item)},
                f"codex:{turn_id}:{item_id}:{method}",
            )
            return
        if method == "turn/started":
            services.emit_backend(
                context, "agent.started", {"backend": "codex", "backend_metadata": {
                    "thread_id": thread_id, "turn_id": turn_id}},
                f"codex:{turn_id}:turn/started",
            )
            return
        if method == "turn/completed":
            self.flush_run(context, services)
            return
        if method and method not in {"thread/status/changed", "thread/tokenUsage/updated", "account/rateLimits/updated"}:
            summary = self._safe(params)
            encoded = json.dumps(summary, sort_keys=True, separators=(",", ":")).encode()
            digest = hashlib.sha256(encoded).hexdigest()
            services.emit_backend(
                context, "agent.item.unknown",
                {"backend": "codex", "method": method, "summary": summary,
                 "backend_metadata": {"thread_id": thread_id, "turn_id": turn_id, "item_id": item_id}},
                f"codex:{turn_id}:{item_id}:{method}:{digest}",
            )

    def flush_run(self, context: RuntimeRunContext, services: AgentExecutionServices) -> None:
        for key in [key for key in self._deltas if key[0] == context.run_id]:
            self._flush(context, services, key)

    def _append_delta(
        self, context: RuntimeRunContext, services: AgentExecutionServices,
        thread_id: str, turn_id: str, item_id: str, delta: str,
    ) -> None:
        key = (context.run_id, turn_id, item_id)
        state = self._deltas.setdefault(key, _DeltaState(thread_id=thread_id))
        state.content += delta
        state.received_bytes += len(delta.encode("utf-8"))
        encoded = state.content.encode("utf-8")
        if len(encoded) > self.max_buffer_bytes:
            excess = len(encoded) - self.max_buffer_bytes
            retained = encoded[excess:]
            while retained and retained[0] & 0xC0 == 0x80:
                retained = retained[1:]
                excess += 1
            state.content = retained.decode("utf-8", errors="replace")
            state.truncated_prefix_bytes += excess
        if len(state.content.encode("utf-8")) >= self.batch_bytes:
            self._flush(context, services, key)

    def _flush(
        self, context: RuntimeRunContext, services: AgentExecutionServices,
        key: tuple[str, str, str],
    ) -> None:
        state = self._deltas.get(key)
        if state is None or not state.content:
            return
        _, turn_id, item_id = key
        content = state.content
        digest = hashlib.sha256(content.encode()).hexdigest()
        services.emit_backend(
            context, "agent.message.delta",
            {"backend": "codex", "content": content,
             "truncated": state.truncated_prefix_bytes > 0,
             "truncated_prefix_bytes": state.truncated_prefix_bytes,
             "backend_metadata": {"thread_id": state.thread_id, "turn_id": turn_id, "item_id": item_id,
                                  "received_bytes": state.received_bytes}},
            f"codex:{turn_id}:{item_id}:delta:{state.received_bytes}:{digest}",
        )
        state.content = ""
        state.truncated_prefix_bytes = 0

    @staticmethod
    def _identities(params: Mapping[str, Any]) -> tuple[str, str, str]:
        thread = params.get("thread") if isinstance(params.get("thread"), Mapping) else {}
        turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
        item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
        return (
            str(params.get("threadId") or thread.get("id") or "unknown-thread"),
            str(params.get("turnId") or turn.get("id") or "unknown-turn"),
            str(params.get("itemId") or item.get("id") or "unknown-item"),
        )

    def _safe(self, value: Any, key: str = "") -> Any:
        if _SECRET_KEY.search(key):
            return "[REDACTED]"
        if isinstance(value, Mapping):
            return {str(child_key): self._safe(child, str(child_key)) for child_key, child in value.items()}
        if isinstance(value, list):
            return [self._safe(child) for child in value[:100]]
        if isinstance(value, str):
            return value if len(value) <= self.max_field_chars else value[:self.max_field_chars] + "…[truncated]"
        return value if isinstance(value, (int, float, bool, type(None))) else str(type(value).__name__)
