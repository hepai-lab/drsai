"""Crash-recoverable same-volume staging, promotion and rollback actions."""

from __future__ import annotations

import hashlib
import ctypes
import json
import os
import re
import sqlite3
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol, Sequence

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .windows_installer_journal import (
    WindowsInstallerJournalError,
    WindowsInstallerOperation,
    WindowsInstallerOperationJournal,
)


class WindowsInstallerFilesystemActionError(WindowsInstallerJournalError):
    pass


@dataclass(frozen=True)
class WindowsInstallerArtifactInput:
    filename: str
    digest: str


@dataclass(frozen=True)
class WindowsInstallerDirectoryIdentity:
    device_id: str
    file_id: str


@dataclass(frozen=True)
class WindowsInstallerFilesystemAction:
    action_id: str
    operation_id: str
    state: str
    package_root: str
    install_root: str
    transaction_root: str
    staging_root: str
    quarantine_root: str
    failed_root: str
    artifact_set_digest: str
    acl_policy_digest: str
    had_existing_installation: bool
    original_device_id: str | None
    original_file_id: str | None
    staged_device_id: str | None
    staged_file_id: str | None
    error_code: str | None
    created_at: float
    updated_at: float


class WindowsInstallerFilesystemApi(Protocol):
    def prepare_transaction(self, path: Path) -> WindowsInstallerDirectoryIdentity: ...
    def identity(self, path: Path) -> WindowsInstallerDirectoryIdentity | None: ...
    def stage(
        self,
        package_root: Path,
        staging_root: Path,
        artifacts: Sequence[WindowsInstallerArtifactInput],
    ) -> WindowsInstallerDirectoryIdentity: ...
    def rename_new(self, source: Path, destination: Path) -> None: ...
    def verify_release_tree(self, root: Path) -> None: ...


class WindowsInstallerTreeAclApi(Protocol):
    def verify_parent(self, path: Path) -> None: ...
    def apply(self, path: Path, *, directory: bool, service_read: bool) -> None: ...
    def verify(self, path: Path, *, directory: bool, service_read: bool) -> None: ...


