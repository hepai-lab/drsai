from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.authorization import ApprovalService
from drsai.backend.runtime.permission_modes import (
    AdministratorPolicy,
    BUILTIN_MODES,
    DEVELOPMENT_CAPABILITIES,
    ModeSelection,
    PermissionModeError,
    PermissionModeService,
    ModeTransitionInterrupted,
    PlatformBoundary,
    WorkspaceContext,
)
from drsai.backend.runtime.security_boundary import (
    ActionProposal,
    GrantError,
    IsolationAttestation,
)
from drsai.backend.runtime.security_boundary.sandbox import REQUIRED_GUARANTEES


def admin() -> AdministratorPolicy:
    return AdministratorPolicy(
        "organization-default", 1, True, allowed_modes=frozenset(BUILTIN_MODES),
        capability_ceiling=DEVELOPMENT_CAPABILITIES,
    )


def platform() -> PlatformBoundary:
    return PlatformBoundary(
        DEVELOPMENT_CAPABILITIES,
        IsolationAttestation(
            "windows-restricted", "1", "windows", 90, 200,
            REQUIRED_GUARANTEES, "sha256:isolation-evidence",
        ),
    )


def apply(service: PermissionModeService, run_id: str, mode_id: str, *, explicit: bool, capabilities=()):
    return service.apply(
        run_id,
        ModeSelection(
            mode_id, "user", explicit,
            requested_capabilities=frozenset(capabilities),
        ),
        administrator=admin(), platform=platform(),
        workspace=WorkspaceContext("C:/workspace", True), now=100,
    )


def test_mode_binding_persists_actual_effective_descriptor_and_audit(tmp_path: Path) -> None:
    service = PermissionModeService(tmp_path / "runtime.sqlite3")
    result = apply(service, "run-1", "manual_safe", explicit=False)
    assert result.transition_kind == "initial"
    assert result.revoked_grants == result.cancelled_requests == 0
    descriptor = service.current_descriptor("run-1")
    assert descriptor == result.effective.as_descriptor()
    assert service.security.active_profile("run-1") == result.effective.capability_profile
    event = service.audit.list()[-1]
    assert event.event_type == "permission_mode.changed"
    assert "C:/workspace" not in str(event.payload)


def test_permission_expansion_requires_confirmation_and_agent_source_stays_forbidden(tmp_path: Path) -> None:
    service = PermissionModeService(tmp_path / "runtime.sqlite3")
    apply(service, "run-1", "manual_safe", explicit=False)
    with pytest.raises(PermissionModeError) as unconfirmed:
        apply(service, "run-1", "auto_reviewed", explicit=False, capabilities=("file.write",))
    assert unconfirmed.value.code == "mode_elevation_confirmation_required"
    upgraded = apply(service, "run-1", "auto_reviewed", explicit=True, capabilities=("file.write",))
    assert upgraded.transition_kind == "upgrade"

    with pytest.raises(PermissionModeError) as agent:
        service.apply(
            "run-1", ModeSelection("manual_safe", "agent", False),
            administrator=admin(), platform=platform(),
            workspace=WorkspaceContext("C:/workspace", True), now=101,
        )
    assert agent.value.code == "mode_selection_source_forbidden"


