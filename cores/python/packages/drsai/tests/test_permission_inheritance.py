from __future__ import annotations

import itertools
import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.permission_modes import (
    AdministratorPolicy,
    BUILTIN_MODES,
    ChildPermissionResolver,
    DEVELOPMENT_CAPABILITIES,
    ModeSelection,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
)
from drsai.backend.runtime.security_boundary import IsolationAttestation
from drsai.backend.runtime.security_boundary.sandbox import REQUIRED_GUARANTEES


def admin(**changes) -> AdministratorPolicy:
    values = {
        "policy_id": "organization-default", "version": 1, "verified": True,
        "allowed_modes": frozenset(BUILTIN_MODES), "capability_ceiling": DEVELOPMENT_CAPABILITIES,
        "allowed_network_rules": ("https://api.example:443",),
        "allowed_credential_refs": frozenset({"credential:api"}),
    }
    values.update(changes)
    return AdministratorPolicy(**values)


def platform() -> PlatformBoundary:
    return PlatformBoundary(
        DEVELOPMENT_CAPABILITIES,
        IsolationAttestation(
            "windows-restricted", "1", "windows", 90, 200,
            REQUIRED_GUARANTEES, "sha256:isolation-evidence",
        ),
    )


def parent_effective(mode_id="manual_safe", *, capabilities=(), hard_denies=frozenset()):
    return PermissionProfileResolver().resolve(
        ModeSelection(
            mode_id, "user", mode_id == "isolated_full_access",
            requested_capabilities=frozenset(capabilities),
            requested_network_rules=("https://api.example:443",),
            requested_credential_refs=frozenset({"credential:api"}),
        ), administrator=admin(hard_denies=hard_denies), platform=platform(),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
    )


def test_child_requesting_full_access_is_clamped_to_manual_parent(tmp_path: Path) -> None:
    parent = parent_effective("manual_safe")
    inherited = ChildPermissionResolver(tmp_path / "runtime.sqlite3").derive_and_bind(
        "parent-run", "child-run", parent,
        ModeSelection(
            "isolated_full_access", "user", True,
            requested_capabilities=DEVELOPMENT_CAPABILITIES,
        ), administrator=admin(), platform=platform(),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
    )
    child = inherited.effective
    assert child.mode.mode_id == "manual_safe" and child.reviewer_route == "human"
    assert child.capability_profile.capabilities <= parent.capability_profile.capabilities
    assert child.isolation_attestation_digest is None
    assert {"capabilities", "reviewer_route"}.issubset(inherited.clamped_dimensions)


def test_child_network_credentials_roots_hard_denies_and_human_rules_never_weaken_parent(tmp_path: Path) -> None:
    parent = parent_effective(
        "auto_reviewed", capabilities=("file.write", "network.connect", "credential.use"),
        hard_denies=frozenset({"organization_forbidden"}),
    )
    inherited = ChildPermissionResolver(tmp_path / "runtime.sqlite3").derive_and_bind(
        "parent-run", "child-run", parent,
        ModeSelection(
            "auto_reviewed", "user", False,
            requested_capabilities=DEVELOPMENT_CAPABILITIES,
            requested_network_rules=("https://api.example:443", "https://other.example:443"),
            requested_credential_refs=frozenset({"credential:api", "credential:other"}),
        ), administrator=admin(hard_denies=frozenset({"child_forbidden"})), platform=platform(),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
    )
    child, parent_profile = inherited.effective, parent.capability_profile
    assert child.capability_profile.capabilities <= parent_profile.capabilities
    assert set(child.capability_profile.network_rules) <= set(parent_profile.network_rules)
    assert child.capability_profile.credential_refs <= parent_profile.credential_refs
    assert set(child.capability_profile.writable_roots) <= set(parent_profile.writable_roots)
    assert child.capability_profile.hard_denies >= parent_profile.hard_denies
    assert child.mandatory_human_categories >= parent.mandatory_human_categories


def test_child_workspace_root_outside_parent_has_no_inherited_write_root(tmp_path: Path) -> None:
    parent = parent_effective("manual_safe", capabilities=("file.write",))
    inherited = ChildPermissionResolver(tmp_path / "runtime.sqlite3").derive_and_bind(
        "parent-run", "child-run", parent,
        ModeSelection("manual_safe", "user", False, requested_capabilities=frozenset({"file.write"})),
        administrator=admin(), platform=platform(),
        workspace=WorkspaceContext("D:/other", True), profile_version=1, now=100,
    )
    assert inherited.effective.capability_profile.writable_roots == ()
    assert "writable_roots" in inherited.clamped_dimensions


def test_all_child_capability_combinations_are_subsets_of_parent(tmp_path: Path) -> None:
    universe = ("file.read", "file.write", "network.connect", "shell.execute")
    parent = parent_effective("auto_reviewed", capabilities=("file.write", "network.connect"))
    resolver = ChildPermissionResolver(tmp_path / "runtime.sqlite3")
    for index, size in enumerate(range(len(universe) + 1)):
        for offset, values in enumerate(itertools.combinations(universe, size)):
            child = resolver.derive_and_bind(
                "parent-run", f"child-{index}-{offset}", parent,
                ModeSelection("auto_reviewed", "user", False, requested_capabilities=frozenset(values)),
                administrator=admin(), platform=platform(),
                workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
            ).effective
            assert child.capability_profile.capabilities <= parent.capability_profile.capabilities


def test_inheritance_binding_and_audit_are_append_only(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    resolver = ChildPermissionResolver(database)
    parent = parent_effective()
    result = resolver.derive_and_bind(
        "parent-run", "child-run", parent, ModeSelection("manual_safe", "user", False),
        administrator=admin(), platform=platform(),
        workspace=WorkspaceContext("C:/workspace", True), profile_version=1, now=100,
    )
    assert resolver.security.active_profile("child-run") == result.effective.capability_profile
    assert resolver.audit.list()[-1].event_type == "permission_profile.inherited"
    with sqlite3.connect(database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM runtime_permission_profile_inheritance")
