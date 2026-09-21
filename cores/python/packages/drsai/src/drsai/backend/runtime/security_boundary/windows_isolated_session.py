"""Durable orchestration for AppContainer profile, ACL and worker cleanup."""

from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .models import canonical_digest
from .sandbox import SandboxError
from .windows_acl_projection import WindowsAclProjectionService
from .windows_appcontainer import (
    AppContainerProfile,
    WindowsAppContainerProfileFactory,
    WindowsAppContainerWorkerLauncher,
    WindowsAppContainerWorkerResult,
)
from .windows_job import WindowsJobLauncher


class WindowsIsolatedSessionError(SandboxError):
    pass


class SimulatedIsolatedSessionCrash(BaseException):
    """Test-only process-crash signal that intentionally bypasses cleanup."""


@dataclass(frozen=True)
class WindowsIsolatedSession:
    session_id: str
    execution_id: str
    run_id: str
    request_digest: str
    profile_name: str
    job_name: str
    sid: str | None
    projection_id: str | None
    workspace_root: str
    writable: bool
    state: str
    worker_status: str | None
    worker_exit_code: int | None
    job_empty_verified: bool
    owner_id: str
    lease_expires_at: float
    created_at: float
    updated_at: float
    error_code: str | None = None


class WindowsIsolatedExecutionSessionService:
    """Maintains the cleanup invariant profile ⇒ projection ⇒ stopped worker."""

    TERMINAL = frozenset({"completed", "failed_cleaned", "recovered", "quarantined"})

    def __init__(
        self,
        database: Path,
        *,
        profiles: WindowsAppContainerProfileFactory | None = None,
        projections: WindowsAclProjectionService | None = None,
        workers: WindowsAppContainerWorkerLauncher | None = None,
        clock: Callable[[], float] = time.time,
        phase_hook: Callable[[str, WindowsIsolatedSession], None] | None = None,
        owner_id: str | None = None,
        lease_seconds: float = 30,
        job_recovery: Callable[[str], bool] | None = None,
        authority_revoker: Callable[[str, str], int] | None = None,
    ):
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive.")
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.profiles = profiles or WindowsAppContainerProfileFactory()
        self.projections = projections or WindowsAclProjectionService(self.database)
        self.workers = workers or WindowsAppContainerWorkerLauncher()
        self.clock = clock
        self.phase_hook = phase_hook
        self.owner_id = owner_id or f"runtime-owner-{uuid.uuid4()}"
        self.lease_seconds = lease_seconds
        self.job_recovery = job_recovery or WindowsJobLauncher().verify_owned_job_empty
        self.authority_revoker = authority_revoker
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_windows_isolated_sessions(
                    session_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE,
                    run_id TEXT NOT NULL, request_digest TEXT NOT NULL,
                    profile_name TEXT NOT NULL, job_name TEXT NOT NULL, sid TEXT, projection_id TEXT,
                    workspace_root TEXT NOT NULL, writable INTEGER NOT NULL,
                    state TEXT NOT NULL, worker_status TEXT, worker_exit_code INTEGER,
                    job_empty_verified INTEGER NOT NULL DEFAULT 0,
                    owner_id TEXT NOT NULL, lease_expires_at REAL NOT NULL,
                    recovery_token TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL, error_code TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_windows_isolated_session_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                    state TEXT NOT NULL, detail TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_windows_isolated_session_events_no_update
                BEFORE UPDATE ON runtime_windows_isolated_session_events BEGIN SELECT RAISE(ABORT, 'isolated session events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_windows_isolated_session_events_no_delete
                BEFORE DELETE ON runtime_windows_isolated_session_events BEGIN SELECT RAISE(ABORT, 'isolated session events are append-only'); END;
            """)
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(runtime_windows_isolated_sessions)")}
            migrations = {
                "job_empty_verified": "INTEGER NOT NULL DEFAULT 0",
                "owner_id": "TEXT NOT NULL DEFAULT 'legacy-owner'",
                "lease_expires_at": "REAL NOT NULL DEFAULT 0",
                "recovery_token": "TEXT",
                "job_name": "TEXT NOT NULL DEFAULT 'legacy-unnamed-job'",
            }
            for name, declaration in migrations.items():
                if name not in columns:
                    db.execute(f"ALTER TABLE runtime_windows_isolated_sessions ADD COLUMN {name} {declaration}")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _from_row(row: sqlite3.Row) -> WindowsIsolatedSession:
        return WindowsIsolatedSession(
            session_id=str(row["session_id"]), execution_id=str(row["execution_id"]),
            run_id=str(row["run_id"]), request_digest=str(row["request_digest"]),
            profile_name=str(row["profile_name"]), sid=row["sid"], projection_id=row["projection_id"],
            job_name=str(row["job_name"]),
            workspace_root=str(row["workspace_root"]), writable=bool(row["writable"]),
            state=str(row["state"]), worker_status=row["worker_status"],
            worker_exit_code=int(row["worker_exit_code"]) if row["worker_exit_code"] is not None else None,
            job_empty_verified=bool(row["job_empty_verified"]), owner_id=str(row["owner_id"]),
            lease_expires_at=float(row["lease_expires_at"]),
            created_at=float(row["created_at"]), updated_at=float(row["updated_at"]),
            error_code=row["error_code"],
        )

    def get(self, session_id: str) -> WindowsIsolatedSession:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_windows_isolated_sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise WindowsIsolatedSessionError("isolated_session_missing", "Isolated session does not exist.")
        return self._from_row(row)

    def _by_execution(self, execution_id: str) -> WindowsIsolatedSession | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_windows_isolated_sessions WHERE execution_id=?", (execution_id,)).fetchone()
        return self._from_row(row) if row is not None else None

    def by_execution(self, execution_id: str) -> WindowsIsolatedSession | None:
        """Return the durable Session bound to an Effect dispatch identity."""

        return self._by_execution(execution_id)

    def reached_state(self, session_id: str, state: str) -> bool:
        with self._connect() as db:
            row = db.execute(
                "SELECT 1 FROM runtime_windows_isolated_session_events "
                "WHERE session_id=? AND state=? LIMIT 1",
                (session_id, state),
            ).fetchone()
        return row is not None

    def _transition(
        self, session_id: str, state: str, *, detail: str = "",
        lease_seconds: float | None = None, **fields: object,
    ) -> WindowsIsolatedSession:
        allowed = {"sid", "projection_id", "worker_status", "worker_exit_code", "job_empty_verified", "error_code"}
        if set(fields) - allowed:
            raise ValueError("Unsupported isolated session field.")
        now = self.clock()
        lease_until = now + (self.lease_seconds if lease_seconds is None else lease_seconds)
        assignments = ["state=?", "updated_at=?", "lease_expires_at=?"] + [f"{name}=?" for name in fields]
        values = [state, now, lease_until, *fields.values(), session_id, self.owner_id]
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                f"UPDATE runtime_windows_isolated_sessions SET {','.join(assignments)} WHERE session_id=? AND owner_id=?",
                values,
            ).rowcount
            if changed != 1:
                db.rollback()
                raise WindowsIsolatedSessionError("isolated_session_lease_lost", "Isolated session ownership was lost.")
            db.execute(
                "INSERT INTO runtime_windows_isolated_session_events(session_id,state,detail,created_at) VALUES(?,?,?,?)",
                (session_id, state, detail, now),
            )
            db.commit()
        session = self.get(session_id)
        if self.phase_hook:
            self.phase_hook(state, session)
        return session

    def heartbeat(self, session_id: str) -> WindowsIsolatedSession:
        session = self.get(session_id)
        if session.state in self.TERMINAL:
            return session
        return self._transition(session_id, session.state, detail="heartbeat")

    def _revoke_runtime_authority(self, session_id: str, reason_code: str) -> None:
        """Revoke a Run lease before a worker/session can become terminal."""

        if self.authority_revoker is None:
            return
        session = self.get(session_id)
        try:
            self.authority_revoker(session.run_id, reason_code)
        except Exception as error:
            raise WindowsIsolatedSessionError(
                "isolated_authority_revocation_failed",
                "Runtime isolation authority could not be revoked.",
            ) from error
        now = self.clock()
        with self._connect() as db:
            db.execute(
                "INSERT INTO runtime_windows_isolated_session_events(session_id,state,detail,created_at) "
                "VALUES(?,?,?,?)",
                (session_id, session.state, f"authority_revoked:{reason_code}", now),
            )

    @staticmethod
    def _request_digest(
        *, run_id: str, argv: Sequence[str], cwd: Path, environment: Mapping[str, str],
        timeout_seconds: float, writable: bool,
    ) -> str:
        # Only the digest is persisted; argv/environment may contain secrets.
        return canonical_digest({
            "run_id": run_id, "argv": list(argv), "cwd": str(cwd),
            "environment": dict(environment), "timeout_seconds": timeout_seconds,
            "writable": writable,
        })

    def execute(
        self, *, execution_id: str, run_id: str, argv: Sequence[str], cwd: Path,
        environment: Mapping[str, str], timeout_seconds: float, writable: bool,
    ) -> WindowsIsolatedSession:
        if not execution_id or not run_id or not argv or timeout_seconds <= 0:
            raise WindowsIsolatedSessionError("isolated_session_request_invalid", "Isolated execution request is invalid.")
        root = Path(cwd).absolute()
        if not root.is_dir():
            raise WindowsIsolatedSessionError("isolated_session_workspace_invalid", "Workspace does not exist.")
        digest = self._request_digest(
            run_id=run_id, argv=argv, cwd=root, environment=environment,
            timeout_seconds=timeout_seconds, writable=writable,
        )
        existing = self._by_execution(execution_id)
        if existing:
            if existing.request_digest != digest or existing.run_id != run_id:
                raise WindowsIsolatedSessionError("isolated_session_scope_mismatch", "Execution identity was reused with different scope.")
            if existing.state in self.TERMINAL:
                return existing
            raise WindowsIsolatedSessionError("isolated_session_in_progress", "Execution already has an unfinished isolated session.")

        session_id = f"windows-session-{uuid.uuid4()}"
        profile_name = self.profiles.reserve_name(run_id)
        job_name = WindowsJobLauncher.reserve_name()
        now = self.clock()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO runtime_windows_isolated_sessions("
                "session_id,execution_id,run_id,request_digest,profile_name,job_name,sid,projection_id,workspace_root,writable,state,"
                "worker_status,worker_exit_code,job_empty_verified,owner_id,lease_expires_at,recovery_token,created_at,updated_at,error_code"
                ") VALUES(?,?,?,?,?,?,NULL,NULL,?,?,'profile_prepared',NULL,NULL,0,?,?,NULL,?,?,NULL)",
                (session_id, execution_id, run_id, digest, profile_name, job_name, str(root), int(writable), self.owner_id, now + self.lease_seconds, now, now),
            )
            db.execute(
                "INSERT INTO runtime_windows_isolated_session_events(session_id,state,detail,created_at) VALUES(?,?,'',?)",
                (session_id, "profile_prepared", now),
            )
            db.commit()
        prepared = self.get(session_id)
        if self.phase_hook:
            self.phase_hook("profile_prepared", prepared)

        profile: AppContainerProfile | None = None
        projection_id: str | None = None
        try:
            profile = self.profiles.create_reserved(profile_name)
            self._transition(session_id, "profile_created", sid=profile.sid_string)
            projection = self.projections.create(
                run_id=run_id, profile_name=profile.name, sid=profile.sid_string,
                root=root, writable=writable,
            )
            projection_id = projection.projection_id
            self._transition(session_id, "acl_active", projection_id=projection_id)
            self._transition(session_id, "worker_starting", lease_seconds=timeout_seconds + self.lease_seconds)
            result: WindowsAppContainerWorkerResult = self.workers.run(
                profile, argv, cwd=root, environment=environment, timeout_seconds=timeout_seconds,
                job_name=job_name,
            )
            if not result.process_tree_empty_verified:
                raise WindowsIsolatedSessionError(
                    "isolated_job_empty_unverified", "Worker returned without proving the Job process tree is empty.",
                )
            self._revoke_runtime_authority(session_id, "worker_terminal")
            self._transition(
                session_id, "worker_terminal", worker_status=result.status,
                worker_exit_code=result.exit_code, job_empty_verified=True,
            )
            self.projections.revoke(projection_id, reason="worker_terminal")
            self._transition(session_id, "acl_revoked")
            profile.close()
            profile = None
            self._transition(session_id, "profile_deleted")
            return self._transition(session_id, "completed")
        except Exception as error:
            revocation_error: Exception | None = None
            try:
                self._revoke_runtime_authority(session_id, "isolated_session_failed")
            except Exception as revoke_error:
                revocation_error = revoke_error
            if getattr(error, "code", "") in {
                "isolated_job_empty_unverified", "appcontainer_job_not_empty", "job_not_empty",
            }:
                # Revoking filesystem authority while an unverified process
                # may still hold workspace handles is less safe than retaining
                # the unique, quarantined profile for operator recovery.
                self._transition(
                    session_id, "quarantined", worker_status="outcome_unknown",
                    error_code="job_empty_unverified",
                )
                if revocation_error is not None:
                    raise revocation_error from error
                raise
            cleanup_failed = False
            try:
                projection = (
                    self.projections.get(projection_id) if projection_id
                    else self.projections.find_unrevoked_for_profile(profile_name)
                )
                if projection and projection.status != "revoked":
                    self.projections.revoke(projection.projection_id, reason="session_error", original_error=type(error).__name__)
            except Exception:
                cleanup_failed = True
            try:
                if profile is not None:
                    profile.close()
                else:
                    self.profiles.delete_owned_profile(profile_name)
            except Exception:
                cleanup_failed = True
            state = "cleanup_failed" if cleanup_failed or revocation_error is not None else "failed_cleaned"
            self._transition(session_id, state, error_code=type(error).__name__)
            if cleanup_failed or revocation_error is not None:
                raise WindowsIsolatedSessionError(
                    "isolated_session_cleanup_failed", "Execution failed and isolation cleanup is incomplete.",
                ) from (revocation_error or error)
            raise

    def recover_incomplete(self) -> list[WindowsIsolatedSession]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT session_id FROM runtime_windows_isolated_sessions "
                "WHERE state NOT IN ('completed','failed_cleaned','recovered','quarantined') AND lease_expires_at<=? "
                "ORDER BY created_at,session_id", (self.clock(),),
            ).fetchall()
        recovered = []
        for row in rows:
            session_id = str(row["session_id"])
            recovery_token = f"recovery-{uuid.uuid4()}"
            now = self.clock()
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                changed = db.execute(
                    "UPDATE runtime_windows_isolated_sessions SET owner_id=?,recovery_token=?,lease_expires_at=?,updated_at=? "
                    "WHERE session_id=? AND lease_expires_at<=? AND state NOT IN ('completed','failed_cleaned','recovered','quarantined')",
                    (self.owner_id, recovery_token, now + self.lease_seconds, now, session_id, now),
                ).rowcount
                db.commit()
            if changed != 1:
                continue
            session = self.get(session_id)
            self._revoke_runtime_authority(session_id, "runtime_interrupted")
            cleanup_failed = False
            recovered_job_empty = session.job_empty_verified
            if session.state == "worker_starting" and not session.job_empty_verified:
                try:
                    empty = self.job_recovery(session.job_name)
                except Exception:
                    empty = False
                if not empty:
                    recovered.append(self._transition(
                        session.session_id, "quarantined", worker_status="outcome_unknown",
                        error_code="job_empty_unverified",
                    ))
                    continue
                recovered_job_empty = True
            try:
                projection = (
                    self.projections.get(session.projection_id) if session.projection_id
                    else self.projections.find_unrevoked_for_profile(session.profile_name)
                )
                if projection and projection.status != "revoked":
                    self.projections.revoke(projection.projection_id, reason="session_startup_recovery")
            except Exception:
                cleanup_failed = True
            try:
                self.profiles.delete_owned_profile(session.profile_name)
            except Exception:
                cleanup_failed = True
            if cleanup_failed:
                recovered.append(self._transition(
                    session.session_id, "cleanup_failed", error_code="startup_recovery_failed",
                ))
                continue
            recovered.append(self._transition(
                session.session_id, "recovered",
                worker_status=session.worker_status,
                job_empty_verified=recovered_job_empty,
                error_code="runtime_interrupted",
            ))
        return recovered

    def resolve_quarantined(self, session_id: str) -> WindowsIsolatedSession:
        session = self.get(session_id)
        if session.state != "quarantined":
            raise WindowsIsolatedSessionError("isolated_session_not_quarantined", "Session is not quarantined.")
        now, token = self.clock(), f"quarantine-recovery-{uuid.uuid4()}"
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            changed = db.execute(
                "UPDATE runtime_windows_isolated_sessions SET owner_id=?,recovery_token=?,lease_expires_at=?,updated_at=? "
                "WHERE session_id=? AND state='quarantined' AND lease_expires_at<=?",
                (self.owner_id, token, now + self.lease_seconds, now, session_id, now),
            ).rowcount
            db.commit()
        if changed != 1:
            raise WindowsIsolatedSessionError("isolated_quarantine_claim_denied", "Quarantine lease is active or already claimed.")
        self._revoke_runtime_authority(session_id, "quarantine_recovery")
        try:
            empty = self.job_recovery(session.job_name)
        except Exception:
            empty = False
        if not empty:
            return self._transition(
                session_id, "quarantined", worker_status="outcome_unknown",
                error_code="job_still_active",
            )
        cleanup_failed = False
        try:
            projection = (
                self.projections.get(session.projection_id) if session.projection_id
                else self.projections.find_unrevoked_for_profile(session.profile_name)
            )
            if projection and projection.status != "revoked":
                self.projections.revoke(projection.projection_id, reason="quarantine_job_empty")
        except Exception:
            cleanup_failed = True
        try:
            self.profiles.delete_owned_profile(session.profile_name)
        except Exception:
            cleanup_failed = True
        if cleanup_failed:
            return self._transition(session_id, "cleanup_failed", error_code="quarantine_cleanup_failed")
        return self._transition(
            session_id, "recovered", worker_status="outcome_unknown",
            job_empty_verified=True, error_code="quarantine_resolved",
        )
