from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .generated_contract import PROTOCOL_VERSION, GeneratedControlRequest, GeneratedErrorEnvelope, GeneratedRelayEvent


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RuntimeStatus(StrEnum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    REVOKED = "revoked"


class ControlRequest(GeneratedControlRequest):
    correlation_id: str = Field(min_length=1, max_length=128)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)


class RuntimeIdentity(StrictModel):
    runtime_id: str
    instance_id: str
    version: str
    protocol_version: str = PROTOCOL_VERSION
    status: RuntimeStatus
    connection_generation: int = Field(ge=1)


class RuntimeCapabilities(StrictModel):
    values: frozenset[str]
    backend_health: dict[str, str] = Field(default_factory=dict)


class Workspace(StrictModel):
    runtime_id: str
    workspace_id: str
    display_name: str


class RuntimeSummary(StrictModel):
    runtime: RuntimeIdentity
    display_name: str


class Page(StrictModel):
    items: list[Any]
    next_cursor: str | None = None


class ErrorEnvelope(GeneratedErrorEnvelope):
    code: str
    message: str
    correlation_id: str
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)
    source: str = Field(pattern="^(relay|runtime)$")


class RelayEvent(GeneratedRelayEvent):
    event_id: str
    sequence: int = Field(ge=1)
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    kind: str
    payload: dict[str, Any] = Field(default_factory=dict)


class RegistrationRequest(ControlRequest):
    display_name: str
    version: str
    public_key: str


class RegistrationResult(StrictModel):
    runtime_id: str
    registration_token: str


class AccessGrantResult(StrictModel):
    code: str
    expires_at: datetime


class AssociationRequest(ControlRequest):
    code: str


class HeartbeatRequest(ControlRequest):
    instance_id: str
    version: str
    capabilities: frozenset[str]
    backend_health: dict[str, str] = Field(default_factory=dict)
    signature: str
    nonce: str


class WorkspacePublishRequest(ControlRequest):
    workspaces: list[Workspace]
