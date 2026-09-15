"""Persistent, proposal-bound, single-use authorization grants."""

from __future__ import annotations

import secrets
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .models import ActionProposal, ResolvedCapabilityProfile
from .hard_deny import HardDenyPolicy
from .hard_deny import HardDenyError
from .audit import SecurityEventJournal


class GrantError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AuthorizationGrant:
    grant_id: str
    run_id: str
    proposal_digest: str
    profile_digest: str
    operation: str
    expires_at: float
    nonce: str
    consumed_at: float | None = None
    revoked_at: float | None = None


class AuthorizationGrantStore:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_authorization_grants(
                grant_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                proposal_digest TEXT NOT NULL,
                profile_digest TEXT NOT NULL,
                operation TEXT NOT NULL,
                expires_at REAL NOT NULL,
                nonce TEXT NOT NULL UNIQUE,
                issued_at REAL NOT NULL,
                consumed_at REAL,
                revoked_at REAL
            )""")
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(runtime_authorization_grants)")}
            if "revoked_at" not in columns:
                db.execute("ALTER TABLE runtime_authorization_grants ADD COLUMN revoked_at REAL")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row) -> AuthorizationGrant:
        return AuthorizationGrant(
            grant_id=str(row["grant_id"]),
            run_id=str(row["run_id"]),
            proposal_digest=str(row["proposal_digest"]),
            profile_digest=str(row["profile_digest"]),
            operation=str(row["operation"]),
            expires_at=float(row["expires_at"]),
            nonce=str(row["nonce"]),
            consumed_at=float(row["consumed_at"]) if row["consumed_at"] is not None else None,
            revoked_at=float(row["revoked_at"]) if row["revoked_at"] is not None else None,
        )

    def issue(
        self,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        *,
        ttl_seconds: float = 300,
        now: float | None = None,
    ) -> AuthorizationGrant:
        issued_at = time.time() if now is None else now
        if ttl_seconds <= 0:
            raise GrantError("grant_ttl_invalid", "Grant TTL must be positive.")
        try:
            HardDenyPolicy().enforce(proposal)
        except HardDenyError as error:
            self.audit.append("hard_deny.blocked", proposal.proposal_id, {
                "run_id": proposal.run_id,
                "operation": proposal.operation,
                "category": error.category,
                "reason_code": error.reason_code,
                "policy_version": error.policy_version,
            }, now=issued_at)
            raise
        if not profile.permits(proposal):
            raise GrantError("proposal_not_permitted", "The resolved capability profile does not permit this proposal.")
        grant = AuthorizationGrant(
            grant_id=f"grant-{uuid.uuid4()}",
            run_id=proposal.run_id,
            proposal_digest=proposal.payload_digest,
            profile_digest=profile.digest,
            operation=proposal.operation,
            expires_at=issued_at + ttl_seconds,
            nonce=secrets.token_urlsafe(24),
        )
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._ensure_no_mode_transition(db, proposal.run_id)
            self._ensure_mode_not_killed(db, proposal.run_id)
            db.execute(
                "INSERT INTO runtime_authorization_grants("
                "grant_id,run_id,proposal_digest,profile_digest,operation,expires_at,nonce,issued_at,consumed_at,revoked_at"
                ") VALUES(?,?,?,?,?,?,?,?,NULL,NULL)",
                (
                    grant.grant_id,
                    grant.run_id,
                    grant.proposal_digest,
                    grant.profile_digest,
                    grant.operation,
                    grant.expires_at,
                    grant.nonce,
                    issued_at,
                ),
            )
            db.commit()
        return grant

    @staticmethod
    def _ensure_no_mode_transition(db: sqlite3.Connection, run_id: str) -> None:
        table = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_permission_mode_transitions'",
        ).fetchone()
        if table is None:
            return
        active = db.execute(
            "SELECT 1 FROM runtime_permission_mode_transitions WHERE run_id=? AND status!='committed' LIMIT 1",
            (run_id,),
        ).fetchone()
        if active is not None:
            raise GrantError(
                "permission_mode_transition_active",
                "Authorization Grant cannot be issued while a permission mode transition is incomplete.",
            )

    @staticmethod
    def _ensure_mode_not_killed(db: sqlite3.Connection, run_id: str) -> None:
        required = {str(row[0]) for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ("
            "'runtime_permission_kill_switch_events','runtime_permission_mode_bindings')",
        ).fetchall()}
        if required != {"runtime_permission_kill_switch_events", "runtime_permission_mode_bindings"}:
            return
        mode = db.execute(
            "SELECT mode_id FROM runtime_permission_mode_bindings WHERE run_id=? ORDER BY sequence DESC LIMIT 1",
            (run_id,),
        ).fetchone()
        if mode is None:
            return
        switch_name = {
            "auto_reviewed": "auto_reviewer",
            "isolated_full_access": "isolated_full_access",
        }.get(str(mode["mode_id"]))
        if switch_name is None:
            return
        state = db.execute(
            "SELECT active FROM runtime_permission_kill_switch_events WHERE switch_name=? "
            "ORDER BY sequence DESC LIMIT 1", (switch_name,),
        ).fetchone()
        if state is not None and bool(state["active"]):
            raise GrantError("permission_kill_switch_active", "Permission mode is disabled by an active kill switch.")

    def get(self, grant_id: str) -> AuthorizationGrant:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_authorization_grants WHERE grant_id=?",
                (grant_id,),
            ).fetchone()
        if row is None:
            raise GrantError("grant_missing", "Authorization grant does not exist.")
        return self._from_row(row)

    def consume(
        self,
        grant_id: str,
        proposal: ActionProposal,
        profile: ResolvedCapabilityProfile,
        *,
        actual_payload: dict[str, object],
        now: float | None = None,
    ) -> AuthorizationGrant:
        consumed_at = time.time() if now is None else now
        if not proposal.matches_payload(actual_payload):
            raise GrantError("proposal_payload_mismatch", "Execution payload differs from the approved proposal.")
        if not profile.permits(proposal):
            raise GrantError("proposal_not_permitted", "The active capability profile no longer permits this proposal.")

        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._ensure_no_mode_transition(db, proposal.run_id)
            self._ensure_mode_not_killed(db, proposal.run_id)
            row = db.execute(
                "SELECT * FROM runtime_authorization_grants WHERE grant_id=?",
                (grant_id,),
            ).fetchone()
            if row is None:
                db.rollback()
                raise GrantError("grant_missing", "Authorization grant does not exist.")
            grant = self._from_row(row)
            expected = (proposal.run_id, proposal.payload_digest, profile.digest, proposal.operation)
            actual = (grant.run_id, grant.proposal_digest, grant.profile_digest, grant.operation)
            if actual != expected:
                db.rollback()
                raise GrantError("grant_scope_mismatch", "Authorization grant does not match this proposal and profile.")
            if grant.expires_at <= consumed_at:
                db.rollback()
                raise GrantError("grant_expired", "Authorization grant expired.")
            if grant.consumed_at is not None:
                db.rollback()
                raise GrantError("grant_already_consumed", "Authorization grant was already consumed.")
            if grant.revoked_at is not None:
                db.rollback()
                raise GrantError("grant_revoked", "Authorization grant was revoked by a security transition.")
            changed = db.execute(
                "UPDATE runtime_authorization_grants SET consumed_at=? "
                "WHERE grant_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
                (consumed_at, grant_id),
            ).rowcount
            if changed != 1:
                db.rollback()
                raise GrantError("grant_already_consumed", "Authorization grant was consumed concurrently.")
            db.commit()
        return AuthorizationGrant(**{**grant.__dict__, "consumed_at": consumed_at})

    def revoke_unconsumed_for_run(self, run_id: str, *, now: float | None = None) -> int:
        revoked_at = float(time.time() if now is None else now)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            grant_ids = [str(row[0]) for row in db.execute(
                "SELECT grant_id FROM runtime_authorization_grants "
                "WHERE run_id=? AND consumed_at IS NULL AND revoked_at IS NULL ORDER BY grant_id",
                (run_id,),
            ).fetchall()]
            changed = db.execute(
                "UPDATE runtime_authorization_grants SET revoked_at=? "
                "WHERE run_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
                (revoked_at, run_id),
            ).rowcount
            for grant_id in grant_ids:
                self.audit.append_in_transaction(db, "authorization.grant_revoked", grant_id, {
                    "reason_code": "permission_mode_transition",
                }, now=revoked_at)
            db.commit()
        return int(changed)
