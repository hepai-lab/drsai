from __future__ import annotations

import pytest

from drsai.backend.runtime.normalized_events import (
    BackendBinding,
    NormalizedAgentEvent,
    NormalizedDeltaKind,
    NormalizedEventKind,
    NormalizedItemType,
)
from drsai.backend.runtime.normalized_writer import normalized_canonical_item, normalized_runtime_write
from drsai.backend.runtime.oaep import reduce_oaep_events


@pytest.mark.parametrize(("item_type", "delta_kind", "stream", "segment_id"), [
    (NormalizedItemType.MESSAGE, NormalizedDeltaKind.MESSAGE_TEXT_APPEND, None, None),
    (NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_SEGMENT_ADDED, None, "summary-2"),
    (NormalizedItemType.REASONING, NormalizedDeltaKind.REASONING_TEXT_APPEND, None, "summary-2"),
    (NormalizedItemType.PLAN, NormalizedDeltaKind.PLAN_TEXT_APPEND, None, None),
    (NormalizedItemType.COMMAND_EXECUTION, NormalizedDeltaKind.COMMAND_OUTPUT_APPEND, "stderr", None),
    (NormalizedItemType.TOOL_CALL, NormalizedDeltaKind.TOOL_OUTPUT_APPEND, None, None),
    (NormalizedItemType.SUBTASK, NormalizedDeltaKind.SUBTASK_SUMMARY_APPEND, None, None),
])
def test_all_delta_metadata_survives_normalized_writer(
    item_type: NormalizedItemType,
    delta_kind: NormalizedDeltaKind,
    stream: str | None,
    segment_id: str | None,
) -> None:
    event = NormalizedAgentEvent(
        kind=NormalizedEventKind.ITEM_DELTA,
        backend="fixture",
        binding=BackendBinding("session", "run", f"item-{delta_kind.value}"),
        item_type=item_type,
        delta_kind=delta_kind,
        stream=stream,
        segment_id=segment_id,
        dedupe_key=f"delta-{delta_kind.value}",
        payload={"text": "chunk", "ordinal": 7, "received_bytes": 11, "truncated": False},
    )
    _, data, _ = normalized_runtime_write(event)
    assert data["delta_kind"] == delta_kind.value
    assert data["ordinal"] == 7
    assert data["received_bytes"] == 11
    assert data["truncated"] is False
    assert data.get("stream") == stream
    assert data.get("segment_id") == segment_id


def test_reasoning_segment_metadata_survives_normalized_writer() -> None:
    event = NormalizedAgentEvent(
        kind=NormalizedEventKind.ITEM_DELTA,
        backend="codex",
        binding=BackendBinding("session", "run", "reasoning"),
        item_type=NormalizedItemType.REASONING,
        delta_kind=NormalizedDeltaKind.REASONING_TEXT_APPEND,
        segment_id="summary-3",
        dedupe_key="reasoning-1",
        payload={"text": "third", "ordinal": 1, "segment_id": "summary-3"},
    )
    _, _, canonical, _ = normalized_canonical_item(
        event,
        {"segments": [{"id": "summary-1", "text": "first"}]},
    )
    assert canonical["segments"] == [
        {"id": "summary-1", "text": "first"},
        {"id": "summary-3", "text": "third", "kind": "summary",
         "visibility": "user", "source": "backend"},
    ]
    event_type, data, _ = normalized_runtime_write(event)
    assert event_type == "oaep.item.reasoning.delta"
    assert data["segment_id"] == "summary-3"
    assert data["delta_kind"] == "reasoning.text.append"


def test_oaep_reducer_keeps_reasoning_segments_and_tool_result_separate() -> None:
    source = {"backend": "codex"}
    events = [
        {"sequence": 1, "timestamp": "2026-08-04T00:00:00Z", "data": {"session": {"id": "session"}}},
        {"sequence": 2, "timestamp": "2026-08-04T00:00:01Z", "item_id": "reasoning", "data": {"item": {
            "id": "reasoning", "run_id": "run", "type": "reasoning", "status": "running", "content": {"segments": []},
            "source": source, "sequence": 2, "created_at": "2026-08-04T00:00:01Z", "updated_at": "2026-08-04T00:00:01Z",
        }}},
        {"sequence": 3, "timestamp": "2026-08-04T00:00:02Z", "item_id": "reasoning", "data": {
            "delta": {"kind": "reasoning.segment.added", "segment_id": "summary-2", "text": ""},
        }},
        {"sequence": 4, "timestamp": "2026-08-04T00:00:03Z", "item_id": "reasoning", "data": {
            "delta": {"kind": "reasoning.text.append", "segment_id": "summary-2", "text": "details"},
        }},
        {"sequence": 5, "timestamp": "2026-08-04T00:00:04Z", "item_id": "tool", "data": {"item": {
            "id": "tool", "run_id": "run", "type": "tool_call", "status": "running", "content": {"result": ""},
            "source": source, "sequence": 5, "created_at": "2026-08-04T00:00:04Z", "updated_at": "2026-08-04T00:00:04Z",
        }}},
        {"sequence": 6, "timestamp": "2026-08-04T00:00:05Z", "item_id": "tool", "data": {
            "delta": {"kind": "tool.output.append", "text": "result"},
        }},
    ]
    snapshot = reduce_oaep_events(events)
    items = {item["id"]: item for item in snapshot["items"]}
    assert items["reasoning"]["content"]["segments"] == [{
        "id": "summary-2", "text": "details", "kind": "summary",
        "visibility": "user", "source": "backend",
    }]
    assert items["tool"]["content"]["result"] == "result"
    assert "output" not in items["tool"]["content"]