class NativeWindowsInstallerTreeAclApi:
    """Protected DACL: trusted installers write; service can only read/execute."""

    _TRUSTED_INSTALLER_SID = (
        "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
    )
    _WRITE_MASK = (
        0x00000002 | 0x00000004 | 0x00000010 | 0x00000040 | 0x00000100
        | 0x00010000 | 0x00040000 | 0x00080000 | 0x10000000 | 0x40000000
    )

    def __init__(self, trusted_writer_sids: Sequence[str], service_sid: str):
        if os.name != "nt":
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_unsupported",
                "Native installer tree ACLs require Windows.",
            )
        try:
            import ntsecuritycon
            import win32con
            import win32security
        except ImportError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_api_unavailable",
                "PyWin32 installer ACL APIs are unavailable.",
            ) from error
        self.security = win32security
        self.win32con = win32con
        self.constants = ntsecuritycon
        self.writers = tuple(sorted({value.upper() for value in trusted_writer_sids}))
        self.service_sid = service_sid.upper()
        if not self.writers or self.service_sid in self.writers:
            raise ValueError("Trusted installer writers must exclude the service SID.")
        self.owner_sid = "S-1-5-18" if "S-1-5-18" in self.writers else self.writers[0]

    def verify_parent(self, path: Path) -> None:
        try:
            descriptor = self.security.GetFileSecurity(
                str(path),
                self.security.OWNER_SECURITY_INFORMATION
                | self.security.DACL_SECURITY_INFORMATION,
            )
            owner = str(self.security.ConvertSidToStringSid(
                descriptor.GetSecurityDescriptorOwner(),
            )).upper()
            acl = descriptor.GetSecurityDescriptorDacl()
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_parent_acl_unreadable",
                "Installer transaction parent ACL is unreadable.",
            ) from error
        trusted = set(self.writers) | {
            "S-1-5-18", "S-1-5-32-544", self._TRUSTED_INSTALLER_SID,
        }
        valid = owner in trusted and acl is not None
        if valid:
            for index in range(acl.GetAceCount()):
                ace = acl.GetAce(index)
                if len(ace) != 3:
                    valid = False
                    continue
                header, mask, sid = ace
                sid_text = str(self.security.ConvertSidToStringSid(sid)).upper()
                if (
                    header[0] == self.security.ACCESS_ALLOWED_ACE_TYPE
                    and int(mask) & self._WRITE_MASK
                    and sid_text not in trusted
                ):
                    valid = False
        if not valid:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_parent_acl_invalid",
                "An untrusted identity can modify the installer transaction parent.",
            )

    def _descriptor(self, *, directory: bool, service_read: bool):
        flags = "OICI" if directory else ""
        aces = "".join(f"(A;{flags};FA;;;{sid})" for sid in self.writers)
        if service_read:
            aces += f"(A;{flags};GRGX;;;{self.service_sid})"
        return self.security.ConvertStringSecurityDescriptorToSecurityDescriptor(
            f"O:{self.owner_sid}G:SYD:P{aces}", self.security.SDDL_REVISION_1,
        )

    def apply(self, path: Path, *, directory: bool, service_read: bool) -> None:
        descriptor = self._descriptor(directory=directory, service_read=service_read)
        try:
            current = self.security.GetFileSecurity(
                str(path), self.security.OWNER_SECURITY_INFORMATION,
            )
            current_owner = str(self.security.ConvertSidToStringSid(
                current.GetSecurityDescriptorOwner(),
            )).upper()
            information = (
                self.security.DACL_SECURITY_INFORMATION
                | self.security.PROTECTED_DACL_SECURITY_INFORMATION
            )
            if current_owner != self.owner_sid:
                information |= self.security.OWNER_SECURITY_INFORMATION
            self.security.SetFileSecurity(
                str(path), information, descriptor,
            )
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_apply_failed",
                "Installer tree owner or protected DACL could not be applied.",
            ) from error
        self.verify(path, directory=directory, service_read=service_read)

    def verify(self, path: Path, *, directory: bool, service_read: bool) -> None:
        try:
            descriptor = self.security.GetFileSecurity(
                str(path),
                self.security.OWNER_SECURITY_INFORMATION
                | self.security.DACL_SECURITY_INFORMATION,
            )
            owner = str(self.security.ConvertSidToStringSid(
                descriptor.GetSecurityDescriptorOwner(),
            )).upper()
            control, _revision = descriptor.GetSecurityDescriptorControl()
            acl = descriptor.GetSecurityDescriptorDacl()
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_unreadable",
                "Installer tree owner or DACL is unreadable.",
            ) from error
        expected: dict[str, int] = {
            sid: int(self.constants.FILE_ALL_ACCESS) for sid in self.writers
        }
        if service_read:
            expected[self.service_sid] = int(
                self.constants.FILE_GENERIC_READ | self.constants.FILE_GENERIC_EXECUTE
            )
        actual: dict[str, int] = {}
        expected_flags = (
            self.win32con.OBJECT_INHERIT_ACE | self.win32con.CONTAINER_INHERIT_ACE
            if directory else 0
        )
        valid = (
            owner in self.writers and acl is not None
            and bool(control & self.security.SE_DACL_PROTECTED)
        )
        if valid:
            for index in range(acl.GetAceCount()):
                header, mask, sid = acl.GetAce(index)
                sid_text = str(self.security.ConvertSidToStringSid(sid)).upper()
                valid = (
                    valid
                    and header[0] == self.security.ACCESS_ALLOWED_ACE_TYPE
                    and header[1] == expected_flags
                    and sid_text not in actual
                )
                actual[sid_text] = int(mask)
        if not valid or actual != expected:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_invalid",
                "Installer tree ACL differs from the exact writer/service policy.",
            )


