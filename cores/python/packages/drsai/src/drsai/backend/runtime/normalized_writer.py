"""Authoritative conversion from private normalized events to Runtime writes.

Adapters are intentionally unaware of the journal representation. Canonical
Item state is produced here before any legacy Runtime Event projection;
compatibility events are a downstream view and never feed back into OAEP.
"""

from __future__ import annotations

from typing import Any

from drsai.backend.runtime.normalized_events import (
    NormalizedAgentEvent,
    NormalizedEventKind,
    NormalizedItemType,
)


_ITEM_EVENT_NAMES = {
    NormalizedItemType.MESSAGE: "oaep.item.message",
    NormalizedItemType.REASONING: "oaep.item.reasoning",
    NormalizedItemType.PLAN: "oaep.item.plan",
    NormalizedItemType.COMMAND_EXECUTION: "oaep.item.command",
    NormalizedItemType.FILE_CHANGE: "oaep.item.file_change",
    NormalizedItemType.TOOL_CALL: "oaep.item.tool",
    NormalizedItemType.ARTIFACT: "oaep.item.artifact",
    NormalizedItemType.INTERACTION: "oaep.item.interaction",
    NormalizedItemType.SUBTASK: "oaep.item.subtask",
    NormalizedItemType.NOTICE: "oaep.item.unknown",
}

_CANONICAL_ITEM_STORAGE = {
    NormalizedItemType.MESSAGE: ("message", "assistant"),
    NormalizedItemType.REASONING: ("reasoning", "assistant"),
    NormalizedItemType.PLAN: ("plan", "assistant"),
    NormalizedItemType.COMMAND_EXECUTION: ("tool", "tool"),
    NormalizedItemType.FILE_CHANGE: ("file_change", None),
    NormalizedItemType.TOOL_CALL: ("tool", "tool"),
    NormalizedItemType.ARTIFACT: ("artifact", None),
    NormalizedItemType.INTERACTION: ("approval", None),
    NormalizedItemType.SUBTASK: ("subtask", None),
    NormalizedItemType.NOTICE: ("error", None),
}


def normalized_canonical_item(
    event: NormalizedAgentEvent,
    prior: dict[str, Any] | None = None,
    audit: dict[str, Any] | None = None,
) -> tuple[str, str | None, dict[str, Any], str]:
    """Project one normalized Item directly into canonical journal fields."""

    if event.item_type is None:
        raise ValueError("Canonical Item projection requires item_type")
    kind, default_role = _CANONICAL_ITEM_STORAGE[event.item_type]
    previous = dict(prior or {})
    incoming = dict(event.payload)
    # Codex terminal notifications are authoritative for the fields they
    # contain, but some versions omit immutable/start-time fields such as the
    # command or accumulated output. Merge by field while terminal values win.
    payload = {**previous, **incoming}
    payload = {**dict(audit or {}), **payload, "backend": event.backend}
    payload["normalized_item_type"] = event.item_type.value
    if event.phase:
        payload["phase"] = event.phase
    if event.stream:
        payload["stream"] = event.stream
    payload["status"] = {
        NormalizedEventKind.ITEM_STARTED: "running",
        NormalizedEventKind.ITEM_DELTA: "streaming",
        NormalizedEventKind.ITEM_UPDATED: str(payload.get("status") or "running"),
        NormalizedEventKind.ITEM_COMPLETED: "completed",
        NormalizedEventKind.ITEM_FAILED: "failed",
        NormalizedEventKind.ITEM_CANCELLED: "cancelled",
    }[event.kind]

    if event.kind == NormalizedEventKind.ITEM_DELTA:
        delta = str(incoming.get("text") or "")
        payload["delta"] = delta
        if event.item_type == NormalizedItemType.MESSAGE:
            payload["text"] = f"{previous.get('text', previous.get('content', ''))}{delta}"
            payload["content"] = payload["text"]
        elif event.item_type in {NormalizedItemType.REASONING, NormalizedItemType.PLAN}:
            payload["text"] = f"{previous.get('text', previous.get('summary', ''))}{delta}"
        elif event.item_type == NormalizedItemType.COMMAND_EXECUTION:
            payload["output"] = f"{previous.get('output', '')}{delta}"
        elif event.item_type == NormalizedItemType.TOOL_CALL:
            payload["result"] = f"{previous.get('result', '')}{delta}"
        elif event.item_type == NormalizedItemType.SUBTASK:
            payload["summary"] = f"{previous.get('summary', '')}{delta}"

    if event.item_type == NormalizedItemType.MESSAGE:
        candidate = incoming.get("role") or previous.get("role") or default_role
        role = str(candidate) if candidate in {"user", "assistant", "system"} else "assistant"
    else:
        role = default_role
    event_kind = "conversation.item.delta" if event.kind == NormalizedEventKind.ITEM_DELTA else (
        "conversation.item.created" if not prior else "conversation.item.upsert"
    )
    return kind, role, payload, event_kind


