"""Crash-recoverable AppContainer SID ACL projection for Windows workspaces."""

from __future__ import annotations

import os
import sqlite3
import stat
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .sandbox import SandboxError


class WindowsAclProjectionError(SandboxError):
    pass


class AclProjectionApi(Protocol):
    def snapshot(self, path: Path) -> str: ...
    def grant(self, path: Path, sid: str, *, writable: bool, directory: bool) -> None: ...
    def restore(self, path: Path, sddl: str) -> None: ...
    def remove_sid(self, path: Path, sid: str) -> None: ...


class NativeWindowsAclApi:
    def __init__(self):
        if os.name != "nt":
            raise WindowsAclProjectionError("acl_projection_unsupported", "Windows ACL projection requires Windows.")
        try:
            import ntsecuritycon
            import win32security
        except ImportError as error:
            raise WindowsAclProjectionError("acl_api_unavailable", "PyWin32 ACL APIs are unavailable.") from error
        self.security = win32security
        self.constants = ntsecuritycon

    def snapshot(self, path: Path) -> str:
        descriptor = self.security.GetFileSecurity(str(path), self.security.DACL_SECURITY_INFORMATION)
        return str(self.security.ConvertSecurityDescriptorToStringSecurityDescriptor(
            descriptor, self.security.SDDL_REVISION_1, self.security.DACL_SECURITY_INFORMATION,
        ))

    def grant(self, path: Path, sid: str, *, writable: bool, directory: bool) -> None:
        descriptor = self.security.GetFileSecurity(str(path), self.security.DACL_SECURITY_INFORMATION)
        acl = descriptor.GetSecurityDescriptorDacl()
        if acl is None:
            raise WindowsAclProjectionError("acl_null_dacl_denied", "Null DACL objects cannot be projected safely.")
        trustee = {
            "TrusteeType": self.security.TRUSTEE_IS_UNKNOWN,
            "TrusteeForm": self.security.TRUSTEE_IS_SID,
            "Identifier": self.security.ConvertStringSidToSid(sid),
        }
        inheritance = 0
        if directory:
            inheritance = self.security.CONTAINER_INHERIT_ACE | self.security.OBJECT_INHERIT_ACE
        permissions = self.constants.FILE_ALL_ACCESS if writable else (
            self.constants.FILE_GENERIC_READ | self.constants.FILE_GENERIC_EXECUTE
        )
        acl.SetEntriesInAcl([{
            "AccessMode": self.security.GRANT_ACCESS,
            "AccessPermissions": permissions,
            "Inheritance": inheritance,
            "Trustee": trustee,
        }])
        self.security.SetNamedSecurityInfo(
            str(path), self.security.SE_FILE_OBJECT, self.security.DACL_SECURITY_INFORMATION,
            None, None, acl, None,
        )

    def restore(self, path: Path, sddl: str) -> None:
        descriptor = self.security.ConvertStringSecurityDescriptorToSecurityDescriptor(
            sddl, self.security.SDDL_REVISION_1,
        )
        control, _revision = descriptor.GetSecurityDescriptorControl()
        protection = (
            self.security.PROTECTED_DACL_SECURITY_INFORMATION
            if control & self.security.SE_DACL_PROTECTED
            else self.security.UNPROTECTED_DACL_SECURITY_INFORMATION
        )
        self.security.SetNamedSecurityInfo(
            str(path), self.security.SE_FILE_OBJECT,
            self.security.DACL_SECURITY_INFORMATION | protection,
            None, None, descriptor.GetSecurityDescriptorDacl(), None,
        )

    def remove_sid(self, path: Path, sid: str) -> None:
        descriptor = self.security.GetFileSecurity(str(path), self.security.DACL_SECURITY_INFORMATION)
        acl = descriptor.GetSecurityDescriptorDacl()
        if acl is None:
            raise WindowsAclProjectionError("acl_null_dacl_denied", "Null DACL objects cannot be cleaned safely.")
        trustee = {
            "TrusteeType": self.security.TRUSTEE_IS_UNKNOWN,
            "TrusteeForm": self.security.TRUSTEE_IS_SID,
            "Identifier": self.security.ConvertStringSidToSid(sid),
        }
        acl.SetEntriesInAcl([{
            "AccessMode": self.security.REVOKE_ACCESS,
            "AccessPermissions": 0,
            "Inheritance": 0,
            "Trustee": trustee,
        }])
        self.security.SetNamedSecurityInfo(
            str(path), self.security.SE_FILE_OBJECT,
            self.security.DACL_SECURITY_INFORMATION | self.security.UNPROTECTED_DACL_SECURITY_INFORMATION,
            None, None, acl, None,
        )


