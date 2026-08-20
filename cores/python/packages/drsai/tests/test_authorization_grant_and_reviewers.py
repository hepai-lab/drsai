from __future__ import annotations

import concurrent.futures
import sqlite3
from dataclasses import asdict
from pathlib import Path

import pytest

from drsai.backend.runtime.authorization import (
    ApprovalService,
    ApprovalServiceError,
    CodexApprovalAdapter,
    GrantService,
    GrantServiceError,
    OaepApprovalAdapter,
    REVIEW_PROTOCOL_VERSION,
    ReviewerDecisionEnvelope,
    TuiApprovalAdapter,
    parse_reviewer_decision,
    serialize_reviewer_decision,
    serialize_reviewer_request,
)
from drsai.backend.runtime.security_boundary import (
    ActionProposal, ResolvedCapabilityProfile, SecurityMetricsCollector,
)


def profile(*, version: int = 1, capabilities: frozenset[str] = frozenset({"file.write"})) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id="manual-safe", version=version, workspace_root="C:/workspace",
        capabilities=capabilities, trusted_workspace=True,
    )


def proposal(*, category: str | None = None, command: str = "write safe.txt") -> ActionProposal:
    return ActionProposal.create(
        proposal_id="proposal-1", run_id="run-1", operation="file.write",
        payload={"command": command, "path": "safe.txt", "token": "proposal-secret"},
        risk="local_write", required_capabilities=("file.write",),
        effect_categories=(category,) if category else (),
    )


def approved_request(database: Path, *, action: ActionProposal | None = None, active_profile: ResolvedCapabilityProfile | None = None):
    approvals = ApprovalService(database)
    selected_proposal = action or proposal()
    selected_profile = active_profile or profile()
    request = approvals.create_request(
        selected_proposal, profile_digest=selected_profile.digest,
        policy_version="authorization-policy/1", reviewer_kind="human",
        reason_code="local_write_requires_review", idempotency_key="request-1",
        deadline_at=200, now=100,
    )
    decision = approvals.decide(
        request.request_id, "approved", reviewer_kind="human", reviewer_id="reviewer-1",
        reason_code="user_approved", idempotency_key="decision-1", now=101,
    )
    return approvals, request, decision, selected_profile


def test_approved_decision_issues_exactly_one_grant_atomically(tmp_path: Path) -> None:
    database = tmp_path / "authorization.sqlite3"
    _, request, decision, active_profile = approved_request(database)
    service = GrantService(database)

    def issue(_: int):
        return service.issue_for_approved_request(
            request.request_id, active_profile, review_requirement="human", now=102,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
        grants = list(executor.map(issue, range(32)))
    assert len({grant.grant_id for grant in grants}) == 1
    assert all(grant.proposal_digest == proposal().payload_digest for grant in grants)
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT COUNT(*) FROM runtime_approval_grants").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM runtime_authorization_grants").fetchone()[0] == 1
        binding = db.execute("SELECT decision_id FROM runtime_approval_grants").fetchone()
        assert binding[0] == decision.decision_id
    assert service.get_for_request(request.request_id) == grants[0]


@pytest.mark.parametrize("terminal", ["denied", "cancelled"])
def test_non_approved_decision_never_issues_grant(tmp_path: Path, terminal: str) -> None:
    database = tmp_path / f"{terminal}.sqlite3"
    approvals = ApprovalService(database)
    active_profile = profile()
    request = approvals.create_request(
        proposal(), profile_digest=active_profile.digest, policy_version="authorization-policy/1",
        reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="request-1", deadline_at=200, now=100,
    )
    approvals.decide(
        request.request_id, terminal, reviewer_kind="human", reviewer_id="reviewer-1",
        reason_code=f"user_{terminal}", idempotency_key="decision-1", now=101,
    )
    with pytest.raises(GrantServiceError) as rejected:
        GrantService(database).issue_for_approved_request(
            request.request_id, active_profile, review_requirement="human", now=102,
        )
    assert rejected.value.code == "approval_not_approved"


def test_profile_or_policy_change_after_approval_requires_new_review(tmp_path: Path) -> None:
    database = tmp_path / "authorization.sqlite3"
    _, request, _, original_profile = approved_request(database)
    service = GrantService(database)
    tightened = profile(version=2, capabilities=frozenset())
    with pytest.raises(GrantServiceError) as changed_profile:
        service.issue_for_approved_request(
            request.request_id, tightened, review_requirement="human", now=102,
        )
    assert changed_profile.value.code == "approval_profile_changed"
    with pytest.raises(GrantServiceError) as changed_reviewer:
        service.issue_for_approved_request(
            request.request_id, original_profile, review_requirement="auto", now=102,
        )
    assert changed_reviewer.value.code == "approval_policy_no_longer_authorizes"


