from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    ActionProposal,
    AuthorizationGrantStore,
    HARD_DENY_POLICY_VERSION,
    MANDATORY_HARD_DENIES,
    HardDenyError,
    HardDenyPolicy,
    ResolvedCapabilityProfile,
    SecurityBoundaryStore,
    infer_effect_categories,
)


def permissive_profile(mode: str) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id=mode,
        version=1,
        workspace_root="C:/workspace",
        capabilities=frozenset({"process.execute", "credential.use", "host.manage", "security.manage"}),
        trusted_workspace=True,
    )


def dangerous_proposal(category: str, *, operation: str = "shell.execute") -> ActionProposal:
    return ActionProposal.create(
        proposal_id=f"proposal-{category}", run_id="run-1", operation=operation,
        payload={"command": ["approved-tool", "--run"]}, risk="sensitive",
        required_capabilities=("process.execute",), effect_categories=(category,),
    )


@pytest.mark.parametrize("mode", ["manual_safe", "auto_reviewed", "isolated_full_access"])
@pytest.mark.parametrize("category", sorted(MANDATORY_HARD_DENIES))
def test_no_permission_mode_or_approval_can_override_hard_deny(tmp_path: Path, mode: str, category: str) -> None:
    store = AuthorizationGrantStore(tmp_path / f"{mode}-{category}.sqlite3")
    with pytest.raises(HardDenyError) as blocked:
        store.issue(dangerous_proposal(category), permissive_profile(mode), now=100)
    assert blocked.value.category == category
    assert blocked.value.policy_version == HARD_DENY_POLICY_VERSION
    assert blocked.value.code == "hard_deny"
    assert store.audit.list()[-1].event_type == "hard_deny.blocked"


@pytest.mark.parametrize(("operation", "category"), [
    ("security.policy.modify", "security_control_tampering"),
    ("credential.export", "credential_theft"),
    ("host.persistence.install", "host_persistence"),
    ("process.inject", "cross_process_injection"),
    ("audit.disable", "audit_disable"),
    ("host.control_plane.access", "host_control_plane"),
])
def test_protected_operation_names_are_denied_without_declared_category(operation: str, category: str) -> None:
    proposal = ActionProposal.create(
        proposal_id="proposal-1", run_id="run-1", operation=operation,
        payload={}, risk="sensitive", required_capabilities=(),
    )
    decision = HardDenyPolicy().evaluate(proposal)
    assert decision.denied is True
    assert decision.category == category
    assert decision.reason_code == "protected_operation"


@pytest.mark.parametrize(("command", "category"), [
    (["SCHTASKS.EXE", "/Create", "/TN", "agent"], "host_persistence"),
    (["sc.exe", "create", "agent", "binPath=x"], "host_persistence"),
    (["reg.exe", "add", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run", "/v", "agent"], "host_persistence"),
    (["wevtutil.exe", "cl", "Security"], "audit_disable"),
    (["auditpol.exe", "/clear", "/y"], "audit_disable"),
    (["procdump64.exe", "-ma", "lsass.exe", "dump.dmp"], "credential_theft"),
    (["mimikatz.exe", "sekurlsa::logonpasswords"], "credential_theft"),
])
def test_deterministic_command_rules_are_case_and_argv_stable(command: list[str], category: str) -> None:
    inferred = infer_effect_categories("shell.execute", {"command": command})
    assert category in inferred
    proposal = ActionProposal.create(
        proposal_id="proposal-command", run_id="run-1", operation="shell.execute",
        payload={"command": command}, risk="sensitive", required_capabilities=("process.execute",),
    )
    decision = HardDenyPolicy().evaluate(proposal)
    assert decision.denied is True
    assert decision.category == category
    assert decision.reason_code == "deterministic_command_rule"


def test_additional_profile_hard_denies_can_only_tighten() -> None:
    proposal = ActionProposal.create(
        proposal_id="proposal-custom", run_id="run-1", operation="external.publish",
        payload={}, risk="external_write", effect_categories=("public_release",),
    )
    profile = ResolvedCapabilityProfile(
        profile_id="organization", version=1, workspace_root="C:/workspace",
        capabilities=frozenset(), hard_denies=frozenset({"public_release"}),
    )
    assert HardDenyPolicy().evaluate(proposal).denied is False
    assert profile.permits(proposal) is False


def test_existing_proposal_table_migrates_effect_categories(tmp_path: Path) -> None:
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as db:
        db.execute("""CREATE TABLE runtime_action_proposals(
            proposal_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, operation TEXT NOT NULL,
            payload_digest TEXT NOT NULL, display_json TEXT NOT NULL, risk TEXT NOT NULL,
            capabilities_json TEXT NOT NULL, created_at REAL NOT NULL
        )""")
    store = SecurityBoundaryStore(database)
    proposal = dangerous_proposal("host_persistence")
    store.save_proposal(proposal, now=100)
    assert store.get_proposal(proposal.proposal_id).effect_categories == frozenset({"host_persistence"})