class NativeWindowsInstallerFilesystemApi:
    """No-delete filesystem adapter; rollback retains failed/staged releases."""

    _BUFFER = 1024 * 1024

    def __init__(
        self,
        trusted_writer_sids: Sequence[str],
        service_sid: str,
        *,
        acl_api: WindowsInstallerTreeAclApi | None = None,
    ):
        self.acl = acl_api or NativeWindowsInstallerTreeAclApi(
            trusted_writer_sids, service_sid,
        )

    @staticmethod
    def _is_reparse(path: Path) -> bool:
        information = path.stat(follow_symlinks=False)
        return bool(
            stat.S_ISLNK(information.st_mode)
            or getattr(information, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )

    @classmethod
    def _secure_kind(cls, path: Path, *, directory: bool) -> os.stat_result:
        try:
            information = path.stat(follow_symlinks=False)
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_path_unavailable",
                "Installer action path is unavailable.",
            ) from error
        if cls._is_reparse(path):
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_reparse_denied",
                "Installer action paths cannot be reparse points.",
            )
        expected = (
            stat.S_ISDIR(information.st_mode)
            if directory else stat.S_ISREG(information.st_mode)
        )
        if not expected:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_object_type_invalid",
                "Installer action object type is invalid.",
            )
        return information

    @staticmethod
    def _digest(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(
                lambda: stream.read(NativeWindowsInstallerFilesystemApi._BUFFER), b"",
            ):
                digest.update(block)
        return "sha256:" + digest.hexdigest()

    def identity(self, path: Path) -> WindowsInstallerDirectoryIdentity | None:
        if not path.exists():
            return None
        information = self._secure_kind(path, directory=True)
        return WindowsInstallerDirectoryIdentity(str(information.st_dev), str(information.st_ino))

    def prepare_transaction(self, path: Path) -> WindowsInstallerDirectoryIdentity:
        self._secure_kind(path.parent, directory=True)
        self.acl.verify_parent(path.parent)
        try:
            path.mkdir(exist_ok=False)
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_transaction_create_failed",
                "Could not create the installer transaction directory.",
            ) from error
        self.acl.apply(path, directory=True, service_read=False)
        identity = self.identity(path)
        if identity is None:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_transaction_identity_missing",
                "Installer transaction identity disappeared after ACL creation.",
            )
        return identity

    def stage(
        self,
        package_root: Path,
        staging_root: Path,
        artifacts: Sequence[WindowsInstallerArtifactInput],
    ) -> WindowsInstallerDirectoryIdentity:
        self._secure_kind(package_root, directory=True)
        self._secure_kind(staging_root.parent, directory=True)
        try:
            staging_root.mkdir(exist_ok=False)
            self.acl.apply(staging_root, directory=True, service_read=True)
        except FileExistsError:
            self._secure_kind(staging_root, directory=True)
            self.acl.verify(staging_root, directory=True, service_read=True)
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_stage_create_failed",
                "Could not create the installer staging directory.",
            ) from error
        for artifact in artifacts:
            source = package_root / artifact.filename
            destination = staging_root / artifact.filename
            source_before = self._secure_kind(source, directory=False)
            if destination.exists():
                self._secure_kind(destination, directory=False)
                self.acl.verify(destination, directory=False, service_read=True)
                if self._digest(destination) != artifact.digest:
                    raise WindowsInstallerFilesystemActionError(
                        "windows_installer_action_stage_collision",
                        "Existing staged artifact differs from the signed input.",
                    )
                continue
            try:
                source_handle = os.open(source, os.O_RDONLY | getattr(os, "O_BINARY", 0))
                try:
                    destination_handle = os.open(
                        destination,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0),
                        0o600,
                    )
                    try:
                        while True:
                            block = os.read(source_handle, self._BUFFER)
                            if not block:
                                break
                            offset = 0
                            while offset < len(block):
                                offset += os.write(destination_handle, block[offset:])
                        os.fsync(destination_handle)
                    finally:
                        os.close(destination_handle)
                finally:
                    os.close(source_handle)
            except OSError as error:
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_stage_copy_failed",
                    "Could not copy a staged artifact.",
                ) from error
            source_after = self._secure_kind(source, directory=False)
            if (
                source_before.st_dev, source_before.st_ino, source_before.st_size,
                source_before.st_mtime_ns,
            ) != (
                source_after.st_dev, source_after.st_ino, source_after.st_size,
                source_after.st_mtime_ns,
            ) or (
                self._digest(source) != artifact.digest
                or self._digest(destination) != artifact.digest
            ):
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_artifact_changed",
                    "Package artifact changed or failed digest verification during staging.",
                )
            self.acl.apply(destination, directory=False, service_read=True)
        actual_names = {item.name for item in staging_root.iterdir()}
        if actual_names != {item.filename for item in artifacts}:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_stage_inventory_invalid",
                "Staging directory contains an unexpected artifact inventory.",
            )
        identity = self.identity(staging_root)
        if identity is None:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_stage_identity_missing",
                "Staged directory identity disappeared after verification.",
            )
        return identity

    def verify_release_tree(self, root: Path) -> None:
        self._secure_kind(root, directory=True)
        self.acl.verify(root, directory=True, service_read=True)
        for item in root.iterdir():
            self._secure_kind(item, directory=False)
            self.acl.verify(item, directory=False, service_read=True)

    def rename_new(self, source: Path, destination: Path) -> None:
        source_identity = self.identity(source)
        if source_identity is None:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_rename_source_missing",
                "Installer rename source is unavailable.",
            )
        if destination.exists():
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_rename_destination_exists",
                "Installer rename destination already exists.",
            )
        destination_parent = self._secure_kind(destination.parent, directory=True)
        if str(destination_parent.st_dev) != source_identity.device_id:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_cross_volume_denied",
                "Installer promotion must remain on one volume.",
            )
        try:
            if os.name == "nt":
                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel32.MoveFileExW.argtypes = [
                    ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong,
                ]
                kernel32.MoveFileExW.restype = ctypes.c_int
                if not kernel32.MoveFileExW(str(source), str(destination), 0x8):
                    raise OSError(ctypes.get_last_error(), "MoveFileExW failed")
            else:
                os.rename(source, destination)
                descriptor = os.open(destination.parent, os.O_RDONLY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        except OSError as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_rename_failed", "Atomic directory rename failed.",
            ) from error
        if self.identity(destination) != source_identity:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_rename_identity_changed",
                "Renamed directory identity differs from the source.",
            )
        self.verify_release_tree(destination)


