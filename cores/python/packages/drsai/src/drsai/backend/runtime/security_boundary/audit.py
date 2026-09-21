"""Tamper-evident append-only journal for security boundary decisions."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .models import canonical_digest, canonical_json, redact_for_display


class SecurityAuditError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SecurityAuditEvent:
    sequence: int
    event_id: str
    event_type: str
    subject_id: str
    payload: Mapping[str, Any]
    previous_digest: str
    event_digest: str
    created_at: float


class SecurityEventJournal:
    GENESIS_DIGEST = "sha256:" + "0" * 64

    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            self.initialize_in_transaction(db)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def initialize_in_transaction(db: sqlite3.Connection) -> None:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS runtime_security_events(
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL UNIQUE,
                event_type TEXT NOT NULL,
                subject_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                previous_digest TEXT NOT NULL,
                event_digest TEXT NOT NULL UNIQUE,
                created_at REAL NOT NULL
            );
            CREATE TRIGGER IF NOT EXISTS runtime_security_events_no_update
            BEFORE UPDATE ON runtime_security_events BEGIN SELECT RAISE(ABORT, 'security event is append-only'); END;
            CREATE TRIGGER IF NOT EXISTS runtime_security_events_no_delete
            BEFORE DELETE ON runtime_security_events BEGIN SELECT RAISE(ABORT, 'security event is append-only'); END;
        """)

    @staticmethod
    def _digest_payload(
        *, event_id: str, event_type: str, subject_id: str, payload_json: str,
        previous_digest: str, created_at: float,
    ) -> str:
        return canonical_digest({
            "event_id": event_id,
            "event_type": event_type,
            "subject_id": subject_id,
            "payload": json.loads(payload_json),
            "previous_digest": previous_digest,
            "created_at": created_at,
        })

    def append_in_transaction(
        self,
        db: sqlite3.Connection,
        event_type: str,
        subject_id: str,
        payload: Mapping[str, Any],
        *,
        now: float | None = None,
        event_id: str | None = None,
    ) -> SecurityAuditEvent:
        if not event_type or not subject_id:
            raise SecurityAuditError("security_event_identity_missing", "Event type and subject are required.")
        # SQLite REAL reads back as float; normalize before hashing so a test
        # or caller supplying integer epoch seconds has the same identity.
        created_at = float(time.time() if now is None else now)
        safe_payload = redact_for_display(payload)
        payload_json = canonical_json(safe_payload)
        previous = db.execute(
            "SELECT event_digest FROM runtime_security_events ORDER BY sequence DESC LIMIT 1",
        ).fetchone()
        previous_digest = str(previous[0]) if previous is not None else self.GENESIS_DIGEST
        stable_event_id = event_id or f"security-event-{uuid.uuid4()}"
        event_digest = self._digest_payload(
            event_id=stable_event_id,
            event_type=event_type,
            subject_id=subject_id,
            payload_json=payload_json,
            previous_digest=previous_digest,
            created_at=created_at,
        )
        cursor = db.execute(
            "INSERT INTO runtime_security_events(event_id,event_type,subject_id,payload_json,previous_digest,event_digest,created_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (stable_event_id, event_type, subject_id, payload_json, previous_digest, event_digest, created_at),
        )
        return SecurityAuditEvent(
            sequence=int(cursor.lastrowid),
            event_id=stable_event_id,
            event_type=event_type,
            subject_id=subject_id,
            payload=safe_payload,
            previous_digest=previous_digest,
            event_digest=event_digest,
            created_at=created_at,
        )

    def append(
        self, event_type: str, subject_id: str, payload: Mapping[str, Any], *, now: float | None = None,
    ) -> SecurityAuditEvent:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            event = self.append_in_transaction(db, event_type, subject_id, payload, now=now)
            db.commit()
        return event

    def list(self) -> list[SecurityAuditEvent]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM runtime_security_events ORDER BY sequence").fetchall()
        return [SecurityAuditEvent(
            sequence=int(row["sequence"]),
            event_id=str(row["event_id"]),
            event_type=str(row["event_type"]),
            subject_id=str(row["subject_id"]),
            payload=json.loads(str(row["payload_json"])),
            previous_digest=str(row["previous_digest"]),
            event_digest=str(row["event_digest"]),
            created_at=float(row["created_at"]),
        ) for row in rows]

    def verify(self) -> None:
        previous_digest = self.GENESIS_DIGEST
        expected_sequence: int | None = None
        with self._connect() as db:
            rows = db.execute("SELECT * FROM runtime_security_events ORDER BY sequence").fetchall()
        for row in rows:
            sequence = int(row["sequence"])
            if expected_sequence is not None and sequence != expected_sequence:
                raise SecurityAuditError("security_event_sequence_gap", "Security event sequence has a gap.")
            if str(row["previous_digest"]) != previous_digest:
                raise SecurityAuditError("security_event_chain_broken", "Security event chain predecessor is invalid.")
            computed = self._digest_payload(
                event_id=str(row["event_id"]),
                event_type=str(row["event_type"]),
                subject_id=str(row["subject_id"]),
                payload_json=str(row["payload_json"]),
                previous_digest=previous_digest,
                created_at=float(row["created_at"]),
            )
            if computed != str(row["event_digest"]):
                raise SecurityAuditError("security_event_digest_invalid", "Security event content was modified.")
            previous_digest = computed
            expected_sequence = sequence + 1
