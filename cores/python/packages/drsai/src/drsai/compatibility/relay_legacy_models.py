"""Frozen DTOs for the pre-OAEP Conversation and Session Event contract."""

from __future__ import annotations

import hashlib
import json
from enum import StrEnum
from typing import Any, Self

from pydantic import Field, model_validator

from drsai.relay.generated_contract import (
    GeneratedConversationSnapshot,
    GeneratedRuntimeSessionEventFrame,
    GeneratedSessionConversationItem,
    GeneratedSessionEvent,
)


def session_conversation_digest(items: list[dict[str, Any]]) -> str:
    fields = (
        "item_id", "session_id", "run_id", "kind", "role", "revision",
        "session_sequence", "source_client", "source_message_id", "payload",
    )
    canonical = [
        {field: item.get(field) for field in fields}
        for item in sorted(
            items, key=lambda item: (int(item["session_sequence"]), str(item["item_id"])),
        )
    ]
    encoded = json.dumps(
        canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


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
    item_id: str | None = None
    item_revision: int | None = Field(default=None, ge=1)
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
