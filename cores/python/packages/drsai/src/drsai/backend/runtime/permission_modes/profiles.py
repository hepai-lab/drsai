"""Stable product contracts for the three permission modes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from drsai.backend.runtime.security_boundary.models import canonical_digest


MODE_SCHEMA_VERSION = "permission-mode/1"

READ_CAPABILITIES = frozenset({
    "file.read", "filesystem.read", "directory.list", "workspace.inspect",
})
DEVELOPMENT_CAPABILITIES = READ_CAPABILITIES | frozenset({
    "file.write", "filesystem.write", "filesystem.rename", "filesystem.delete",
    "filesystem.restore", "filesystem.purge", "process.start", "shell.execute", "network.connect",
    "credential.use", "mcp.invoke", "delegate.run", "schedule.manage", "external.write",
})


@dataclass(frozen=True)
class ModeDefinition:
    schema_version: str
    mode_id: str
    display_name: str
    reviewer_route: str
    default_capabilities: frozenset[str]
    capability_ceiling: frozenset[str]
    mandatory_human_categories: frozenset[str]
    requires_isolation: bool
    can_be_cross_workspace_default: bool

    def as_descriptor(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "mode_id": self.mode_id,
            "display_name": self.display_name,
            "reviewer_route": self.reviewer_route,
            "default_capabilities": sorted(self.default_capabilities),
            "capability_ceiling": sorted(self.capability_ceiling),
            "mandatory_human_categories": sorted(self.mandatory_human_categories),
            "requires_isolation": self.requires_isolation,
            "can_be_cross_workspace_default": self.can_be_cross_workspace_default,
        }

    @property
    def digest(self) -> str:
        return canonical_digest(self.as_descriptor())


_MANDATORY_HUMAN = frozenset({
    "irreversible_external_write", "identity_or_permission_change", "production_target",
    "sensitive_credential_first_use", "scope_expansion", "proposal_incomplete",
    "reviewer_low_confidence",
})

BUILTIN_MODES: Mapping[str, ModeDefinition] = {
    "manual_safe": ModeDefinition(
        MODE_SCHEMA_VERSION, "manual_safe", "请求批准", "human",
        READ_CAPABILITIES, DEVELOPMENT_CAPABILITIES, frozenset(), False, True,
    ),
    "auto_reviewed": ModeDefinition(
        MODE_SCHEMA_VERSION, "auto_reviewed", "帮我批准", "auto",
        READ_CAPABILITIES, DEVELOPMENT_CAPABILITIES, _MANDATORY_HUMAN, False, True,
    ),
    "isolated_full_access": ModeDefinition(
        MODE_SCHEMA_VERSION, "isolated_full_access", "完全访问权限", "none",
        DEVELOPMENT_CAPABILITIES, DEVELOPMENT_CAPABILITIES, _MANDATORY_HUMAN,
        True, False,
    ),
}


def get_mode(mode_id: str, *, schema_version: str = MODE_SCHEMA_VERSION) -> ModeDefinition:
    if schema_version != MODE_SCHEMA_VERSION:
        raise ValueError("Unknown permission mode schema version; upgrade is required.")
    try:
        return BUILTIN_MODES[mode_id]
    except KeyError as error:
        raise ValueError("Unknown permission mode; execution is denied.") from error


def mode_descriptors() -> list[dict[str, object]]:
    return [BUILTIN_MODES[key].as_descriptor() | {"descriptor_digest": BUILTIN_MODES[key].digest}
            for key in sorted(BUILTIN_MODES)]