@dataclass(frozen=True)
class AclProjection:
    projection_id: str
    run_id: str
    profile_name: str
    sid: str
    root: str
    writable: bool
    status: str
    item_count: int
    applied_count: int
    restored_count: int
    created_at: float
    updated_at: float
    error_code: str | None = None


class WindowsAclProjectionService:
    """Journals original DACLs before granting and restores them in reverse order."""

    _ACTIVE = frozenset({"applying", "active", "revoking", "rollback_failed"})

    def __init__(
        self,
        database: Path,
        api: AclProjectionApi | None = None,
        *,
        max_entries: int = 100_000,
        clock: Callable[[], float] = time.time,
    ):
        if max_entries < 1:
            raise ValueError("max_entries must be positive.")
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.api = api or NativeWindowsAclApi()
        self.max_entries = max_entries
        self.clock = clock
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_acl_projections(
                    projection_id TEXT PRIMARY KEY, run_id TEXT NOT NULL,
                    profile_name TEXT NOT NULL, sid TEXT NOT NULL, root TEXT NOT NULL,
                    writable INTEGER NOT NULL, status TEXT NOT NULL,
                    item_count INTEGER NOT NULL DEFAULT 0,
                    applied_count INTEGER NOT NULL DEFAULT 0,
                    restored_count INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL, error_code TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_acl_projection_items(
                    projection_id TEXT NOT NULL REFERENCES runtime_acl_projections(projection_id),
                    ordinal INTEGER NOT NULL, relative_path TEXT NOT NULL,
                    original_sddl TEXT NOT NULL, device_id TEXT NOT NULL, file_id TEXT NOT NULL,
                    object_kind TEXT NOT NULL, state TEXT NOT NULL,
                    PRIMARY KEY(projection_id, ordinal), UNIQUE(projection_id, relative_path)
                );
                CREATE TABLE IF NOT EXISTS runtime_acl_projection_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, projection_id TEXT NOT NULL,
                    event TEXT NOT NULL, detail TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_acl_projection_events_no_update
                BEFORE UPDATE ON runtime_acl_projection_events BEGIN SELECT RAISE(ABORT, 'acl projection events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_acl_projection_events_no_delete
                BEFORE DELETE ON runtime_acl_projection_events BEGIN SELECT RAISE(ABORT, 'acl projection events are append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _identity(path: Path) -> tuple[str, str, str]:
        information = path.stat(follow_symlinks=False)
        if stat.S_ISLNK(information.st_mode) or (
            getattr(information, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        ):
            raise WindowsAclProjectionError("acl_reparse_point_denied", "ACL projection refuses reparse points.")
        kind = "directory" if stat.S_ISDIR(information.st_mode) else "file" if stat.S_ISREG(information.st_mode) else "other"
        if kind == "other":
            raise WindowsAclProjectionError("acl_object_type_denied", "ACL projection accepts only files and directories.")
        return str(information.st_dev), str(information.st_ino), kind

    def _paths(self, root: Path) -> list[Path]:
        paths = [root]
        for current, directories, files in os.walk(root, topdown=True, followlinks=False):
            base = Path(current)
            # Inspect before descending; os.walk otherwise follows some Windows
            # junction variants despite followlinks=False on older runtimes.
            for name in sorted(directories):
                candidate = base / name
                self._identity(candidate)
                paths.append(candidate)
            for name in sorted(files):
                candidate = base / name
                self._identity(candidate)
                paths.append(candidate)
            if len(paths) > self.max_entries:
                raise WindowsAclProjectionError("acl_projection_too_large", "Workspace exceeds ACL projection entry limit.")
        return paths

    @staticmethod
    def _from_row(row: sqlite3.Row) -> AclProjection:
        return AclProjection(
            projection_id=str(row["projection_id"]), run_id=str(row["run_id"]),
            profile_name=str(row["profile_name"]), sid=str(row["sid"]), root=str(row["root"]),
            writable=bool(row["writable"]), status=str(row["status"]),
            item_count=int(row["item_count"]), applied_count=int(row["applied_count"]),
            restored_count=int(row["restored_count"]), created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]), error_code=row["error_code"],
        )

    def get(self, projection_id: str) -> AclProjection:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_acl_projections WHERE projection_id=?", (projection_id,)).fetchone()
        if row is None:
            raise WindowsAclProjectionError("acl_projection_missing", "ACL projection does not exist.")
        return self._from_row(row)

    def find_unrevoked_for_profile(self, profile_name: str) -> AclProjection | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_acl_projections WHERE profile_name=? AND status!='revoked' ORDER BY created_at DESC LIMIT 1",
                (profile_name,),
            ).fetchone()
        return self._from_row(row) if row is not None else None

    def _event(self, db: sqlite3.Connection, projection_id: str, event: str, detail: str, now: float) -> None:
        db.execute(
            "INSERT INTO runtime_acl_projection_events(projection_id,event,detail,created_at) VALUES(?,?,?,?)",
            (projection_id, event, detail, now),
        )

    def create(
        self, *, run_id: str, profile_name: str, sid: str, root: Path,
        writable: bool, fault_after_apply: int | None = None,
    ) -> AclProjection:
        if not run_id or not profile_name or not sid:
            raise WindowsAclProjectionError("acl_projection_identity_missing", "Run, profile and SID are required.")
        canonical_root = Path(os.path.abspath(root))
        device, inode, kind = self._identity(canonical_root)
        if kind != "directory":
            raise WindowsAclProjectionError("acl_projection_root_invalid", "Projection root must be a directory.")
        paths = self._paths(canonical_root)
        projection_id, now = f"acl-projection-{uuid.uuid4()}", self.clock()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            conflict = db.execute(
                "SELECT 1 FROM runtime_acl_projections WHERE root=? AND status IN ('applying','active','revoking','rollback_failed')",
                (str(canonical_root),),
            ).fetchone()
            if conflict:
                db.rollback()
                raise WindowsAclProjectionError("acl_projection_conflict", "Workspace already has an active ACL projection.")
            db.execute(
                "INSERT INTO runtime_acl_projections VALUES(?,?,?,?,?,?,'applying',0,0,0,?,?,NULL)",
                (projection_id, run_id, profile_name, sid, str(canonical_root), int(writable), now, now),
            )
            self._event(db, projection_id, "projection.started", f"root_identity={device}:{inode}", now)
            db.commit()
        try:
            # Snapshot every object before granting the root inheritable ACE.
            # Otherwise that ACE can reach children and contaminate the
            # "original" snapshots needed for exact rollback.
            for ordinal, path in enumerate(paths):
                relative = "." if path == canonical_root else path.relative_to(canonical_root).as_posix()
                device, inode, kind = self._identity(path)
                original = self.api.snapshot(path)
                with self._connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    db.execute(
                        "INSERT INTO runtime_acl_projection_items VALUES(?,?,?,?,?,?,?,'prepared')",
                        (projection_id, ordinal, relative, original, device, inode, kind),
                    )
                    db.execute(
                        "UPDATE runtime_acl_projections SET item_count=item_count+1,updated_at=? WHERE projection_id=?",
                        (self.clock(), projection_id),
                    )
                    db.commit()
            for ordinal, path in enumerate(paths):
                with self._connect() as db:
                    row = db.execute(
                        "SELECT object_kind FROM runtime_acl_projection_items WHERE projection_id=? AND ordinal=?",
                        (projection_id, ordinal),
                    ).fetchone()
                self.api.grant(path, sid, writable=writable, directory=str(row["object_kind"]) == "directory")
                if fault_after_apply is not None and ordinal + 1 == fault_after_apply:
                    raise RuntimeError("injected_acl_projection_fault")
                with self._connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    db.execute(
                        "UPDATE runtime_acl_projection_items SET state='applied' WHERE projection_id=? AND ordinal=?",
                        (projection_id, ordinal),
                    )
                    db.execute(
                        "UPDATE runtime_acl_projections SET applied_count=applied_count+1,updated_at=? WHERE projection_id=?",
                        (self.clock(), projection_id),
                    )
                    db.commit()
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute("UPDATE runtime_acl_projections SET status='active',updated_at=? WHERE projection_id=?", (self.clock(), projection_id))
                self._event(db, projection_id, "projection.active", f"items={len(paths)}", self.clock())
                db.commit()
            return self.get(projection_id)
        except BaseException as error:
            try:
                self.revoke(projection_id, reason="apply_failed", original_error=type(error).__name__)
            except BaseException as rollback_error:
                raise WindowsAclProjectionError(
                    "acl_projection_rollback_failed",
                    f"ACL projection failed and rollback failed: {type(rollback_error).__name__}.",
                ) from error
            raise

    def revoke(self, projection_id: str, *, reason: str = "requested", original_error: str | None = None) -> AclProjection:
        projection = self.get(projection_id)
        if projection.status == "revoked":
            return projection
        now = self.clock()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE runtime_acl_projections SET status='revoking',updated_at=?,error_code=? WHERE projection_id=?", (now, original_error, projection_id))
            self._event(db, projection_id, "projection.revoking", reason, now)
            db.commit()
        failures = []
        with self._connect() as db:
            rows = db.execute(
                # Restore root first so unprotected descendants subsequently
                # re-enable inheritance from a parent that no longer carries
                # the AppContainer ACE.
                "SELECT * FROM runtime_acl_projection_items WHERE projection_id=? AND state!='restored' ORDER BY ordinal ASC",
                (projection_id,),
            ).fetchall()
        root = Path(projection.root)
        for row in rows:
            path = root if row["relative_path"] == "." else root / str(row["relative_path"])
            try:
                device, inode, _kind = self._identity(path)
                if (device, inode) != (str(row["device_id"]), str(row["file_id"])):
                    raise WindowsAclProjectionError("acl_object_identity_changed", "Projected object identity changed.")
                if str(row["state"]) == "discovered":
                    self.api.remove_sid(path, projection.sid)
                else:
                    # prepared means the grant may have reached the OS before
                    # the process crashed; restoring it is conservative.
                    self.api.restore(path, str(row["original_sddl"]))
            except BaseException as error:
                failures.append((int(row["ordinal"]), type(error).__name__))
                continue
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute(
                    "UPDATE runtime_acl_projection_items SET state='restored' WHERE projection_id=? AND ordinal=?",
                    (projection_id, int(row["ordinal"])),
                )
                db.execute(
                    "UPDATE runtime_acl_projections SET restored_count=restored_count+1,updated_at=? WHERE projection_id=?",
                    (self.clock(), projection_id),
                )
                db.commit()
        # Objects created while the projection was active have no original ACL
        # to restore.  The profile SID is unique to this projection, so it is
        # safe to journal and revoke only that SID after the parent ACLs are
        # restored.  Discovered entries make a crash between OS revoke and DB
        # marking idempotently recoverable.
        try:
            current_paths = self._paths(root)
        except BaseException as error:
            failures.append((-1, type(error).__name__))
            current_paths = []
        with self._connect() as db:
            known = {str(row[0]) for row in db.execute(
                "SELECT relative_path FROM runtime_acl_projection_items WHERE projection_id=?",
                (projection_id,),
            ).fetchall()}
            next_ordinal = int(db.execute(
                "SELECT COALESCE(MAX(ordinal),-1)+1 FROM runtime_acl_projection_items WHERE projection_id=?",
                (projection_id,),
            ).fetchone()[0])
        for path in current_paths:
            relative = "." if path == root else path.relative_to(root).as_posix()
            if relative in known:
                continue
            try:
                device, inode, kind = self._identity(path)
                with self._connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    db.execute(
                        "INSERT OR IGNORE INTO runtime_acl_projection_items VALUES(?,?,?,?,?,?,?,'discovered')",
                        (projection_id, next_ordinal, relative, "", device, inode, kind),
                    )
                    db.execute(
                        "UPDATE runtime_acl_projections SET item_count=(SELECT COUNT(*) FROM runtime_acl_projection_items WHERE projection_id=?),updated_at=? WHERE projection_id=?",
                        (projection_id, self.clock(), projection_id),
                    )
                    db.commit()
                self.api.remove_sid(path, projection.sid)
            except BaseException as error:
                failures.append((next_ordinal, type(error).__name__))
                next_ordinal += 1
                continue
            with self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute(
                    "UPDATE runtime_acl_projection_items SET state='restored' WHERE projection_id=? AND relative_path=?",
                    (projection_id, relative),
                )
                db.execute(
                    "UPDATE runtime_acl_projections SET restored_count=restored_count+1,updated_at=? WHERE projection_id=?",
                    (self.clock(), projection_id),
                )
                db.commit()
            known.add(relative)
            next_ordinal += 1
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            status = "rollback_failed" if failures else "revoked"
            error_code = "acl_restore_failed" if failures else original_error
            db.execute(
                "UPDATE runtime_acl_projections SET status=?,updated_at=?,error_code=? WHERE projection_id=?",
                (status, self.clock(), error_code, projection_id),
            )
            self._event(db, projection_id, f"projection.{status}", f"failures={len(failures)}", self.clock())
            db.commit()
        result = self.get(projection_id)
        if failures:
            raise WindowsAclProjectionError("acl_restore_failed", f"Failed to restore {len(failures)} ACL object(s).")
        return result

    def recover_incomplete(self) -> list[AclProjection]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT projection_id FROM runtime_acl_projections WHERE status IN ('applying','revoking','rollback_failed') ORDER BY created_at,projection_id",
            ).fetchall()
        return [self.revoke(str(row["projection_id"]), reason="startup_recovery") for row in rows]
