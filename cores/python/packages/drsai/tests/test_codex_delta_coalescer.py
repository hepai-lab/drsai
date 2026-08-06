from __future__ import annotations

from pathlib import Path

from drsai.backend.codex_adapter.delta_coalescer import NormalizedDeltaCoalescer
from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
)


def _delta(text: str, *, ordinal: int = 1, item_type: NormalizedItemType = NormalizedItemType.MESSAGE):
    delta_kind = {
        NormalizedItemType.MESSAGE: NormalizedDeltaKind.MESSAGE_TEXT_APPEND,
        NormalizedItemType.REASONING: NormalizedDeltaKind.REASONING_TEXT_APPEND,
        NormalizedItemType.PLAN: NormalizedDeltaKind.PLAN_TEXT_APPEND,
        NormalizedItemType.COMMAND_EXECUTION: NormalizedDeltaKind.COMMAND_OUTPUT_APPEND,
    }[item_type]
    return NormalizedAgentEvent(
        kind=NormalizedEventKind.ITEM_DELTA,
        backend="fixture-backend",
        binding=BackendBinding("backend-session", "backend-run", "backend-item"),
        dedupe_key=f"fixture:{ordinal}",
        item_type=item_type,
        delta_kind=delta_kind,
        phase="final" if item_type is NormalizedItemType.MESSAGE else None,
        payload={"text": text, "ordinal": ordinal},
    )


def test_coalescer_is_backend_neutral_and_mapper_has_no_private_delta_shortcut() -> None:
    root = Path(__file__).parents[1] / "src/drsai/backend/codex_adapter"
    mapper = (root / "event_mapper.py").read_text(encoding="utf-8")
    coalescer = (root / "delta_coalescer.py").read_text(encoding="utf-8")
    assert "item/agentMessage/delta" not in mapper
    assert "item/agentMessage/delta" not in coalescer
    assert "Codex" not in coalescer


def test_message_delta_flushes_by_size_and_time_with_exact_text() -> None:
    now = [10.0]
    coalescer = NormalizedDeltaCoalescer(batch_bytes=256, max_buffer_bytes=1024, max_wait_ms=40, clock=lambda: now[0])
    assert coalescer.push("runtime-run", _delta("hello", ordinal=1)) == []
    assert coalescer.push("runtime-run", _delta(" world", ordinal=2)) == []
    now[0] += 0.041
    flushed = coalescer.flush_due("runtime-run")
    assert [event.payload["text"] for event in flushed] == ["hello world"]
    assert flushed[0].phase == "final"
    assert flushed[0].payload["received_bytes"] == len("hello world".encode())


def test_structured_deltas_are_low_latency_and_keep_normalized_semantics() -> None:
    coalescer = NormalizedDeltaCoalescer()
    for item_type in (NormalizedItemType.REASONING, NormalizedItemType.PLAN, NormalizedItemType.COMMAND_EXECUTION):
        events = coalescer.push("runtime-run", _delta("part", item_type=item_type))
        assert len(events) == 1
        assert events[0].item_type is item_type
        assert events[0].payload["text"] == "part"


def test_unicode_buffer_is_bounded_and_run_flush_or_discard_cleans_state() -> None:
    coalescer = NormalizedDeltaCoalescer(batch_bytes=4096, max_buffer_bytes=4096)
    for ordinal in range(100):
        coalescer.push("runtime-run", _delta("数" * 100, ordinal=ordinal))
    flushed = coalescer.flush_run("runtime-run")
    assert len(flushed) == 1
    assert len(flushed[0].payload["text"].encode("utf-8")) <= 4096
    assert flushed[0].payload["truncated"] is True
    assert coalescer.diagnostics()["active_buffers"] == 0
    coalescer.push("cancelled-run", _delta("pending"))
    coalescer.discard_run("cancelled-run")
    assert coalescer.diagnostics()["active_buffers"] == 0
