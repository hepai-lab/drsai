"""Monotonic parent-to-child effective permission inheritance."""

from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.security_boundary import ResolvedCapabilityProfile, SecurityBoundaryStore
from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.models import canonical_digest, canonical_json
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .resolver import (
    AdministratorPolicy,
    EffectivePermissionProfile,
    ModeSelection,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
)


@dataclass(frozen=True)
class ChildPermissionInheritance:
    inheritance_id: str
    parent_run_id: str
    child_run_id: str
    parent_effective_digest: str
    effective: EffectivePermissionProfile
    clamped_dimensions: tuple[str, ...]


class ChildPermissionResolver:
    _RANK = {"human": 0, "auto": 1, "none": 2}

    def __init__(self, database: Path):
        self.database = Path(database)
        self.resolver = PermissionProfileResolver()
        self.security = SecurityBoundaryStore(self.database)
        self.audit = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_permission_profile_inheritance(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    inheritance_id TEXT NOT NULL UNIQUE,
                    parent_run_id TEXT NOT NULL,
                    child_run_id TEXT NOT NULL,
                    parent_effective_digest TEXT NOT NULL,
                    child_effective_digest TEXT NOT NULL,
                    child_profile_digest TEXT NOT NULL,
                    descriptor_json TEXT NOT NULL,
                    clamped_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE(child_run_id,child_effective_digest)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_permission_profile_inheritance_no_update
                BEFORE UPDATE ON runtime_permission_profile_inheritance
                BEGIN SELECT RAISE(ABORT, 'permission inheritance is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_profile_inheritance_no_delete
                BEFORE DELETE ON runtime_permission_profile_inheritance
                BEGIN SELECT RAISE(ABORT, 'permission inheritance is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def derive_and_bind(
        self,
        parent_run_id: str,
        child_run_id: str,
        parent: EffectivePermissionProfile,
        child_selection: ModeSelection,
        *,
        administrator: AdministratorPolicy,
        platform: PlatformBoundary,
        workspace: WorkspaceContext,
        profile_version: int,
        now: float | None = None,
    ) -> ChildPermissionInheritance:
        created_at = float(time.time() if now is None else now)
        if not parent_run_id or not child_run_id or parent_run_id == child_run_id:
            raise ValueError("Distinct parent and child Run identities are required.")
        requested = self.resolver.resolve(
            child_selection, administrator=administrator, platform=platform,
            workspace=workspace, profile_version=profile_version, now=created_at,
        )
        parent_profile = parent.capability_profile
        requested_profile = requested.capability_profile
        capabilities = requested_profile.capabilities & parent_profile.capabilities
        network = tuple(rule for rule in requested_profile.network_rules if rule in parent_profile.network_rules)
        credentials = requested_profile.credential_refs & parent_profile.credential_refs
        writable = tuple(root for root in requested_profile.writable_roots if root in parent_profile.writable_roots)
        reviewer_route = requested.reviewer_route
        mode = requested.mode
        clamped: list[str] = []
        if capabilities != requested_profile.capabilities:
            clamped.append("capabilities")
        if network != requested_profile.network_rules:
            clamped.append("network")
        if credentials != requested_profile.credential_refs:
            clamped.append("credentials")
        if writable != requested_profile.writable_roots:
            clamped.append("writable_roots")
        if self._RANK[reviewer_route] > self._RANK[parent.reviewer_route]:
            reviewer_route = parent.reviewer_route
            mode = parent.mode
            clamped.append("reviewer_route")
        trusted = requested_profile.trusted_workspace and parent_profile.trusted_workspace
        if requested_profile.trusted_workspace and not trusted:
            clamped.append("workspace_trust")
        child_profile = ResolvedCapabilityProfile(
            profile_id=(
                f"permission-child:{mode.mode_id}:"
                f"{canonical_digest(child_run_id).split(':', 1)[1][:16]}"
            ),
            version=profile_version, workspace_root=requested_profile.workspace_root,
            capabilities=frozenset(capabilities), writable_roots=writable,
            network_rules=network, credential_refs=frozenset(credentials),
            hard_denies=parent_profile.hard_denies | requested_profile.hard_denies,
            trusted_workspace=trusted,
        )
        effective = EffectivePermissionProfile(
            requested.schema_version, mode, child_profile, reviewer_route,
            parent.mandatory_human_categories | requested.mandatory_human_categories,
            tuple(sorted(set(requested.limitations) | {f"parent_clamped:{value}" for value in clamped})),
            "parent_inheritance", requested.administrator_policy,
            requested.isolation_attestation_digest if mode.mode_id == "isolated_full_access" else None,
        )
        self.security.save_profile(child_profile, now=created_at)
        self.security.bind_run_profile(
            child_run_id, child_profile, reason=f"inherited_from:{canonical_digest(parent_run_id)}",
            now=created_at,
        )
        inheritance_id = f"permission-inheritance-{uuid.uuid4()}"
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO runtime_permission_profile_inheritance("
                "inheritance_id,parent_run_id,child_run_id,parent_effective_digest,child_effective_digest,"
                "child_profile_digest,descriptor_json,clamped_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    inheritance_id, parent_run_id, child_run_id, parent.digest, effective.digest,
                    child_profile.digest, canonical_json(effective.as_descriptor()),
                    canonical_json(sorted(clamped)), created_at,
                ),
            )
            self.audit.append_in_transaction(db, "permission_profile.inherited", inheritance_id, {
                "parent_effective_digest": parent.digest, "child_effective_digest": effective.digest,
                "clamped_dimensions": sorted(clamped), "mode_id": effective.mode.mode_id,
            }, now=created_at)
            db.commit()
        return ChildPermissionInheritance(
            inheritance_id, parent_run_id, child_run_id, parent.digest, effective, tuple(sorted(clamped)),
        )
