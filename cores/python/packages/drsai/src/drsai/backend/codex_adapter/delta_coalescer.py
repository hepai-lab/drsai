"""Backend-neutral, bounded coalescing for normalized Agent deltas."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, replace
from typing import Callable

from drsai.backend.runtime.normalized_events import NormalizedAgentEvent, NormalizedEventKind, NormalizedItemType


@dataclass(slots=True)
class _DeltaBuffer:
    template: NormalizedAgentEvent
    content: str = ""
    received_bytes: int = 0
    truncated_prefix_bytes: int = 0
    first_buffered_at: float | None = None


class NormalizedDeltaCoalescer:
    """Coalesce only normalized semantics; no Backend method names are known here."""

    def __init__(
        self,
        *,
        batch_bytes: int = 4096,
        max_buffer_bytes: int = 64 * 1024,
        max_wait_ms: int = 40,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.batch_bytes = max(256, batch_bytes)
        self.max_buffer_bytes = max(self.batch_bytes, max_buffer_bytes)
        self.max_wait_ms = max(1, max_wait_ms)
        self.clock = clock
        self._buffers: dict[tuple[str, str, str, str, str], _DeltaBuffer] = {}
        self.flushes = 0
        self.flush_delay_total_ms = 0.0
        self.flush_delay_max_ms = 0.0

    @staticmethod
    def _key(runtime_run_id: str, event: NormalizedAgentEvent) -> tuple[str, str, str, str, str]:
        return (
            runtime_run_id,
            str(event.binding.run_id or ""),
            str(event.binding.item_id or ""),
            str(event.delta_kind.value if event.delta_kind else ""),
            str(event.segment_id or ""),
        )

    def push(self, runtime_run_id: str, event: NormalizedAgentEvent) -> list[NormalizedAgentEvent]:
        if event.kind is not NormalizedEventKind.ITEM_DELTA:
            raise ValueError("NormalizedDeltaCoalescer accepts only item.delta events")
        key = self._key(runtime_run_id, event)
        state = self._buffers.setdefault(key, _DeltaBuffer(template=event))
        state.template = event
        text = str(event.payload.get("text") or "")
        if not state.content:
            state.first_buffered_at = self.clock()
        state.content += text
        state.received_bytes += len(text.encode("utf-8"))
        encoded = state.content.encode("utf-8")
        if len(encoded) > self.max_buffer_bytes:
            excess = len(encoded) - self.max_buffer_bytes
            retained = encoded[excess:]
            while retained and retained[0] & 0xC0 == 0x80:
                retained = retained[1:]
                excess += 1
            state.content = retained.decode("utf-8", errors="replace")
            state.truncated_prefix_bytes += excess
        # Message tokens are the high-frequency path that benefits from a
        # short frame-sized batch. Structured progress/output deltas remain
        # low-latency while still passing through this Backend-neutral owner.
        immediate = event.item_type is not NormalizedItemType.MESSAGE
        return self._flush_key(key) if immediate or len(state.content.encode("utf-8")) >= self.batch_bytes else []

    def flush_due(self, runtime_run_id: str) -> list[NormalizedAgentEvent]:
        events: list[NormalizedAgentEvent] = []
        maximum_age = self.max_wait_ms / 1000
        for key, state in list(self._buffers.items()):
            if key[0] == runtime_run_id and state.first_buffered_at is not None:
                if self.clock() - state.first_buffered_at >= maximum_age:
                    events.extend(self._flush_key(key))
        return events

    def flush_item(self, runtime_run_id: str, backend_run_id: str, backend_item_id: str) -> list[NormalizedAgentEvent]:
        events: list[NormalizedAgentEvent] = []
        for key in [key for key in self._buffers if key[:3] == (runtime_run_id, backend_run_id, backend_item_id)]:
            events.extend(self._flush_key(key))
            self._buffers.pop(key, None)
        return events

    def flush_run(self, runtime_run_id: str) -> list[NormalizedAgentEvent]:
        events: list[NormalizedAgentEvent] = []
        for key in [key for key in self._buffers if key[0] == runtime_run_id]:
            events.extend(self._flush_key(key))
            self._buffers.pop(key, None)
        return events

    def discard_run(self, runtime_run_id: str) -> None:
        for key in [key for key in self._buffers if key[0] == runtime_run_id]:
            self._buffers.pop(key, None)

    def _flush_key(self, key: tuple[str, str, str, str, str]) -> list[NormalizedAgentEvent]:
        state = self._buffers.get(key)
        if state is None or not state.content:
            return []
        content = state.content
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        buffered_at = state.first_buffered_at
        event = replace(
            state.template,
            dedupe_key=f"{state.template.dedupe_key}:batch:{state.received_bytes}:{digest}",
            payload={
                **dict(state.template.payload),
                "text": content,
                "received_bytes": state.received_bytes,
                "truncated": state.truncated_prefix_bytes > 0,
                "truncated_prefix_bytes": state.truncated_prefix_bytes,
            },
        )
        self.flushes += 1
        if buffered_at is not None:
            delay_ms = max(0.0, (self.clock() - buffered_at) * 1000)
            self.flush_delay_total_ms += delay_ms
            self.flush_delay_max_ms = max(self.flush_delay_max_ms, delay_ms)
        state.content = ""
        state.truncated_prefix_bytes = 0
        state.first_buffered_at = None
        return [event]

    def diagnostics(self) -> dict[str, object]:
        average = self.flush_delay_total_ms / self.flushes if self.flushes else 0.0
        return {
            "flushes": self.flushes,
            "flush_delay_ms": {"average": round(average, 3), "maximum": round(self.flush_delay_max_ms, 3)},
            "active_buffers": len(self._buffers),
        }
