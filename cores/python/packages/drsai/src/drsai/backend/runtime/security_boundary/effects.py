"""Exactly-once Effect Execution claims and crash-safe terminal receipts."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .grants import AuthorizationGrant, AuthorizationGrantStore, GrantError
from .audit import SecurityEventJournal
from .models import ActionProposal, ResolvedCapabilityProfile
from .hard_deny import HardDenyError, HardDenyPolicy


class EffectExecutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class EffectExecution:
    execution_id: str
    grant_id: str
    run_id: str
    operation: str
    proposal_digest: str
    profile_digest: str
    attestation_digest: str
    status: str
    claimed_at: float
    completed_at: float | None = None
    receipt_digest: str | None = None
    error_code: str | None = None


class EffectExecutionStore:
    """Makes Grant consumption and Effect claim one SQLite transaction."""

    TERMINAL = frozenset({"succeeded", "failed", "timed_out", "outcome_unknown"})

    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        # Ensure the grant table exists when this store is constructed alone.
        AuthorizationGrantStore(self.database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_effect_executions(
                    execution_id TEXT PRIMARY KEY,
                    grant_id TEXT NOT NULL UNIQUE REFERENCES runtime_authorization_grants(grant_id),
                    run_id TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    proposal_digest TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    attestation_digest TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('executing','succeeded','failed','timed_out','outcome_unknown')),
                    claimed_at REAL NOT NULL,
                    completed_at REAL,
                    receipt_digest TEXT,
                    error_code TEXT
                );
                CREATE TRIGGER IF NOT EXISTS runtime_effect_executions_identity_immutable
                BEFORE UPDATE OF execution_id,grant_id,run_id,operation,proposal_digest,profile_digest,attestation_digest,claimed_at
                ON runtime_effect_executions BEGIN SELECT RAISE(ABORT, 'effect execution identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_effect_executions_no_delete
                BEFORE DELETE ON runtime_effect_executions BEGIN SELECT RAISE(ABORT, 'effect execution is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row) -> EffectExecution:
        return EffectExecution(
            execution_id=str(row["execution_id"]),
            grant_id=str(row["grant_id"]),
            run_id=str(row["run_id"]),
            operation=str(row["operation"]),
            proposal_digest=str(row["proposal_digest"]),
            profile_digest=str(row["profile_digest"]),
            attestation_digest=str(row["attestation_digest"]),
            status=str(row["status"]),
            claimed_at=float(row["claimed_at"]),
            completed_at=float(row["completed_at"]) if row["completed_at"] is not None else None,
            receipt_digest=str(row["receipt_digest"]) if row["receipt_digest"] is not None else None,
            error_code=str(row["error_code"]) if row["error_code"] is not None else None,
        )

    def get(self, execution_id: str) -> EffectExecution:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_effect_executions WHERE execution_id=?", (execution_id,),
            ).fetchone()
        if row is None:
            raise EffectExecutionError("effect_execution_missing", "Effect execution does not exist.")
        return self._from_row(row)

    def claim(
        self,
        *,
        execution_id: str,
        grant_id: str,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        actual_payload: dict[str, object],
        attestation_digest: str,
        now: float | None = None,
        commit_hook: Callable[[sqlite3.Connection], None] | None = None,
    ) -> EffectExecution:
        claimed_at = time.time() if now is None else now
        if not execution_id or not attestation_digest:
            raise EffectExecutionError("effect_execution_identity_missing", "Execution and attestation identity are required.")
        if not proposal.matches_payload(actual_payload):
            raise GrantError("proposal_payload_mismatch", "Execution payload differs from the approved proposal.")
        try:
            HardDenyPolicy().enforce(proposal)
        except HardDenyError as error:
            self.audit.append("hard_deny.blocked", proposal.proposal_id, {
                "run_id": proposal.run_id,
                "operation": proposal.operation,
                "category": error.category,
                "reason_code": error.reason_code,
                "policy_version": error.policy_version,
            }, now=claimed_at)
            raise
        if not profile.permits(proposal):
            raise GrantError("proposal_not_permitted", "The active capability profile no longer permits this proposal.")

        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            AuthorizationGrantStore._ensure_no_mode_transition(db, proposal.run_id)
            AuthorizationGrantStore._ensure_mode_not_killed(db, proposal.run_id)
            row = db.execute(
                "SELECT * FROM runtime_authorization_grants WHERE grant_id=?", (grant_id,),
            ).fetchone()
            if row is None:
                db.rollback()
                raise GrantError("grant_missing", "Authorization grant does not exist.")
            grant = AuthorizationGrantStore._from_row(row)
            expected = (proposal.run_id, proposal.payload_digest, profile.digest, proposal.operation)
            actual = (grant.run_id, grant.proposal_digest, grant.profile_digest, grant.operation)
            if actual != expected:
                db.rollback()
                raise GrantError("grant_scope_mismatch", "Authorization grant does not match this proposal and profile.")
            if grant.expires_at <= claimed_at:
                db.rollback()
                raise GrantError("grant_expired", "Authorization grant expired.")
            if grant.consumed_at is not None:
                db.rollback()
                raise GrantError("grant_already_consumed", "Authorization grant was already consumed.")
            if grant.revoked_at is not None:
                db.rollback()
                raise GrantError("grant_revoked", "Authorization grant was revoked by a security transition.")
            try:
                db.execute(
                    "INSERT INTO runtime_effect_executions VALUES(?,?,?,?,?,?,?,'executing',?,NULL,NULL,NULL)",
                    (
                        execution_id, grant_id, proposal.run_id, proposal.operation,
                        proposal.payload_digest, profile.digest, attestation_digest, claimed_at,
                    ),
                )
            except sqlite3.IntegrityError as error:
                db.rollback()
                raise EffectExecutionError(
                    "effect_execution_conflict", "Execution or Grant already has an Effect claim.",
                ) from error
            changed = db.execute(
                "UPDATE runtime_authorization_grants SET consumed_at=? "
                "WHERE grant_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
                (claimed_at, grant_id),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise GrantError("grant_already_consumed", "Authorization grant was consumed concurrently.")
            self.audit.append_in_transaction(db, "effect.claimed", execution_id, {
                "grant_id": grant_id,
                "run_id": proposal.run_id,
                "operation": proposal.operation,
                "proposal_digest": proposal.payload_digest,
                "profile_digest": profile.digest,
                "attestation_digest": attestation_digest,
            }, now=claimed_at)
            if commit_hook is not None:
                commit_hook(db)
            db.commit()
        return self.get(execution_id)

    def complete(
        self,
        execution_id: str,
        *,
        status: str,
        receipt_digest: str,
        error_code: str | None = None,
        now: float | None = None,
        commit_hook: Callable[[sqlite3.Connection], None] | None = None,
    ) -> EffectExecution:
        if status not in self.TERMINAL:
            raise EffectExecutionError("effect_status_invalid", "Effect terminal status is invalid.")
        if not receipt_digest:
            raise EffectExecutionError("effect_receipt_missing", "A terminal Effect requires a receipt digest.")
        completed_at = time.time() if now is None else now
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_effect_executions SET status=?,completed_at=?,receipt_digest=?,error_code=? "
                "WHERE execution_id=? AND status='executing'",
                (status, completed_at, receipt_digest, error_code, execution_id),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise EffectExecutionError(
                    "effect_not_executing", "Effect is missing or already terminal.",
                )
            self.audit.append_in_transaction(db, "effect.terminal", execution_id, {
                "status": status,
                "receipt_digest": receipt_digest,
                "error_code": error_code,
            }, now=completed_at)
            if commit_hook is not None:
                commit_hook(db)
            db.commit()
        return self.get(execution_id)

    def mark_outcome_unknown(
        self,
        execution_id: str,
        *,
        receipt_digest: str,
        error_code: str,
        now: float | None = None,
        commit_hook: Callable[[sqlite3.Connection], None] | None = None,
    ) -> EffectExecution:
        return self.complete(
            execution_id,
            status="outcome_unknown",
            receipt_digest=receipt_digest,
            error_code=error_code,
            now=now,
            commit_hook=commit_hook,
        )

    def reconcile_interrupted(self, *, now: float | None = None) -> int:
        completed_at = time.time() if now is None else now
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            interrupted = db.execute(
                "SELECT execution_id FROM runtime_effect_executions WHERE status='executing' ORDER BY execution_id",
            ).fetchall()
            changed = db.execute(
                "UPDATE runtime_effect_executions SET status='outcome_unknown',completed_at=?,"
                "receipt_digest='recovery:no-terminal-receipt',error_code='runtime_interrupted' "
                "WHERE status='executing'",
                (completed_at,),
            ).rowcount
            for row in interrupted:
                self.audit.append_in_transaction(db, "effect.recovered_unknown", str(row["execution_id"]), {
                    "status": "outcome_unknown",
                    "receipt_digest": "recovery:no-terminal-receipt",
                    "error_code": "runtime_interrupted",
                }, now=completed_at)
            db.commit()
        return int(changed)
