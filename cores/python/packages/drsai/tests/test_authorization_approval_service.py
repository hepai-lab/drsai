from __future__ import annotations

import concurrent.futures
import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.authorization import (
    ApprovalService,
    ApprovalServiceError,
    PolicyDecisionService,
    RunApprovalProjection,
)
from drsai.backend.runtime.security_boundary import ActionProposal, ResolvedCapabilityProfile


def proposal(index: int = 1, *, category: str | None = None) -> ActionProposal:
    return ActionProposal.create(
        proposal_id=f"proposal-{index}", run_id="run-1", operation=f"tool.write.{index}",
        payload={"path": f"file-{index}.txt", "content": f"value-{index}", "token": "proposal-secret"},
        risk="local_write", required_capabilities=("file.write",),
        effect_categories=(category,) if category else (),
    )


def profile(*, capabilities: frozenset[str] = frozenset({"file.write"}), version: int = 1) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id="manual-safe", version=version, workspace_root="C:/workspace",
        capabilities=capabilities, trusted_workspace=True,
    )


def create_request(service: ApprovalService, index: int = 1, **values: object):
    parameters = {
        "profile_digest": profile().digest,
        "policy_version": "authorization-policy/1",
        "reviewer_kind": "human",
        "reason_code": "local_write_requires_review",
        "idempotency_key": f"request-{index}",
        "deadline_at": 200.0,
        "now": 100.0,
    }
    parameters.update(values)
    return service.create_request(proposal(index), **parameters)  # type: ignore[arg-type]


