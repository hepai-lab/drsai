"""Strongly typed private adapter events consumed by the OAEP writer.

This is deliberately not a public protocol.  Backend adapters own native wire
decoding, while the Runtime owns OAEP ids, ordering, persistence and projection.
The union below prevents adapters from extending the former free-form
``agent.*`` payload convention with unreviewed semantics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from types import MappingProxyType
from typing import Any, Mapping, Protocol, runtime_checkable


class NormalizedEventKind(str, Enum):
    SESSION_CREATED = "session.created"
    SESSION_UPDATED = "session.updated"
    SESSION_ARCHIVED = "session.archived"
    SESSION_UNARCHIVED = "session.unarchived"
    SESSION_DELETED = "session.deleted"
    RUN_STARTED = "run.started"
    RUN_WAITING = "run.waiting"
    RUN_RESUMED = "run.resumed"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"
    RUN_CANCELLED = "run.cancelled"
    ITEM_STARTED = "item.started"
    ITEM_DELTA = "item.delta"
    ITEM_UPDATED = "item.updated"
    ITEM_COMPLETED = "item.completed"
    ITEM_FAILED = "item.failed"
    ITEM_CANCELLED = "item.cancelled"


class NormalizedItemType(str, Enum):
    MESSAGE = "message"
    REASONING = "reasoning"
    PLAN = "plan"
    COMMAND_EXECUTION = "command_execution"
    FILE_CHANGE = "file_change"
    TOOL_CALL = "tool_call"
    ARTIFACT = "artifact"
    INTERACTION = "interaction"
    SUBTASK = "subtask"
    NOTICE = "notice"


class NormalizedDeltaKind(str, Enum):
    MESSAGE_TEXT_APPEND = "message.text.append"
    REASONING_SEGMENT_ADDED = "reasoning.segment.added"
    REASONING_TEXT_APPEND = "reasoning.text.append"
    PLAN_TEXT_APPEND = "plan.text.append"
    COMMAND_OUTPUT_APPEND = "command.output.append"
    TOOL_OUTPUT_APPEND = "tool.output.append"
    SUBTASK_SUMMARY_APPEND = "subtask.summary.append"


class NormalizedTerminalStatus(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@runtime_checkable
class AgentEventAdapter(Protocol):
    """Backend-private decoder boundary; clients only consume OAEP."""

    backend_id: str

    def decode(self, message: Mapping[str, Any]) -> "NormalizedAgentEvent | None": ...


_ITEM_KINDS = {
    NormalizedEventKind.ITEM_STARTED,
    NormalizedEventKind.ITEM_DELTA,
    NormalizedEventKind.ITEM_UPDATED,
    NormalizedEventKind.ITEM_COMPLETED,
    NormalizedEventKind.ITEM_FAILED,
    NormalizedEventKind.ITEM_CANCELLED,
}
_RUN_KINDS = {
    NormalizedEventKind.RUN_STARTED,
    NormalizedEventKind.RUN_WAITING,
    NormalizedEventKind.RUN_RESUMED,
    NormalizedEventKind.RUN_COMPLETED,
    NormalizedEventKind.RUN_FAILED,
    NormalizedEventKind.RUN_CANCELLED,
}


@dataclass(frozen=True, slots=True)
class BackendBinding:
    session_id: str
    run_id: str | None = None
    item_id: str | None = None

    def __post_init__(self) -> None:
        if not self.session_id.strip():
            raise ValueError("backend session binding is required")
        if self.item_id is not None and not self.run_id:
            raise ValueError("backend item binding requires a run binding")


@dataclass(frozen=True, slots=True)
class NormalizedAgentEvent:
    kind: NormalizedEventKind
    backend: str
    binding: BackendBinding
    dedupe_key: str
    item_type: NormalizedItemType | None = None
    delta_kind: NormalizedDeltaKind | None = None
    phase: str | None = None
    stream: str | None = None
    terminal_status: NormalizedTerminalStatus | None = None
    payload: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.backend.strip() or not self.dedupe_key.strip():
            raise ValueError("backend and dedupe_key are required")
        if self.kind in _ITEM_KINDS:
            if not self.binding.item_id or self.item_type is None:
                raise ValueError("item events require item binding and item_type")
        elif self.item_type is not None or self.delta_kind is not None:
            raise ValueError("non-item events cannot carry item semantics")
        if self.kind == NormalizedEventKind.ITEM_DELTA:
            if self.delta_kind is None:
                raise ValueError("item.delta requires delta_kind")
        elif self.delta_kind is not None:
            raise ValueError("delta_kind is only valid for item.delta")
        if self.kind in _RUN_KINDS and not self.binding.run_id:
            raise ValueError("run events require a run binding")
        expected_terminal = {
            NormalizedEventKind.RUN_COMPLETED: NormalizedTerminalStatus.COMPLETED,
            NormalizedEventKind.RUN_FAILED: NormalizedTerminalStatus.FAILED,
            NormalizedEventKind.RUN_CANCELLED: NormalizedTerminalStatus.CANCELLED,
        }.get(self.kind)
        if expected_terminal is not None and self.terminal_status != expected_terminal:
            raise ValueError(f"{self.kind.value} requires terminal_status={expected_terminal.value}")
        if expected_terminal is None and self.terminal_status is not None:
            raise ValueError("terminal_status is only valid for terminal run events")
        if self.phase is not None and self.phase not in {"commentary", "final"}:
            raise ValueError("phase must be commentary or final")
        if self.stream is not None and self.stream not in {"stdout", "stderr", "combined"}:
            raise ValueError("stream must be stdout, stderr or combined")
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))
