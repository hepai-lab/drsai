from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .generated_contract import (
    PROTOCOL_VERSION,
    GeneratedControlRequest,
    GeneratedConversationSnapshot,
    GeneratedErrorEnvelope,
    GeneratedRelayEvent,
    GeneratedRuntimeSessionEventFrame,
    GeneratedSessionConversationItem,
    GeneratedSessionEvent,
)


def session_conversation_digest(items: list[dict[str, Any]]) -> str:
    """Hash the converged, user-visible Session transcript across clients."""
    fields = (
        "item_id",
        "session_id",
        "run_id",
        "kind",
        "role",
        "revision",
        "session_sequence",
        "source_client",
        "source_message_id",
        "payload",
    )
    canonical = [
        {field: item.get(field) for field in fields}
        for item in sorted(
            items,
            key=lambda item: (int(item["session_sequence"]), str(item["item_id"])),
        )
    ]
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RuntimeStatus(StrEnum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    REVOKED = "revoked"


class ResourceLifecycle(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    REMOVED = "removed"


class SessionEventKind(StrEnum):
    SESSION_UPDATED = "session.updated"
    RUN_CREATED = "run.created"
    RUN_STATE_CHANGED = "run.state.changed"
    CONVERSATION_ITEM_CREATED = "conversation.item.created"
    CONVERSATION_ITEM_DELTA = "conversation.item.delta"
    CONVERSATION_ITEM_UPSERT = "conversation.item.upsert"
    TOOL_STATE_CHANGED = "tool.state.changed"
    APPROVAL_CREATED = "approval.created"
    APPROVAL_DECIDED = "approval.decided"
    ARTIFACT_CREATED = "artifact.created"
    SESSION_ARCHIVED = "session.archived"
    SESSION_REMOVED = "session.removed"


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


class SessionConversationItem(GeneratedSessionConversationItem):
    revision: int = Field(ge=1)
    session_sequence: int = Field(ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class ConversationSnapshot(GeneratedConversationSnapshot):
    snapshot_sequence: int = Field(ge=0)
    items: list[SessionConversationItem]


class SessionEvent(GeneratedSessionEvent):
    session_sequence: int = Field(ge=1)
    kind: SessionEventKind
    payload: dict[str, Any] = Field(default_factory=dict)


class RuntimeSessionEventFrame(GeneratedRuntimeSessionEventFrame):
    session_sequence: int = Field(ge=1)
    event: SessionEvent

    @model_validator(mode="after")
    def validate_event_scope(self) -> Self:
        if self.session_id != self.event.session_id:
            raise ValueError("frame session_id must match event session_id")
        if self.session_sequence != self.event.session_sequence:
            raise ValueError("frame session_sequence must match event session_sequence")
        return self


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


class AssociationPresenceRequest(StrictModel):
    accessing: bool = False


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
