"""Runtime-owned immutable security context for one Desktop Agent turn."""

from __future__ import annotations

import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .permission_modes.service import PermissionModeService
from .security_boundary.models import ResolvedCapabilityProfile, canonical_digest
from .security_boundary.isolation_leases import IsolationAttestationLeaseStore
from .security_boundary.storage import SecurityBoundaryStore, SecurityBoundaryStoreError


class DesktopSecurityBindingError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class DesktopSecurityExecutionBinding:
    schema_version: str
    binding_id: str
    runtime_run_id: str
    session_id: str
    workspace_id: str
    workspace_root: str
    database: Path
    profile: ResolvedCapabilityProfile
    mode_id: str
    reviewer_route: str
    isolation_attestation_digest: str | None
    effective_descriptor_digest: str
    issued_at: float
    binding_digest: str

    def security_payload(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "binding_id": self.binding_id,
            "runtime_run_id": self.runtime_run_id,
            "session_id": self.session_id,
            "workspace_id": self.workspace_id,
            "workspace_root": os.path.normcase(os.path.abspath(self.workspace_root)),
            "database": os.path.normcase(os.path.abspath(self.database)),
            "profile_digest": self.profile.digest,
            "mode_id": self.mode_id,
            "reviewer_route": self.reviewer_route,
            "isolation_attestation_digest": self.isolation_attestation_digest,
            "effective_descriptor_digest": self.effective_descriptor_digest,
            "issued_at": self.issued_at,
        }


def create_desktop_security_execution_binding(
    engine: Any, context: Any, *, now: float | None = None,
) -> DesktopSecurityExecutionBinding:
    run_id = str(context.run_id)
    run = engine.get_run(run_id)
    session_id, workspace_id = str(context.session_id), str(context.workspace_id)
    if str(run.get("session_id")) != session_id or str(run.get("workspace_id")) != workspace_id:
        raise DesktopSecurityBindingError("desktop_security_run_context_mismatch", "Runtime Run context does not match its durable identity.")
    try:
        profile = engine.get_run_security_profile(run_id)
    except (KeyError, SecurityBoundaryStoreError) as error:
        raise DesktopSecurityBindingError("desktop_security_profile_missing", "Runtime Run has no active security Profile.") from error
    descriptor = engine.effective_permission_descriptor(run_id)
    if not isinstance(descriptor, dict):
        raise DesktopSecurityBindingError("desktop_permission_mode_missing", "Runtime Run has no effective Permission Mode binding.")
    if str(descriptor.get("profile_digest")) != profile.digest:
        raise DesktopSecurityBindingError("desktop_security_profile_mismatch", "Permission Mode and active Profile disagree.")
    workspace_root = os.path.normcase(os.path.abspath(context.workspace_path))
    if workspace_root != os.path.normcase(os.path.abspath(profile.workspace_root)):
        raise DesktopSecurityBindingError("desktop_security_workspace_mismatch", "Profile root differs from the Runtime Workspace.")
    reviewer_route = str(descriptor.get("reviewer_route"))
    isolation_digest = (
        str(descriptor["isolation_attestation_digest"])
        if descriptor.get("isolation_attestation_digest") is not None else None
    )
    if reviewer_route == "none":
        if not isolation_digest:
            raise DesktopSecurityBindingError(
                "desktop_isolation_attestation_missing", "Isolated full access has no scoped attestation.",
            )
        try:
            IsolationAttestationLeaseStore(Path(engine.database)).assert_active(
                run_id, workspace_root=workspace_root, profile_digest=profile.digest,
                attestation_digest=isolation_digest,
            )
        except Exception as error:
            raise DesktopSecurityBindingError(
                str(getattr(error, "code", "desktop_isolation_attestation_invalid")),
                "Isolated full access attestation is not currently valid.",
            ) from error
    issued_at = float(time.time() if now is None else now)
    values = {
        "schema_version": "desktop-security-binding/1",
        "binding_id": f"desktop-security-{uuid.uuid4()}",
        "runtime_run_id": run_id,
        "session_id": session_id,
        "workspace_id": workspace_id,
        "workspace_root": workspace_root,
        "database": Path(engine.database),
        "profile": profile,
        "mode_id": str(descriptor.get("mode_id")),
        "reviewer_route": reviewer_route,
        "isolation_attestation_digest": isolation_digest,
        "effective_descriptor_digest": canonical_digest(descriptor),
        "issued_at": issued_at,
    }
    provisional = DesktopSecurityExecutionBinding(**values, binding_digest="")
    return DesktopSecurityExecutionBinding(**values, binding_digest=canonical_digest(provisional.security_payload()))