def test_downgrade_revokes_unconsumed_grants_and_cancels_pending_requests(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    service = PermissionModeService(database)
    broad = apply(service, "run-1", "isolated_full_access", explicit=True)
    proposal = ActionProposal.create(
        proposal_id="proposal-write", run_id="run-1", operation="file.write",
        payload={"path": "safe.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    service.security.save_proposal(proposal, now=100)
    grant = service.grants.issue(proposal, broad.effective.capability_profile, now=100)
    approvals = ApprovalService(database)
    request = approvals.create_request(
        proposal, profile_digest=broad.effective.capability_profile.digest,
        policy_version="authorization-policy/1", reviewer_kind="human",
        reason_code="manual_review_required", idempotency_key="request-1", now=100,
    )

    narrowed = apply(service, "run-1", "manual_safe", explicit=False)
    assert narrowed.transition_kind == "downgrade"
    assert narrowed.revoked_grants == 1 and narrowed.cancelled_requests == 1
    assert service.grants.get(grant.grant_id).revoked_at == 100
    assert approvals.get_request(request.request_id).status == "cancelled"
    decision = approvals.get_decision(request.request_id)
    assert decision is not None and decision.reviewer_kind == "system"
    with pytest.raises(GrantError) as revoked:
        service.grants.consume(
            grant.grant_id, proposal, broad.effective.capability_profile,
            actual_payload={"path": "safe.txt"}, now=101,
        )
    assert revoked.value.code == "grant_revoked"


def test_same_mode_rebind_does_not_revoke_grants_but_versions_profile(tmp_path: Path) -> None:
    service = PermissionModeService(tmp_path / "runtime.sqlite3")
    first = apply(service, "run-1", "manual_safe", explicit=False)
    proposal = ActionProposal.create(
        proposal_id="proposal-read", run_id="run-1", operation="file.read",
        payload={"path": "safe.txt"}, risk="read", required_capabilities=("file.read",),
    )
    grant = service.grants.issue(proposal, first.effective.capability_profile, now=100)
    second = service.apply(
        "run-1", ModeSelection("manual_safe", "user", False),
        administrator=admin(), platform=platform(), workspace=WorkspaceContext("C:/workspace", True), now=101,
    )
    assert second.transition_kind == "same" and second.revoked_grants == 0
    assert service.grants.get(grant.grant_id).revoked_at is None
    assert second.effective.capability_profile.version == first.effective.capability_profile.version + 1


def test_mode_binding_and_grant_revocation_are_append_only(tmp_path: Path) -> None:
    service = PermissionModeService(tmp_path / "runtime.sqlite3")
    result = apply(service, "run-1", "manual_safe", explicit=False)
    with sqlite3.connect(service.database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM runtime_permission_mode_bindings WHERE binding_id=?", (result.binding_id,))


@pytest.mark.parametrize("fault_stage", ["revoked", "requests_cancelled", "profile_bound"])
def test_mode_transition_recovers_from_each_durable_fault_stage_and_blocks_new_grants(
    tmp_path: Path, fault_stage: str,
) -> None:
    database = tmp_path / f"transition-{fault_stage}.sqlite3"
    service = PermissionModeService(database)
    broad = apply(service, "run-1", "isolated_full_access", explicit=True)
    write = ActionProposal.create(
        proposal_id="proposal-write", run_id="run-1", operation="file.write",
        payload={"path": "safe.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    grant = service.grants.issue(write, broad.effective.capability_profile, now=100)
    service.approvals.create_request(
        write, profile_digest=broad.effective.capability_profile.digest,
        policy_version="authorization-policy/1", reviewer_kind="human",
        reason_code="manual_review_required", idempotency_key="request-transition", now=100,
    )
    with pytest.raises(ModeTransitionInterrupted, match=fault_stage):
        service.apply(
            "run-1", ModeSelection("manual_safe", "user", False),
            administrator=admin(), platform=platform(), workspace=WorkspaceContext("C:/workspace", True),
            now=101, fault_after=fault_stage,
        )
    assert service.grants.get(grant.grant_id).revoked_at == 101
    with pytest.raises(GrantError) as transition_active:
        service.grants.issue(write, broad.effective.capability_profile, now=102)
    assert transition_active.value.code == "permission_mode_transition_active"
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT status FROM runtime_permission_mode_transitions WHERE status!='committed'",
        ).fetchone()[0] == fault_stage

    restarted = PermissionModeService(database)
    recovered = restarted.apply(
        "run-1", ModeSelection("manual_safe", "user", False),
        administrator=admin(), platform=platform(), workspace=WorkspaceContext("C:/workspace", True), now=103,
    )
    assert recovered.transition_kind == "downgrade"
    assert recovered.revoked_grants == 1 and recovered.cancelled_requests == 1
    assert restarted.approvals.list_requests("run-1", status="pending") == []
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_permission_mode_transitions WHERE status='committed'",
        ).fetchone()[0] == 2
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_permission_mode_bindings WHERE run_id='run-1'",
        ).fetchone()[0] == 2
        stages = {row[0] for row in db.execute(
            "SELECT stage FROM runtime_permission_mode_transition_events "
            "WHERE transition_id=(SELECT transition_id FROM runtime_permission_mode_transitions "
            "WHERE transition_kind='downgrade')",
        )}
    assert stages == {"revoked", "requests_cancelled", "profile_bound", "committed"}