def test_hard_deny_is_rechecked_after_approved_decision(tmp_path: Path) -> None:
    database = tmp_path / "authorization.sqlite3"
    dangerous = proposal(category="credential_theft")
    _, request, _, active_profile = approved_request(database, action=dangerous)
    with pytest.raises(GrantServiceError) as blocked:
        GrantService(database).issue_for_approved_request(
            request.request_id, active_profile, review_requirement="human", now=102,
        )
    assert blocked.value.code == "approval_policy_no_longer_authorizes"
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT COUNT(*) FROM runtime_authorization_grants").fetchone()[0] == 0


def test_approved_request_deadline_bounds_new_grant_but_not_idempotent_read(tmp_path: Path) -> None:
    database = tmp_path / "authorization.sqlite3"
    _, request, _, active_profile = approved_request(database)
    service = GrantService(database)
    with pytest.raises(GrantServiceError) as expired:
        service.issue_for_approved_request(
            request.request_id, active_profile, review_requirement="human", now=200,
        )
    assert expired.value.code == "approval_authorization_expired"

    database_two = tmp_path / "issued.sqlite3"
    _, issued_request, _, issued_profile = approved_request(database_two)
    issued_service = GrantService(database_two)
    grant = issued_service.issue_for_approved_request(
        issued_request.request_id, issued_profile, review_requirement="human", now=102,
    )
    assert issued_service.issue_for_approved_request(
        issued_request.request_id, issued_profile, review_requirement="human", now=300,
    ) == grant


def test_grant_audit_links_decision_without_reviewer_or_secret(tmp_path: Path) -> None:
    database = tmp_path / "authorization.sqlite3"
    _, request, decision, active_profile = approved_request(database)
    service = GrantService(database)
    grant = service.issue_for_approved_request(
        request.request_id, active_profile, review_requirement="human", now=102,
    )
    event = next(item for item in service.audit.list() if item.event_type == "authorization.grant_issued")
    assert event.subject_id == grant.grant_id
    assert event.payload["decision_id"] == decision.decision_id
    serialized = str(event)
    assert "reviewer-1" not in serialized
    assert "proposal-secret" not in serialized
    service.audit.verify()


def test_codex_tui_oaep_adapters_share_one_semantic_envelope(tmp_path: Path) -> None:
    database = tmp_path / "authorization.sqlite3"
    approvals = ApprovalService(database)
    action = proposal(command="write safe.txt\u202eexe")
    request = approvals.create_request(
        action, profile_digest=profile().digest, policy_version="authorization-policy/1",
        reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="request-1", deadline_at=200, now=100,
    )
    adapters = [CodexApprovalAdapter(), TuiApprovalAdapter(), OaepApprovalAdapter()]
    envelopes = [adapter.present(approvals, request.request_id) for adapter in adapters]
    semantic = []
    for envelope in envelopes:
        value = asdict(envelope)
        value.pop("adapter_kind")
        semantic.append(value)
    assert semantic[0] == semantic[1] == semantic[2]
    assert all(envelope.approval_scope == "once" for envelope in envelopes)
    assert all(envelope.proposal_digest == action.payload_digest for envelope in envelopes)
    assert "proposal-secret" not in str(envelopes)
    assert "\\u202e" in str(envelopes[0].display_payload)


@pytest.mark.parametrize("adapter", [CodexApprovalAdapter(), TuiApprovalAdapter(), OaepApprovalAdapter()])
def test_each_adapter_only_submits_a_decision_fact(tmp_path: Path, adapter) -> None:
    database = tmp_path / f"{adapter.adapter_kind}.sqlite3"
    approvals = ApprovalService(database)
    request = approvals.create_request(
        proposal(), profile_digest=profile().digest, policy_version="authorization-policy/1",
        reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="request-1", deadline_at=200, now=100,
    )
    envelope = ReviewerDecisionEnvelope(
        schema_version=REVIEW_PROTOCOL_VERSION, adapter_kind=adapter.adapter_kind,
        request_id=request.request_id, decision="approved", reason_code="user_approved",
        idempotency_key="decision-1", detail={},
    )
    decision = adapter.submit(
        approvals, envelope, reviewer_id="reviewer-1", reviewer_kind="human", now=101,
    )
    assert decision.decision == "approved"
    with sqlite3.connect(database) as db:
        grant_table_count = db.execute(
            "SELECT COUNT(*) FROM sqlite_master "
            "WHERE type = 'table' AND name = 'runtime_authorization_grants'"
        ).fetchone()[0]
        assert grant_table_count == 0


