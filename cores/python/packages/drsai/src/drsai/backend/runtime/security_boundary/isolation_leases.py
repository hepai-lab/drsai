"""Durable, scoped liveness proof for isolated-full Runtime execution."""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .models import ResolvedCapabilityProfile, canonical_digest
from .sandbox import IsolationAttestation, SandboxError


@dataclass(frozen=True)
class ScopedIsolationLease:
    lease_id: str
    run_id: str
    workspace_root: str
    profile_digest: str
    attestation_digest: str
    backend_id: str
    backend_version: str
    verified_at: float
    expires_at: float
    guarantees: frozenset[str]
    status: str
    created_at: float


class IsolationAttestationLeaseStore:
    """Append-only authority binding an OS attestation to one Run/Profile."""

    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_isolation_attestation_leases(
                    lease_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    workspace_root TEXT NOT NULL,
                    profile_digest TEXT NOT NULL,
                    attestation_digest TEXT NOT NULL,
                    backend_id TEXT NOT NULL,
                    backend_version TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    verified_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    guarantees_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE(run_id,profile_digest,attestation_digest)
                );
                CREATE TABLE IF NOT EXISTS runtime_isolation_attestation_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    lease_id TEXT NOT NULL REFERENCES runtime_isolation_attestation_leases(lease_id),
                    status TEXT NOT NULL CHECK(status IN ('active','revoked')),
                    reason_code TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_isolation_attestation_leases_no_update
                BEFORE UPDATE ON runtime_isolation_attestation_leases
                BEGIN SELECT RAISE(ABORT, 'isolation lease is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolation_attestation_leases_no_delete
                BEFORE DELETE ON runtime_isolation_attestation_leases
                BEGIN SELECT RAISE(ABORT, 'isolation lease is durable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolation_attestation_events_no_update
                BEFORE UPDATE ON runtime_isolation_attestation_events
                BEGIN SELECT RAISE(ABORT, 'isolation lease event is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_isolation_attestation_events_no_delete
                BEFORE DELETE ON runtime_isolation_attestation_events
                BEGIN SELECT RAISE(ABORT, 'isolation lease event is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row, status: str) -> ScopedIsolationLease:
        return ScopedIsolationLease(
            lease_id=str(row["lease_id"]), run_id=str(row["run_id"]),
            workspace_root=str(row["workspace_root"]), profile_digest=str(row["profile_digest"]),
            attestation_digest=str(row["attestation_digest"]), backend_id=str(row["backend_id"]),
            backend_version=str(row["backend_version"]), verified_at=float(row["verified_at"]),
            expires_at=float(row["expires_at"]),
            guarantees=frozenset(json.loads(str(row["guarantees_json"]))),
            status=status, created_at=float(row["created_at"]),
        )

    def bind(
        self,
        run_id: str,
        workspace_root: str,
        profile: ResolvedCapabilityProfile,
        attestation: IsolationAttestation,
        *,
        now: float | None = None,
    ) -> ScopedIsolationLease:
        bound_at = float(time.time() if now is None else now)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            lease = self.bind_in_transaction(
                db, run_id, workspace_root, profile, attestation, now=bound_at,
            )
            db.commit()
        return self.assert_active(
            run_id, workspace_root=lease.workspace_root, profile_digest=profile.digest,
            attestation_digest=attestation.evidence_digest, now=bound_at,
        )

    def bind_in_transaction(
        self,
        db: sqlite3.Connection,
        run_id: str,
        workspace_root: str,
        profile: ResolvedCapabilityProfile,
        attestation: IsolationAttestation,
        *,
        now: float,
    ) -> ScopedIsolationLease:
        """Stage a lease using the caller's mode-commit transaction."""

        bound_at = float(now)
        attestation.validate(now=bound_at)
        canonical_root = os.path.normcase(os.path.abspath(workspace_root))
        if canonical_root != os.path.normcase(os.path.abspath(profile.workspace_root)):
            raise SandboxError("isolation_lease_workspace_mismatch", "Isolation lease Workspace differs from Profile.")
        if profile.network_rules and "network_egress_enforced" not in attestation.guarantees:
            raise SandboxError("isolation_network_guarantee_missing", "Scoped network access lacks an isolation guarantee.")
        if profile.credential_refs and "credential_isolated" not in attestation.guarantees:
            raise SandboxError("isolation_credential_guarantee_missing", "Credential scope lacks an isolation guarantee.")
        lease_id = "isolation-lease-" + canonical_digest({
            "run_id": run_id, "workspace_root": canonical_root,
            "profile_digest": profile.digest,
            "attestation_digest": attestation.evidence_digest,
        }).split(":", 1)[1][:32]
        row = db.execute(
            "SELECT * FROM runtime_isolation_attestation_leases "
            "WHERE run_id=? AND profile_digest=? AND attestation_digest=?",
            (run_id, profile.digest, attestation.evidence_digest),
        ).fetchone()
        if row is None:
            db.execute(
                "INSERT INTO runtime_isolation_attestation_leases VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    lease_id, run_id, canonical_root, profile.digest,
                    attestation.evidence_digest, attestation.backend_id,
                    attestation.backend_version, attestation.platform,
                    attestation.verified_at, attestation.expires_at,
                    json.dumps(sorted(attestation.guarantees), separators=(",", ":")), bound_at,
                ),
            )
            db.execute(
                "INSERT INTO runtime_isolation_attestation_events(event_id,lease_id,status,reason_code,created_at) "
                "VALUES(?,?,'active','permission_mode_bound',?)",
                (f"isolation-event-{uuid.uuid4()}", lease_id, bound_at),
            )
            return ScopedIsolationLease(
                lease_id, run_id, canonical_root, profile.digest, attestation.evidence_digest,
                attestation.backend_id, attestation.backend_version,
                attestation.verified_at, attestation.expires_at,
                attestation.guarantees, "active", bound_at,
            )
        lease_id = str(row["lease_id"])
        latest = db.execute(
            "SELECT status FROM runtime_isolation_attestation_events WHERE lease_id=? "
            "ORDER BY sequence DESC LIMIT 1", (lease_id,),
        ).fetchone()
        if latest is None or str(latest["status"]) != "active":
            raise SandboxError("isolation_lease_revoked", "Isolation lease cannot be reactivated.")
        return self._from_row(row, "active")

    def revoke_run(self, run_id: str, *, reason_code: str, now: float | None = None) -> int:
        revoked_at = float(time.time() if now is None else now)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = self.revoke_run_in_transaction(
                db, run_id, reason_code=reason_code, now=revoked_at,
            )
            db.commit()
        return changed

    @staticmethod
    def revoke_run_in_transaction(
        db: sqlite3.Connection, run_id: str, *, reason_code: str, now: float,
        keep_lease_id: str | None = None,
    ) -> int:
        """Stage revocation in the caller's mode-commit transaction."""

        changed = 0
        rows = db.execute(
            "SELECT l.lease_id,(SELECT status FROM runtime_isolation_attestation_events e "
            "WHERE e.lease_id=l.lease_id ORDER BY sequence DESC LIMIT 1) AS status "
            "FROM runtime_isolation_attestation_leases l WHERE l.run_id=? ORDER BY l.lease_id",
            (run_id,),
        ).fetchall()
        for row in rows:
            if str(row["status"]) != "active" or str(row["lease_id"]) == keep_lease_id:
                continue
            db.execute(
                "INSERT INTO runtime_isolation_attestation_events(event_id,lease_id,status,reason_code,created_at) "
                "VALUES(?,?,'revoked',?,?)",
                (f"isolation-event-{uuid.uuid4()}", str(row["lease_id"]), reason_code, float(now)),
            )
            changed += 1
        return changed

    def assert_active(
        self,
        run_id: str,
        *,
        workspace_root: str,
        profile_digest: str,
        attestation_digest: str,
        now: float | None = None,
    ) -> ScopedIsolationLease:
        checked_at = float(time.time() if now is None else now)
        with self._connect() as db:
            row = db.execute(
                "SELECT l.*,(SELECT status FROM runtime_isolation_attestation_events e "
                "WHERE e.lease_id=l.lease_id ORDER BY sequence DESC LIMIT 1) AS current_status "
                "FROM runtime_isolation_attestation_leases l WHERE l.run_id=? "
                "AND l.profile_digest=? AND l.attestation_digest=?",
                (run_id, profile_digest, attestation_digest),
            ).fetchone()
            kill = db.execute(
                "SELECT active FROM runtime_permission_kill_switch_events WHERE switch_name='isolated_full_access' "
                "ORDER BY sequence DESC LIMIT 1",
            ).fetchone() if db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_permission_kill_switch_events'",
            ).fetchone() is not None else None
        if kill is not None and bool(kill["active"]):
            raise SandboxError("permission_kill_switch_active", "Isolated full access is disabled.")
        if row is None:
            raise SandboxError("isolation_lease_missing", "No scoped isolation lease exists.")
        lease = self._from_row(row, str(row["current_status"]))
        if lease.status != "active":
            raise SandboxError("isolation_lease_revoked", "Scoped isolation lease was revoked.")
        if os.path.normcase(os.path.abspath(workspace_root)) != lease.workspace_root:
            raise SandboxError("isolation_lease_workspace_mismatch", "Isolation lease Workspace scope differs.")
        attestation = IsolationAttestation(
            lease.backend_id, lease.backend_version, str(row["platform"]),
            lease.verified_at, lease.expires_at, lease.guarantees, lease.attestation_digest,
        )
        attestation.validate(now=checked_at)
        return lease
