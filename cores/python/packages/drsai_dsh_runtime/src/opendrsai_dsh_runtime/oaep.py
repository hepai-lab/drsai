"""Strict OAEP v1 validation, durable journal, and snapshot projection."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from .contracts import OAEP_SCHEMA_SHA256, canonical_json_sha256
from .store import RuntimeAuthorityStore, RuntimeStoreError


class OaepValidationError(ValueError):
    """Raised when a value violates the pinned OAEP contract."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class OaepCursorExpired(OaepValidationError):
    """Signals that a replay cursor must recover from the attached snapshot."""

    def __init__(self, *, expired_through: int, snapshot: Mapping[str, Any]):
        super().__init__("oaep_cursor_expired")
        self.expired_through = expired_through
        self.snapshot = dict(snapshot)


def _schema_bytes(schema_path: Path | None) -> bytes:
    if schema_path is not None:
        return Path(schema_path).read_bytes()
    packaged = resources.files(__package__).joinpath("protocol_data/oaep.schema.json")
    if packaged.is_file():
        return packaged.read_bytes()
    # Editable source checkout: cores/python/packages/<package>/src/<module>/oaep.py
    checkout = Path(__file__).resolve().parents[5] / "protocol" / "oaep" / "oaep.schema.json"
    if checkout.is_file():
        return checkout.read_bytes()
    raise OaepValidationError("oaep_schema_missing")


class OaepProtocol:
    """Validators built from the exact schema identity advertised by the bridge."""

    def __init__(self, schema_path: Path | None = None) -> None:
        raw = _schema_bytes(schema_path)
        if hashlib.sha256(raw).hexdigest() != OAEP_SCHEMA_SHA256:
            raise OaepValidationError("oaep_schema_digest_mismatch")
        self.schema = json.loads(raw)
        Draft202012Validator.check_schema(self.schema)
        common = {"$schema": self.schema["$schema"], "$defs": self.schema["$defs"]}
        self._event = Draft202012Validator({**common, "$ref": "#/$defs/event"})
        self._snapshot = Draft202012Validator({**common, "$ref": "#/$defs/snapshot"})
        self._page = Draft202012Validator({**common, "$ref": "#/$defs/eventPage"})

    @staticmethod
    def _validate(validator: Draft202012Validator, value: Mapping[str, Any], code: str) -> None:
        try:
            validator.validate(dict(value))
        except ValidationError as exc:
            raise OaepValidationError(code) from exc

    def validate_event(self, value: Mapping[str, Any]) -> None:
        self._validate(self._event, value, "oaep_event_invalid")

    def validate_snapshot(self, value: Mapping[str, Any]) -> None:
        self._validate(self._snapshot, value, "oaep_snapshot_invalid")

    def validate_event_page(self, value: Mapping[str, Any]) -> None:
        self._validate(self._page, value, "oaep_event_page_invalid")


_ITEM_TERMINAL = frozenset({"completed", "failed", "cancelled"})
_EVENT_ITEM_STATUS = {
    "event.item.created": "pending",
    "event.item.started": "running",
    "event.item.completed": "completed",
    "event.item.failed": "failed",
    "event.item.cancelled": "cancelled",
}
_RUN_STATUS = {
    "queued": "queued",
    "starting": "running",
    "running": "running",
    "waiting": "waiting",
    "outcome_unknown": "waiting",
    "completed": "completed",
    "failed": "failed",
    "cancelled": "cancelled",
}


