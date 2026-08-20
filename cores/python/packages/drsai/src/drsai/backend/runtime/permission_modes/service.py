"""Persist effective modes and apply fail-closed Run transitions."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable

from drsai.backend.runtime.authorization import ApprovalService, ApprovalServiceError
from drsai.backend.runtime.security_boundary import AuthorizationGrantStore, SecurityBoundaryStore
from drsai.backend.runtime.security_boundary.audit import SecurityEventJournal
from drsai.backend.runtime.security_boundary.models import canonical_digest, canonical_json
from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .resolver import (
    AdministratorPolicy,
    EffectivePermissionProfile,
    ModeSelection,
    PermissionModeError,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
)


@dataclass(frozen=True)
class ModeTransitionResult:
    binding_id: str
    run_id: str
    transition_kind: str
    effective: EffectivePermissionProfile
    revoked_grants: int
    cancelled_requests: int


class ModeTransitionInterrupted(RuntimeError):
    """Test/fault-injection signal; retrying apply resumes the durable transition."""


class PermissionModeService:
    """Internal authority for mode selection; clients consume descriptors only."""

    _REVIEWER_RANK = {"human": 0, "auto": 1, "none": 2}

    def __init__(self, database: Path):
        self.database = Path(database)
        self.resolver = PermissionProfileResolver()
        self.security = SecurityBoundaryStore(self.database)
        self.grants = AuthorizationGrantStore(self.database)
        self.approvals = ApprovalService(self.database)
        self.audit = SecurityEventJournal(self.database)
        self._lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_permission_mode_bindings(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    binding_id TEXT NOT NULL UNIQUE,
                    run_id TEXT NOT NULL,
                    mode_id TEXT NOT NULL,
                    mode_schema_version TEXT NOT NULL,
                    effective_digest TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    descriptor_json TEXT NOT NULL,
                    selection_source TEXT NOT NULL,
                    transition_kind TEXT NOT NULL CHECK(transition_kind IN ('initial','same','upgrade','downgrade','mixed')),
                    previous_binding_id TEXT,
                    created_at REAL NOT NULL,
                    UNIQUE(run_id,effective_digest)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_permission_mode_bindings_no_update
                BEFORE UPDATE ON runtime_permission_mode_bindings
                BEGIN SELECT RAISE(ABORT, 'permission mode binding is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_mode_bindings_no_delete
                BEFORE DELETE ON runtime_permission_mode_bindings
                BEGIN SELECT RAISE(ABORT, 'permission mode binding is append-only'); END;
                CREATE TABLE IF NOT EXISTS runtime_permission_mode_transitions(
                    transition_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    target_effective_digest TEXT NOT NULL,
                    target_profile_digest TEXT NOT NULL,
                    target_profile_version INTEGER NOT NULL,
                    transition_kind TEXT NOT NULL,
                    previous_binding_id TEXT,
                    status TEXT NOT NULL CHECK(status IN ('revoked','requests_cancelled','profile_bound','committed')),
                    revoked_grants INTEGER NOT NULL DEFAULT 0,
                    cancelled_requests INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    binding_id TEXT,
                    UNIQUE(run_id,target_effective_digest)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_mode_one_active_transition
                ON runtime_permission_mode_transitions(run_id) WHERE status!='committed';
                CREATE TABLE IF NOT EXISTS runtime_permission_mode_transition_events(
                    event_id TEXT PRIMARY KEY,
                    transition_id TEXT NOT NULL REFERENCES runtime_permission_mode_transitions(transition_id),
                    stage TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE(transition_id,stage)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_permission_mode_transitions_identity_immutable
                BEFORE UPDATE OF transition_id,run_id,target_effective_digest,target_profile_digest,
                                 target_profile_version,transition_kind,previous_binding_id,created_at
                ON runtime_permission_mode_transitions
                BEGIN SELECT RAISE(ABORT, 'permission mode transition identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_mode_transitions_no_delete
                BEFORE DELETE ON runtime_permission_mode_transitions
                BEGIN SELECT RAISE(ABORT, 'permission mode transition is durable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_mode_transition_events_no_update
                BEFORE UPDATE ON runtime_permission_mode_transition_events
                BEGIN SELECT RAISE(ABORT, 'permission mode transition event is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_permission_mode_transition_events_no_delete
                BEFORE DELETE ON runtime_permission_mode_transition_events
                BEGIN SELECT RAISE(ABORT, 'permission mode transition event is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def current_descriptor(self, run_id: str) -> dict[str, object] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT descriptor_json FROM runtime_permission_mode_bindings "
                "WHERE run_id=? ORDER BY sequence DESC LIMIT 1", (run_id,),
            ).fetchone()
        return json.loads(str(row["descriptor_json"])) if row is not None else None

    @classmethod
    def _classify(cls, old: dict[str, object] | None, new: EffectivePermissionProfile) -> str:
        if old is None:
            return "initial"
        descriptor = new.as_descriptor()
        old_caps, new_caps = set(old.get("effective_capabilities", [])), set(descriptor["effective_capabilities"])
        old_network, new_network = set(old.get("network_rules", [])), set(descriptor["network_rules"])
        old_credentials, new_credentials = set(old.get("credential_refs", [])), set(descriptor["credential_refs"])
        old_roots, new_roots = set(old.get("writable_roots", [])), set(descriptor["writable_roots"])
        old_rank = cls._REVIEWER_RANK.get(str(old.get("reviewer_route")), 99)
        new_rank = cls._REVIEWER_RANK.get(new.reviewer_route, 99)
        if (
            old.get("mode_id") == descriptor["mode_id"] and old_caps == new_caps
            and old_network == new_network and old_credentials == new_credentials and old_roots == new_roots
            and old_rank == new_rank
            and set(old.get("mandatory_human_categories", [])) == set(descriptor["mandatory_human_categories"])
            and set(old.get("hard_denies", [])) == set(descriptor["hard_denies"])
            and old.get("isolation_attestation_digest") == descriptor["isolation_attestation_digest"]
        ):
            return "same"
        no_expansion = (
            new_caps <= old_caps and new_network <= old_network and new_credentials <= old_credentials
            and new_roots <= old_roots and new_rank <= old_rank
        )
        no_reduction = (
            old_caps <= new_caps and old_network <= new_network and old_credentials <= new_credentials
            and old_roots <= new_roots and old_rank <= new_rank
        )
        if no_expansion:
            return "downgrade"
        if no_reduction:
            return "upgrade"
        return "mixed"

    def apply(
        self,
        run_id: str,
        selection: ModeSelection,
        *,
        administrator: AdministratorPolicy,
        platform: PlatformBoundary,
        workspace: WorkspaceContext,
        now: float | None = None,
        fault_after: str | None = None,
        commit_hook: Callable[[sqlite3.Connection, EffectivePermissionProfile, float], None] | None = None,
    ) -> ModeTransitionResult:
        changed_at = float(time.time() if now is None else now)
        with self._lock:
            with self._connect() as db:
                run_table = db.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_runs'",
                ).fetchone()
                if run_table is not None and db.execute(
                    "SELECT 1 FROM runtime_runs WHERE run_id=?", (run_id,),
                ).fetchone() is None:
                    raise PermissionModeError("run_missing", "Run does not exist.")
                prior = db.execute(
                    "SELECT * FROM runtime_permission_mode_bindings WHERE run_id=? ORDER BY sequence DESC LIMIT 1",
                    (run_id,),
                ).fetchone()
                active_transition = db.execute(
                    "SELECT * FROM runtime_permission_mode_transitions WHERE run_id=? AND status!='committed'",
                    (run_id,),
                ).fetchone()
                profile_version = (
                    int(active_transition["target_profile_version"])
                    if active_transition is not None else
                    int(db.execute(
                        "SELECT COALESCE(MAX(p.version),0) FROM runtime_run_security_profiles b "
                        "JOIN runtime_security_profiles p ON p.profile_digest=b.profile_digest WHERE b.run_id=?",
                        (run_id,),
                    ).fetchone()[0]) + 1
                )
            effective = self.resolver.resolve(
                selection, administrator=administrator, platform=platform, workspace=workspace,
                profile_version=profile_version, now=changed_at,
            )
            run_profile_id = (
                f"permission:{effective.mode.mode_id}:"
                f"{canonical_digest(run_id).split(':', 1)[1][:16]}"
            )
            effective = replace(
                effective,
                capability_profile=replace(effective.capability_profile, profile_id=run_profile_id),
            )
            self._ensure_target_mode_not_killed(effective.mode.mode_id)
            old_descriptor = json.loads(str(prior["descriptor_json"])) if prior is not None else None
            transition = self._classify(old_descriptor, effective)
            if transition in {"upgrade", "mixed"} and not selection.explicit_confirmation:
                raise PermissionModeError(
                    "mode_elevation_confirmation_required", "Permission expansion requires explicit user confirmation.",
                )
            if active_transition is not None:
                if (
                    str(active_transition["target_effective_digest"]) != effective.digest
                    or str(active_transition["target_profile_digest"]) != effective.capability_profile.digest
                ):
                    raise PermissionModeError(
                        "mode_transition_active", "A different permission mode transition must be recovered first.",
                    )
                transition_id = str(active_transition["transition_id"])
                transition = str(active_transition["transition_kind"])
            else:
                transition_id = f"mode-transition-{uuid.uuid4()}"
                expected_previous = str(prior["binding_id"]) if prior is not None else None
                revoke_required = prior is not None and transition != "same"
                with self._connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    grant_ids = [] if not revoke_required else [str(row[0]) for row in db.execute(
                        "SELECT grant_id FROM runtime_authorization_grants "
                        "WHERE run_id=? AND consumed_at IS NULL AND revoked_at IS NULL ORDER BY grant_id",
                        (run_id,),
                    ).fetchall()]
                    if revoke_required:
                        db.execute(
                            "UPDATE runtime_authorization_grants SET revoked_at=? "
                            "WHERE run_id=? AND consumed_at IS NULL AND revoked_at IS NULL",
                            (changed_at, run_id),
                        )
                    db.execute(
                        "INSERT INTO runtime_permission_mode_transitions VALUES(?,?,?,?,?,?,?,'revoked',?,?,?, ?,NULL)",
                        (
                            transition_id, run_id, effective.digest, effective.capability_profile.digest,
                            effective.capability_profile.version, transition, expected_previous,
                            len(grant_ids), 0, changed_at, changed_at,
                        ),
                    )
                    db.execute(
                        "INSERT INTO runtime_permission_mode_transition_events VALUES(?,?,?,?)",
                        (f"mode-transition-event-{uuid.uuid4()}", transition_id, "revoked", changed_at),
                    )
                    for grant_id in grant_ids:
                        self.audit.append_in_transaction(db, "authorization.grant_revoked", grant_id, {
                            "reason_code": "permission_mode_transition", "transition_id": transition_id,
                        }, now=changed_at)
                    self.audit.append_in_transaction(db, "permission_mode.transition_started", transition_id, {
                        "run_id": run_id, "transition_kind": transition,
                        "target_mode_id": effective.mode.mode_id, "revoked_grants": len(grant_ids),
                    }, now=changed_at)
                    db.commit()
                active_transition = self._transition(transition_id)
            self._inject(fault_after, "revoked")

            if str(active_transition["status"]) == "revoked":
                cancelled_now = 0
                for request in self.approvals.list_requests(run_id, status="pending"):
                    try:
                        self.approvals.decide(
                            request.request_id, "cancelled", reviewer_kind="system", reviewer_id="permission-mode-service",
                            reason_code="permission_mode_changed",
                            idempotency_key=f"mode-transition:{effective.digest}:{request.request_id}", now=changed_at,
                        )
                        cancelled_now += 1
                    except ApprovalServiceError as error:
                        if error.code != "approval_request_terminal":
                            raise
                self._advance(transition_id, "requests_cancelled", changed_at, cancelled_delta=cancelled_now)
                active_transition = self._transition(transition_id)
            self._inject(fault_after, "requests_cancelled")

            if str(active_transition["status"]) == "requests_cancelled":
                self.security.save_profile(effective.capability_profile, now=changed_at)
                try:
                    active_profile = self.security.active_profile(run_id)
                except Exception:
                    active_profile = None
                if active_profile is None or active_profile.digest != effective.capability_profile.digest:
                    self.security.bind_run_profile(
                        run_id, effective.capability_profile,
                        reason=f"permission_mode:{effective.mode.mode_id}:{transition}", now=changed_at,
                    )
                self._advance(transition_id, "profile_bound", changed_at)
                active_transition = self._transition(transition_id)
            self._inject(fault_after, "profile_bound")

            binding_id = f"mode-binding-{uuid.uuid4()}"
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                active_transition = db.execute(
                    "SELECT * FROM runtime_permission_mode_transitions WHERE transition_id=?", (transition_id,),
                ).fetchone()
                if active_transition is None:
                    db.rollback()
                    raise PermissionModeError("mode_transition_missing", "Permission mode transition disappeared.")
                if str(active_transition["status"]) == "committed":
                    existing_binding = str(active_transition["binding_id"])
                    if commit_hook is not None:
                        commit_hook(db, effective, changed_at)
                        db.commit()
                    else:
                        db.rollback()
                    return ModeTransitionResult(
                        existing_binding, run_id, transition, effective,
                        int(active_transition["revoked_grants"]), int(active_transition["cancelled_requests"]),
                    )
                if str(active_transition["status"]) != "profile_bound":
                    db.rollback()
                    raise PermissionModeError("mode_transition_stage_invalid", "Permission mode transition is not ready.")
                latest = db.execute(
                    "SELECT binding_id FROM runtime_permission_mode_bindings WHERE run_id=? "
                    "ORDER BY sequence DESC LIMIT 1", (run_id,),
                ).fetchone()
                expected_previous = (
                    str(active_transition["previous_binding_id"])
                    if active_transition["previous_binding_id"] is not None else None
                )
                actual_previous = str(latest["binding_id"]) if latest is not None else None
                if actual_previous != expected_previous:
                    db.rollback()
                    raise PermissionModeError("mode_transition_conflict", "Permission mode changed concurrently.")
                if commit_hook is not None:
                    commit_hook(db, effective, changed_at)
                self._inject(fault_after, "authority_staged")
                db.execute(
                    "INSERT INTO runtime_permission_mode_bindings("
                    "binding_id,run_id,mode_id,mode_schema_version,effective_digest,profile_digest,descriptor_json,"
                    "selection_source,transition_kind,previous_binding_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        binding_id, run_id, effective.mode.mode_id, effective.mode.schema_version,
                        effective.digest, effective.capability_profile.digest,
                        canonical_json(effective.as_descriptor()), selection.source, transition,
                        expected_previous, changed_at,
                    ),
                )
                self.audit.append_in_transaction(db, "permission_mode.changed", binding_id, {
                    "run_id": run_id, "mode_id": effective.mode.mode_id,
                    "effective_digest": effective.digest, "profile_digest": effective.capability_profile.digest,
                    "transition_kind": transition, "selection_source": selection.source,
                    "revoked_grants": int(active_transition["revoked_grants"]),
                    "cancelled_requests": int(active_transition["cancelled_requests"]),
                }, now=changed_at)
                db.execute(
                    "UPDATE runtime_permission_mode_transitions SET status='committed',binding_id=?,updated_at=? "
                    "WHERE transition_id=? AND status='profile_bound'",
                    (binding_id, changed_at, transition_id),
                )
                db.execute(
                    "INSERT INTO runtime_permission_mode_transition_events VALUES(?,?,?,?)",
                    (f"mode-transition-event-{uuid.uuid4()}", transition_id, "committed", changed_at),
                )
                db.commit()
            return ModeTransitionResult(
                binding_id, run_id, transition, effective,
                int(active_transition["revoked_grants"]), int(active_transition["cancelled_requests"]),
            )

    def _transition(self, transition_id: str) -> sqlite3.Row:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_permission_mode_transitions WHERE transition_id=?", (transition_id,),
            ).fetchone()
        if row is None:
            raise PermissionModeError("mode_transition_missing", "Permission mode transition does not exist.")
        return row

    def _ensure_target_mode_not_killed(self, mode_id: str) -> None:
        switch_name = {
            "auto_reviewed": "auto_reviewer",
            "isolated_full_access": "isolated_full_access",
        }.get(mode_id)
        if switch_name is None:
            return
        with self._connect() as db:
            table = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_permission_kill_switch_events'",
            ).fetchone()
            state = None if table is None else db.execute(
                "SELECT active FROM runtime_permission_kill_switch_events WHERE switch_name=? "
                "ORDER BY sequence DESC LIMIT 1", (switch_name,),
            ).fetchone()
        if state is not None and bool(state["active"]):
            raise PermissionModeError(
                "permission_kill_switch_active", "Selected permission mode is disabled by an active kill switch.",
            )

    def _advance(
        self, transition_id: str, stage: str, changed_at: float, *, cancelled_delta: int = 0,
    ) -> None:
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE runtime_permission_mode_transitions SET status=?,"
                "cancelled_requests=cancelled_requests+?,updated_at=? WHERE transition_id=?",
                (stage, cancelled_delta, changed_at, transition_id),
            )
            db.execute(
                "INSERT OR IGNORE INTO runtime_permission_mode_transition_events VALUES(?,?,?,?)",
                (f"mode-transition-event-{uuid.uuid4()}", transition_id, stage, changed_at),
            )
            db.commit()

    @staticmethod
    def _inject(fault_after: str | None, stage: str) -> None:
        if fault_after == stage:
            raise ModeTransitionInterrupted(f"Injected interruption after {stage}")