def validate_desktop_security_execution_binding(
    binding: DesktopSecurityExecutionBinding,
    *, expected_session_id: str, expected_workspace_root: str,
) -> None:
    if binding.schema_version != "desktop-security-binding/1":
        raise DesktopSecurityBindingError("desktop_security_binding_version_invalid", "Desktop security binding version is unsupported.")
    if canonical_digest(binding.security_payload()) != binding.binding_digest:
        raise DesktopSecurityBindingError("desktop_security_binding_tampered", "Desktop security binding digest is invalid.")
    if binding.session_id != expected_session_id:
        raise DesktopSecurityBindingError("desktop_security_session_mismatch", "Desktop session differs from the Runtime binding.")
    if os.path.normcase(os.path.abspath(expected_workspace_root)) != binding.workspace_root:
        raise DesktopSecurityBindingError("desktop_security_workspace_mismatch", "Desktop Workspace differs from the Runtime binding.")
    try:
        current_profile = SecurityBoundaryStore(binding.database).active_profile(binding.runtime_run_id)
    except SecurityBoundaryStoreError as error:
        raise DesktopSecurityBindingError("desktop_security_profile_missing", "Runtime security Profile is unavailable.") from error
    descriptor = PermissionModeService(binding.database).current_descriptor(binding.runtime_run_id)
    if current_profile.digest != binding.profile.digest or not isinstance(descriptor, dict):
        raise DesktopSecurityBindingError("desktop_security_binding_stale", "Runtime security state changed after binding.")
    if canonical_digest(descriptor) != binding.effective_descriptor_digest:
        raise DesktopSecurityBindingError("desktop_security_binding_stale", "Permission Mode changed after binding.")
    if str(descriptor.get("mode_id")) != binding.mode_id or str(descriptor.get("reviewer_route")) != binding.reviewer_route:
        raise DesktopSecurityBindingError("desktop_security_binding_stale", "Permission reviewer route changed after binding.")
    current_attestation = descriptor.get("isolation_attestation_digest")
    current_attestation = str(current_attestation) if current_attestation is not None else None
    if current_attestation != binding.isolation_attestation_digest:
        raise DesktopSecurityBindingError("desktop_security_binding_stale", "Isolation attestation binding changed.")
    if binding.reviewer_route == "none":
        if not binding.isolation_attestation_digest:
            raise DesktopSecurityBindingError(
                "desktop_isolation_attestation_missing", "Isolated full access has no scoped attestation.",
            )
        try:
            IsolationAttestationLeaseStore(binding.database).assert_active(
                binding.runtime_run_id,
                workspace_root=binding.workspace_root,
                profile_digest=binding.profile.digest,
                attestation_digest=binding.isolation_attestation_digest,
            )
        except Exception as error:
            raise DesktopSecurityBindingError(
                str(getattr(error, "code", "desktop_isolation_attestation_invalid")),
                "Isolated full access attestation is not currently valid.",
            ) from error
    try:
        with sqlite3.connect(binding.database, timeout=30) as database:
            row = database.execute(
                "SELECT session_id,workspace_id,status FROM runtime_runs WHERE run_id=?",
                (binding.runtime_run_id,),
            ).fetchone()
    except sqlite3.Error as error:
        raise DesktopSecurityBindingError("desktop_security_run_unavailable", "Runtime Run identity cannot be verified.") from error
    if row is None or tuple(map(str, row[:2])) != (binding.session_id, binding.workspace_id) or str(row[2]) not in {"queued", "running"}:
        raise DesktopSecurityBindingError("desktop_security_run_stale", "Runtime Run is no longer executable under this binding.")


def validate_desktop_authorization_grant(
    binding: DesktopSecurityExecutionBinding, *, grant_id: str, proposal_id: str,
) -> None:
    """Prove the Grant came from the reviewer route bound to this turn."""

    try:
        with sqlite3.connect(binding.database, timeout=30) as database:
            row = database.execute(
                "SELECT r.run_id,r.proposal_id,r.profile_digest,r.reviewer_kind,"
                "d.decision,d.reviewer_kind,g.grant_id,b.request_id "
                "FROM runtime_approval_grants b "
                "JOIN runtime_approval_requests r ON r.request_id=b.request_id "
                "JOIN runtime_approval_decisions d ON d.decision_id=b.decision_id "
                "JOIN runtime_authorization_grants g ON g.grant_id=b.grant_id "
                "WHERE b.grant_id=?", (grant_id,),
            ).fetchone()
            route_table = database.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_auto_review_routes'",
            ).fetchone()
            escalation = None
            if row is not None and route_table is not None:
                escalation = database.execute(
                    "SELECT route,status FROM runtime_auto_review_routes WHERE human_request_id=?",
                    (str(row[7]),),
                ).fetchone()
    except sqlite3.Error as error:
        raise DesktopSecurityBindingError("desktop_workspace_grant_unverifiable", "Workspace Grant cannot be verified.") from error
    expected_reviewer = binding.reviewer_route
    if expected_reviewer not in {"human", "auto"}:
        raise DesktopSecurityBindingError("desktop_workspace_grant_route_invalid", "This mode must not use an Approval Grant.")
    if row is None:
        raise DesktopSecurityBindingError("desktop_workspace_grant_scope_mismatch", "Workspace Grant does not match the bound reviewer and scope.")
    request_reviewer, decision_reviewer = str(row[3]), str(row[5])
    direct_route = request_reviewer == expected_reviewer and decision_reviewer == expected_reviewer
    escalated_auto_route = (
        expected_reviewer == "auto"
        and request_reviewer == "human" and decision_reviewer == "human"
        and escalation is not None
        and tuple(map(str, escalation)) == ("escalated", "applied")
    )
    if tuple(map(str, row[:3])) != (
        binding.runtime_run_id, proposal_id, binding.profile.digest,
    ) or str(row[4]) != "approved" or str(row[6]) != grant_id or not (direct_route or escalated_auto_route):
        raise DesktopSecurityBindingError("desktop_workspace_grant_scope_mismatch", "Workspace Grant does not match the bound reviewer and scope.")