def test_adapter_protocol_mismatch_and_disconnect_fail_closed(tmp_path: Path) -> None:
    approvals = ApprovalService(tmp_path / "authorization.sqlite3")
    request = approvals.create_request(
        proposal(), profile_digest=profile().digest, policy_version="authorization-policy/1",
        reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="request-1", deadline_at=200, now=100,
    )
    adapter = CodexApprovalAdapter()
    adapter.present(approvals, request.request_id)
    # Merely presenting/disconnecting cannot create a Decision or Grant.
    assert approvals.get_request(request.request_id).status == "pending"
    assert approvals.get_decision(request.request_id) is None
    wrong = ReviewerDecisionEnvelope(
        schema_version=REVIEW_PROTOCOL_VERSION, adapter_kind="tui", request_id=request.request_id,
        decision="approved", reason_code="user_approved", idempotency_key="decision-1", detail={},
    )
    with pytest.raises(ApprovalServiceError) as mismatch:
        adapter.submit(approvals, wrong, reviewer_id="reviewer-1", reviewer_kind="human", now=101)
    assert mismatch.value.code == "review_protocol_mismatch"
    assert approvals.get_request(request.request_id).status == "pending"
    metrics = SecurityMetricsCollector(approvals.database).snapshot(now=102)
    assert any(
        metric.name == "security_approval_adapter_failure_total"
        and metric.labels == {"adapter": "codex", "category": "protocol"}
        and metric.value == 1
        for metric in metrics
    )
    assert request.request_id not in str(metrics)


def test_reviewer_request_and_decision_have_canonical_golden_wire_contract(tmp_path: Path) -> None:
    database = tmp_path / "golden.sqlite3"
    approvals = ApprovalService(database)
    action = proposal()
    request = approvals.create_request(
        action, profile_digest=profile().digest, policy_version="authorization-policy/1",
        reviewer_kind="human", reason_code="local_write_requires_review",
        idempotency_key="request-golden", deadline_at=200, now=100,
    )
    presented = CodexApprovalAdapter().present(approvals, request.request_id)
    request_wire = serialize_reviewer_request(presented)
    assert request_wire == (
        '{"adapter_kind":"codex","approval_scope":"once","deadline_at":200.0,'
        '"display_payload":{"command":"write safe.txt","path":"safe.txt","token":"[REDACTED]"},'
        '"effect_categories":[],"operation":"file.write","proposal_digest":"' + action.payload_digest + '",'
        '"proposal_id":"proposal-1","reason_code":"local_write_requires_review",'
        '"request_id":"' + request.request_id + '","required_capabilities":["file.write"],'
        '"reviewer_kind":"human","risk":"local_write","run_id":"run-1",'
        '"schema_version":"approval-review/1"}'
    )
    decision = ReviewerDecisionEnvelope(
        schema_version=REVIEW_PROTOCOL_VERSION, adapter_kind="codex", request_id=request.request_id,
        decision="approved", reason_code="user_approved", idempotency_key="decision-golden",
        detail={"ticket": "SEC-1"},
    )
    decision_wire = serialize_reviewer_decision(decision)
    assert parse_reviewer_decision(decision_wire) == decision
    assert serialize_reviewer_decision(parse_reviewer_decision(decision_wire)) == decision_wire


@pytest.mark.parametrize("bad_payload", [
    "[]",
    '{"schema_version":"approval-review/2"}',
    '{"schema_version":"approval-review/1","adapter_kind":"codex","request_id":"r",'
    '"decision":"execute","reason_code":"x","idempotency_key":"k","detail":{}}',
])
def test_reviewer_decision_wire_rejects_malformed_or_unsupported_payload(bad_payload: str) -> None:
    with pytest.raises(ApprovalServiceError):
        parse_reviewer_decision(bad_payload)


def test_reviewer_decision_wire_has_bounded_size() -> None:
    with pytest.raises(ApprovalServiceError, match="wire limit"):
        parse_reviewer_decision(b" " * (64 * 1024 + 1))
