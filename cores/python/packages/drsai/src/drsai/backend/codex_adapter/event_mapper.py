"""Bounded, replay-safe Codex notification to Runtime Event mapping."""

from __future__ import annotations

import time
from collections import Counter
from dataclasses import dataclass, replace
from typing import Any, Callable, Mapping

from drsai.backend.codex_adapter.native_decoder import CodexNativeEventDecoder
from drsai.backend.codex_adapter.diagnostics import CodexDiagnosticSink
from drsai.backend.codex_adapter.delta_coalescer import NormalizedDeltaCoalescer
from drsai.backend.codex_adapter.stable_contract import (
    NotificationClass,
    SemanticDisposition,
    classify_notification,
    semantic_disposition,
)
from drsai.backend.codex_adapter.version import CODEX_ADAPTER_MAPPING_VERSION
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext
from drsai.backend.runtime.normalized_events import (
    NormalizedAgentEvent,
    NormalizedEventKind,
    NormalizedItemType,
    NormalizedReasoningVisibility,
)


@dataclass(frozen=True, slots=True)
class DeltaFlushHint:
    backend_run_id: str
    backend_item_id: str


class CodexEventMapper:
    def __init__(
        self,
        *,
        batch_bytes: int = 4096,
        max_buffer_bytes: int = 64 * 1024,
        max_field_chars: int = 8000,
        max_wait_ms: int = 40,
        clock: Callable[[], float] = time.monotonic,
        diagnostic_sink: CodexDiagnosticSink | None = None,
    ):
        self.batch_bytes = max(256, batch_bytes)
        self.max_buffer_bytes = max(self.batch_bytes, max_buffer_bytes)
        self.max_field_chars = max(256, max_field_chars)
        self.max_wait_ms = max(1, max_wait_ms)
        self._clock = clock
        self.coalescer = NormalizedDeltaCoalescer(
            batch_bytes=self.batch_bytes,
            max_buffer_bytes=self.max_buffer_bytes,
            max_wait_ms=self.max_wait_ms,
            clock=self._clock,
        )
        # Track assistant messages by stable backend item id and public phase.
        # A run-level boolean is insufficient: a commentary message must not
        # suppress recovery of a missing final answer at turn completion.
        self._message_items_by_run: dict[str, dict[str, str]] = {}
        self._received = 0
        self._emitted = 0
        self._ignored_user_echo = 0
        self._ignored_run_lifecycle = 0
        self._mapping_errors: Counter[str] = Counter()
        self._coverage: Counter[str] = Counter()
        self.native_decoder = CodexNativeEventDecoder(max_field_chars=self.max_field_chars)
        self.diagnostic_sink = diagnostic_sink or CodexDiagnosticSink()

    def handle(
        self, context: RuntimeRunContext, services: AgentExecutionServices, message: Mapping[str, Any],
    ) -> DeltaFlushHint | None:
        method = str(message.get("method") or "")
        self._received += 1
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        self.flush_due(context, services)
        classification = classify_notification(method)
        disposition = semantic_disposition(method) if classification is NotificationClass.SEMANTIC else None
        if disposition is SemanticDisposition.REVIEWED_IGNORED:
            self._coverage["semantic.reviewed_ignored"] += 1
            return None
        if disposition is SemanticDisposition.RELEASE_BLOCKED:
            self.diagnostic_sink.record("semantic_release_blocked", method, params)
            return None
        normalized = self.native_decoder.decode(message)
        if classification in {NotificationClass.DIAGNOSTIC, NotificationClass.UNKNOWN}:
            self.diagnostic_sink.record(classification.value, method, params)
            return None
        if classification is NotificationClass.KNOWN_IGNORED:
            self._coverage["known_ignored"] += 1
            return None
        if (
            normalized is not None
            and normalized.item_type is NormalizedItemType.REASONING
            and normalized.reasoning_visibility is not NormalizedReasoningVisibility.USER
        ):
            # Record only the method identity. Native reasoning text must not
            # enter OAEP persistence, UI/export payloads, or diagnostic logs.
            self._coverage[f"reasoning.{normalized.reasoning_visibility.value}"] += 1
            self.diagnostic_sink.record("reasoning_not_user_visible", method, {})
            return None
        # RuntimeAgentService is the sole public Run lifecycle producer. Codex
        # Turn lifecycle is retained in the private binding store, but mapping
        # it again would duplicate run.started/terminal OAEP events.
        if normalized is not None and normalized.kind is NormalizedEventKind.RUN_STARTED:
            self.coalescer.discard_run(context.run_id)
            self._message_items_by_run.pop(context.run_id, None)
            self._ignored_run_lifecycle += 1
            return None
        if normalized is not None and normalized.item_type is NormalizedItemType.MESSAGE:
            if str(normalized.payload.get("role") or "") == "user":
                self._ignored_user_echo += 1
                return None
            item_id = str(normalized.binding.item_id or "")
            if item_id:
                phase = str(normalized.phase or normalized.payload.get("phase") or "unknown")
                items = self._message_items_by_run.setdefault(context.run_id, {})
                previous = items.get(item_id)
                # Once an item is known to be final, a phase-less delta cannot
                # downgrade it back to unknown.
                items[item_id] = previous if previous == "final" and phase == "unknown" else phase
        if normalized is not None and normalized.kind is NormalizedEventKind.ITEM_DELTA:
            for event in self.coalescer.push(context.run_id, normalized):
                self._emit(context, services, event)
            return DeltaFlushHint(str(normalized.binding.run_id or ""), str(normalized.binding.item_id or ""))
        if normalized is not None and normalized.kind in {
            NormalizedEventKind.ITEM_COMPLETED,
            NormalizedEventKind.ITEM_FAILED,
            NormalizedEventKind.ITEM_CANCELLED,
        }:
            self.flush_item(
                context,
                services,
                str(normalized.binding.run_id or ""),
                str(normalized.binding.item_id or ""),
            )
        if normalized is not None and normalized.kind in {
            NormalizedEventKind.RUN_COMPLETED,
            NormalizedEventKind.RUN_FAILED,
            NormalizedEventKind.RUN_CANCELLED,
        }:
            self.flush_run(context, services)
            seen = self._message_items_by_run.get(context.run_id, {})
            for fallback in self.native_decoder.terminal_agent_messages(message):
                fallback_item_id = str(fallback.binding.item_id or "")
                # Terminal payloads can contain commentary and final messages.
                # Recover only public final answers, and never append a second
                # copy of an item already emitted by the live stream.
                if fallback.phase != "final" or fallback_item_id in seen:
                    continue
                self._emit(context, services, fallback)
                seen[fallback_item_id] = "final"
            self._message_items_by_run.pop(context.run_id, None)
            self._ignored_run_lifecycle += 1
            return None
        if normalized is not None:
            self._emit(context, services, normalized)
        elif classification is NotificationClass.FATAL:
            self.diagnostic_sink.record("fatal_without_turn", method, params)
        elif classification is NotificationClass.SEMANTIC:
            identity = self.native_decoder.unmapped_identity(message)
            label = "unknown_item" if identity != method else "semantic_unmapped"
            self.diagnostic_sink.record(label, identity, params)
        return None

    def flush_run(self, context: RuntimeRunContext, services: AgentExecutionServices) -> None:
        for event in self.coalescer.flush_run(context.run_id):
            self._emit(context, services, event)

    def flush_item(
        self,
        context: RuntimeRunContext,
        services: AgentExecutionServices,
        turn_id: str,
        item_id: str,
    ) -> None:
        for event in self.coalescer.flush_item(context.run_id, turn_id, item_id):
            self._emit(context, services, event)

    def flush_due(self, context: RuntimeRunContext, services: AgentExecutionServices) -> None:
        for event in self.coalescer.flush_due(context.run_id):
            self._emit(context, services, event)

    def discard_run(self, run_id: str) -> None:
        self.coalescer.discard_run(run_id)
        self._message_items_by_run.pop(run_id, None)

    def finalize_run(
        self,
        context: RuntimeRunContext,
        services: AgentExecutionServices,
        *,
        backend_turn_id: str,
        flush_policy: str,
    ) -> None:
        if flush_policy == "flush":
            self.flush_run(context, services)
        elif flush_policy == "discard":
            self.coalescer.discard_run(context.run_id)
        else:
            raise ValueError(f"Unsupported Codex finalizer flush policy: {flush_policy}")
        self._message_items_by_run.pop(context.run_id, None)
        self.native_decoder.discard_turn(backend_turn_id)

    def record_mapping_error(self, error: BaseException) -> None:
        """Record only a bounded exception class, never native payload content."""
        self._mapping_errors[type(error).__name__[:120]] += 1

    def diagnostics_snapshot(self) -> dict[str, Any]:
        """Return bounded, content-free OAEP adapter coverage and latency metrics."""
        delta = self.coalescer.diagnostics()
        return {
            "received_notifications": self._received,
            "emitted_normalized_events": self._emitted,
            "ignored_user_echoes": self._ignored_user_echo,
            "ignored_run_lifecycle": self._ignored_run_lifecycle,
            "delta_flushes": delta["flushes"],
            "delta_flush_delay_ms": delta["flush_delay_ms"],
            "event_coverage": dict(sorted(self._coverage.items())),
            "mapping_errors": dict(sorted(self._mapping_errors.items())),
            "active_delta_buffers": delta["active_buffers"],
            "active_message_runs": len(self._message_items_by_run),
            "active_message_items": sum(len(items) for items in self._message_items_by_run.values()),
            "decoder_state": self.native_decoder.state_diagnostics(),
            "protocol_diagnostics": self.diagnostic_sink.snapshot(),
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