def normalized_runtime_write(event: NormalizedAgentEvent) -> tuple[str, dict[str, Any], str]:
    """Return the bounded Runtime write for a validated normalized event."""

    metadata = {
        "thread_id": event.binding.session_id,
        **({"turn_id": event.binding.run_id} if event.binding.run_id else {}),
        **({"item_id": event.binding.item_id} if event.binding.item_id else {}),
        **({"item_type": event.item_type.value} if event.item_type else {}),
    }
    data: dict[str, Any] = {
        "backend": event.backend,
        "backend_metadata": metadata,
    }
    if event.phase:
        data["oaep_phase"] = event.phase
    if event.stream:
        data["stream"] = event.stream

    if event.kind == NormalizedEventKind.ITEM_DELTA:
        data["content"] = str(event.payload.get("text") or "")
        data["delta_kind"] = event.delta_kind.value if event.delta_kind else None
        if "received_bytes" in event.payload:
            metadata["received_bytes"] = event.payload["received_bytes"]
        for key in ("ordinal", "received_bytes", "truncated", "truncated_prefix_bytes"):
            if key in event.payload:
                data[key] = event.payload[key]
        base = _ITEM_EVENT_NAMES[event.item_type]
        event_type = "oaep.item.message.delta" if event.item_type == NormalizedItemType.MESSAGE else f"{base}.delta"
    elif event.kind in {
        NormalizedEventKind.ITEM_STARTED,
        NormalizedEventKind.ITEM_UPDATED,
        NormalizedEventKind.ITEM_COMPLETED,
        NormalizedEventKind.ITEM_FAILED,
        NormalizedEventKind.ITEM_CANCELLED,
    }:
        event_type = _ITEM_EVENT_NAMES[event.item_type]
        data["phase"] = {
            NormalizedEventKind.ITEM_STARTED: "started",
            NormalizedEventKind.ITEM_UPDATED: "updated",
            NormalizedEventKind.ITEM_COMPLETED: "completed",
            NormalizedEventKind.ITEM_FAILED: "failed",
            NormalizedEventKind.ITEM_CANCELLED: "cancelled",
        }[event.kind]
        data["item"] = dict(event.payload)
        if event.item_type == NormalizedItemType.COMMAND_EXECUTION:
            command = event.payload.get("command")
            if isinstance(command, str):
                # The journal intentionally redacts the raw command field;
                # this bounded display form is the public OAEP representation.
                data["item"]["summary"] = command
    elif event.kind == NormalizedEventKind.RUN_STARTED:
        event_type = "oaep.run.started"
        data["status"] = "running"
    elif event.kind == NormalizedEventKind.RUN_COMPLETED:
        event_type = "oaep.run.completed"
        data["status"] = "completed"
        data.update(dict(event.payload))
    elif event.kind in {NormalizedEventKind.RUN_FAILED, NormalizedEventKind.RUN_CANCELLED}:
        event_type = "oaep.run.cancelled" if event.kind == NormalizedEventKind.RUN_CANCELLED else "oaep.run.failed"
        data.update(dict(event.payload))
        data["status"] = "cancelled" if event.kind == NormalizedEventKind.RUN_CANCELLED else "failed"
        data["cancelled"] = event.kind == NormalizedEventKind.RUN_CANCELLED
    elif event.kind in {NormalizedEventKind.RUN_WAITING, NormalizedEventKind.RUN_RESUMED}:
        event_type = "oaep.run.state"
        data["status"] = "waiting" if event.kind == NormalizedEventKind.RUN_WAITING else "running"
    elif event.kind in {
        NormalizedEventKind.SESSION_CREATED,
        NormalizedEventKind.SESSION_UPDATED,
        NormalizedEventKind.SESSION_ARCHIVED,
        NormalizedEventKind.SESSION_UNARCHIVED,
        NormalizedEventKind.SESSION_DELETED,
    }:
        event_type = f"oaep.{event.kind.value}"
        data.update(dict(event.payload))
    else:
        # Thread lifecycle is retained as a safe Runtime notice until the
        # session registry accepts backend-originated lifecycle mutations.
        event_type = "oaep.item.unknown"
        data.update({"method": event.kind.value, "summary": dict(event.payload)})
        data["backend_metadata"]["item_id"] = event.binding.item_id or f"session:{event.binding.session_id}"

    return event_type, data, event.dedupe_key
