from __future__ import annotations

import itertools

import pytest

from drsai.backend.runtime.permission_modes import (
    AdministratorPolicy,
    BUILTIN_MODES,
    DEVELOPMENT_CAPABILITIES,
    MODE_SCHEMA_VERSION,
    ModeSelection,
    PermissionModeError,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
    get_mode,
    mode_descriptors,
)
from drsai.backend.runtime.security_boundary import ActionProposal, HardDenyPolicy, IsolationAttestation
from drsai.backend.runtime.security_boundary.sandbox import REQUIRED_GUARANTEES


def admin(**changes: object) -> AdministratorPolicy:
    values = {
        "policy_id": "organization-default", "version": 1, "verified": True,
        "allowed_modes": frozenset(BUILTIN_MODES),
        "capability_ceiling": DEVELOPMENT_CAPABILITIES,
        "allowed_network_rules": ("https://api.example:443",),
        "allowed_credential_refs": frozenset({"credential:api"}),
    }
    values.update(changes)
    return AdministratorPolicy(**values)  # type: ignore[arg-type]


def platform(*, attestation: IsolationAttestation | None = None) -> PlatformBoundary:
    return PlatformBoundary(DEVELOPMENT_CAPABILITIES, attestation)


def attestation(
    *, expires_at: float = 200,
    guarantees: frozenset[str] = REQUIRED_GUARANTEES,
) -> IsolationAttestation:
    return IsolationAttestation(
        backend_id="windows-restricted", backend_version="1", platform="windows",
        verified_at=90, expires_at=expires_at, guarantees=guarantees,
        evidence_digest="sha256:isolation-evidence",
    )


def workspace(*, trusted: bool = True) -> WorkspaceContext:
    return WorkspaceContext("C:/workspace", trusted)


def resolve(mode_id: str, **changes: object):
    selection_values = {
        "mode_id": mode_id, "source": "user", "explicit_confirmation": mode_id == "isolated_full_access",
    }
    selection_values.update(changes.pop("selection", {}))
    return PermissionProfileResolver().resolve(
        ModeSelection(**selection_values), administrator=changes.pop("administrator", admin()),
        platform=changes.pop("platform", platform(attestation=attestation())),
        workspace=changes.pop("workspace_context", workspace()), profile_version=1, now=100,
    )


def test_builtin_mode_contract_is_stable_and_canonical() -> None:
    descriptors = mode_descriptors()
    assert [item["mode_id"] for item in descriptors] == [
        "auto_reviewed", "isolated_full_access", "manual_safe",
    ]
    assert all(item["schema_version"] == MODE_SCHEMA_VERSION for item in descriptors)
    assert all(str(item["descriptor_digest"]).startswith("sha256:") for item in descriptors)
    assert get_mode("manual_safe").reviewer_route == "human"
    assert get_mode("auto_reviewed").reviewer_route == "auto"
    assert get_mode("isolated_full_access").reviewer_route == "none"
    assert "filesystem.read" in get_mode("manual_safe").default_capabilities
    assert {
        "filesystem.write", "filesystem.rename", "filesystem.delete",
        "filesystem.restore", "filesystem.purge",
    }.issubset(get_mode("manual_safe").capability_ceiling)
    with pytest.raises(ValueError, match="upgrade"):
        get_mode("manual_safe", schema_version="permission-mode/2")
    with pytest.raises(ValueError, match="Unknown permission mode"):
        get_mode("dangerous")


@pytest.mark.parametrize("source", ["agent", "repository", "workspace_config", "tool"])
def test_repository_or_agent_cannot_select_a_mode(source: str) -> None:
    with pytest.raises(PermissionModeError) as denied:
        resolve("manual_safe", selection={"source": source, "explicit_confirmation": False})
    assert denied.value.code == "mode_selection_source_forbidden"


def test_untrusted_workspace_forces_manual_safe_minimum_without_silent_full_access() -> None:
    effective = resolve(
        "isolated_full_access", workspace_context=workspace(trusted=False),
        selection={"explicit_confirmation": True}, platform=platform(attestation=None),
    )
    assert effective.mode.mode_id == "manual_safe"
    assert effective.capability_profile.capabilities == BUILTIN_MODES["manual_safe"].default_capabilities
    assert "untrusted_workspace_forced_manual_safe" in effective.limitations
    assert effective.reviewer_route == "human"


