"""Generated from cores/protocol/relay/runtime-relay.schema.json. Do not edit."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict

SCHEMA_VERSION = '2.0.0'
PROTOCOL_VERSION = 'owop/1'
ENDPOINTS = {'access_grant_create': 'POST /v1/runtimes/{runtime_id}/access-grants', 'access_grant_read': 'GET /v1/runtimes/{runtime_id}/access-grants/{grant_id}', 'access_grant_revoke': 'DELETE /v1/runtimes/{runtime_id}/access-grants/{grant_id}', 'approval_decision': 'POST /v1/runtimes/{runtime_id}/approvals/{approval_id}/decision', 'approval_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals', 'association_create': 'POST /v1/associations', 'association_revoke': 'DELETE /v1/associations/{runtime_id}', 'conversation_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation', 'event_list': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events', 'event_stream': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events/stream', 'file_raw': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw', 'run_cancel': 'POST /v1/runtimes/{runtime_id}/runs/{run_id}/cancel', 'run_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_read': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}', 'runtime_association_list': 'GET /v1/runtimes/{runtime_id}/associations', 'runtime_association_revoke': 'DELETE /v1/runtimes/{runtime_id}/associations/{association_id}', 'runtime_capabilities': 'GET /v1/runtimes/{runtime_id}/capabilities', 'runtime_connect': 'WS /v1/runtime-connect', 'runtime_enrollment_revoke': 'DELETE /v1/runtimes/{runtime_id}/enrollment', 'runtime_identity': 'GET /v1/runtimes/{runtime_id}/runtime', 'runtime_list': 'GET /v1/runtimes', 'runtime_rename': 'PATCH /v1/runtimes/{runtime_id}', 'session_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_read': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}', 'workspace_list': 'GET /v1/runtimes/{runtime_id}/workspaces'}
CAPABILITIES = frozenset(['approval.decide', 'approval.list', 'association.list', 'association.revoke', 'conversation.read', 'enrollment.revoke', 'event.cursor_expired', 'event.resume', 'event.stream', 'file.raw.read', 'run.cancel', 'run.create', 'run.list', 'run.read', 'runtime.capabilities', 'runtime.identity', 'runtime.rename', 'session.create', 'session.list', 'session.read', 'workspace.list'])

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
