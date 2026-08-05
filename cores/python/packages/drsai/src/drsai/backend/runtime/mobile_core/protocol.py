"""Versioned Android runtime bridge messages.

This module deliberately uses only the Python standard library so importing the
mobile protocol never pulls server, database, UI, or model-provider packages.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import json
from typing import Any, Mapping


PROTOCOL_VERSION = 1
MAX_IDENTIFIER_LENGTH = 128
MAX_IDEMPOTENCY_KEY_LENGTH = 256


class MessageType(StrEnum):
    START_RUN = "start_run"
    CANCEL_RUN = "cancel_run"
    RESUME_RUN = "resume_run"
    MODEL_CHUNK = "model_chunk"
    MODEL_COMPLETED = "model_completed"
    MODEL_FAILED = "model_failed"
    TOOL_RESULT = "tool_result"
    APPROVAL_RESULT = "approval_result"
    ARTIFACT_RESULT = "artifact_result"
    LIFECYCLE_CHANGED = "lifecycle_changed"
    RUNTIME_EVENT = "runtime_event"
    MODEL_REQUEST = "model_request"
    TOOL_CALL_REQUEST = "tool_call_request"
    APPROVAL_REQUEST = "approval_request"
    CHECKPOINT_REQUEST = "checkpoint_request"
    ARTIFACT_REQUEST = "artifact_request"


@dataclass(frozen=True, slots=True)
class RuntimeEnvelope:
    message_type: MessageType
    request_id: str
    run_id: str
    session_id: str
    sequence: int
    idempotency_key: str
    payload: Mapping[str, Any]
    protocol_version: int = PROTOCOL_VERSION

    def __post_init__(self) -> None:
        if self.protocol_version != PROTOCOL_VERSION:
            raise ValueError("unsupported_protocol_version")
        self._require_identifier("request_id", self.request_id)
        self._require_identifier("run_id", self.run_id)
        self._require_identifier("session_id", self.session_id)
        if not self.idempotency_key or len(self.idempotency_key) > MAX_IDEMPOTENCY_KEY_LENGTH:
            raise ValueError("idempotency_key_invalid")
        if self.sequence < 0:
            raise ValueError("sequence_invalid")
        if not isinstance(self.payload, Mapping):
            raise ValueError("payload_must_be_object")

    @staticmethod
    def _require_identifier(name: str, value: str) -> None:
        if not value or len(value) > MAX_IDENTIFIER_LENGTH:
            raise ValueError(f"{name}_invalid")

    def to_dict(self) -> dict[str, Any]:
        return {
            "protocol_version": self.protocol_version,
            "message_type": self.message_type.value,
            "request_id": self.request_id,
            "run_id": self.run_id,
            "session_id": self.session_id,
            "sequence": self.sequence,
            "idempotency_key": self.idempotency_key,
            "payload": dict(self.payload),
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> RuntimeEnvelope:
        expected = {
            "protocol_version", "message_type", "request_id", "run_id", "session_id",
            "sequence", "idempotency_key", "payload",
        }
        if set(value) != expected:
            raise ValueError("envelope_fields_invalid")
        try:
            message_type = MessageType(value["message_type"])
        except (ValueError, TypeError) as error:
            raise ValueError("message_type_invalid") from error
        return cls(
            protocol_version=value["protocol_version"],
            message_type=message_type,
            request_id=value["request_id"],
            run_id=value["run_id"],
            session_id=value["session_id"],
            sequence=value["sequence"],
            idempotency_key=value["idempotency_key"],
            payload=value["payload"],
        )

    @classmethod
    def from_json(cls, value: str) -> RuntimeEnvelope:
        decoded = json.loads(value)
        if not isinstance(decoded, dict):
            raise ValueError("envelope_must_be_object")
        return cls.from_dict(decoded)