class WindowsInstallerFilesystemActionJournal:
    _DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
    _ACTIVE = frozenset({
        "prepared", "staging", "staged", "promoting", "promoted", "rollback_failed",
    })

    def __init__(
        self,
        database: Path,
        installer_journal: WindowsInstallerOperationJournal,
        api: WindowsInstallerFilesystemApi | None = None,
        *,
        trusted_writer_sids: Sequence[str],
        service_sid: str,
        clock=time.time,
        fault_hook: Callable[[str], None] | None = None,
    ):
        self.database = Path(database)
        self.installer_journal = installer_journal
        self.trusted_writer_sids = tuple(sorted({value.upper() for value in trusted_writer_sids}))
        self.service_sid = service_sid.upper()
        if not self.trusted_writer_sids or self.service_sid in self.trusted_writer_sids:
            raise ValueError("Installer writer SIDs must be non-empty and exclude the service SID.")
        policy = json.dumps({
            "trusted_writer_sids": self.trusted_writer_sids,
            "service_sid": self.service_sid,
        }, sort_keys=True, separators=(",", ":")).encode("ascii")
        self.acl_policy_digest = "sha256:" + hashlib.sha256(policy).hexdigest()
        self.api = api or NativeWindowsInstallerFilesystemApi(
            self.trusted_writer_sids, self.service_sid,
        )
        self.clock = clock
        self.fault_hook = fault_hook or (lambda _stage: None)
        self.security_journal = SecurityEventJournal(self.database)
        with self._connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_filesystem_actions(
                    action_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL, package_root TEXT NOT NULL,
                    install_root TEXT NOT NULL, transaction_root TEXT NOT NULL,
                    staging_root TEXT NOT NULL, quarantine_root TEXT NOT NULL,
                    failed_root TEXT NOT NULL, artifact_set_digest TEXT NOT NULL,
                    acl_policy_digest TEXT NOT NULL,
                    artifact_json TEXT NOT NULL, had_existing_installation INTEGER NOT NULL,
                    original_device_id TEXT, original_file_id TEXT,
                    staged_device_id TEXT, staged_file_id TEXT, error_code TEXT,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS runtime_windows_installer_one_active_fs_root
                ON runtime_windows_installer_filesystem_actions(install_root)
                WHERE state IN (
                    'prepared','staging','staged','promoting','promoted',
                    'rolling_back','rollback_failed'
                );
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_filesystem_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    action_id TEXT NOT NULL, event TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_fs_events_no_update
                BEFORE UPDATE ON runtime_windows_installer_filesystem_events
                BEGIN SELECT RAISE(ABORT, 'installer filesystem events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_fs_events_no_delete
                BEFORE DELETE ON runtime_windows_installer_filesystem_events
                BEGIN SELECT RAISE(ABORT, 'installer filesystem events are append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def artifact_set_digest(artifacts: Sequence[WindowsInstallerArtifactInput]) -> str:
        payload = [{"filename": item.filename, "digest": item.digest} for item in artifacts]
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("ascii")
        return "sha256:" + hashlib.sha256(encoded).hexdigest()

    @classmethod
    def _validate_artifacts(
        cls, artifacts: Sequence[WindowsInstallerArtifactInput],
    ) -> tuple[WindowsInstallerArtifactInput, ...]:
        values = tuple(artifacts)
        names: set[str] = set()
        if not values:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_artifacts_invalid", "At least one artifact is required.",
            )
        for item in values:
            if (
                not isinstance(item, WindowsInstallerArtifactInput)
                or not item.filename or Path(item.filename).name != item.filename
                or item.filename in names or not cls._DIGEST.fullmatch(item.digest)
            ):
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_artifacts_invalid",
                    "Installer artifact names and digests must be unique and canonical.",
                )
            names.add(item.filename)
        return tuple(sorted(values, key=lambda item: item.filename))

    @classmethod
    def validated_artifact_set_digest(
        cls, artifacts: Sequence[WindowsInstallerArtifactInput],
    ) -> str:
        return cls.artifact_set_digest(cls._validate_artifacts(artifacts))

    @staticmethod
    def _from_row(row: sqlite3.Row) -> WindowsInstallerFilesystemAction:
        return WindowsInstallerFilesystemAction(
            action_id=str(row["action_id"]), operation_id=str(row["operation_id"]),
            state=str(row["state"]), package_root=str(row["package_root"]),
            install_root=str(row["install_root"]), transaction_root=str(row["transaction_root"]),
            staging_root=str(row["staging_root"]), quarantine_root=str(row["quarantine_root"]),
            failed_root=str(row["failed_root"]),
            artifact_set_digest=str(row["artifact_set_digest"]),
            acl_policy_digest=str(row["acl_policy_digest"]),
            had_existing_installation=bool(row["had_existing_installation"]),
            original_device_id=row["original_device_id"], original_file_id=row["original_file_id"],
            staged_device_id=row["staged_device_id"], staged_file_id=row["staged_file_id"],
            error_code=row["error_code"], created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    def get(self, action_id: str) -> WindowsInstallerFilesystemAction:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_filesystem_actions WHERE action_id=?",
                (action_id,),
            ).fetchone()
        if row is None:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_missing", "Installer filesystem action does not exist.",
            )
        return self._from_row(row)

    def get_for_operation(self, operation_id: str) -> WindowsInstallerFilesystemAction | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_filesystem_actions "
                "WHERE operation_id=?", (operation_id,),
            ).fetchone()
        return self._from_row(row) if row is not None else None

    def _require_policy(self, action: WindowsInstallerFilesystemAction) -> None:
        if action.acl_policy_digest != self.acl_policy_digest:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_acl_policy_mismatch",
                "Installer action ACL policy differs from its durable identity.",
            )

    def _artifacts(self, action_id: str) -> tuple[WindowsInstallerArtifactInput, ...]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT artifact_json FROM runtime_windows_installer_filesystem_actions "
                "WHERE action_id=?", (action_id,),
            ).fetchone()
        if row is None:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_missing", "Installer filesystem action does not exist.",
            )
        return tuple(WindowsInstallerArtifactInput(**item) for item in json.loads(row[0]))

    def _set_state(
        self,
        connection: sqlite3.Connection,
        action: WindowsInstallerFilesystemAction,
        state: str,
        *,
        staged_identity: WindowsInstallerDirectoryIdentity | None = None,
        error_code: str | None = None,
    ) -> None:
        now = float(self.clock())
        connection.execute(
            "UPDATE runtime_windows_installer_filesystem_actions SET state=?,"
            "staged_device_id=COALESCE(?,staged_device_id),"
            "staged_file_id=COALESCE(?,staged_file_id),error_code=?,updated_at=? "
            "WHERE action_id=?",
            (state, staged_identity.device_id if staged_identity else None,
             staged_identity.file_id if staged_identity else None, error_code, now,
             action.action_id),
        )
        connection.execute(
            "INSERT INTO runtime_windows_installer_filesystem_events(action_id,event,created_at) "
            "VALUES(?,?,?)", (action.action_id, state, now),
        )
        self.security_journal.append_in_transaction(
            connection, f"windows_installer_filesystem.{state}", action.operation_id,
            {"action_id": action.action_id, "artifact_set_digest": action.artifact_set_digest},
            now=now,
        )

    def prepare(
        self,
        operation: WindowsInstallerOperation,
        package_root: Path,
        artifacts: Sequence[WindowsInstallerArtifactInput],
    ) -> WindowsInstallerFilesystemAction:
        current = self.installer_journal.get(operation.operation_id)
        if (
            current != operation or operation.state != "safe_disabled"
            or operation.service_sid.upper() != self.service_sid
        ):
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_operation_not_safe",
                "Filesystem action requires the current safe-disabled installer operation.",
            )
        values = self._validate_artifacts(artifacts)
        package = Path(package_root).resolve(strict=True)
        install = Path(operation.install_root).resolve(strict=False)
        if package == install or package.is_relative_to(install) or install.is_relative_to(package):
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_package_root_invalid",
                "Package source and installation target must be disjoint.",
            )
        action_id = f"windows-fs-{operation.operation_id.removeprefix('windows-installer-')}"
        transaction = install.parent / f".opendrsai-{action_id}"
        staging = transaction / "staging"
        quarantine = transaction / "quarantine"
        failed = transaction / "failed-promoted"
        original = self.api.identity(install)
        if original is not None:
            self.api.verify_release_tree(install)
        artifact_digest = self.artifact_set_digest(values)
        now = float(self.clock())
        try:
            self.api.prepare_transaction(transaction)
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "INSERT INTO runtime_windows_installer_filesystem_actions VALUES"
                    "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (action_id, operation.operation_id, "prepared", str(package), str(install),
                     str(transaction), str(staging), str(quarantine), str(failed),
                     artifact_digest, self.acl_policy_digest,
                     json.dumps([item.__dict__ for item in values], sort_keys=True),
                     int(original is not None), original.device_id if original else None,
                     original.file_id if original else None, None, None, None, now, now),
                )
                row = connection.execute(
                    "SELECT * FROM runtime_windows_installer_filesystem_actions WHERE action_id=?",
                    (action_id,),
                ).fetchone()
                action = self._from_row(row)
                self._set_state(connection, action, "prepared")
                connection.commit()
        except (OSError, sqlite3.IntegrityError) as error:
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_prepare_failed",
                "Could not prepare a unique installer filesystem transaction.",
            ) from error
        return self.get(action_id)

    def stage(self, action_id: str) -> WindowsInstallerFilesystemAction:
        initial = self.get(action_id)
        self._require_policy(initial)
        operation = self.installer_journal.get(initial.operation_id)
        if operation.state != "safe_disabled":
            raise WindowsInstallerFilesystemActionError(
                "windows_installer_action_operation_not_safe",
                "Staging requires the current safe-disabled installer operation.",
            )
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            action = self.get(action_id)
            self._require_policy(action)
            if action.state not in {"prepared", "staging"}:
                connection.rollback()
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_state_invalid", "Action cannot enter staging.",
                )
            self._set_state(connection, action, "staging")
            self.fault_hook("before_stage")
            identity = self.api.stage(
                Path(action.package_root), Path(action.staging_root), self._artifacts(action_id),
            )
            self.fault_hook("after_stage")
            self._set_state(connection, action, "staged", staged_identity=identity)
            connection.commit()
        return self.get(action_id)

    @staticmethod
    def _matches(
        actual: WindowsInstallerDirectoryIdentity | None,
        device_id: str | None,
        file_id: str | None,
    ) -> bool:
        return actual is not None and (actual.device_id, actual.file_id) == (device_id, file_id)

    def promote(self, action_id: str) -> WindowsInstallerFilesystemAction:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            action = self.get(action_id)
            self._require_policy(action)
            operation = self.installer_journal.get(action.operation_id)
            if (
                action.state not in {"staged", "promoting"}
                or operation.state != "artifacts_staged"
                or operation.staged_artifact_set_digest != action.artifact_set_digest
            ):
                connection.rollback()
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_promotion_not_authorized",
                    "Promotion requires the exact journaled staged artifact set.",
                )
            self._set_state(connection, action, "promoting")
            install = self.api.identity(Path(action.install_root))
            quarantine = self.api.identity(Path(action.quarantine_root))
            staging = self.api.identity(Path(action.staging_root))
            staged_matches = self._matches(
                staging, action.staged_device_id, action.staged_file_id,
            )
            original_matches = self._matches(
                install, action.original_device_id, action.original_file_id,
            )
            install_is_staged = self._matches(
                install, action.staged_device_id, action.staged_file_id,
            )
            quarantined_original = self._matches(
                quarantine, action.original_device_id, action.original_file_id,
            )
            if not staged_matches and not install_is_staged:
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_staged_identity_invalid",
                    "Staging directory was replaced or lost before promotion.",
                )
            if staged_matches:
                self.api.verify_release_tree(Path(action.staging_root))
            if action.had_existing_installation and original_matches and quarantine is None:
                self.fault_hook("before_quarantine")
                self.api.rename_new(Path(action.install_root), Path(action.quarantine_root))
                self.fault_hook("after_quarantine")
                install, quarantine = None, self.api.identity(Path(action.quarantine_root))
                quarantined_original = self._matches(
                    quarantine, action.original_device_id, action.original_file_id,
                )
            if action.had_existing_installation and not quarantined_original:
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_original_identity_lost",
                    "Original installation is not present at a trusted path.",
                )
            if install is None and staged_matches:
                self.fault_hook("before_promote")
                self.api.rename_new(Path(action.staging_root), Path(action.install_root))
                self.fault_hook("after_promote")
                install = self.api.identity(Path(action.install_root))
            if not self._matches(install, action.staged_device_id, action.staged_file_id):
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_promoted_identity_invalid",
                    "Promoted installation does not match the staged directory identity.",
                )
            self._set_state(connection, action, "promoted")
            connection.commit()
        return self.get(action_id)

    def _rollback_in_connection(
        self,
        connection: sqlite3.Connection,
        operation: WindowsInstallerOperation,
    ) -> None:
        row = connection.execute(
            "SELECT * FROM runtime_windows_installer_filesystem_actions WHERE operation_id=?",
            (operation.operation_id,),
        ).fetchone()
        if row is None:
            return
        action = self._from_row(row)
        self._require_policy(action)
        if action.state == "rolled_back":
            return
        self._set_state(connection, action, "rolling_back")
        try:
            install = self.api.identity(Path(action.install_root))
            staging = self.api.identity(Path(action.staging_root))
            quarantine = self.api.identity(Path(action.quarantine_root))
            failed = self.api.identity(Path(action.failed_root))
            install_is_staged = self._matches(
                install, action.staged_device_id, action.staged_file_id,
            )
            if install_is_staged:
                destination = (
                    Path(action.staging_root) if staging is None else Path(action.failed_root)
                )
                if destination == Path(action.failed_root) and failed is not None:
                    raise WindowsInstallerFilesystemActionError(
                        "windows_installer_action_failed_quarantine_occupied",
                        "Failed promoted release cannot be quarantined safely.",
                    )
                self.api.rename_new(Path(action.install_root), destination)
                install = None
            if action.had_existing_installation:
                quarantine_is_original = self._matches(
                    quarantine, action.original_device_id, action.original_file_id,
                )
                install_is_original = self._matches(
                    install, action.original_device_id, action.original_file_id,
                )
                if install is None and quarantine_is_original:
                    self.api.rename_new(Path(action.quarantine_root), Path(action.install_root))
                    install_is_original = True
                if not install_is_original:
                    raise WindowsInstallerFilesystemActionError(
                        "windows_installer_action_original_restore_unproven",
                        "Rollback could not prove restoration of the original installation.",
                    )
            elif install is not None:
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_new_install_cleanup_unproven",
                    "Rollback found an unrecognized new installation root.",
                )
        except BaseException as error:
            self._set_state(
                connection, action, "rollback_failed", error_code=type(error).__name__,
            )
            raise
        self._set_state(connection, action, "rolled_back")

    def rollback_in_transaction(
        self,
        connection: sqlite3.Connection,
        operation: WindowsInstallerOperation,
    ) -> None:
        self._rollback_in_connection(connection, operation)

    def rollback(self, operation: WindowsInstallerOperation) -> None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                self._rollback_in_connection(connection, operation)
            except BaseException:
                connection.commit()
                raise
            connection.commit()

    def mark_committed(self, action_id: str) -> WindowsInstallerFilesystemAction:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            action = self.get(action_id)
            self._require_policy(action)
            operation = self.installer_journal.get(action.operation_id)
            install = self.api.identity(Path(action.install_root))
            quarantine = self.api.identity(Path(action.quarantine_root))
            physical_valid = self._matches(
                install, action.staged_device_id, action.staged_file_id,
            ) and (
                not action.had_existing_installation
                or self._matches(
                    quarantine, action.original_device_id, action.original_file_id,
                )
            )
            if (
                action.state != "promoted"
                or operation.state != "committed"
                or not physical_valid
            ):
                connection.rollback()
                raise WindowsInstallerFilesystemActionError(
                    "windows_installer_action_commit_not_authorized",
                    "Filesystem action can commit only with its installer operation.",
                )
            self._set_state(connection, action, "committed")
            connection.commit()
        return self.get(action_id)
