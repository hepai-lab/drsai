"""Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict

SCHEMA_VERSION = '2.0.0'
PROTOCOL_VERSION = 'owop/1'
ENDPOINTS = {'access_grant_create': 'POST /v1/runtimes/{runtime_id}/access-grants', 'access_grant_read': 'GET /v1/runtimes/{runtime_id}/access-grants/{grant_id}', 'access_grant_revoke': 'DELETE /v1/runtimes/{runtime_id}/access-grants/{grant_id}', 'approval_decision': 'POST /v1/runtimes/{runtime_id}/approvals/{approval_id}/decision', 'approval_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals', 'association_create': 'POST /v1/associations', 'association_revoke': 'DELETE /v1/associations/{runtime_id}', 'conversation_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot', 'event_list': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events', 'event_stream': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events/stream', 'file_raw': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw', 'run_cancel': 'POST /v1/runtimes/{runtime_id}/runs/{run_id}/cancel', 'run_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_read': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}', 'runtime_association_list': 'GET /v1/runtimes/{runtime_id}/associations', 'runtime_association_revoke': 'DELETE /v1/runtimes/{runtime_id}/associations/{association_id}', 'runtime_capabilities': 'GET /v1/runtimes/{runtime_id}/capabilities', 'runtime_connect': 'WS /v1/runtime-connect', 'runtime_enrollment_revoke': 'DELETE /v1/runtimes/{runtime_id}/enrollment', 'runtime_identity': 'GET /v1/runtimes/{runtime_id}/runtime', 'runtime_list': 'GET /v1/runtimes', 'runtime_rename': 'PATCH /v1/runtimes/{runtime_id}', 'session_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_event_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events', 'session_event_stream': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream', 'session_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}', 'workspace_list': 'GET /v1/runtimes/{runtime_id}/workspaces', 'workspace_sync': 'POST /v1/runtimes/{runtime_id}/workspaces/sync'}
CAPABILITIES = frozenset(['approval.decide', 'approval.list', 'association.device-bound', 'association.list', 'association.revoke', 'conversation.read', 'enrollment.revoke', 'event.cursor_expired', 'event.resume', 'event.stream', 'file.raw.read', 'run.cancel', 'run.create', 'run.list', 'run.read', 'runtime.capabilities', 'runtime.identity', 'runtime.rename', 'session.create', 'session.list', 'session.read', 'workspace.list', 'workspace.sync'])

CAPABILITY_PROFILES = {'device-association/1': frozenset(['association.device-bound', 'association.list', 'association.revoke']), 'session-events/1': frozenset(['conversation.snapshot', 'session.event.cursor_expired', 'session.event.resume', 'session.event.stream'])}
MINIMUM_VERSIONS = {'device-association/1': {'android': '1.5.3', 'relay': '2.0.0', 'runtime': '1.5.3'}, 'session-events/1': {'runtime': '1.5.3', 'android': '1.5.3', 'desktop': '1.5.3'}}
SESSION_EVENT_KINDS = frozenset(['approval.created', 'approval.decided', 'artifact.created', 'conversation.item.created', 'conversation.item.delta', 'conversation.item.upsert', 'run.created', 'run.state.changed', 'session.archived', 'session.removed', 'session.updated', 'tool.state.changed'])

class GeneratedStrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

class GeneratedControlRequest(GeneratedStrictModel):
    request_id: UUID
    correlation_id: str
    idempotency_key: str | None = None

class GeneratedErrorEnvelope(GeneratedStrictModel):
    code: str
    message: str
    correlation_id: str
    retryable: bool
    details: dict[str, Any]
    source: Literal["relay", "runtime"]

class GeneratedRelayEvent(GeneratedStrictModel):
    event_id: str
    sequence: int
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    timestamp: datetime
    kind: str
    payload: dict[str, Any]

class GeneratedSessionConversationItem(GeneratedStrictModel):
    item_id: str
    session_id: str
    run_id: str | None
    kind: Literal["message", "reasoning", "tool", "approval", "artifact", "error"]
    role: Literal["user", "assistant", "system", "tool"] | None
    revision: int
    session_sequence: int
    source_client: Literal["windows", "android", "runtime"]
    source_message_id: str | None
    created_at: datetime
    updated_at: datetime
    payload: dict[str, Any]

class GeneratedConversationSnapshot(GeneratedStrictModel):
    session_id: str
    snapshot_sequence: int
    items: list[GeneratedSessionConversationItem]
    next_cursor: str | None

class GeneratedSessionEvent(GeneratedStrictModel):
    event_id: str
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str | None
    session_sequence: int
    kind: str
    timestamp: datetime
    payload: dict[str, Any]

class GeneratedRuntimeSessionEventFrame(GeneratedStrictModel):
    type: Literal["event"] = "event"
    scope: Literal["session"] = "session"
    session_id: str
    session_sequence: int
    event: GeneratedSessionEvent