def test_product_mode_profile_is_directly_compatible_with_filesystem_broker() -> None:
    effective = resolve(
        "manual_safe",
        selection={
            "explicit_confirmation": False,
            "requested_capabilities": frozenset({"filesystem.write"}),
        },
    )
    proposal = ActionProposal.create(
        proposal_id="proposal-mode-file", run_id="run-mode-file",
        operation="file.write", payload={"relative_path": "notes.txt"}, risk="write",
        required_capabilities=("filesystem.write",),
    )
    assert effective.capability_profile.permits(proposal)
    assert effective.capability_profile.writable_roots == ("C:/workspace",)


def test_effective_profile_is_strict_intersection_and_explains_restrictions() -> None:
    effective = resolve(
        "auto_reviewed",
        administrator=admin(
            capability_ceiling=frozenset({"file.read", "file.write", "network.connect", "credential.use"}),
            denied_capabilities=frozenset({"file.write"}),
        ),
        platform=PlatformBoundary(frozenset({"file.read", "file.write", "network.connect", "credential.use"})),
        selection={
            "requested_capabilities": frozenset({"file.write", "network.connect", "credential.use", "shell.execute"}),
            "requested_network_rules": ("https://api.example:443", "https://evil.example:443"),
            "requested_credential_refs": frozenset({"credential:api", "credential:unknown"}),
        },
    )
    assert effective.capability_profile.capabilities == frozenset({"file.read", "network.connect", "credential.use"})
    assert effective.capability_profile.writable_roots == ()
    assert effective.capability_profile.network_rules == ("https://api.example:443",)
    assert effective.capability_profile.credential_refs == frozenset({"credential:api"})
    assert "capability_unavailable:file.write" in effective.limitations
    assert "capability_unavailable:shell.execute" in effective.limitations
    assert "network_scope_restricted" in effective.limitations
    assert "credential_scope_restricted" in effective.limitations


def test_administrator_policy_must_be_verified_and_can_disable_modes() -> None:
    with pytest.raises(PermissionModeError) as unverified:
        resolve("manual_safe", administrator=admin(verified=False))
    assert unverified.value.code == "administrator_policy_unverified"
    with pytest.raises(PermissionModeError) as disabled:
        resolve("auto_reviewed", administrator=admin(allowed_modes=frozenset({"manual_safe"})))
    assert disabled.value.code == "mode_disabled_by_administrator"


def test_auto_reviewer_and_full_access_kill_switches_do_not_disable_manual_safe() -> None:
    restricted = admin(auto_reviewer_enabled=False, isolated_full_access_enabled=False)
    assert resolve("manual_safe", administrator=restricted).mode.mode_id == "manual_safe"
    with pytest.raises(PermissionModeError) as auto:
        resolve("auto_reviewed", administrator=restricted)
    assert auto.value.code == "auto_reviewer_kill_switch_active"
    with pytest.raises(PermissionModeError) as full:
        resolve("isolated_full_access", administrator=restricted)
    assert full.value.code == "full_access_kill_switch_active"


def test_isolated_full_access_requires_explicit_current_attestation_and_is_not_a_default() -> None:
    with pytest.raises(PermissionModeError) as no_confirmation:
        resolve("isolated_full_access", selection={"explicit_confirmation": False})
    assert no_confirmation.value.code == "full_access_confirmation_required"
    with pytest.raises(PermissionModeError) as missing:
        resolve("isolated_full_access", platform=platform(attestation=None))
    assert missing.value.code == "isolation_attestation_required"
    with pytest.raises(PermissionModeError) as expired:
        resolve("isolated_full_access", platform=platform(attestation=attestation(expires_at=100)))
    assert expired.value.code == "isolation_attestation_expired"
    with pytest.raises(PermissionModeError) as default:
        resolve("isolated_full_access", selection={"source": "personal_default", "explicit_confirmation": True})
    assert default.value.code == "mode_cannot_be_default"

    effective = resolve("isolated_full_access")
    assert effective.capability_profile.capabilities == DEVELOPMENT_CAPABILITIES
    assert effective.isolation_attestation_digest == "sha256:isolation-evidence"


