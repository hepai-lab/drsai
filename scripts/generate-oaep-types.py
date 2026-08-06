"""Generate the shared OAEP contract types for Python, TypeScript and Kotlin."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/oaep/oaep.schema.json"
PYTHON = ROOT / "cores/python/packages/drsai/src/drsai/oaep/generated.py"
PYTHON_SCHEMA = ROOT / "cores/python/packages/drsai/src/drsai/oaep/oaep.schema.json"
TYPESCRIPT = ROOT / "apps/desktop/shared/api/oaep.generated.ts"
KOTLIN = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/OaepGenerated.kt"
RELAY_SCHEMA = ROOT / "cores/protocol/relay/runtime-relay.schema.json"
DESKTOP_SELECTION = ROOT / "apps/desktop/shared/main/runtimeProtocolSelection.ts"


def _quoted(values: list[str], separator: str) -> str:
    return separator.join(json.dumps(value) for value in values)


def _metadata(schema: dict[str, object]) -> tuple[str, str, list[str], list[str], list[str]]:
    raw = SCHEMA.read_bytes()
    defs = schema["$defs"]
    assert isinstance(defs, dict)
    item_types = list(defs["itemType"]["enum"])
    item_statuses = list(defs["itemStatus"]["enum"])
    event_types = list(defs["eventType"]["enum"])
    return hashlib.sha256(raw).hexdigest(), str(schema["version"]), item_types, item_statuses, event_types


def render_python(schema: dict[str, object]) -> str:
    digest, version, item_types, statuses, event_types = _metadata(schema)
    return f'''"""Generated from cores/protocol/oaep/oaep.schema.json; do not edit."""
from __future__ import annotations

from typing import Any, Literal
from typing_extensions import NotRequired, Required, TypedDict

OAEP_SCHEMA_SHA256 = {digest!r}
OAEP_VERSION = {version!r}
OAEP_PROFILE = "oaep.session-stream/1"
OaepItemType = Literal[{_quoted(item_types, ", ")}]
OaepItemStatus = Literal[{_quoted(statuses, ", ")}]
OaepEventType = Literal[{_quoted(event_types, ", ")}]


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
    version: Required[Literal[{version!r}]]
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
    version: Required[Literal[{version!r}]]
    session: Required[OaepSession]
    runs: Required[list[OaepRun]]
    items: Required[list[OaepItem]]
    snapshot_sequence: Required[int]
    checkpoint: OaepSnapshotCheckpoint
    window: OaepSnapshotWindow


class OaepEventPage(TypedDict):
    version: Literal[{version!r}]
    object: Literal["list"]
    data: list[OaepEvent]
    next_sequence: int
    has_more: bool
'''


def render_typescript(schema: dict[str, object]) -> str:
    digest, version, item_types, statuses, event_types = _metadata(schema)
    return f'''// Generated from cores/protocol/oaep/oaep.schema.json; do not edit.
export const OAEP_SCHEMA_SHA256 = {json.dumps(digest)} as const;
export const OAEP_VERSION = {json.dumps(version)} as const;
export const OAEP_PROFILE = "oaep.session-stream/1" as const;
export type OaepItemType = {_quoted(item_types, " | ")};
export type OaepItemStatus = {_quoted(statuses, " | ")};
export type OaepEventType = {_quoted(event_types, " | ")};
export interface OaepSource {{ backend: string; backend_item_id?: string; backend_event_id?: string; client?: string; message_id?: string; runtime_id?: string; backend_version?: string; adapter?: string; adapter_version?: string; mapping_version?: string; backend_run_id?: string; backend_run_index?: number; }}
export interface OaepError {{ code: string; message: string; retryable: boolean; details?: Record<string, unknown>; }}
export interface OaepOperationRef {{ protocol: "owop/1"; operation_id: string; workspace_id: string; operation: string; correlation_id: string; }}
export interface OaepResourceRef {{ protocol: "owop/1"; workspace_id: string; resource_type: "workspace" | "worktree" | "file" | "git" | "process" | "pty" | "checkpoint" | "artifact"; resource_id: string; operation_id?: string; label?: string; digest?: string; }}
export interface OaepContentReferences {{ operation_ref?: OaepOperationRef; resource_refs?: OaepResourceRef[]; }}
export interface OaepMessagePart {{ type: "text" | "image" | "audio" | "file" | "resource_ref"; text?: string; url?: string; name?: string; mime_type?: string; resource_ref?: OaepResourceRef; }}
export interface OaepMessageContent extends OaepContentReferences {{ role: "user" | "assistant" | "system"; text: string; phase?: "commentary" | "final"; citations?: Record<string, unknown>[]; parts?: OaepMessagePart[]; }}
export interface OaepReasoningContent extends OaepContentReferences {{ segments: Array<{{id: string; text: string; kind?: "summary" | "commentary" | "analysis"; visibility?: "user" | "diagnostic" | "hidden"; source?: "backend" | "adapter" | "runtime"}}>; }}
export interface OaepPlanContent extends OaepContentReferences {{ text: string; steps: Array<{{id: string; title: string; status: string}}>; explanation?: string; }}
export interface OaepReplayPolicy {{ classification?: "pure" | "read_only_versioned" | "read_only_mutable" | "workspace_write" | "external_write" | "unknown"; tool_reference?: string; source_event_id?: string; input_digest?: string; implementation_digest?: string; schema_digest?: string; result_digest?: string; current?: Record<string, string>; }}
export interface OaepCommandExecutionContent extends OaepContentReferences {{ command: string[]; display_command: string; cwd: string; output: string; stdout_tail?: string; stderr_tail?: string; exit_code?: number | null; duration_ms?: number | null; replay_policy?: OaepReplayPolicy; }}
export interface OaepToolCallContent extends OaepContentReferences {{ tool_kind: string; tool_name: string; call_id: string; arguments: Record<string, unknown>; result: unknown; server?: string | null; duration_ms?: number | null; replay_policy?: OaepReplayPolicy; }}
export interface OaepFileChangeContent extends OaepContentReferences {{ changes: Array<Record<string, unknown>>; summary: string; }}
export interface OaepArtifactContent extends OaepContentReferences {{ artifact_id: string; artifact_type: string; name: string; summary: string; path?: string | null; mime_type?: string | null; size?: number | null; sha256?: string | null; previewable?: boolean; downloadable?: boolean; }}
export interface OaepInteractionContent extends OaepContentReferences {{ interaction_type: string; prompt: string; options: Array<Record<string, unknown>>; approval_id?: string | null; operation?: string; request_summary?: Record<string, unknown>; related_item_id?: string | null; response?: unknown; deadline_at?: string | null; }}
export interface OaepSubtaskContent extends OaepContentReferences {{ title: string; summary: string; agent_name?: string | null; child_run_id?: string | null; result?: unknown; }}
export interface OaepNoticeContent extends OaepContentReferences {{ level: "info" | "warning" | "error"; code: string; message: string; error?: OaepError; details?: Record<string, unknown>; }}
export type OaepItemContent = OaepMessageContent | OaepReasoningContent | OaepPlanContent | OaepCommandExecutionContent | OaepToolCallContent | OaepFileChangeContent | OaepArtifactContent | OaepInteractionContent | OaepSubtaskContent | OaepNoticeContent;
export interface OaepSession {{ id: string; workspace_id: string; title?: string; status: "active" | "archived" | "deleted"; backend?: string; created_at: string; updated_at: string; }}
export interface OaepRun {{ id: string; session_id: string; parent_run_id?: string | null; sequence?: number; source?: OaepSource; status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled"; created_at: string; updated_at: string; completed_at?: string | null; }}
export interface OaepItemBase {{ id: string; session_id: string; run_id: string; status: OaepItemStatus; sequence: number; created_at: string; updated_at: string; source: OaepSource; }}
export type OaepItem =
  | (OaepItemBase & {{ type: "message"; content: OaepMessageContent }})
  | (OaepItemBase & {{ type: "reasoning"; content: OaepReasoningContent }})
  | (OaepItemBase & {{ type: "plan"; content: OaepPlanContent }})
  | (OaepItemBase & {{ type: "command_execution"; content: OaepCommandExecutionContent }})
  | (OaepItemBase & {{ type: "file_change"; content: OaepFileChangeContent }})
  | (OaepItemBase & {{ type: "tool_call"; content: OaepToolCallContent }})
  | (OaepItemBase & {{ type: "artifact"; content: OaepArtifactContent }})
  | (OaepItemBase & {{ type: "interaction"; content: OaepInteractionContent }})
  | (OaepItemBase & {{ type: "subtask"; content: OaepSubtaskContent }})
  | (OaepItemBase & {{ type: "notice"; content: OaepNoticeContent }});
export interface OaepDelta {{ kind: string; text?: string; segment_id?: string; stream?: "stdout" | "stderr" | "combined"; reasoning_kind?: "summary" | "commentary" | "analysis"; visibility?: "user" | "diagnostic" | "hidden"; reasoning_source?: "backend" | "adapter" | "runtime"; }}
export interface OaepEventData {{ item?: OaepItem; delta?: OaepDelta; error?: OaepError; [key: string]: unknown; }}
export interface OaepEvent {{ version: typeof OAEP_VERSION; event_id: string; session_id: string; run_id?: string; item_id?: string; sequence: number; type: OaepEventType; timestamp: string; dedupe_key: string; source: OaepSource; data: OaepEventData; }}
export interface OaepSnapshotCheckpoint {{ sequence: number; snapshot_hash: string; item_count: number; }}
export interface OaepSnapshotWindow {{ limit: number; has_more: boolean; next_cursor: string | null; }}
export interface OaepSnapshot {{ version: typeof OAEP_VERSION; session: OaepSession; runs: OaepRun[]; items: OaepItem[]; snapshot_sequence: number; checkpoint?: OaepSnapshotCheckpoint; window?: OaepSnapshotWindow; }}
export interface OaepEventPage {{ version: typeof OAEP_VERSION; object: "list"; data: OaepEvent[]; next_sequence: number; has_more: boolean; }}
'''


def render_kotlin(schema: dict[str, object]) -> str:
    digest, version, item_types, statuses, event_types = _metadata(schema)
    return f'''// Generated from cores/protocol/oaep/oaep.schema.json; do not edit.
package ai.drsai.remote.remote.generated

object OaepContract {{
    const val SCHEMA_SHA256 = "{digest}"
    const val VERSION = "{version}"
    const val PROFILE = "oaep.session-stream/1"
    val ITEM_TYPES = setOf({_quoted(item_types, ", ")})
    val ITEM_STATUSES = setOf({_quoted(statuses, ", ")})
    val EVENT_TYPES = setOf({_quoted(event_types, ", ")})
}}

data class OaepSource(val backend: String, val backendItemId: String? = null, val backendEventId: String? = null, val client: String? = null, val messageId: String? = null, val runtimeId: String? = null, val backendVersion: String? = null, val adapter: String? = null, val adapterVersion: String? = null, val mappingVersion: String? = null, val backendRunId: String? = null, val backendRunIndex: Long? = null)
data class OaepError(val code: String, val message: String, val retryable: Boolean, val details: Map<String, Any?> = emptyMap())
data class OaepOperationRef(val protocol: String = "owop/1", val operationId: String, val workspaceId: String, val operation: String, val correlationId: String)
data class OaepResourceRef(val protocol: String = "owop/1", val workspaceId: String, val resourceType: String, val resourceId: String, val operationId: String? = null, val label: String? = null, val digest: String? = null)
sealed interface OaepItemContent {{ val operationRef: OaepOperationRef?; val resourceRefs: List<OaepResourceRef> }}
data class OaepMessageContent(val role: String, val text: String, val phase: String? = null, val citations: List<Map<String, Any?>> = emptyList(), val parts: List<Map<String, Any?>> = emptyList(), override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepReasoningContent(val segments: List<Map<String, String>>, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepPlanContent(val text: String, val steps: List<Map<String, Any?>>, val explanation: String? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepCommandExecutionContent(val command: List<String>, val displayCommand: String, val cwd: String, val output: String, val stdoutTail: String? = null, val stderrTail: String? = null, val exitCode: Int? = null, val durationMs: Double? = null, val replayPolicy: Map<String, Any?> = emptyMap(), override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepToolCallContent(val toolKind: String, val toolName: String, val callId: String, val arguments: Map<String, Any?>, val result: Any?, val server: String? = null, val durationMs: Double? = null, val replayPolicy: Map<String, Any?> = emptyMap(), override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepFileChangeContent(val changes: List<Map<String, Any?>>, val summary: String, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepArtifactContent(val artifactId: String, val artifactType: String, val name: String, val summary: String, val path: String? = null, val mimeType: String? = null, val size: Long? = null, val sha256: String? = null, val previewable: Boolean = false, val downloadable: Boolean = false, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepInteractionContent(val interactionType: String, val prompt: String, val options: List<Map<String, Any?>>, val approvalId: String? = null, val operation: String? = null, val requestSummary: Map<String, Any?> = emptyMap(), val relatedItemId: String? = null, val response: Any? = null, val deadlineAt: String? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepSubtaskContent(val title: String, val summary: String, val agentName: String? = null, val childRunId: String? = null, val result: Any? = null, override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepNoticeContent(val level: String, val code: String, val message: String, val error: OaepError? = null, val details: Map<String, Any?> = emptyMap(), override val operationRef: OaepOperationRef? = null, override val resourceRefs: List<OaepResourceRef> = emptyList()) : OaepItemContent
data class OaepSession(val id: String, val workspaceId: String, val title: String?, val status: String, val backend: String?, val createdAt: String, val updatedAt: String)
data class OaepRun(val id: String, val sessionId: String, val parentRunId: String?, val sequence: Long? = null, val source: OaepSource? = null, val status: String, val createdAt: String, val updatedAt: String, val completedAt: String?)
data class OaepItem(val id: String, val sessionId: String, val runId: String, val type: String, val status: String, val sequence: Long, val createdAt: String, val updatedAt: String, val source: OaepSource, val content: OaepItemContent)
data class OaepDelta(val kind: String, val text: String? = null, val segmentId: String? = null, val stream: String? = null, val reasoningKind: String? = null, val visibility: String? = null, val reasoningSource: String? = null)
data class OaepEventData(val item: OaepItem? = null, val delta: OaepDelta? = null, val error: OaepError? = null, val extra: Map<String, Any?> = emptyMap())
data class OaepEvent(val version: String, val eventId: String, val sessionId: String, val runId: String?, val itemId: String?, val sequence: Long, val type: String, val timestamp: String, val dedupeKey: String, val source: OaepSource, val data: OaepEventData)
data class OaepSnapshotCheckpoint(val sequence: Long, val snapshotHash: String, val itemCount: Long)
data class OaepSnapshotWindow(val limit: Int, val hasMore: Boolean, val nextCursor: String?)
data class OaepSnapshot(val version: String, val session: OaepSession, val runs: List<OaepRun>, val items: List<OaepItem>, val snapshotSequence: Long, val checkpoint: OaepSnapshotCheckpoint? = null, val window: OaepSnapshotWindow? = null)
data class OaepEventPage(val version: String, val objectType: String, val data: List<OaepEvent>, val nextSequence: Long, val hasMore: Boolean)
'''


def _update(path: Path, content: str, check: bool) -> bool:
    current = path.read_text(encoding="utf-8") if path.exists() else None
    if current == content:
        return True
    if check:
        print(f"OAEP generated type drift: {path.relative_to(ROOT)}")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def _update_relay_schema_hash(digest: str, check: bool) -> bool:
    relay = json.loads(RELAY_SCHEMA.read_text(encoding="utf-8"))
    if relay.get("x-oaep-schema-sha256") == digest:
        return True
    if check:
        print(f"OAEP Relay schema hash drift: {RELAY_SCHEMA.relative_to(ROOT)}")
        return False
    relay["x-oaep-schema-sha256"] = digest
    RELAY_SCHEMA.write_text(
        json.dumps(relay, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return True


def _check_desktop_runtime_mirror(digest: str, version: str) -> bool:
    source = DESKTOP_SELECTION.read_text(encoding="utf-8")
    expected = (
        f'const OAEP_VERSION = "{version}";',
        'const OAEP_PROFILE = "oaep.session-stream/1";',
        f'const OAEP_SCHEMA_SHA256 = "{digest}";',
    )
    missing = [value for value in expected if value not in source]
    if missing:
        print(f"OAEP Desktop runtime mirror drift: {DESKTOP_SELECTION.relative_to(ROOT)}")
        return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    digest = hashlib.sha256(SCHEMA.read_bytes()).hexdigest()
    results = (
        _update(PYTHON, render_python(schema), args.check),
        _update(
            PYTHON_SCHEMA,
            json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
            args.check,
        ),
        _update(TYPESCRIPT, render_typescript(schema), args.check),
        _update(KOTLIN, render_kotlin(schema), args.check),
        _update_relay_schema_hash(digest, args.check),
        _check_desktop_runtime_mirror(digest, str(schema["version"])),
    )
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
