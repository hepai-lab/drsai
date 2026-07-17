"""Generated from protocol/relay/runtime-relay.schema.json. Do not edit."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict

SCHEMA_VERSION = '1.0.0'
PROTOCOL_VERSION = 'owop/1'
ENDPOINTS = {'event_list': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}/events', 'file_raw': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/files/raw', 'run_cancel': 'POST /v1/runtimes/{runtime_id}/runs/{run_id}/cancel', 'run_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs', 'run_read': 'GET /v1/runtimes/{runtime_id}/runs/{run_id}', 'runtime_capabilities': 'GET /v1/runtimes/{runtime_id}/capabilities', 'runtime_identity': 'GET /v1/runtimes/{runtime_id}/runtime', 'runtime_list': 'GET /v1/runtimes', 'session_create': 'POST /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'session_list': 'GET /v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions', 'workspace_list': 'GET /v1/runtimes/{runtime_id}/workspaces'}
CAPABILITIES = frozenset(['event.resume', 'file.raw.read', 'run.cancel', 'run.create', 'run.read', 'runtime.capabilities', 'runtime.identity', 'session.create', 'session.list', 'workspace.list'])

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
