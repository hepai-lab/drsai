"""Recoverable routing from AutoReviewer advice to P1 Approval facts."""

from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.authorization import (
    ApprovalDecision,
    ApprovalRequest,
    ApprovalService,
    ApprovalServiceError,
)
from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .auto_reviewer import AutoReviewDecision, AutoReviewerService
from .resolver import EffectivePermissionProfile


class AutoReviewCoordinatorError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AutoReviewRouteResult:
    request_id: str
    review: AutoReviewDecision
    route: str
    decision: ApprovalDecision
    human_request: ApprovalRequest | None


class AutoReviewCoordinator:
    """Applies advice as Decision facts; this class cannot access GrantService."""

    def __init__(self, database: Path, reviewer: AutoReviewerService):
        self.database = Path(database)
        if self.database.resolve() != reviewer.database.resolve():
            raise ValueError("AutoReviewer and Approval coordinator must share one database.")
        self.reviewer = reviewer
        self.approvals = ApprovalService(self.database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_auto_review_routes(
                    request_id TEXT PRIMARY KEY REFERENCES runtime_approval_requests(request_id),
                    review_id TEXT NOT NULL UNIQUE REFERENCES runtime_auto_review_decisions(review_id),
                    route TEXT NOT NULL CHECK(route IN ('approved','denied','escalated')),
                    decision_id TEXT,
                    human_request_id TEXT,
                    status TEXT NOT NULL CHECK(status IN ('reviewed','applied')),
                    idempotency_key TEXT NOT NULL UNIQUE,
                    created_at REAL NOT NULL,
                    applied_at REAL
                );
                CREATE TABLE IF NOT EXISTS runtime_auto_review_route_events(
                    event_id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL REFERENCES runtime_auto_review_routes(request_id),
                    phase TEXT NOT NULL CHECK(phase IN ('reviewed','applied')),
                    created_at REAL NOT NULL,
                    UNIQUE(request_id,phase)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_auto_review_routes_identity_immutable
                BEFORE UPDATE OF request_id,review_id,route,idempotency_key,created_at
                ON runtime_auto_review_routes
                BEGIN SELECT RAISE(ABORT, 'auto review route identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_auto_review_routes_no_delete
                BEFORE DELETE ON runtime_auto_review_routes
                BEGIN SELECT RAISE(ABORT, 'auto review route is durable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_auto_review_route_events_no_update
                BEFORE UPDATE ON runtime_auto_review_route_events
                BEGIN SELECT RAISE(ABORT, 'auto review route event is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_auto_review_route_events_no_delete
                BEFORE DELETE ON runtime_auto_review_route_events
                BEGIN SELECT RAISE(ABORT, 'auto review route event is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def process(
        self,
        request_id: str,
        effective: EffectivePermissionProfile,
        *,
        idempotency_key: str,
        human_deadline_seconds: float = 300,
        now: float | None = None,
    ) -> AutoReviewRouteResult:
        reviewed_at = float(time.time() if now is None else now)
        if human_deadline_seconds <= 0 or human_deadline_seconds > 86400:
            raise AutoReviewCoordinatorError("human_deadline_invalid", "Human escalation deadline is invalid.")
        request = self.approvals.get_request(request_id)
        if request.reviewer_kind != "auto":
            raise AutoReviewCoordinatorError("auto_request_required", "Only an auto-review Approval Request can be routed.")
        if request.profile_digest != effective.capability_profile.digest:
            raise AutoReviewCoordinatorError("auto_review_profile_changed", "Effective profile changed before auto review.")
        proposal = self.approvals.proposals.get_proposal(request.proposal_id)
        review = self.reviewer.review(
            proposal, effective, idempotency_key=f"auto-review:{idempotency_key}", now=reviewed_at,
        )
        route = {"approve": "approved", "deny": "denied", "escalate": "escalated"}[review.outcome]
        self._claim_route(request, review, route, idempotency_key, reviewed_at)

        reason = f"auto_reviewer_{route}"
        decision_kind = "cancelled" if route == "escalated" else route
        reviewer_kind = "system" if route == "escalated" else "auto"
        try:
            decision = self.approvals.decide(
                request_id, decision_kind, reviewer_kind=reviewer_kind,
                reviewer_id=f"auto-reviewer:{review.rule_version}", reason_code=reason,
                idempotency_key=f"auto-route:{request_id}:{route}",
                detail={
                    "auto_review_id": review.review_id, "rule_version": review.rule_version,
                    "model_version": review.model_version or "none", "confidence": review.confidence,
                }, now=reviewed_at,
            )
        except ApprovalServiceError as error:
            raise AutoReviewCoordinatorError(error.code, str(error)) from error

        human_request: ApprovalRequest | None = None
        if route == "escalated":
            deadline = max(reviewed_at + human_deadline_seconds, request.deadline_at or 0)
            human_request = self.approvals.create_request(
                proposal, profile_digest=request.profile_digest, policy_version=request.policy_version,
                reviewer_kind="human", reason_code="auto_reviewer_escalated",
                idempotency_key=f"auto-escalation:{request_id}", deadline_at=deadline, now=reviewed_at,
            )
        self._mark_applied(request_id, decision, human_request, reviewed_at)
        return AutoReviewRouteResult(request_id, review, route, decision, human_request)

    def _claim_route(
        self,
        request: ApprovalRequest,
        review: AutoReviewDecision,
        route: str,
        idempotency_key: str,
        created_at: float,
    ) -> None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute(
                "SELECT * FROM runtime_auto_review_routes WHERE request_id=? OR idempotency_key=?",
                (request.request_id, idempotency_key),
            ).fetchone()
            if prior is not None:
                expected = (request.request_id, review.review_id, route, idempotency_key)
                actual = (
                    str(prior["request_id"]), str(prior["review_id"]),
                    str(prior["route"]), str(prior["idempotency_key"]),
                )
                db.rollback()
                if actual != expected:
                    raise AutoReviewCoordinatorError("auto_route_idempotency_conflict", "Auto-review route identity conflicts.")
                return
            db.execute(
                "INSERT INTO runtime_auto_review_routes VALUES(?,?,?,NULL,NULL,'reviewed',?,?,NULL)",
                (request.request_id, review.review_id, route, idempotency_key, created_at),
            )
            db.execute(
                "INSERT INTO runtime_auto_review_route_events VALUES(?,?,?,?)",
                (f"auto-route-event-{uuid.uuid4()}", request.request_id, "reviewed", created_at),
            )
            self.audit.append_in_transaction(db, "auto_reviewer.routed", request.request_id, {
                "route": route, "review_id": review.review_id,
            }, now=created_at)
            db.commit()

    def _mark_applied(
        self,
        request_id: str,
        decision: ApprovalDecision,
        human_request: ApprovalRequest | None,
        applied_at: float,
    ) -> None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM runtime_auto_review_routes WHERE request_id=?", (request_id,),
            ).fetchone()
            if row is None:
                db.rollback()
                raise AutoReviewCoordinatorError("auto_route_missing", "Auto-review route disappeared.")
            expected_human = human_request.request_id if human_request is not None else None
            if str(row["status"]) == "applied":
                actual_human = str(row["human_request_id"]) if row["human_request_id"] is not None else None
                db.rollback()
                if str(row["decision_id"]) != decision.decision_id or actual_human != expected_human:
                    raise AutoReviewCoordinatorError("auto_route_result_conflict", "Applied auto-review route conflicts.")
                return
            changed = db.execute(
                "UPDATE runtime_auto_review_routes SET decision_id=?,human_request_id=?,status='applied',applied_at=? "
                "WHERE request_id=? AND status='reviewed'",
                (decision.decision_id, expected_human, applied_at, request_id),
            ).rowcount
            if changed != 1:
                concurrent = db.execute(
                    "SELECT * FROM runtime_auto_review_routes WHERE request_id=?", (request_id,),
                ).fetchone()
                actual_human = (
                    str(concurrent["human_request_id"])
                    if concurrent is not None and concurrent["human_request_id"] is not None else None
                )
                if (
                    concurrent is not None and str(concurrent["status"]) == "applied"
                    and str(concurrent["decision_id"]) == decision.decision_id
                    and actual_human == expected_human
                ):
                    db.rollback()
                    return
                db.rollback()
                raise AutoReviewCoordinatorError("auto_route_apply_conflict", "Auto-review route was applied concurrently.")
            db.execute(
                "INSERT INTO runtime_auto_review_route_events VALUES(?,?,?,?)",
                (f"auto-route-event-{uuid.uuid4()}", request_id, "applied", applied_at),
            )
            self.audit.append_in_transaction(db, "auto_reviewer.route_applied", request_id, {
                "decision": decision.decision,
                "human_escalation_created": human_request is not None,
            }, now=applied_at)
            db.commit()
