"""Revalidate an approved Decision and atomically issue its only Grant."""

from __future__ import annotations

import secrets
import sqlite3
import time
import uuid
from pathlib import Path

from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.grants import AuthorizationGrant, AuthorizationGrantStore
from drsai.backend.runtime.security_boundary.models import ResolvedCapabilityProfile
from drsai.backend.runtime.security_boundary.storage import SecurityBoundaryStore
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .approval_service import ApprovalService
from .policy_decision_service import PolicyDecisionService


class GrantServiceError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class GrantService:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.approvals = ApprovalService(self.database)
        self.proposals = SecurityBoundaryStore(self.database)
        self.grants = AuthorizationGrantStore(self.database)
        self.audit = SecurityEventJournal(self.database)
        self.policy = PolicyDecisionService()
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_approval_grants(
                    request_id TEXT PRIMARY KEY REFERENCES runtime_approval_requests(request_id),
                    decision_id TEXT NOT NULL UNIQUE REFERENCES runtime_approval_decisions(decision_id),
                    grant_id TEXT NOT NULL UNIQUE REFERENCES runtime_authorization_grants(grant_id),
                    profile_digest TEXT NOT NULL,
                    policy_version TEXT NOT NULL,
                    issued_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_approval_grants_no_update
                BEFORE UPDATE ON runtime_approval_grants BEGIN SELECT RAISE(ABORT, 'approval grant binding is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_approval_grants_no_delete
                BEFORE DELETE ON runtime_approval_grants BEGIN SELECT RAISE(ABORT, 'approval grant binding is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def get_for_request(self, request_id: str) -> AuthorizationGrant | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT g.* FROM runtime_approval_grants b "
                "JOIN runtime_authorization_grants g ON g.grant_id=b.grant_id WHERE b.request_id=?",
                (request_id,),
            ).fetchone()
        return AuthorizationGrantStore._from_row(row) if row is not None else None

    def issue_for_approved_request(
        self,
        request_id: str,
        profile: ResolvedCapabilityProfile,
        *,
        review_requirement: str,
        ttl_seconds: float = 300,
        now: float | None = None,
    ) -> AuthorizationGrant:
        issued_at = float(time.time() if now is None else now)
        if ttl_seconds <= 0 or ttl_seconds > 900:
            raise GrantServiceError("grant_ttl_invalid", "Approval Grant TTL is outside the allowed range.")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            request_scope = db.execute(
                "SELECT run_id FROM runtime_approval_requests WHERE request_id=?", (request_id,),
            ).fetchone()
            if request_scope is not None:
                try:
                    AuthorizationGrantStore._ensure_no_mode_transition(db, str(request_scope["run_id"]))
                    AuthorizationGrantStore._ensure_mode_not_killed(db, str(request_scope["run_id"]))
                except Exception:
                    db.rollback()
                    raise
            prior = db.execute(
                "SELECT b.profile_digest,b.policy_version,g.* FROM runtime_approval_grants b "
                "JOIN runtime_authorization_grants g ON g.grant_id=b.grant_id WHERE b.request_id=?",
                (request_id,),
            ).fetchone()
            if prior is not None:
                if str(prior["profile_digest"]) != profile.digest:
                    db.rollback()
                    raise GrantServiceError("approval_profile_changed", "Approval Grant belongs to a different profile.")
                grant = AuthorizationGrantStore._from_row(prior)
                db.rollback()
                return grant

            request_row = db.execute(
                "SELECT * FROM runtime_approval_requests WHERE request_id=?", (request_id,),
            ).fetchone()
            if request_row is None:
                db.rollback()
                raise GrantServiceError("approval_request_missing", "Approval request does not exist.")
            request = ApprovalService._request(request_row)
            decision_row = db.execute(
                "SELECT * FROM runtime_approval_decisions WHERE request_id=?", (request_id,),
            ).fetchone()
            if request.status != "approved" or decision_row is None:
                db.rollback()
                raise GrantServiceError("approval_not_approved", "Approval request has no approved Decision.")
            decision = ApprovalService._decision(decision_row)
            if decision.decision != "approved":
                db.rollback()
                raise GrantServiceError("approval_not_approved", "Approval Decision is not approved.")
            if request.deadline_at is not None and request.deadline_at <= issued_at:
                db.rollback()
                raise GrantServiceError("approval_authorization_expired", "Approved Request expired before Grant issuance.")
            if request.profile_digest != profile.digest:
                db.rollback()
                raise GrantServiceError("approval_profile_changed", "Active profile changed after review was requested.")
            proposal_row = db.execute(
                "SELECT * FROM runtime_action_proposals WHERE proposal_id=?", (request.proposal_id,),
            ).fetchone()
            if proposal_row is None:
                db.rollback()
                raise GrantServiceError("proposal_missing", "Approval Proposal does not exist.")
            proposal = SecurityBoundaryStore._proposal_from_row(proposal_row)
            policy = self.policy.evaluate(proposal, profile, review_requirement=review_requirement)
            if request.policy_version != policy.policy_version:
                db.rollback()
                raise GrantServiceError("approval_policy_changed", "Authorization policy changed after review was requested.")
            if policy.disposition != "require_reviewer" or policy.reviewer_kind != request.reviewer_kind:
                db.rollback()
                raise GrantServiceError(
                    "approval_policy_no_longer_authorizes", "Current policy no longer authorizes this reviewed action.",
                )
            grant = AuthorizationGrant(
                grant_id=f"grant-{uuid.uuid4()}",
                run_id=proposal.run_id,
                proposal_digest=proposal.payload_digest,
                profile_digest=profile.digest,
                operation=proposal.operation,
                expires_at=issued_at + ttl_seconds,
                nonce=secrets.token_urlsafe(24),
            )
            db.execute(
                "INSERT INTO runtime_authorization_grants("
                "grant_id,run_id,proposal_digest,profile_digest,operation,expires_at,nonce,issued_at,consumed_at,revoked_at"
                ") VALUES(?,?,?,?,?,?,?,?,NULL,NULL)",
                (
                    grant.grant_id, grant.run_id, grant.proposal_digest, grant.profile_digest,
                    grant.operation, grant.expires_at, grant.nonce, issued_at,
                ),
            )
            db.execute(
                "INSERT INTO runtime_approval_grants VALUES(?,?,?,?,?,?)",
                (
                    request.request_id, decision.decision_id, grant.grant_id,
                    profile.digest, policy.policy_version, issued_at,
                ),
            )
            self.audit.append_in_transaction(db, "authorization.grant_issued", grant.grant_id, {
                "request_id": request.request_id,
                "decision_id": decision.decision_id,
                "proposal_id": proposal.proposal_id,
                "run_id": proposal.run_id,
                "profile_digest": profile.digest,
                "policy_version": policy.policy_version,
                "operation": proposal.operation,
                "expires_at": grant.expires_at,
            }, now=issued_at)
            db.commit()
            return grant
