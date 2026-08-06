from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from drsai.compatibility.relay_legacy_models import (
    ConversationSnapshot,
    RuntimeSessionEventFrame,
    SessionConversationItem,
    SessionEvent,
    SessionEventKind,
    session_conversation_digest,
)

from .generated_contract import (
    PROTOCOL_VERSION,
    GeneratedControlRequest,
    GeneratedErrorEnvelope,
    GeneratedRelayEvent,
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RuntimeStatus(StrEnum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    PAUSED = "paused"
    REVOKED = "revoked"


class ResourceLifecycle(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    REMOVED = "removed"


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
    last_seen_at: datetime | None = None


class RuntimeCapabilities(StrictModel):
    values: frozenset[str]
    backend_health: dict[str, str] = Field(default_factory=dict)


class Workspace(StrictModel):
    runtime_id: str
    workspace_id: str
    display_name: str
    lifecycle: ResourceLifecycle = ResourceLifecycle.ACTIVE
    revision: int = Field(default=1, ge=1)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


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
    grant_id: str
    code: str
    expires_at: datetime
    status: str = Field(pattern="^(pending|consumed|expired|revoked)$")


class AccessGrantCreateRequest(StrictModel):
    workspace_scope: str = Field(default="all", pattern="^(all|selected)$")
    workspace_ids: list[str] = Field(default_factory=list, max_length=1000)
    permissions: list[str] = Field(default_factory=lambda: ["read", "send", "approve", "files"], min_length=1, max_length=4)


class AccessGrantStatusResult(StrictModel):
    grant_id: str
    expires_at: datetime
    status: str = Field(pattern="^(pending|consumed|expired|revoked)$")
    subject_summary: str | None = Field(default=None, pattern=r"^sub_[0-9a-f]{12}$")


class AssociationResult(StrictModel):
    association_id: str
    runtime_id: str
    subject_summary: str = Field(pattern=r"^sub_[0-9a-f]{12}$")
    device_summary: str = Field(pattern=r"^dev_[0-9a-f]{12}$")
    device_name: str = Field(
        min_length=1,
        max_length=128,
        pattern=r".*\S.*",
    )
    status: str = Field(pattern="^(active|revoked)$")
    access_state: str = Field(pattern="^(online|offline|accessing|revoked)$")
    created_at: datetime
    last_seen_at: datetime | None = None
    revoked_at: datetime | None = None
    workspace_scope: str = Field(default="all", pattern="^(all|selected)$")
    workspace_ids: list[str] = Field(default_factory=list, max_length=1000)
    permissions: list[str] = Field(default_factory=list, min_length=1, max_length=4)


class AssociationPresenceRequest(StrictModel):
    accessing: bool = False


class PushRegistrationRequest(StrictModel):
    provider: str = Field(min_length=2, max_length=32, pattern=r"^[a-z][a-z0-9_-]+$")
    token: str = Field(min_length=32, max_length=4096, pattern=r".*\S.*")
    generation: int = Field(ge=1)


class PushRegistrationResult(StrictModel):
    runtime_id: str
    device_summary: str = Field(pattern=r"^dev_[0-9a-f]{12}$")
    provider: str = Field(min_length=2, max_length=32, pattern=r"^[a-z][a-z0-9_-]+$")
    generation: int = Field(ge=1)
    status: str = Field(pattern="^(active|revoked)$")
    updated_at: datetime


class AssociationDeviceKeyRotationRequest(StrictModel):
    new_device_public_key: str = Field(
        min_length=43,
        max_length=43,
        pattern=r"^[A-Za-z0-9_-]+$",
    )


class AssociationAuthorizationShrinkRequest(StrictModel):
    workspace_scope: str | None = Field(default=None, pattern="^(all|selected)$")
    workspace_ids: list[str] | None = Field(default=None, max_length=1000)
    permissions: list[str] | None = Field(default=None, min_length=1, max_length=4)


class AssociationRequest(ControlRequest):
    code: str
    device_id: str = Field(
        min_length=16,
        max_length=128,
        pattern=r"^[A-Za-z0-9._-]+$",
    )
    device_name: str = Field(
        min_length=1,
        max_length=128,
        pattern=r".*\S.*",
    )
    device_public_key: str = Field(
        min_length=43,
        max_length=43,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    workspace_scope: str = Field(default="all", pattern="^(all|selected)$")
    workspace_ids: list[str] = Field(default_factory=list, max_length=1000)
    permissions: list[str] = Field(default_factory=lambda: ["read", "send", "approve", "files"], min_length=1, max_length=4)


class HeartbeatRequest(ControlRequest):
    instance_id: str
    version: str
    capabilities: frozenset[str]
    backend_health: dict[str, str] = Field(default_factory=dict)
    signature: str
    nonce: str


class WorkspacePublishRequest(ControlRequest):
    workspaces: list[Workspace]


class WorkspaceCatalogSyncRequest(StrictModel):
    pass


class WorkspaceCatalogSyncResult(StrictModel):
    runtime_id: str
    catalog_revision: int = Field(default=0, ge=0)
    synced_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    items: list[Workspace]