@pytest.mark.parametrize(
    ("selection", "missing_code", "required_guarantee"),
    [
        (
            {
                "requested_capabilities": frozenset({"network.connect"}),
                "requested_network_rules": ("https://api.example:443",),
            },
            "isolation_network_guarantee_missing",
            "network_egress_enforced",
        ),
        (
            {
                "requested_capabilities": frozenset({"credential.use"}),
                "requested_credential_refs": frozenset({"credential:api"}),
            },
            "isolation_credential_guarantee_missing",
            "credential_isolated",
        ),
    ],
)
def test_isolated_full_scope_requires_matching_attested_guarantee_before_commit(
    selection: dict[str, object], missing_code: str, required_guarantee: str,
) -> None:
    with pytest.raises(PermissionModeError) as missing:
        resolve(
            "isolated_full_access",
            selection=selection,
            platform=platform(attestation=attestation()),
        )
    assert missing.value.code == missing_code

    effective = resolve(
        "isolated_full_access",
        selection=selection,
        platform=platform(attestation=attestation(
            guarantees=REQUIRED_GUARANTEES | frozenset({required_guarantee}),
        )),
    )
    assert required_guarantee in (
        platform(attestation=attestation(
            guarantees=REQUIRED_GUARANTEES | frozenset({required_guarantee}),
        )).isolation_attestation.guarantees
    )
    assert effective.mode.mode_id == "isolated_full_access"


def test_auto_mode_has_all_mandatory_human_escalations_and_admin_can_only_add() -> None:
    effective = resolve(
        "auto_reviewed",
        administrator=admin(mandatory_human_categories=frozenset({"organization_special"})),
    )
    assert {
        "irreversible_external_write", "identity_or_permission_change", "production_target",
        "sensitive_credential_first_use", "scope_expansion", "proposal_incomplete",
        "reviewer_low_confidence", "organization_special",
    } == effective.mandatory_human_categories


@pytest.mark.parametrize("mode_id", list(BUILTIN_MODES))
def test_no_mode_can_override_system_hard_deny(mode_id: str) -> None:
    proposal = ActionProposal.create(
        proposal_id=f"proposal-{mode_id}", run_id="run-1", operation="credential.dump",
        payload={"target": "lsass"}, risk="critical", required_capabilities=(),
        effect_categories=("credential_theft",),
    )
    effective = resolve(mode_id)
    assert HardDenyPolicy().evaluate(proposal).denied
    # A broad capability set cannot turn a mandatory denial into authorization.
    assert not effective.capability_profile.permits(proposal) or HardDenyPolicy().evaluate(proposal).denied


def test_lower_layers_never_expand_administrator_capability_ceiling() -> None:
    universe = ("file.read", "file.write", "network.connect", "shell.execute")
    resolver = PermissionProfileResolver()
    for size in range(len(universe) + 1):
        for values in itertools.combinations(universe, size):
            ceiling = frozenset(values)
            effective = resolver.resolve(
                ModeSelection(
                    "auto_reviewed", "user", False,
                    requested_capabilities=frozenset(universe),
                ),
                administrator=admin(capability_ceiling=ceiling),
                platform=PlatformBoundary(frozenset(universe)), workspace=workspace(),
                profile_version=1, now=100,
            )
            assert effective.capability_profile.capabilities <= ceiling


def test_effective_descriptor_is_deterministic_and_contains_actual_not_requested_permissions() -> None:
    first = resolve("manual_safe")
    second = resolve("manual_safe")
    assert first == second and first.digest == second.digest
    descriptor = first.as_descriptor()
    assert descriptor["effective_capabilities"] == sorted(first.capability_profile.capabilities)
    assert descriptor["profile_digest"] == first.capability_profile.digest
    assert "requested_capabilities" not in descriptor
