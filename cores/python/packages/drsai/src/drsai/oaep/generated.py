"""Generated from cores/protocol/oaep/oaep.schema.json; do not edit."""
from __future__ import annotations

from typing import Any, Literal
from typing_extensions import NotRequired, Required, TypedDict

OAEP_SCHEMA_SHA256 = '1b28430fb888b7160247c5518f8d6075b2118b4a43151234a5f7e29f0d7ace09'
OAEP_VERSION = '1.0'
OAEP_PROFILE = "oaep.session-stream/1"
OaepItemType = Literal["message", "reasoning", "plan", "command_execution", "file_change", "tool_call", "artifact", "interaction", "subtask", "notice"]
OaepItemStatus = Literal["pending", "running", "waiting", "completed", "failed", "cancelled"]
OaepEventType = Literal["event.session.created", "event.session.updated", "event.session.archived", "event.session.unarchived", "event.session.deleted", "event.run.created", "event.run.started", "event.run.waiting", "event.run.resumed", "event.run.completed", "event.run.failed", "event.run.cancelled", "event.item.created", "event.item.started", "event.item.delta", "event.item.updated", "event.item.completed", "event.item.failed", "event.item.cancelled"]


class OaepSource(TypedDict, total=False):
    backend: Required[str]
    backend_item_id: str
    backend_event_id: str
    client: str
    message_id: str
    runtime_id: str
    backend_version: str
    adapter: str
    adapter_version: str
    mapping_version: str
    backend_run_id: str
    backend_run_index: int


class OaepError(TypedDict, total=False):
    code: Required[str]
    message: Required[str]
    retryable: Required[bool]
    details: dict[str, Any]


class OaepOperationRef(TypedDict):
    protocol: Literal["owop/1"]
    operation_id: str
    workspace_id: str
    operation: str
    correlation_id: str


class OaepResourceRef(TypedDict, total=False):
    protocol: Required[Literal["owop/1"]]
    workspace_id: Required[str]
    resource_type: Required[Literal["workspace", "worktree", "file", "git", "process", "pty", "checkpoint", "artifact"]]
    resource_id: Required[str]
    operation_id: str
    label: str
    digest: str


class OaepMessageContent(TypedDict, total=False):
    role: Required[Literal["user", "assistant", "system"]]
    text: Required[str]
    phase: Literal["commentary", "final"]
    citations: list[dict[str, Any]]
    parts: list[dict[str, Any]]
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepReasoningContent(TypedDict, total=False):
    segments: Required[list[dict[str, str]]]
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepPlanContent(TypedDict, total=False):
    text: Required[str]
    steps: Required[list[dict[str, Any]]]
    explanation: str
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepReplayPolicy(TypedDict, total=False):
    classification: Literal["pure", "read_only_versioned", "read_only_mutable", "workspace_write", "external_write", "unknown"]
    tool_reference: str
    source_event_id: str
    input_digest: str
    implementation_digest: str
    schema_digest: str
    result_digest: str
    current: dict[str, str]


class OaepCommandExecutionContent(TypedDict, total=False):
    command: Required[list[str]]
    display_command: Required[str]
    cwd: Required[str]
    output: Required[str]
    stdout_tail: str
    stderr_tail: str
    exit_code: int | None
    duration_ms: float | None
    replay_policy: OaepReplayPolicy
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepToolCallContent(TypedDict, total=False):
    tool_kind: Required[str]
    tool_name: Required[str]
    call_id: Required[str]
    arguments: Required[dict[str, Any]]
    result: Required[Any]
    server: str | None
    duration_ms: float | None
    replay_policy: OaepReplayPolicy
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepFileChangeContent(TypedDict, total=False):
    changes: Required[list[dict[str, Any]]]
    summary: Required[str]
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepArtifactContent(TypedDict, total=False):
    artifact_id: Required[str]
    artifact_type: Required[str]
    name: Required[str]
    summary: Required[str]
    path: str | None
    mime_type: str | None
    size: int | None
    sha256: str | None
    previewable: bool
    downloadable: bool
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepInteractionContent(TypedDict, total=False):
    interaction_type: Required[str]
    prompt: Required[str]
    options: Required[list[dict[str, Any]]]
    approval_id: str | None
    operation: str
    request_summary: dict[str, Any]
    related_item_id: str | None
    response: Any
    deadline_at: str | None
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepSubtaskContent(TypedDict, total=False):
    title: Required[str]
    summary: Required[str]
    agent_name: str | None
    child_run_id: str | None
    result: Any
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


class OaepNoticeContent(TypedDict, total=False):
    level: Required[Literal["info", "warning", "error"]]
    code: Required[str]
    message: Required[str]
    error: OaepError
    details: dict[str, Any]
    operation_ref: OaepOperationRef
    resource_refs: list[OaepResourceRef]


OaepItemContent = OaepMessageContent | OaepReasoningContent | OaepPlanContent | OaepCommandExecutionContent | OaepToolCallContent | OaepFileChangeContent | OaepArtifactContent | OaepInteractionContent | OaepSubtaskContent | OaepNoticeContent


class OaepSession(TypedDict, total=False):
    id: Required[str]
    workspace_id: Required[str]
    title: str
    status: Required[Literal["active", "archived", "deleted"]]
    backend: str
    created_at: Required[str]
    updated_at: Required[str]


class OaepRun(TypedDict, total=False):
    id: Required[str]
    session_id: Required[str]
    parent_run_id: str | None
    sequence: int
    source: OaepSource
    status: Required[Literal["queued", "running", "waiting", "completed", "failed", "cancelled"]]
    created_at: Required[str]
    updated_at: Required[str]
    completed_at: str | None


class OaepItem(TypedDict, total=False):
    id: Required[str]
    session_id: Required[str]
    run_id: Required[str]
    type: Required[OaepItemType]
    status: Required[OaepItemStatus]
    sequence: Required[int]
    created_at: Required[str]
    updated_at: Required[str]
    source: Required[OaepSource]
    content: Required[OaepItemContent]


class OaepDelta(TypedDict, total=False):
    kind: Required[str]
    text: str
    segment_id: str
    stream: Literal["stdout", "stderr", "combined"]
    reasoning_kind: Literal["summary", "commentary", "analysis"]
    visibility: Literal["user", "diagnostic", "hidden"]
    reasoning_source: Literal["backend", "adapter", "runtime"]


class OaepEventData(TypedDict, total=False):
    item: OaepItem
    delta: OaepDelta
    error: OaepError


class OaepEvent(TypedDict, total=False):
    version: Required[Literal['1.0']]
    event_id: Required[str]
    session_id: Required[str]
    run_id: str
    item_id: str
    sequence: Required[int]
    type: Required[OaepEventType]
    timestamp: Required[str]
    dedupe_key: Required[str]
    source: Required[OaepSource]
    data: Required[OaepEventData]


class OaepSnapshotCheckpoint(TypedDict):
    sequence: int
    snapshot_hash: str
    item_count: int


class OaepSnapshotWindow(TypedDict):
    limit: int
    has_more: bool
    next_cursor: str | None


class OaepSnapshot(TypedDict, total=False):
    version: Required[Literal['1.0']]
    session: Required[OaepSession]
    runs: Required[list[OaepRun]]
    items: Required[list[OaepItem]]
    snapshot_sequence: Required[int]
    checkpoint: OaepSnapshotCheckpoint
    window: OaepSnapshotWindow


class OaepEventPage(TypedDict):
    version: Literal['1.0']
    object: Literal["list"]
    data: list[OaepEvent]
    next_sequence: int
    has_more: bool
