"""Strict validation for the packaged Open Agent Event Protocol contract."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Any, Mapping

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError


class OAEPValidationError(ValueError):
    pass


class OAEPProtocol:
    def __init__(self, schema_path: Path | None = None) -> None:
        self.schema_path = Path(schema_path) if schema_path else Path(__file__).with_name(
            "oaep.schema.json"
        )
        self.schema = json.loads(self.schema_path.read_text(encoding="utf-8"))
        self.schema_hash = hashlib.sha256(self.schema_path.read_bytes()).hexdigest()
        Draft202012Validator.check_schema(self.schema)
        self._event_validator = Draft202012Validator({
            "$schema": self.schema["$schema"],
            "$defs": self.schema["$defs"],
            "$ref": "#/$defs/event",
        })
        self._snapshot_validator = Draft202012Validator(self.schema)
        self._event_page_validator = Draft202012Validator({
            "$schema": self.schema["$schema"],
            "$defs": self.schema["$defs"],
            "$ref": "#/$defs/eventPage",
        })

    def validate_event(self, event: Mapping[str, Any]) -> None:
        try:
            self._event_validator.validate(dict(event))
        except ValidationError as exc:
            raise OAEPValidationError("oaep_event_invalid") from exc

    def validate_snapshot(self, snapshot: Mapping[str, Any]) -> None:
        try:
            self._snapshot_validator.validate(dict(snapshot))
        except ValidationError as exc:
            raise OAEPValidationError("oaep_snapshot_invalid") from exc

    def validate_event_page(self, page: Mapping[str, Any]) -> None:
        try:
            self._event_page_validator.validate(dict(page))
        except ValidationError as exc:
            raise OAEPValidationError("oaep_event_page_invalid") from exc


class OAEPStreamValidator:
    """Stateful semantic validation layered on top of the OAEP JSON Schema."""

    _TERMINAL_ITEMS = frozenset({
        "event.item.completed", "event.item.failed", "event.item.cancelled",
    })
    _TERMINAL_RUNS = frozenset({
        "event.run.completed", "event.run.failed", "event.run.cancelled",
    })
    _DELTA_BY_TYPE = {
        "message": {"message.text.append"},
        "reasoning": {"reasoning.segment.added", "reasoning.text.append"},
        "plan": {"plan.text.append"},
        "command_execution": {"command.output.append"},
        "tool_call": {"tool.output.append"},
        "subtask": {"subtask.summary.append"},
    }

    def __init__(self, protocol: OAEPProtocol | None = None, *, after_sequence: int = 0) -> None:
        self.protocol = protocol or OAEPProtocol()
        self.last_sequence = max(0, after_sequence)
        self.session_id: str | None = None
        self.item_types: dict[str, str] = {}
        self.item_states: dict[str, str] = {}
        self.run_states: dict[str, str] = {}

    def accept(self, event: Mapping[str, Any]) -> None:
        self.protocol.validate_event(event)
        value = dict(event)
        sequence = int(value["sequence"])
        if sequence != self.last_sequence + 1:
            raise OAEPValidationError("oaep_sequence_discontinuous")
        session_id = str(value["session_id"])
        if self.session_id is not None and session_id != self.session_id:
            raise OAEPValidationError("oaep_session_changed")
        self.session_id = session_id
        event_type = str(value["type"])
        run_id = str(value.get("run_id") or "")
        item_id = str(value.get("item_id") or "")
        data = value.get("data") if isinstance(value.get("data"), Mapping) else {}

        if event_type.startswith("event.item."):
            if not run_id or not item_id:
                raise OAEPValidationError("oaep_item_identity_missing")
            prior = self.item_states.get(item_id)
            if prior in {"completed", "failed", "cancelled"}:
                raise OAEPValidationError("oaep_item_event_after_terminal")
            if event_type == "event.item.delta":
                if prior is None:
                    raise OAEPValidationError("oaep_delta_before_item")
                delta = data.get("delta") if isinstance(data.get("delta"), Mapping) else {}
                delta_kind = str(delta.get("kind") or "")
                item_type = self.item_types.get(item_id, "")
                if delta_kind not in self._DELTA_BY_TYPE.get(item_type, set()):
                    raise OAEPValidationError("oaep_delta_item_type_mismatch")
            else:
                item = data.get("item") if isinstance(data.get("item"), Mapping) else {}
                item_type = str(item.get("type") or "")
                if not item_type:
                    raise OAEPValidationError("oaep_item_payload_missing")
                known_type = self.item_types.get(item_id)
                if known_type is not None and known_type != item_type:
                    raise OAEPValidationError("oaep_item_type_changed")
                self.item_types[item_id] = item_type
            self.item_states[item_id] = {
                "event.item.completed": "completed",
                "event.item.failed": "failed",
                "event.item.cancelled": "cancelled",
            }.get(event_type, "running")

        if event_type.startswith("event.run.") and run_id:
            prior_run = self.run_states.get(run_id)
            if prior_run in {"completed", "failed", "cancelled"}:
                raise OAEPValidationError("oaep_run_event_after_terminal")
            if event_type == "event.run.resumed" and prior_run != "waiting":
                raise OAEPValidationError("oaep_run_resumed_without_waiting")
            self.run_states[run_id] = {
                "event.run.waiting": "waiting",
                "event.run.completed": "completed",
                "event.run.failed": "failed",
                "event.run.cancelled": "cancelled",
            }.get(event_type, "running")
        self.last_sequence = sequence
