"""Durable emergency switches that revoke authority without deleting history."""

from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.authorization import ApprovalService, ApprovalServiceError
from drsai.backend.runtime.security_boundary import AuthorizationGrantStore
from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.sqlite_connection import ClosingConnection


_SWITCH_MODES = {
    "auto_reviewer": "auto_reviewed",
    "isolated_full_access": "isolated_full_access",
}


@dataclass(frozen=True)
class KillSwitchResult:
    switch_name: str
    active: bool
    affected_runs: int
    revoked_grants: int
    cancelled_requests: int
    event_id: str


class PermissionKillSwitchService:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.grants = AuthorizationGrantStore(self.database)
        self.approvals = ApprovalService(self.database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_permission_kill_switch_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    switch_name TEXT NOT NULL CHECK(switch_name IN ('auto_reviewer','isolated_full_access')),
                    active INTEGER NOT NULL CHECK(active IN (0,1)),
                    reason_code TEXT NOT NULL,
                    actor_kind TEXT NOT NULL CHECK(actor_kind IN ('administrator','system')),
                    created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_permission_kill_switch_events_no_update
                BEFORE UPDATE ON runtime_permission_kill_switch_events
                BEGIN SELECT RAISE(ABORT, 'permission kill switch event is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_kill_switch_events_no_delete
                BEFORE DELETE ON runtime_permission_kill_switch_events
                BEGIN SELECT RAISE(ABORT, 'permission kill switch event is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def is_active(self, switch_name: str) -> bool:
        self._validate(switch_name)
        with self._connect() as db:
            row = db.execute(
                "SELECT active FROM runtime_permission_kill_switch_events WHERE switch_name=? "
                "ORDER BY sequence DESC LIMIT 1", (switch_name,),
            ).fetchone()
        return bool(row["active"]) if row is not None else False

    def set(
        self,
        switch_name: str,
        *,
        active: bool,
        reason_code: str,
        actor_kind: str = "administrator",
        now: float | None = None,
    ) -> KillSwitchResult:
        self._validate(switch_name)
        if actor_kind not in {"administrator", "system"} or not reason_code:
            raise ValueError("Kill switch actor and reason are required.")
        changed_at = float(time.time() if now is None else now)
        event_id = f"permission-kill-switch-{uuid.uuid4()}"
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute(
                "SELECT * FROM runtime_permission_kill_switch_events WHERE switch_name=? "
                "ORDER BY sequence DESC LIMIT 1", (switch_name,),
            ).fetchone()
            if current is not None and bool(current["active"]) == active:
                db.rollback()
                event_id = str(current["event_id"])
                if not active:
                    return KillSwitchResult(switch_name, False, 0, 0, 0, event_id)
            else:
                db.execute(
                    "INSERT INTO runtime_permission_kill_switch_events("
                    "event_id,switch_name,active,reason_code,actor_kind,created_at) VALUES(?,?,?,?,?,?)",
                    (event_id, switch_name, int(active), reason_code, actor_kind, changed_at),
                )
                self.audit.append_in_transaction(db, "permission_kill_switch.changed", event_id, {
                    "switch_name": switch_name, "active": active,
                    "reason_code": reason_code, "actor_kind": actor_kind,
                }, now=changed_at)
                db.commit()
        if not active:
            return KillSwitchResult(switch_name, False, 0, 0, 0, event_id)

        with self._connect() as db:
            mode_table = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_permission_mode_bindings'",
            ).fetchone()
            runs = [] if mode_table is None else [str(row[0]) for row in db.execute(
                "SELECT b.run_id FROM runtime_permission_mode_bindings b "
                "JOIN (SELECT run_id,MAX(sequence) AS sequence FROM runtime_permission_mode_bindings GROUP BY run_id) latest "
                "ON latest.run_id=b.run_id AND latest.sequence=b.sequence WHERE b.mode_id=? ORDER BY b.run_id",
                (_SWITCH_MODES[switch_name],),
            ).fetchall()]
        revoked = cancelled = 0
        for run_id in runs:
            revoked += self.grants.revoke_unconsumed_for_run(run_id, now=changed_at)
            for request in self.approvals.list_requests(run_id, status="pending"):
                try:
                    self.approvals.decide(
                        request.request_id, "cancelled", reviewer_kind="system",
                        reviewer_id="permission-kill-switch", reason_code="permission_kill_switch_active",
                        idempotency_key=f"kill-switch:{event_id}:{request.request_id}", now=changed_at,
                    )
                    cancelled += 1
                except ApprovalServiceError as error:
                    if error.code != "approval_request_terminal":
                        raise
        self.audit.append("permission_kill_switch.propagated", event_id, {
            "switch_name": switch_name, "affected_runs": len(runs),
            "revoked_grants": revoked, "cancelled_requests": cancelled,
        }, now=changed_at)
        return KillSwitchResult(switch_name, True, len(runs), revoked, cancelled, event_id)

    @staticmethod
    def _validate(switch_name: str) -> None:
        if switch_name not in _SWITCH_MODES:
            raise ValueError("Unknown permission kill switch.")