@pytest.mark.parametrize(("kind", "field"), [
    ("message.text.append", "text"),
    ("reasoning.segment.added", "segments"),
    ("reasoning.text.append", "segments"),
    ("plan.text.append", "text"),
    ("command.output.append", "output"),
    ("tool.output.append", "result"),
    ("subtask.summary.append", "summary"),
])
def test_all_delta_families_recover_before_started(kind: str, field: str) -> None:
    delta = {"kind": kind, "text": "live"}
    if kind.startswith("reasoning."):
        delta["segment_id"] = "summary-1"
    events = [
        {"sequence": 1, "timestamp": "2026-08-04T00:00:00Z", "data": {"session": {"id": "session"}}},
        {"sequence": 2, "timestamp": "2026-08-04T00:00:01Z", "session_id": "session", "run_id": "run",
         "item_id": "item", "source": {"backend": "fixture"}, "data": {"delta": delta}},
    ]
    snapshot = reduce_oaep_events(events)
    content = snapshot["items"][0]["content"]
    if field == "segments":
        assert content["segments"] == [{
            "id": "summary-1", "text": "live", "kind": "summary",
            "visibility": "user", "source": "backend",
        }]
    else:
        assert content[field] == "live"


def test_reducer_rejects_delta_after_item_terminal_and_duplicate_run_terminal() -> None:
    item = {
        "id": "item", "session_id": "session", "run_id": "run", "type": "message", "status": "completed",
        "sequence": 2, "created_at": "2026-08-04T00:00:01Z", "updated_at": "2026-08-04T00:00:01Z",
        "source": {"backend": "fixture"},
        "content": {"role": "assistant", "phase": "final", "text": "done", "parts": [], "citations": []},
    }
    with pytest.raises(ValueError, match="Delta cannot follow terminal"):
        reduce_oaep_events([
            {"sequence": 1, "timestamp": "2026-08-04T00:00:00Z", "data": {"session": {"id": "session"}}},
            {"sequence": 2, "timestamp": "2026-08-04T00:00:01Z", "item_id": "item", "data": {"item": item}},
            {"sequence": 3, "timestamp": "2026-08-04T00:00:02Z", "item_id": "item",
             "data": {"delta": {"kind": "message.text.append", "text": "late"}}},
        ])
    run = {"id": "run", "status": "completed", "created_at": "2026-08-04T00:00:00Z"}
    with pytest.raises(ValueError, match="more than one terminal"):
        reduce_oaep_events([
            {"sequence": 1, "timestamp": "2026-08-04T00:00:00Z", "data": {"session": {"id": "session"}}},
            {"sequence": 2, "timestamp": "2026-08-04T00:00:01Z", "type": "event.run.completed", "run_id": "run", "data": {"run": run}},
            {"sequence": 3, "timestamp": "2026-08-04T00:00:02Z", "type": "event.run.completed", "run_id": "run", "data": {"run": run}},
        ])


@pytest.mark.parametrize(("terminal_type", "status"), [
    ("event.item.completed", "completed"),
    ("event.item.failed", "failed"),
    ("event.item.cancelled", "cancelled"),
])
def test_item_identity_and_terminal_state_are_immutable(terminal_type: str, status: str) -> None:
    base = {
        "id": "item", "session_id": "session", "run_id": "run", "type": "message", "status": "running",
        "sequence": 1, "created_at": "2026-08-04T00:00:00Z", "updated_at": "2026-08-04T00:00:00Z",
        "source": {"backend": "fixture"},
        "content": {"role": "assistant", "phase": "final", "text": "", "parts": [], "citations": []},
    }
    terminal = {**base, "status": status, "sequence": 3,
                "content": {**base["content"], "text": "authoritative"}}
    events = [
        {"sequence": 1, "timestamp": "2026-08-04T00:00:00Z", "item_id": "item",
         "data": {"session": {"id": "session"}, "item": base}},
        {"sequence": 2, "timestamp": "2026-08-04T00:00:01Z", "item_id": "item",
         "data": {"delta": {"kind": "message.text.append", "text": "streamed"}}},
        {"sequence": 3, "timestamp": "2026-08-04T00:00:02Z", "type": terminal_type,
         "item_id": "item", "data": {"item": terminal}},
    ]
    snapshot = reduce_oaep_events(events)
    assert snapshot["items"][0]["status"] == status
    assert snapshot["items"][0]["content"]["text"] == "authoritative"
    with pytest.raises(ValueError, match="Delta cannot follow terminal"):
        reduce_oaep_events(events + [{
            "sequence": 4, "timestamp": "2026-08-04T00:00:03Z", "item_id": "item",
            "data": {"delta": {"kind": "message.text.append", "text": "late"}},
        }])
    with pytest.raises(ValueError, match="type is immutable"):
        reduce_oaep_events(events[:1] + [{
            "sequence": 2, "timestamp": "2026-08-04T00:00:01Z", "item_id": "item",
            "data": {"item": {**base, "type": "reasoning", "content": {"segments": []}}},
        }])
