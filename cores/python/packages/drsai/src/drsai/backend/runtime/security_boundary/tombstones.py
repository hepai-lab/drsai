"""Durable catalog for recoverable file deletion, restore and purge."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .sandbox import SandboxError


class TombstoneError(SandboxError):
    pass


@dataclass(frozen=True)
class TombstoneRecord:
    tombstone_id: str
    deletion_execution_id: str
    run_id: str
    profile_digest: str
    source_payload_digest: str
    state: str
    restore_execution_id: str | None
    destination_payload_digest: str | None
    purge_execution_id: str | None
    created_at: float
    updated_at: float
    error_code: str | None = None


class TombstoneStore:
    def __init__(self, database: Path, *, clock: Callable[[], float] = time.time):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_filesystem_tombstones(
                    tombstone_id TEXT PRIMARY KEY, deletion_execution_id TEXT NOT NULL UNIQUE,
                    run_id TEXT NOT NULL, profile_digest TEXT NOT NULL,
                    source_payload_digest TEXT NOT NULL, state TEXT NOT NULL,
                    restore_execution_id TEXT UNIQUE, destination_payload_digest TEXT,
                    purge_execution_id TEXT UNIQUE, created_at REAL NOT NULL,
                    updated_at REAL NOT NULL, error_code TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_filesystem_tombstone_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, tombstone_id TEXT NOT NULL,
                    state TEXT NOT NULL, detail TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_filesystem_tombstone_events_no_update
                BEFORE UPDATE ON runtime_filesystem_tombstone_events BEGIN SELECT RAISE(ABORT, 'tombstone events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_filesystem_tombstone_events_no_delete
                BEFORE DELETE ON runtime_filesystem_tombstone_events BEGIN SELECT RAISE(ABORT, 'tombstone events are append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row) -> TombstoneRecord:
        return TombstoneRecord(
            tombstone_id=str(row["tombstone_id"]), deletion_execution_id=str(row["deletion_execution_id"]),
            run_id=str(row["run_id"]), profile_digest=str(row["profile_digest"]),
            source_payload_digest=str(row["source_payload_digest"]), state=str(row["state"]),
            restore_execution_id=row["restore_execution_id"], destination_payload_digest=row["destination_payload_digest"],
            purge_execution_id=row["purge_execution_id"], created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]), error_code=row["error_code"],
        )

    def get(self, tombstone_id: str) -> TombstoneRecord:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_filesystem_tombstones WHERE tombstone_id=?", (tombstone_id,)).fetchone()
        if row is None:
            raise TombstoneError("tombstone_missing", "Tombstone does not exist.")
        return self._from_row(row)

    def get_by_deletion_execution(self, execution_id: str) -> TombstoneRecord:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_filesystem_tombstones WHERE deletion_execution_id=?", (execution_id,),
            ).fetchone()
        if row is None:
            raise TombstoneError("tombstone_missing", "Tombstone does not exist.")
        return self._from_row(row)

    def _event(self, db: sqlite3.Connection, tombstone_id: str, state: str, detail: str, now: float) -> None:
        db.execute(
            "INSERT INTO runtime_filesystem_tombstone_events(tombstone_id,state,detail,created_at) VALUES(?,?,?,?)",
            (tombstone_id, state, detail, now),
        )

    def prepare(
        self, *, tombstone_id: str, deletion_execution_id: str, run_id: str,
        profile_digest: str, source_payload_digest: str,
    ) -> TombstoneRecord:
        now = self.clock()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM runtime_filesystem_tombstones WHERE deletion_execution_id=? OR tombstone_id=?",
                (deletion_execution_id, tombstone_id),
            ).fetchone()
            if existing is not None:
                record = self._from_row(existing)
                expected = (tombstone_id, deletion_execution_id, run_id, profile_digest, source_payload_digest)
                actual = (
                    record.tombstone_id, record.deletion_execution_id, record.run_id,
                    record.profile_digest, record.source_payload_digest,
                )
                db.rollback()
                if actual != expected:
                    raise TombstoneError("tombstone_scope_mismatch", "Tombstone identity was reused with different scope.")
                return record
            db.execute(
                "INSERT INTO runtime_filesystem_tombstones VALUES(?,?,?,?,?,'prepared',NULL,NULL,NULL,?,?,NULL)",
                (tombstone_id, deletion_execution_id, run_id, profile_digest, source_payload_digest, now, now),
            )
            self._event(db, tombstone_id, "prepared", "", now)
            db.commit()
        return self.get(tombstone_id)

    def _transition(
        self, tombstone_id: str, *, expected: tuple[str, ...], state: str,
        error_code: str | None = None, fields: dict[str, str] | None = None,
    ) -> TombstoneRecord:
        fields = fields or {}
        allowed = {"restore_execution_id", "destination_payload_digest", "purge_execution_id"}
        if set(fields) - allowed:
            raise ValueError("Unsupported tombstone field.")
        now = self.clock()
        placeholders = ",".join("?" for _ in expected)
        assignments = ["state=?", "updated_at=?", "error_code=?"] + [f"{key}=?" for key in fields]
        values = [state, now, error_code, *fields.values(), tombstone_id, *expected]
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                f"UPDATE runtime_filesystem_tombstones SET {','.join(assignments)} "
                f"WHERE tombstone_id=? AND state IN ({placeholders})",
                values,
            ).rowcount
            if changed != 1:
                db.rollback()
                raise TombstoneError("tombstone_state_conflict", "Tombstone is not in the required state.")
            self._event(db, tombstone_id, state, error_code or "", now)
            db.commit()
        return self.get(tombstone_id)

    def mark_moved(self, tombstone_id: str) -> TombstoneRecord:
        return self._transition(tombstone_id, expected=("prepared", "delete_unknown"), state="moved")

    def mark_delete_unknown(self, tombstone_id: str, error_code: str) -> TombstoneRecord:
        return self._transition(tombstone_id, expected=("prepared",), state="delete_unknown", error_code=error_code)

    def claim_restore(self, tombstone_id: str, execution_id: str, destination_payload_digest: str) -> TombstoneRecord:
        return self._transition(
            tombstone_id, expected=("moved",), state="restoring",
            fields={"restore_execution_id": execution_id, "destination_payload_digest": destination_payload_digest},
        )

    def release_restore(self, tombstone_id: str, execution_id: str) -> TombstoneRecord:
        record = self.get(tombstone_id)
        if record.state != "restoring" or record.restore_execution_id != execution_id:
            raise TombstoneError("tombstone_restore_claim_mismatch", "Restore claim does not match.")
        return self._transition(tombstone_id, expected=("restoring",), state="moved")

    def mark_restored(self, tombstone_id: str, execution_id: str) -> TombstoneRecord:
        record = self.get(tombstone_id)
        if record.restore_execution_id != execution_id:
            raise TombstoneError("tombstone_restore_claim_mismatch", "Restore claim does not match.")
        return self._transition(tombstone_id, expected=("restoring",), state="restored")

    def claim_purge(self, tombstone_id: str, execution_id: str) -> TombstoneRecord:
        return self._transition(
            tombstone_id, expected=("moved",), state="purging",
            fields={"purge_execution_id": execution_id},
        )

    def release_purge(self, tombstone_id: str, execution_id: str) -> TombstoneRecord:
        record = self.get(tombstone_id)
        if record.state != "purging" or record.purge_execution_id != execution_id:
            raise TombstoneError("tombstone_purge_claim_mismatch", "Purge claim does not match.")
        return self._transition(tombstone_id, expected=("purging",), state="moved")

    def mark_purged(self, tombstone_id: str, execution_id: str) -> TombstoneRecord:
        record = self.get(tombstone_id)
        if record.purge_execution_id != execution_id:
            raise TombstoneError("tombstone_purge_claim_mismatch", "Purge claim does not match.")
        return self._transition(tombstone_id, expected=("purging",), state="purged")
