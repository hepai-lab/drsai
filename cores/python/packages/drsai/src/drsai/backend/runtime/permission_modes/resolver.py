"""Resolve an effective profile by intersecting every authority layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from drsai.backend.runtime.security_boundary.models import ResolvedCapabilityProfile, canonical_digest
from drsai.backend.runtime.security_boundary.sandbox import IsolationAttestation, SandboxError

from .profiles import BUILTIN_MODES, DEVELOPMENT_CAPABILITIES, MODE_SCHEMA_VERSION, ModeDefinition, get_mode


class PermissionModeError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AdministratorPolicy:
    policy_id: str
    version: int
    verified: bool
    allowed_modes: frozenset[str] = field(default_factory=lambda: frozenset(BUILTIN_MODES))
    capability_ceiling: frozenset[str] = field(default_factory=lambda: DEVELOPMENT_CAPABILITIES)
    denied_capabilities: frozenset[str] = field(default_factory=frozenset)
    allowed_network_rules: tuple[str, ...] = ()
    allowed_credential_refs: frozenset[str] = field(default_factory=frozenset)
    mandatory_human_categories: frozenset[str] = field(default_factory=frozenset)
    hard_denies: frozenset[str] = field(default_factory=frozenset)
    auto_reviewer_enabled: bool = True
    isolated_full_access_enabled: bool = True


@dataclass(frozen=True)
class PlatformBoundary:
    capabilities: frozenset[str]
    isolation_attestation: IsolationAttestation | None = None


@dataclass(frozen=True)
class WorkspaceContext:
    workspace_root: str
    trusted: bool


@dataclass(frozen=True)
class ModeSelection:
    mode_id: str
    source: str
    explicit_confirmation: bool
    requested_capabilities: frozenset[str] = field(default_factory=frozenset)
    requested_network_rules: tuple[str, ...] = ()
    requested_credential_refs: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class EffectivePermissionProfile:
    schema_version: str
    mode: ModeDefinition
    capability_profile: ResolvedCapabilityProfile
    reviewer_route: str
    mandatory_human_categories: frozenset[str]
    limitations: tuple[str, ...]
    selection_source: str
    administrator_policy: str
    isolation_attestation_digest: str | None

    def as_descriptor(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "mode_id": self.mode.mode_id,
            "mode_version": self.mode.schema_version,
            "mode_digest": self.mode.digest,
            "profile_digest": self.capability_profile.digest,
            "effective_capabilities": sorted(self.capability_profile.capabilities),
            "writable_roots": list(self.capability_profile.writable_roots),
            "network_rules": list(self.capability_profile.network_rules),
            "credential_refs": sorted(self.capability_profile.credential_refs),
            "hard_denies": sorted(self.capability_profile.hard_denies),
            "reviewer_route": self.reviewer_route,
            "mandatory_human_categories": sorted(self.mandatory_human_categories),
            "limitations": list(self.limitations),
            "selection_source": self.selection_source,
            "administrator_policy": self.administrator_policy,
            "isolation_attestation_digest": self.isolation_attestation_digest,
        }

    @property
    def digest(self) -> str:
        return canonical_digest(self.as_descriptor())


class PermissionProfileResolver:
    _SELECTION_SOURCES = frozenset({"user", "administrator", "personal_default"})

    def resolve(
        self,
        selection: ModeSelection,
        *,
        administrator: AdministratorPolicy,
        platform: PlatformBoundary,
        workspace: WorkspaceContext,
        profile_version: int,
        now: float | None = None,
    ) -> EffectivePermissionProfile:
        if not administrator.verified:
            raise PermissionModeError("administrator_policy_unverified", "Administrator policy is not verified.")
        if selection.source not in self._SELECTION_SOURCES:
            raise PermissionModeError("mode_selection_source_forbidden", "Repository and Agent mode selection is forbidden.")
        if profile_version <= 0 or not workspace.workspace_root:
            raise PermissionModeError("effective_profile_invalid", "Effective profile identity is invalid.")
        requested_mode = get_mode(selection.mode_id)
        limitations: list[str] = []
        mode = requested_mode
        if not workspace.trusted and requested_mode.mode_id != "manual_safe":
            mode = BUILTIN_MODES["manual_safe"]
            limitations.append("untrusted_workspace_forced_manual_safe")
        if mode.mode_id not in administrator.allowed_modes:
            raise PermissionModeError("mode_disabled_by_administrator", "Selected mode is disabled by administrator policy.")
        if mode.mode_id == "auto_reviewed" and not administrator.auto_reviewer_enabled:
            raise PermissionModeError("auto_reviewer_kill_switch_active", "Automatic review is disabled by kill switch.")
        if mode.mode_id == "isolated_full_access" and not administrator.isolated_full_access_enabled:
            raise PermissionModeError("full_access_kill_switch_active", "Isolated full access is disabled by kill switch.")
        if selection.source == "personal_default" and not mode.can_be_cross_workspace_default:
            raise PermissionModeError("mode_cannot_be_default", "This mode cannot be saved as a cross-workspace default.")
        attestation_digest: str | None = None
        if mode.requires_isolation:
            if not selection.explicit_confirmation:
                raise PermissionModeError("full_access_confirmation_required", "Full access requires explicit user confirmation.")
            if platform.isolation_attestation is None:
                raise PermissionModeError("isolation_attestation_required", "Full access requires a valid isolation attestation.")
            try:
                platform.isolation_attestation.validate(now=now)
            except SandboxError as error:
                raise PermissionModeError(error.code, str(error)) from error
            attestation_digest = platform.isolation_attestation.evidence_digest

        desired = mode.default_capabilities | selection.requested_capabilities
        capabilities = desired & mode.capability_ceiling & platform.capabilities
        capabilities &= administrator.capability_ceiling
        capabilities -= administrator.denied_capabilities
        omitted = desired - capabilities
        limitations.extend(f"capability_unavailable:{value}" for value in sorted(omitted))

        network_rules: tuple[str, ...] = ()
        if "network.connect" in capabilities:
            allowed = set(administrator.allowed_network_rules)
            network_rules = tuple(rule for rule in selection.requested_network_rules if rule in allowed)
            if set(selection.requested_network_rules) - set(network_rules):
                limitations.append("network_scope_restricted")
        credential_refs = selection.requested_credential_refs & administrator.allowed_credential_refs
        if selection.requested_credential_refs - credential_refs:
            limitations.append("credential_scope_restricted")
        if "credential.use" not in capabilities:
            credential_refs = frozenset()
        if mode.requires_isolation and platform.isolation_attestation is not None:
            guarantees = platform.isolation_attestation.guarantees
            if network_rules and "network_egress_enforced" not in guarantees:
                raise PermissionModeError(
                    "isolation_network_guarantee_missing",
                    "Scoped network access lacks an isolation guarantee.",
                )
            if credential_refs and "credential_isolated" not in guarantees:
                raise PermissionModeError(
                    "isolation_credential_guarantee_missing",
                    "Credential scope lacks an isolation guarantee.",
                )

        profile = ResolvedCapabilityProfile(
            profile_id=f"permission:{mode.mode_id}", version=profile_version,
            workspace_root=workspace.workspace_root, capabilities=frozenset(capabilities),
            writable_roots=(workspace.workspace_root,) if (
                "file.write" in capabilities or "filesystem.write" in capabilities
            ) else (),
            network_rules=network_rules, credential_refs=frozenset(credential_refs),
            hard_denies=administrator.hard_denies, trusted_workspace=workspace.trusted,
        )
        return EffectivePermissionProfile(
            MODE_SCHEMA_VERSION, mode, profile, mode.reviewer_route,
            mode.mandatory_human_categories | administrator.mandatory_human_categories,
            tuple(sorted(set(limitations))), selection.source,
            f"{administrator.policy_id}@{administrator.version}", attestation_digest,
        )
