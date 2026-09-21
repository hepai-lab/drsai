"""Deny-first resolution of immutable Runtime capability profiles."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .models import ResolvedCapabilityProfile, canonical_digest


class PolicyError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class CapabilityPolicyLayer:
    name: str
    allowed_capabilities: frozenset[str] | None = None
    denied_capabilities: frozenset[str] = frozenset()
    writable_roots: tuple[str, ...] | None = None
    network_rules: tuple[str, ...] | None = None
    credential_refs: frozenset[str] | None = None
    hard_denies: frozenset[str] = frozenset()
    requires_trusted_workspace: bool = False


def _normalized_root(path: str | Path) -> str:
    return os.path.normcase(str(Path(path).resolve(strict=False)))


def _inside(path: str, parent: str) -> bool:
    try:
        return os.path.commonpath((path, parent)) == parent
    except ValueError:
        return False


class CapabilityPolicyResolver:
    """Resolve policy layers by intersection; no lower layer can widen access."""

    def resolve(
        self,
        *,
        profile_id: str,
        version: int,
        workspace_root: str | Path,
        trusted_workspace: bool,
        layers: Iterable[CapabilityPolicyLayer],
    ) -> ResolvedCapabilityProfile:
        if not profile_id or version < 1:
            raise PolicyError("profile_identity_invalid", "A profile ID and positive version are required.")
        root = _normalized_root(workspace_root)
        layer_list = list(layers)
        if not layer_list:
            raise PolicyError("policy_layers_missing", "At least one policy layer is required.")

        capabilities: set[str] | None = None
        roots: set[str] | None = None
        network: set[str] | None = None
        credentials: set[str] | None = None
        hard_denies: set[str] = set()

        for layer in layer_list:
            if not layer.name:
                raise PolicyError("policy_layer_invalid", "Every policy layer needs a name.")
            if layer.requires_trusted_workspace and not trusted_workspace:
                raise PolicyError("workspace_untrusted", f"Policy layer {layer.name} requires a trusted workspace.")
            if layer.allowed_capabilities is not None:
                values = set(layer.allowed_capabilities)
                capabilities = values if capabilities is None else capabilities & values
            if capabilities is not None:
                capabilities -= set(layer.denied_capabilities)
            if layer.writable_roots is not None:
                values = {_normalized_root(item) for item in layer.writable_roots}
                if any(not _inside(item, root) for item in values):
                    raise PolicyError("writable_root_outside_workspace", "Writable roots must remain inside the workspace.")
                if roots is None:
                    roots = values
                else:
                    intersections: set[str] = set()
                    for existing in roots:
                        for limit in values:
                            if _inside(existing, limit):
                                intersections.add(existing)
                            elif _inside(limit, existing):
                                intersections.add(limit)
                    roots = intersections
            if layer.network_rules is not None:
                values = set(layer.network_rules)
                network = values if network is None else network & values
            if layer.credential_refs is not None:
                values = set(layer.credential_refs)
                credentials = values if credentials is None else credentials & values
            hard_denies.update(layer.hard_denies)

        if capabilities is None:
            raise PolicyError("capability_allowlist_missing", "A top-level capability allowlist is required.")
        resolved_roots = tuple(sorted(roots or set()))
        payload = {
            "layers": [layer.name for layer in layer_list],
            "root": root,
            "trusted": trusted_workspace,
        }
        stable_id = f"{profile_id}:{canonical_digest(payload).split(':', 1)[1][:16]}"
        return ResolvedCapabilityProfile(
            profile_id=stable_id,
            version=version,
            workspace_root=root,
            capabilities=frozenset(capabilities),
            writable_roots=resolved_roots,
            network_rules=tuple(sorted(network or set())),
            credential_refs=frozenset(credentials or set()),
            hard_denies=frozenset(hard_denies),
            trusted_workspace=trusted_workspace,
        )