def test_request_creation_is_idempotent_and_does_not_require_run_state(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    first = create_request(service)
    second = create_request(service)
    assert first == second
    assert first.status == "pending"
    assert first.run_id == "run-1"
    with sqlite3.connect(service.database) as db:
        assert db.execute("SELECT COUNT(*) FROM runtime_approval_requests").fetchone()[0] == 1
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_runs'").fetchone() is None

    with pytest.raises(ApprovalServiceError) as conflict:
        create_request(service, reviewer_kind="auto")
    assert conflict.value.code == "approval_idempotency_conflict"


@pytest.mark.parametrize("decision", ["approved", "denied", "cancelled"])
def test_decision_is_append_only_terminal_and_idempotent(tmp_path: Path, decision: str) -> None:
    service = ApprovalService(tmp_path / f"{decision}.sqlite3")
    request = create_request(service)
    reviewer_kind = "system" if decision == "cancelled" else "human"
    stored = service.decide(
        request.request_id, decision, reviewer_kind=reviewer_kind, reviewer_id="reviewer-1",
        reason_code=f"review_{decision}", idempotency_key="decision-1",
        detail={"comment": "safe", "token": "decision-secret"}, now=101,
    )
    repeated = service.decide(
        request.request_id, decision, reviewer_kind=reviewer_kind, reviewer_id="reviewer-1",
        reason_code=f"review_{decision}", idempotency_key="decision-1",
        detail={"comment": "safe", "token": "decision-secret"}, now=102,
    )
    assert repeated == stored
    assert service.get_request(request.request_id).status == decision
    assert stored.detail["token"] == "[REDACTED]"
    assert b"decision-secret" not in service.database.read_bytes()
    with pytest.raises(ApprovalServiceError) as idempotency_conflict:
        service.decide(
            request.request_id, decision, reviewer_kind=reviewer_kind, reviewer_id="reviewer-1",
            reason_code="different_reason", idempotency_key="decision-1", now=102.5,
        )
    assert idempotency_conflict.value.code == "approval_idempotency_conflict"
    event_types = [event.event_type for event in service.audit.list()]
    assert event_types.count("approval.decision_duplicate") == 1
    assert event_types.count("approval.decision_conflict") == 1

    with pytest.raises(ApprovalServiceError) as terminal:
        service.decide(
            request.request_id, "denied" if decision != "denied" else "approved",
            reviewer_kind="human", reviewer_id="reviewer-2", reason_code="conflicting_review",
            idempotency_key="decision-2", now=103,
        )
    assert terminal.value.code == "approval_request_terminal"
    with sqlite3.connect(service.database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="immutable|append-only"):
            db.execute("DELETE FROM runtime_approval_decisions")


def test_concurrent_decisions_have_one_terminal_winner(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    request = create_request(service)

    def decide(index: int) -> str:
        decision = "approved" if index % 2 == 0 else "denied"
        try:
            service.decide(
                request.request_id, decision, reviewer_kind="human", reviewer_id=f"reviewer-{index}",
                reason_code=f"concurrent_{decision}", idempotency_key=f"decision-{index}", now=101,
            )
            return decision
        except ApprovalServiceError as error:
            return error.code

    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
        results = list(executor.map(decide, range(32)))
    winners = [value for value in results if value in {"approved", "denied"}]
    assert len(winners) == 1
    assert service.get_request(request.request_id).status == winners[0]
    with sqlite3.connect(service.database) as db:
        assert db.execute("SELECT COUNT(*) FROM runtime_approval_decisions").fetchone()[0] == 1


def test_multiple_pending_requests_are_independent_and_order_independent(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    requests = [create_request(service, index) for index in range(1, 11)]
    assert len(service.list_requests("run-1", status="pending")) == 10
    for request in reversed(requests[::2]):
        service.decide(
            request.request_id, "approved", reviewer_kind="human", reviewer_id="reviewer-1",
            reason_code="selected_approval", idempotency_key=f"decision-{request.request_id}", now=101,
        )
    assert len(service.list_requests("run-1", status="approved")) == 5
    assert len(service.list_requests("run-1", status="pending")) == 5
    assert {item.request_id for item in service.list_requests("run-1", status="pending")} == {
        request.request_id for request in requests[1::2]
    }


def test_expiry_is_a_system_decision_and_late_approval_fails(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    request = create_request(service, deadline_at=101.0)
    with pytest.raises(ApprovalServiceError) as expired:
        service.decide(
            request.request_id, "approved", reviewer_kind="human", reviewer_id="reviewer-1",
            reason_code="late_approval", idempotency_key="late", now=101,
        )
    assert expired.value.code == "approval_request_expired"
    assert service.get_request(request.request_id).status == "expired"
    decision = service.get_decision(request.request_id)
    assert decision is not None
    assert decision.decision == "expired"
    assert decision.reviewer_kind == "system"


def test_expire_due_handles_many_pending_without_touching_others(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    expired = [create_request(service, index, deadline_at=110.0) for index in range(1, 4)]
    future = create_request(service, 4, deadline_at=200.0)
    assert service.expire_due(now=110) == 3
    assert all(service.get_request(item.request_id).status == "expired" for item in expired)
    assert service.get_request(future.request_id).status == "pending"


def test_reviewer_kind_is_bound_and_disconnect_leaves_pending(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    request = create_request(service, reviewer_kind="auto")
    with pytest.raises(ApprovalServiceError) as reviewer:
        service.decide(
            request.request_id, "approved", reviewer_kind="human", reviewer_id="user-1",
            reason_code="wrong_reviewer", idempotency_key="decision-1", now=101,
        )
    assert reviewer.value.code == "reviewer_kind_mismatch"
    assert service.get_request(request.request_id).status == "pending"
    # There is intentionally no disconnect->approve transition. Transport
    # failure leaves the Request pending until deadline/cancellation.
    assert service.get_decision(request.request_id) is None


def test_policy_decision_is_separate_from_approval_and_rechecks_profile() -> None:
    service = PolicyDecisionService()
    action = proposal()
    assert service.evaluate(action, profile(), review_requirement="none").disposition == "allow_without_review"
    review = service.evaluate(action, profile(), review_requirement="human")
    assert review.disposition == "require_reviewer"
    assert review.reviewer_kind == "human"
    tightened = profile(capabilities=frozenset(), version=2)
    assert service.evaluate(action, tightened, review_requirement="human").disposition == "capability_denied"
    hard = proposal(2, category="credential_theft")
    assert service.evaluate(hard, profile(), review_requirement="human").disposition == "hard_deny"


def test_denial_is_tool_result_and_run_cancellation_is_separate(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    request = create_request(service)
    service.decide(
        request.request_id, "denied", reviewer_kind="human", reviewer_id="reviewer-1",
        reason_code="user_denied", idempotency_key="decision-1", now=101,
    )
    denied = service.get_request(request.request_id)
    result = RunApprovalProjection.tool_result(denied)
    assert result["outcome"] == "denied"
    assert result["run_action"] == "continue"
    cancel = RunApprovalProjection.cancel_run_command("run-1", reason_code="user_cancelled_task")
    assert cancel == {
        "type": "run_command", "action": "cancel", "run_id": "run-1", "reason_code": "user_cancelled_task",
    }


def test_run_waiting_status_is_a_projection_not_approval_authority() -> None:
    assert RunApprovalProjection.status("running", runnable_steps=2, pending_requests=3) == "running"
    assert RunApprovalProjection.status("running", runnable_steps=0, pending_requests=3) == "waiting_approval"
    assert RunApprovalProjection.status("waiting_approval", runnable_steps=1, pending_requests=3) == "running"
    assert RunApprovalProjection.status("cancelled", runnable_steps=1, pending_requests=3) == "cancelled"


def test_approval_audit_contains_no_proposal_or_decision_secret(tmp_path: Path) -> None:
    service = ApprovalService(tmp_path / "authorization.sqlite3")
    request = create_request(service)
    service.decide(
        request.request_id, "approved", reviewer_kind="human", reviewer_id="reviewer-private-id",
        reason_code="user_approved", idempotency_key="decision-1",
        detail={"token": "decision-secret", "comment": "approved"}, now=101,
    )
    serialized = str(service.audit.list())
    assert "proposal-secret" not in serialized
    assert "decision-secret" not in serialized
    assert "reviewer-private-id" not in serialized
    service.audit.verify()
