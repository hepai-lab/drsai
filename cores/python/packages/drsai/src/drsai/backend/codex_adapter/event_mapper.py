"""Bounded, replay-safe Codex notification to Runtime Event mapping."""

from __future__ import annotations

import hashlib
import re
import time
from collections import Counter
from dataclasses import dataclass, replace
from typing import Any, Callable, Mapping

from drsai.backend.codex_adapter.native_decoder import CodexNativeEventDecoder
from drsai.backend.codex_adapter.version import CODEX_ADAPTER_MAPPING_VERSION
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext
from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
)


_SECRET_KEY = re.compile(r"(?:token|secret|password|cookie|authorization|api.?key|credential)", re.I)


@dataclass
class _DeltaState:
    thread_id: str = "unknown-thread"
    content: str = ""
    received_bytes: int = 0
    truncated_prefix_bytes: int = 0
    first_buffered_at: float | None = None


class CodexEventMapper:
    def __init__(
        self,
        *,
        batch_bytes: int = 4096,
        max_buffer_bytes: int = 64 * 1024,
        max_field_chars: int = 8000,
        max_wait_ms: int = 40,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.batch_bytes = max(256, batch_bytes)
        self.max_buffer_bytes = max(self.batch_bytes, max_buffer_bytes)
        self.max_field_chars = max(256, max_field_chars)
        self.max_wait_ms = max(1, max_wait_ms)
        self._clock = clock
        self._deltas: dict[tuple[str, str, str], _DeltaState] = {}
        self._message_seen_runs: set[str] = set()
        self._received = 0
        self._emitted = 0
        self._ignored_user_echo = 0
        self._ignored_run_lifecycle = 0
        self._flushes = 0
        self._flush_delay_total_ms = 0.0
        self._flush_delay_max_ms = 0.0
        self._mapping_errors: Counter[str] = Counter()
        self._coverage: Counter[str] = Counter()
        self.native_decoder = CodexNativeEventDecoder(max_field_chars=self.max_field_chars)

    def handle(
        self, context: RuntimeRunContext, services: AgentExecutionServices, message: Mapping[str, Any],
    ) -> None:
        method = str(message.get("method") or "")
        self._received += 1
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        thread_id, turn_id, item_id = self._identities(params)
        self.flush_due(context, services)
        # RuntimeAgentService is the sole public Run lifecycle producer. Codex
        # Turn lifecycle is retained in the private binding store, but mapping
        # it again would duplicate run.started/terminal OAEP events.
        if method == "turn/started":
            self.native_decoder.decode(message)  # resets deterministic replay ordinals
            self._ignored_run_lifecycle += 1
            return
        if method == "item/agentMessage/delta" and isinstance(params.get("delta"), str):
            self._message_seen_runs.add(context.run_id)
            self._append_delta(context, services, thread_id, turn_id, item_id, params["delta"])
            return
        if method in {"item/started", "item/completed"}:
            item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
            native_type = str(item.get("type") or "")
            # Runtime already created the authoritative current-user Item from
            # source_message_id. Codex's live echo only confirms the private
            # Backend binding and must not create a second public OAEP Item.
            if native_type == "userMessage":
                self._ignored_user_echo += 1
                return
            if method == "item/completed" and native_type == "agentMessage":
                self.flush_item(context, services, turn_id, str(item.get("id") or item_id))
        if method == "turn/completed":
            self.flush_run(context, services)
            if context.run_id not in self._message_seen_runs:
                turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
                items = turn.get("items") if isinstance(turn.get("items"), list) else []
                for item in items:
                    if not isinstance(item, Mapping) or str(item.get("type") or "") != "agentMessage":
                        continue
                    fallback = self.native_decoder.decode({
                        "method": "item/completed",
                        "params": {"threadId": thread_id, "turnId": turn_id, "item": item},
                    })
                    if fallback is not None:
                        self._emit(context, services, fallback)
                        self._message_seen_runs.add(context.run_id)
            self._message_seen_runs.discard(context.run_id)
            return
        elif method == "item/completed":
            item = params.get("item") if isinstance(params.get("item"), Mapping) else {}
            if str(item.get("type") or "") == "agentMessage":
                self._message_seen_runs.add(context.run_id)
        normalized = self.native_decoder.decode(message)
        if normalized is not None:
            self._emit(context, services, normalized)

    def flush_run(self, context: RuntimeRunContext, services: AgentExecutionServices) -> None:
        for key in [key for key in self._deltas if key[0] == context.run_id]:
            self._flush(context, services, key)

    def flush_item(
        self,
        context: RuntimeRunContext,
        services: AgentExecutionServices,
        turn_id: str,
        item_id: str,
    ) -> None:
        self._flush(context, services, (context.run_id, turn_id, item_id))

    def flush_due(self, context: RuntimeRunContext, services: AgentExecutionServices) -> None:
        now = self._clock()
        maximum_age = self.max_wait_ms / 1000
        for key, state in list(self._deltas.items()):
            if key[0] != context.run_id or state.first_buffered_at is None:
                continue
            if now - state.first_buffered_at >= maximum_age:
                self._flush(context, services, key)

    def _append_delta(
        self, context: RuntimeRunContext, services: AgentExecutionServices,
        thread_id: str, turn_id: str, item_id: str, delta: str,
    ) -> None:
        key = (context.run_id, turn_id, item_id)
        state = self._deltas.setdefault(key, _DeltaState(thread_id=thread_id))
        if not state.content:
            state.first_buffered_at = self._clock()
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
        buffered_at = state.first_buffered_at
        self._emit(context, services, NormalizedAgentEvent(
            kind=NormalizedEventKind.ITEM_DELTA,
            backend="codex",
            binding=BackendBinding(state.thread_id, turn_id, item_id),
            item_type=NormalizedItemType.MESSAGE,
            delta_kind=NormalizedDeltaKind.MESSAGE_TEXT_APPEND,
            phase="final",
            dedupe_key=f"codex:{turn_id}:{item_id}:delta:{state.received_bytes}:{digest}",
            payload={
                "text": content,
                "received_bytes": state.received_bytes,
                "truncated": state.truncated_prefix_bytes > 0,
                "truncated_prefix_bytes": state.truncated_prefix_bytes,
            },
        ))
        self._flushes += 1
        if buffered_at is not None:
            delay_ms = max(0.0, (self._clock() - buffered_at) * 1000)
            self._flush_delay_total_ms += delay_ms
            self._flush_delay_max_ms = max(self._flush_delay_max_ms, delay_ms)
        state.content = ""
        state.truncated_prefix_bytes = 0
        state.first_buffered_at = None

    def record_mapping_error(self, error: BaseException) -> None:
        """Record only a bounded exception class, never native payload content."""
        self._mapping_errors[type(error).__name__[:120]] += 1

    def diagnostics_snapshot(self) -> dict[str, Any]:
        """Return bounded, content-free OAEP adapter coverage and latency metrics."""
        average = self._flush_delay_total_ms / self._flushes if self._flushes else 0.0
        return {
            "received_notifications": self._received,
            "emitted_normalized_events": self._emitted,
            "ignored_user_echoes": self._ignored_user_echo,
            "ignored_run_lifecycle": self._ignored_run_lifecycle,
            "delta_flushes": self._flushes,
            "delta_flush_delay_ms": {
                "average": round(average, 3),
                "maximum": round(self._flush_delay_max_ms, 3),
            },
            "event_coverage": dict(sorted(self._coverage.items())),
            "mapping_errors": dict(sorted(self._mapping_errors.items())),
            "content_redacted": True,
        }

    def _emit(
        self,
        context: RuntimeRunContext,
        services: AgentExecutionServices,
        event: NormalizedAgentEvent,
    ) -> None:
        event = replace(event, payload={
            **dict(event.payload),
            "adapter": "codex-adapter",
            "mapping_version": CODEX_ADAPTER_MAPPING_VERSION,
        })
        services.emit_normalized(context, event)
        self._emitted += 1
        self._coverage[event.kind.value] += 1

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