class OaepJournal:
    """Session-scoped append-only events with an atomic current-Item projection."""

    def __init__(self, store: RuntimeAuthorityStore, protocol: OaepProtocol | None = None) -> None:
        self.store = store
        self.protocol = protocol or OaepProtocol()
        self._changed = threading.Condition()

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _json(value: Mapping[str, Any]) -> str:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))

    def append(
        self,
        session_id: str,
        *,
        event_type: str,
        dedupe_key: str,
        source: Mapping[str, Any],
        data: Mapping[str, Any],
        run_id: str | None = None,
        item_id: str | None = None,
        event_id: str | None = None,
        timestamp: str | None = None,
    ) -> dict[str, Any]:
        if not dedupe_key:
            raise OaepValidationError("oaep_dedupe_key_missing")
        semantic = {
            "session_id": session_id,
            "run_id": run_id,
            "item_id": item_id,
            "type": event_type,
            "source": dict(source),
            "data": dict(data),
        }
        payload_digest = canonical_json_sha256(semantic)
        with self.store._lock, self.store._transaction():
            session = self.store._db.execute(
                "SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)
            ).fetchone()
            if session is None:
                raise RuntimeStoreError("session_not_found", "Session was not found")
            prior = self.store._db.execute(
                "SELECT payload_digest,event_json FROM oaep_events WHERE session_id=? AND dedupe_key=?",
                (session_id, dedupe_key),
            ).fetchone()
            if prior is not None:
                if prior["payload_digest"] != payload_digest:
                    raise OaepValidationError("oaep_dedupe_conflict")
                return json.loads(prior["event_json"])
            if run_id is not None:
                run = self.store._db.execute(
                    "SELECT session_id FROM runtime_runs WHERE run_id=?", (run_id,)
                ).fetchone()
                if run is None or run["session_id"] != session_id:
                    raise OaepValidationError("oaep_run_session_mismatch")
            row = self.store._db.execute(
                "SELECT last_sequence FROM oaep_session_sequences WHERE session_id=?", (session_id,)
            ).fetchone()
            sequence = (int(row["last_sequence"]) if row else 0) + 1
            event: dict[str, Any] = {
                "version": "1.0",
                "event_id": event_id or f"event-{uuid.uuid4().hex}",
                "session_id": session_id,
                "sequence": sequence,
                "type": event_type,
                "timestamp": timestamp or self._now(),
                "dedupe_key": dedupe_key,
                "source": dict(source),
                "data": dict(data),
            }
            if run_id is not None:
                event["run_id"] = run_id
            if item_id is not None:
                event["item_id"] = item_id
            self.protocol.validate_event(event)
            self._project_item(event)
            encoded = self._json(event)
            self.store._db.execute(
                "INSERT INTO oaep_events(session_id,sequence,event_id,run_id,item_id,event_type,dedupe_key,"
                "payload_digest,event_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (session_id, sequence, event["event_id"], run_id, item_id, event_type, dedupe_key,
                 payload_digest, encoded, event["timestamp"]),
            )
            self.store._db.execute(
                "INSERT INTO oaep_session_sequences(session_id,last_sequence) VALUES(?,?) "
                "ON CONFLICT(session_id) DO UPDATE SET last_sequence=excluded.last_sequence",
                (session_id, sequence),
            )
        with self._changed:
            self._changed.notify_all()
        return event

    def _project_item(self, event: Mapping[str, Any]) -> None:
        event_type = str(event["type"])
        if not event_type.startswith("event.item.") or event_type == "event.item.delta":
            return
        data = event["data"]
        item = data.get("item") if isinstance(data, Mapping) else None
        if not isinstance(item, Mapping):
            raise OaepValidationError("oaep_item_payload_missing")
        value = dict(item)
        identities = (value.get("id"), value.get("session_id"), value.get("run_id"))
        if identities != (event.get("item_id"), event["session_id"], event.get("run_id")):
            raise OaepValidationError("oaep_item_identity_mismatch")
        expected = _EVENT_ITEM_STATUS.get(event_type)
        if expected is not None and value.get("status") != expected:
            raise OaepValidationError("oaep_item_status_mismatch")
        prior = self.store._db.execute(
            "SELECT * FROM oaep_items WHERE item_id=?", (event["item_id"],)
        ).fetchone()
        if prior is not None:
            if prior["session_id"] != event["session_id"] or prior["run_id"] != event["run_id"]:
                raise OaepValidationError("oaep_item_identity_changed")
            if prior["item_type"] != value["type"] or prior["item_sequence"] != value["sequence"]:
                raise OaepValidationError("oaep_item_identity_changed")
            if prior["item_status"] in _ITEM_TERMINAL:
                raise OaepValidationError("oaep_item_after_terminal")
            revision = int(prior["revision"]) + 1
            self.store._db.execute(
                "UPDATE oaep_items SET item_status=?,revision=?,event_sequence=?,item_json=? WHERE item_id=?",
                (value["status"], revision, event["sequence"], self._json(value), event["item_id"]),
            )
        else:
            if event_type != "event.item.created":
                raise OaepValidationError("oaep_item_not_created")
            try:
                self.store._db.execute(
                    "INSERT INTO oaep_items(item_id,session_id,run_id,item_type,item_status,item_sequence,"
                    "revision,event_sequence,item_json) VALUES(?,?,?,?,?,?,?,?,?)",
                    (event["item_id"], event["session_id"], event["run_id"], value["type"], value["status"],
                     value["sequence"], 1, event["sequence"], self._json(value)),
                )
            except sqlite3.IntegrityError as exc:
                raise OaepValidationError("oaep_item_sequence_conflict") from exc

    def event_page(self, session_id: str, *, after_sequence: int = 0, limit: int = 100) -> dict[str, Any]:
        if after_sequence < 0 or not 1 <= limit <= 500:
            raise OaepValidationError("oaep_cursor_invalid")
        self.store.require_session(session_id)
        with self.store._lock:
            retention = self.store._db.execute(
                "SELECT expired_through FROM oaep_retention WHERE session_id=?", (session_id,)
            ).fetchone()
            expired_through = int(retention["expired_through"]) if retention else 0
            if after_sequence < expired_through:
                raise OaepCursorExpired(
                    expired_through=expired_through,
                    snapshot=self.snapshot(session_id),
                )
            rows = self.store._db.execute(
                "SELECT event_json FROM oaep_events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?",
                (session_id, after_sequence, limit + 1),
            ).fetchall()
        has_more = len(rows) > limit
        data = [json.loads(row["event_json"]) for row in rows[:limit]]
        page = {
            "version": "1.0",
            "object": "list",
            "data": data,
            "next_sequence": data[-1]["sequence"] if data else after_sequence,
            "has_more": has_more,
        }
        self.protocol.validate_event_page(page)
        return page

    def expire_through(self, session_id: str, sequence: int) -> int:
        """Advance the retained replay floor without changing the projection."""

        if sequence < 0:
            raise OaepValidationError("oaep_retention_invalid")
        self.store.require_session(session_id)
        with self.store._lock, self.store._transaction():
            waterline = self.store._db.execute(
                "SELECT last_sequence FROM oaep_session_sequences WHERE session_id=?", (session_id,)
            ).fetchone()
            last_sequence = int(waterline["last_sequence"]) if waterline else 0
            if sequence > last_sequence:
                raise OaepValidationError("oaep_retention_beyond_waterline")
            prior = self.store._db.execute(
                "SELECT expired_through FROM oaep_retention WHERE session_id=?", (session_id,)
            ).fetchone()
            floor = max(sequence, int(prior["expired_through"]) if prior else 0)
            self.store._db.execute(
                "DELETE FROM oaep_events WHERE session_id=? AND sequence<=?", (session_id, floor)
            )
            self.store._db.execute(
                "INSERT INTO oaep_retention(session_id,expired_through) VALUES(?,?) "
                "ON CONFLICT(session_id) DO UPDATE SET expired_through=excluded.expired_through",
                (session_id, floor),
            )
        return floor

    def wait_event_page(
        self, session_id: str, *, after_sequence: int, limit: int = 100, timeout: float = 30.0
    ) -> dict[str, Any]:
        deadline = time.monotonic() + max(0.0, timeout)
        while True:
            page = self.event_page(session_id, after_sequence=after_sequence, limit=limit)
            if page["data"] or time.monotonic() >= deadline:
                return page
            with self._changed:
                self._changed.wait(timeout=min(0.25, max(0.0, deadline - time.monotonic())))

    def snapshot(self, session_id: str) -> dict[str, Any]:
        session = self.store.require_session(session_id)
        with self.store._lock:
            runs = self.store._db.execute(
                "SELECT * FROM runtime_runs WHERE session_id=? ORDER BY created_at,run_id", (session_id,)
            ).fetchall()
            item_rows = self.store._db.execute(
                "SELECT item_json FROM oaep_items WHERE session_id=? ORDER BY run_id,item_sequence",
                (session_id,),
            ).fetchall()
            sequence_row = self.store._db.execute(
                "SELECT last_sequence FROM oaep_session_sequences WHERE session_id=?", (session_id,)
            ).fetchone()
        oaep_session = {
            "id": session["session_id"],
            "workspace_id": session["workspace_id"],
            "status": session["status"],
            "backend": "deepseek-harness",
            "created_at": session["created_at"],
            "updated_at": session["updated_at"],
        }
        if session.get("title"):
            oaep_session["title"] = session["title"]
        oaep_runs = []
        for index, run in enumerate(runs, 1):
            value = {
                "id": run["run_id"],
                "session_id": session_id,
                "sequence": index,
                "source": {"backend": "deepseek-harness", "adapter": "opendrsai-dsh-runtime"},
                "status": _RUN_STATUS[run["status"]],
                "created_at": run["created_at"],
                "updated_at": run["updated_at"],
            }
            value["completed_at"] = run["updated_at"] if run["status"] in _ITEM_TERMINAL else None
            oaep_runs.append(value)
        items = [json.loads(row["item_json"]) for row in item_rows]
        snapshot_sequence = int(sequence_row["last_sequence"]) if sequence_row else 0
        base = {
            "version": "1.0",
            "session": oaep_session,
            "runs": oaep_runs,
            "items": items,
            "snapshot_sequence": snapshot_sequence,
        }
        snapshot = {
            **base,
            "checkpoint": {
                "sequence": snapshot_sequence,
                "snapshot_hash": canonical_json_sha256(base),
                "item_count": len(items),
            },
        }
        self.protocol.validate_snapshot(snapshot)
        return snapshot
