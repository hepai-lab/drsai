from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.permission_modes import (
    AdministratorPolicy,
    BUILTIN_MODES,
    DEVELOPMENT_CAPABILITIES,
    ModeSelection,
    PermissionKillSwitchService,
    PermissionModeService,
    PlatformBoundary,
    WorkspaceContext,
    PermissionModeError,
)
from drsai.backend.runtime.security_boundary import ActionProposal, EffectExecutionStore, GrantError


def admin() -> AdministratorPolicy:
    return AdministratorPolicy(
        "organization-default", 1, True, allowed_modes=frozenset(BUILTIN_MODES),
        capability_ceiling=DEVELOPMENT_CAPABILITIES,
    )


def bind(service: PermissionModeService, run_id: str, mode_id: str, capabilities=()):
    return service.apply(
        run_id, ModeSelection(
            mode_id, "user", mode_id != "manual_safe",
            requested_capabilities=frozenset(capabilities),
        ), administrator=admin(), platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
        workspace=WorkspaceContext("C:/workspace", True), now=100,
    )


def test_auto_reviewer_kill_switch_revokes_only_affected_mode_and_cancels_pending(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    modes = PermissionModeService(database)
    auto = bind(modes, "run-auto", "auto_reviewed", ("file.write",))
    manual = bind(modes, "run-manual", "manual_safe", ("file.write",))
    auto_action = ActionProposal.create(
        proposal_id="proposal-auto", run_id="run-auto", operation="file.write",
        payload={"path": "auto.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    manual_action = ActionProposal.create(
        proposal_id="proposal-manual", run_id="run-manual", operation="file.write",
        payload={"path": "manual.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    auto_grant = modes.grants.issue(auto_action, auto.effective.capability_profile, now=100)
    manual_grant = modes.grants.issue(manual_action, manual.effective.capability_profile, now=100)
    pending = modes.approvals.create_request(
        auto_action, profile_digest=auto.effective.capability_profile.digest,
        policy_version="authorization-policy/1", reviewer_kind="auto",
        reason_code="policy_requires_auto", idempotency_key="request-auto", now=100,
    )

    result = PermissionKillSwitchService(database).set(
        "auto_reviewer", active=True, reason_code="incident_response", now=101,
    )
    assert result.affected_runs == 1 and result.revoked_grants == 1 and result.cancelled_requests == 1
    assert modes.grants.get(auto_grant.grant_id).revoked_at == 101
    assert modes.grants.get(manual_grant.grant_id).revoked_at is None
    assert modes.approvals.get_request(pending.request_id).status == "cancelled"
    modes.grants.consume(
        manual_grant.grant_id, manual_action, manual.effective.capability_profile,
        actual_payload={"path": "manual.txt"}, now=102,
    )


def test_active_switch_blocks_grant_issue_consume_and_effect_claim_even_before_cleanup(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    modes = PermissionModeService(database)
    auto = bind(modes, "run-auto", "auto_reviewed", ("file.write",))
    action = ActionProposal.create(
        proposal_id="proposal-auto", run_id="run-auto", operation="file.write",
        payload={"path": "auto.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    grant = modes.grants.issue(action, auto.effective.capability_profile, now=100)
    switches = PermissionKillSwitchService(database)
    switches.set("auto_reviewer", active=True, reason_code="incident_response", now=101)

    with pytest.raises(GrantError) as issue:
        modes.grants.issue(action, auto.effective.capability_profile, now=102)
    assert issue.value.code == "permission_kill_switch_active"
    with pytest.raises(GrantError) as consume:
        modes.grants.consume(
            grant.grant_id, action, auto.effective.capability_profile,
            actual_payload={"path": "auto.txt"}, now=102,
        )
    assert consume.value.code == "permission_kill_switch_active"
    with pytest.raises(GrantError) as claim:
        EffectExecutionStore(database).claim(
            execution_id="execution-1", grant_id=grant.grant_id, proposal=action,
            profile=auto.effective.capability_profile, actual_payload={"path": "auto.txt"},
            attestation_digest="sha256:attestation", now=102,
        )
    assert claim.value.code == "permission_kill_switch_active"


def test_deactivation_does_not_restore_old_authority_and_activation_retry_finishes_cleanup(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    modes = PermissionModeService(database)
    auto = bind(modes, "run-auto", "auto_reviewed", ("file.write",))
    action = ActionProposal.create(
        proposal_id="proposal-auto", run_id="run-auto", operation="file.write",
        payload={"path": "auto.txt"}, risk="local_write", required_capabilities=("file.write",),
    )
    old = modes.grants.issue(action, auto.effective.capability_profile, now=100)
    switches = PermissionKillSwitchService(database)
    first = switches.set("auto_reviewer", active=True, reason_code="incident_response", now=101)
    retry = switches.set("auto_reviewer", active=True, reason_code="retry_propagation", now=102)
    assert retry.event_id == first.event_id and retry.revoked_grants == 0
    switches.set("auto_reviewer", active=False, reason_code="incident_resolved", now=103)
    assert not switches.is_active("auto_reviewer")
    assert modes.grants.get(old.grant_id).revoked_at == 101
    new = modes.grants.issue(action, auto.effective.capability_profile, now=104)
    assert new.revoked_at is None


def test_kill_switch_events_are_append_only(tmp_path: Path) -> None:
    service = PermissionKillSwitchService(tmp_path / "runtime.sqlite3")
    service.set("auto_reviewer", active=True, reason_code="test", now=100)
    with sqlite3.connect(service.database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM runtime_permission_kill_switch_events")


def test_active_switch_prevents_selecting_affected_mode_but_manual_safe_remains_available(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    switches = PermissionKillSwitchService(database)
    switches.set("auto_reviewer", active=True, reason_code="incident", now=100)
    modes = PermissionModeService(database)
    with pytest.raises(PermissionModeError) as disabled:
        bind(modes, "run-auto", "auto_reviewed")
    assert disabled.value.code == "permission_kill_switch_active"
    assert bind(modes, "run-manual", "manual_safe").effective.mode.mode_id == "manual_safe"
