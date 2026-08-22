"""Host capabilities required by the shared agent core.

Ports exchange opaque identifiers and sanitized values. Authentication tokens,
keystore material, Android URIs, database handles, and platform objects are not
part of these contracts.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, AsyncIterator, Mapping, Protocol, Sequence


class LifecycleState(StrEnum):
    FOREGROUND = "foreground"
    BACKGROUND = "background"
    LOW_MEMORY = "low_memory"
    THERMAL_LIMITED = "thermal_limited"


@dataclass(frozen=True, slots=True)
class ModelRequest:
    request_id: str
    model_id: str
    messages: Sequence[Mapping[str, Any]]
    tools: Sequence[Mapping[str, Any]] = ()


@dataclass(frozen=True, slots=True)
class ModelChunk:
    request_id: str
    delta: str = ""
    finish_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ToolCall:
    call_id: str
    name: str
    arguments: Mapping[str, Any]
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class ToolResult:
    call_id: str
    succeeded: bool
    content: Mapping[str, Any]
    error_code: str | None = None
    artifact_ids: Sequence[str] = ()


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    approval_id: str
    call_id: str
    risk: str
    title: str
    summary: str


@dataclass(frozen=True, slots=True)
class ApprovalDecision:
    approval_id: str
    decision: str


@dataclass(frozen=True, slots=True)
class CheckpointRecord:
    run_id: str
    sequence: int
    state: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class ArtifactDescriptor:
    artifact_id: str
    mime_type: str
    size: int
    sha256: str


class ModelPort(Protocol):
    def stream(self, request: ModelRequest) -> AsyncIterator[ModelChunk]: ...


class StateStorePort(Protocol):
    async def save_checkpoint(self, checkpoint: CheckpointRecord) -> None: ...
    async def load_checkpoint(self, run_id: str) -> CheckpointRecord | None: ...


class ToolHostPort(Protocol):
    async def execute(self, call: ToolCall) -> ToolResult: ...


class ApprovalPort(Protocol):
    async def request(self, request: ApprovalRequest) -> ApprovalDecision: ...


class ArtifactPort(Protocol):
    async def describe(self, artifact_id: str) -> ArtifactDescriptor: ...
    async def read_chunk(self, artifact_id: str, offset: int, length: int) -> bytes: ...


class LifecyclePort(Protocol):
    async def current(self) -> LifecycleState: ...
