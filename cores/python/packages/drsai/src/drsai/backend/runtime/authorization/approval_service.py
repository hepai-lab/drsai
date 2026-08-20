"""Durable Approval Request/Decision facts with no Run side effects."""

from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.models import ActionProposal, canonical_json, redact_for_display
from drsai.backend.runtime.security_boundary.storage import SecurityBoundaryStore
from drsai.backend.runtime.sqlite_connection import ClosingConnection


_REASON_CODE = re.compile(r"^[a-z][a-z0-9_.-]{1,127}$")
_REVIEWER_KINDS = frozenset({"human", "auto"})
_DECISIONS = frozenset({"approved", "denied", "cancelled"})
_TERMINAL = frozenset({"approved", "denied", "cancelled", "expired"})


class ApprovalServiceError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ApprovalRequest:
    request_id: str
    proposal_id: str
    run_id: str
    profile_digest: str
    policy_version: str
    reviewer_kind: str
    reason_code: str
    status: str
    idempotency_key: str
    created_at: float
    deadline_at: float | None
    resolved_at: float | None = None


@dataclass(frozen=True)
class ApprovalDecision:
    decision_id: str
    request_id: str
    decision: str
    reviewer_kind: str
    reviewer_id: str
    reason_code: str
    detail: Mapping[str, Any]
    idempotency_key: str
    created_at: float


