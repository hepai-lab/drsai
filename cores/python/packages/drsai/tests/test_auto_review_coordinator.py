from __future__ import annotations

import concurrent.futures
import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.authorization import ApprovalService, GrantService, GrantServiceError
from drsai.backend.runtime.permission_modes import (
    AdministratorPolicy,
    AutoReviewCoordinator,
    AutoReviewCoordinatorError,
    AutoReviewerConfig,
    AutoReviewerService,
    BUILTIN_MODES,
    DEVELOPMENT_CAPABILITIES,
    ModeSelection,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
)
from drsai.backend.runtime.security_boundary import ActionProposal


def effective():
    return PermissionProfileResolver().resolve(
        ModeSelection(
            "auto_reviewed", "user", False,
            requested_capabilities=DEVELOPMENT_CAPABILITIES,
        ),
        administrator=AdministratorPolicy(
            "organization-default", 1, True, allowed_modes=frozenset(BUILTIN_MODES),
            capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ),
        platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
    )


def proposal(*, proposal_id="proposal-1", risk="local_read", categories=(), capabilities=("file.read",)):
    return ActionProposal.create(
        proposal_id=proposal_id, run_id="run-1", operation="file.read",
        payload={"path": "README.md", "token": "coordinator-secret"}, risk=risk,
        required_capabilities=capabilities, effect_categories=categories,
    )


def setup(database: Path, action: ActionProposal):
    profile = effective()
    approvals = ApprovalService(database)
    request = approvals.create_request(
        action, profile_digest=profile.capability_profile.digest,
        policy_version="authorization-policy/1", reviewer_kind="auto",
        reason_code="policy_requires_auto", idempotency_key=f"request:{action.proposal_id}",
        deadline_at=200, now=100,
    )
    reviewer = AutoReviewerService(database, AutoReviewerConfig(enabled=True), None)
    return approvals, AutoReviewCoordinator(database, reviewer), profile, request


def test_auto_approve_writes_only_decision_and_never_creates_grant(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    approvals, coordinator, profile, request = setup(database, proposal())
    result = coordinator.process(request.request_id, profile, idempotency_key="route-1", now=101)
    assert result.route == "approved"
    assert result.decision.decision == "approved" and result.decision.reviewer_kind == "auto"
    assert result.human_request is None
    assert approvals.get_request(request.request_id).status == "approved"
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='runtime_authorization_grants'",
        ).fetchone()[0] == 0


def test_auto_deny_is_operation_fact_and_cannot_issue_grant(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    action = proposal(risk="critical", categories=("credential_theft",), capabilities=())
    approvals, coordinator, profile, request = setup(database, action)
    result = coordinator.process(request.request_id, profile, idempotency_key="route-deny", now=101)
    assert result.route == "denied" and result.decision.decision == "denied"
    assert approvals.get_request(request.request_id).status == "denied"
    with pytest.raises(GrantServiceError, match="no approved Decision"):
        GrantService(database).issue_for_approved_request(
            request.request_id, profile.capability_profile, review_requirement="auto", now=102,
        )


def test_escalation_cancels_auto_request_and_creates_one_human_request(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    action = proposal(
        risk="production", categories=("production_target",), capabilities=("external.write",),
    )
    approvals, coordinator, profile, request = setup(database, action)
    result = coordinator.process(request.request_id, profile, idempotency_key="route-escalate", now=101)
    assert result.route == "escalated" and result.decision.decision == "cancelled"
    assert result.human_request is not None
    assert result.human_request.reviewer_kind == "human" and result.human_request.status == "pending"
    assert result.human_request.proposal_id == request.proposal_id
    assert result.human_request.profile_digest == request.profile_digest
    assert len(approvals.list_requests("run-1")) == 2
    assert approvals.get_decision(result.human_request.request_id) is None


def test_route_is_idempotent_under_32_concurrent_retries(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    approvals, coordinator, profile, request = setup(database, proposal())

    def process(_index: int):
        return coordinator.process(request.request_id, profile, idempotency_key="route-concurrent", now=101)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(process, range(32)))
    assert len({item.review.review_id for item in results}) == 1
    assert len({item.decision.decision_id for item in results}) == 1
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT COUNT(*) FROM runtime_auto_review_routes").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM runtime_auto_review_route_events").fetchone()[0] == 2
        assert db.execute("SELECT COUNT(*) FROM runtime_approval_decisions").fetchone()[0] == 1


def test_escalation_retry_recovers_after_route_claim_and_cancel(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    action = proposal(risk="production", categories=("production_target",), capabilities=("external.write",))
    approvals, coordinator, profile, request = setup(database, action)
    review = coordinator.reviewer.review(
        action, profile, idempotency_key="auto-review:route-recovery", now=101,
    )
    coordinator._claim_route(request, review, "escalated", "route-recovery", 101)
    approvals.decide(
        request.request_id, "cancelled", reviewer_kind="system",
        reviewer_id=f"auto-reviewer:{review.rule_version}", reason_code="auto_reviewer_escalated",
        idempotency_key=f"auto-route:{request.request_id}:escalated",
        detail={
            "auto_review_id": review.review_id, "rule_version": review.rule_version,
            "model_version": review.model_version or "none", "confidence": review.confidence,
        }, now=101,
    )

    recovered = coordinator.process(
        request.request_id, profile, idempotency_key="route-recovery", now=101,
    )
    assert recovered.human_request is not None
    assert approvals.get_request(recovered.human_request.request_id).status == "pending"
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT status FROM runtime_auto_review_routes").fetchone()[0] == "applied"


def test_wrong_reviewer_profile_or_idempotency_scope_fails_closed(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    approvals, coordinator, profile, request = setup(database, proposal())
    human = approvals.create_request(
        proposal(proposal_id="proposal-human"), profile_digest=profile.capability_profile.digest,
        policy_version="authorization-policy/1", reviewer_kind="human",
        reason_code="manual_review_required", idempotency_key="request-human", now=100,
    )
    with pytest.raises(AutoReviewCoordinatorError) as wrong_kind:
        coordinator.process(human.request_id, profile, idempotency_key="wrong-kind", now=101)
    assert wrong_kind.value.code == "auto_request_required"

    changed = PermissionProfileResolver().resolve(
        ModeSelection("auto_reviewed", "user", False),
        administrator=AdministratorPolicy(
            "organization-default", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
        ), platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=2, now=100,
    )
    with pytest.raises(AutoReviewCoordinatorError) as wrong_profile:
        coordinator.process(request.request_id, changed, idempotency_key="wrong-profile", now=101)
    assert wrong_profile.value.code == "auto_review_profile_changed"