class ApprovalService:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.proposals = SecurityBoundaryStore(self.database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_approval_requests(
                    request_id TEXT PRIMARY KEY,
                    proposal_id TEXT NOT NULL REFERENCES runtime_action_proposals(proposal_id),
                    run_id TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    policy_version TEXT NOT NULL,
                    reviewer_kind TEXT NOT NULL CHECK(reviewer_kind IN ('human','auto')),
                    reason_code TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','cancelled','expired')),
                    idempotency_key TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    deadline_at REAL,
                    resolved_at REAL,
                    UNIQUE(run_id,idempotency_key)
                );
                CREATE TABLE IF NOT EXISTS runtime_approval_decisions(
                    decision_id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL REFERENCES runtime_approval_requests(request_id),
                    decision TEXT NOT NULL CHECK(decision IN ('approved','denied','cancelled','expired')),
                    reviewer_kind TEXT NOT NULL CHECK(reviewer_kind IN ('human','auto','system')),
                    reviewer_id TEXT NOT NULL,
                    reason_code TEXT NOT NULL,
                    detail_json TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE(request_id),
                    UNIQUE(request_id,idempotency_key)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_approval_requests_identity_immutable
                BEFORE UPDATE OF request_id,proposal_id,run_id,profile_digest,policy_version,reviewer_kind,reason_code,idempotency_key,created_at,deadline_at
                ON runtime_approval_requests BEGIN SELECT RAISE(ABORT, 'approval request identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_approval_requests_no_delete
                BEFORE DELETE ON runtime_approval_requests BEGIN SELECT RAISE(ABORT, 'approval request is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_approval_decisions_no_update
                BEFORE UPDATE ON runtime_approval_decisions BEGIN SELECT RAISE(ABORT, 'approval decision is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_approval_decisions_no_delete
                BEFORE DELETE ON runtime_approval_decisions BEGIN SELECT RAISE(ABORT, 'approval decision is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @staticmethod
    def _request(row: sqlite3.Row) -> ApprovalRequest:
        return ApprovalRequest(
            request_id=str(row["request_id"]), proposal_id=str(row["proposal_id"]), run_id=str(row["run_id"]),
            profile_digest=str(row["profile_digest"]), policy_version=str(row["policy_version"]),
            reviewer_kind=str(row["reviewer_kind"]), reason_code=str(row["reason_code"]), status=str(row["status"]),
            idempotency_key=str(row["idempotency_key"]), created_at=float(row["created_at"]),
            deadline_at=float(row["deadline_at"]) if row["deadline_at"] is not None else None,
            resolved_at=float(row["resolved_at"]) if row["resolved_at"] is not None else None,
        )

    @staticmethod
    def _decision(row: sqlite3.Row) -> ApprovalDecision:
        return ApprovalDecision(
            decision_id=str(row["decision_id"]), request_id=str(row["request_id"]),
            decision=str(row["decision"]), reviewer_kind=str(row["reviewer_kind"]),
            reviewer_id=str(row["reviewer_id"]), reason_code=str(row["reason_code"]),
            detail=json.loads(str(row["detail_json"])), idempotency_key=str(row["idempotency_key"]),
            created_at=float(row["created_at"]),
        )

    @staticmethod
    def _validate_reason(value: str) -> str:
        if not _REASON_CODE.fullmatch(value):
            raise ApprovalServiceError("approval_reason_invalid", "Approval reason code is invalid.")
        return value

    def create_request(
        self,
        proposal: ActionProposal,
        *,
        profile_digest: str,
        policy_version: str,
        reviewer_kind: str,
        reason_code: str,
        idempotency_key: str,
        deadline_at: float | None = None,
        now: float | None = None,
    ) -> ApprovalRequest:
        created_at = float(time.time() if now is None else now)
        if reviewer_kind not in _REVIEWER_KINDS:
            raise ApprovalServiceError("reviewer_kind_invalid", "Approval reviewer kind is invalid.")
        self._validate_reason(reason_code)
        if not profile_digest or not policy_version or not idempotency_key:
            raise ApprovalServiceError("approval_request_identity_missing", "Approval policy and idempotency identity are required.")
        if deadline_at is not None and deadline_at <= created_at:
            raise ApprovalServiceError("approval_deadline_invalid", "Approval deadline must be in the future.")
        self.proposals.save_proposal(proposal, now=created_at)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM runtime_approval_requests WHERE run_id=? AND idempotency_key=?",
                (proposal.run_id, idempotency_key),
            ).fetchone()
            if existing is not None:
                request = self._request(existing)
                expected = (
                    proposal.proposal_id, profile_digest, policy_version, reviewer_kind, reason_code, deadline_at,
                )
                actual = (
                    request.proposal_id, request.profile_digest, request.policy_version,
                    request.reviewer_kind, request.reason_code, request.deadline_at,
                )
                db.rollback()
                if actual == expected:
                    return request
                raise ApprovalServiceError("approval_idempotency_conflict", "Approval request idempotency key was reused.")
            request_id = f"approval-request-{uuid.uuid4()}"
            db.execute(
                "INSERT INTO runtime_approval_requests VALUES(?,?,?,?,?,?,?,'pending',?,?,?,NULL)",
                (
                    request_id, proposal.proposal_id, proposal.run_id, profile_digest, policy_version,
                    reviewer_kind, reason_code, idempotency_key, created_at, deadline_at,
                ),
            )
            self.audit.append_in_transaction(db, "approval.requested", request_id, {
                "run_id": proposal.run_id, "proposal_id": proposal.proposal_id,
                "profile_digest": profile_digest, "policy_version": policy_version,
                "reviewer_kind": reviewer_kind, "reason_code": reason_code,
                "deadline_at": deadline_at,
            }, now=created_at)
            db.commit()
        return self.get_request(request_id)

    def get_request(self, request_id: str) -> ApprovalRequest:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_approval_requests WHERE request_id=?", (request_id,)).fetchone()
        if row is None:
            raise ApprovalServiceError("approval_request_missing", "Approval request does not exist.")
        return self._request(row)

    def get_decision(self, request_id: str) -> ApprovalDecision | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_approval_decisions WHERE request_id=?", (request_id,)).fetchone()
        return self._decision(row) if row is not None else None

    def list_requests(self, run_id: str, *, status: str | None = None) -> list[ApprovalRequest]:
        query = "SELECT * FROM runtime_approval_requests WHERE run_id=?"
        parameters: tuple[object, ...] = (run_id,)
        if status is not None:
            if status not in {"pending", *_TERMINAL}:
                raise ApprovalServiceError("approval_status_invalid", "Approval status filter is invalid.")
            query += " AND status=?"
            parameters += (status,)
        query += " ORDER BY created_at,request_id"
        with self._connect() as db:
            rows = db.execute(query, parameters).fetchall()
        return [self._request(row) for row in rows]

    def _insert_decision(
        self,
        db: sqlite3.Connection,
        request: ApprovalRequest,
        *,
        decision: str,
        reviewer_kind: str,
        reviewer_id: str,
        reason_code: str,
        detail: Mapping[str, Any],
        idempotency_key: str,
        created_at: float,
    ) -> ApprovalDecision:
        decision_id = f"approval-decision-{uuid.uuid4()}"
        safe_detail = redact_for_display(detail)
        db.execute(
            "INSERT INTO runtime_approval_decisions VALUES(?,?,?,?,?,?,?,?,?)",
            (
                decision_id, request.request_id, decision, reviewer_kind, reviewer_id,
                reason_code, canonical_json(safe_detail), idempotency_key, created_at,
            ),
        )
        changed = db.execute(
            "UPDATE runtime_approval_requests SET status=?,resolved_at=? WHERE request_id=? AND status='pending'",
            (decision, created_at, request.request_id),
        ).rowcount
        if changed != 1:
            raise ApprovalServiceError("approval_request_terminal", "Approval request is already terminal.")
        self.audit.append_in_transaction(db, "approval.decided", request.request_id, {
            "decision_id": decision_id, "decision": decision, "reviewer_kind": reviewer_kind,
            "reason_code": reason_code,
        }, now=created_at)
        return ApprovalDecision(
            decision_id, request.request_id, decision, reviewer_kind, reviewer_id,
            reason_code, safe_detail, idempotency_key, created_at,
        )

    def decide(
        self,
        request_id: str,
        decision: str,
        *,
        reviewer_kind: str,
        reviewer_id: str,
        reason_code: str,
        idempotency_key: str,
        detail: Mapping[str, Any] | None = None,
        now: float | None = None,
    ) -> ApprovalDecision:
        decided_at = float(time.time() if now is None else now)
        if decision not in _DECISIONS:
            raise ApprovalServiceError("approval_decision_invalid", "Approval decision is invalid.")
        if not reviewer_id or not idempotency_key:
            raise ApprovalServiceError("approval_decision_identity_missing", "Reviewer and idempotency identity are required.")
        self._validate_reason(reason_code)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            request_row = db.execute(
                "SELECT * FROM runtime_approval_requests WHERE request_id=?", (request_id,),
            ).fetchone()
            if request_row is None:
                db.rollback()
                raise ApprovalServiceError("approval_request_missing", "Approval request does not exist.")
            request = self._request(request_row)
            prior = db.execute(
                "SELECT * FROM runtime_approval_decisions WHERE request_id=? AND idempotency_key=?",
                (request_id, idempotency_key),
            ).fetchone()
            if prior is not None:
                stored = self._decision(prior)
                expected = (decision, reviewer_kind, reviewer_id, reason_code, redact_for_display(detail or {}))
                actual = (stored.decision, stored.reviewer_kind, stored.reviewer_id, stored.reason_code, stored.detail)
                db.rollback()
                if actual == expected:
                    self.audit.append("approval.decision_duplicate", request_id, {
                        "reviewer_kind": reviewer_kind,
                    }, now=decided_at)
                    return stored
                self.audit.append("approval.decision_conflict", request_id, {
                    "reviewer_kind": reviewer_kind,
                }, now=decided_at)
                raise ApprovalServiceError("approval_idempotency_conflict", "Decision idempotency key was reused.")
            if request.status != "pending":
                db.rollback()
                raise ApprovalServiceError("approval_request_terminal", "Approval request is already terminal.")
            if request.deadline_at is not None and request.deadline_at <= decided_at:
                self._insert_decision(
                    db, request, decision="expired", reviewer_kind="system", reviewer_id="runtime",
                    reason_code="deadline_elapsed", detail={}, idempotency_key=f"expire:{request_id}",
                    created_at=decided_at,
                )
                db.commit()
                raise ApprovalServiceError("approval_request_expired", "Approval request expired before decision.")
            if decision == "cancelled":
                if reviewer_kind not in {request.reviewer_kind, "system"}:
                    db.rollback()
                    raise ApprovalServiceError("reviewer_kind_mismatch", "Reviewer kind does not match request.")
            elif reviewer_kind != request.reviewer_kind:
                db.rollback()
                raise ApprovalServiceError("reviewer_kind_mismatch", "Reviewer kind does not match request.")
            stored = self._insert_decision(
                db, request, decision=decision, reviewer_kind=reviewer_kind, reviewer_id=reviewer_id,
                reason_code=reason_code, detail=detail or {}, idempotency_key=idempotency_key,
                created_at=decided_at,
            )
            db.commit()
            return stored

    def expire_due(self, *, now: float | None = None) -> int:
        expired_at = float(time.time() if now is None else now)
        with self._connect() as db:
            request_ids = [str(row[0]) for row in db.execute(
                "SELECT request_id FROM runtime_approval_requests "
                "WHERE status='pending' AND deadline_at IS NOT NULL AND deadline_at<=? ORDER BY request_id",
                (expired_at,),
            ).fetchall()]
        count = 0
        for request_id in request_ids:
            try:
                self.decide(
                    request_id, "cancelled", reviewer_kind="system", reviewer_id="runtime",
                    reason_code="deadline_elapsed", idempotency_key=f"expire:{request_id}", now=expired_at,
                )
            except ApprovalServiceError as error:
                if error.code == "approval_request_expired":
                    count += 1
                elif error.code != "approval_request_terminal":
                    raise
        return count
