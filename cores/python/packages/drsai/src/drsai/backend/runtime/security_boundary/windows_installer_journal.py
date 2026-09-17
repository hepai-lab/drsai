"""Crash-recoverable security journal for privileged Windows installer operations."""

from __future__ import annotations

import hashlib
import ctypes
import os
import secrets
import sqlite3
import time
import uuid
import re
from ctypes import wintypes
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Protocol

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .windows_installation_verifier import VerifiedWindowsSecurityInstallation
from .windows_package_catalog import VerifiedWindowsSecurityPackageCatalog


class WindowsInstallerJournalError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class WindowsInstallerServiceSafetyEvidence:
    service_name: str
    disabled: bool
    stopped: bool
    process_count: int
    registered: bool = True
    previous_start_type: str | None = "disabled"


class WindowsInstallerSafetyController(Protocol):
    def ensure_disabled_and_stopped(self, service_name: str) -> WindowsInstallerServiceSafetyEvidence: ...


class NativeWindowsInstallerSafetyController:
    """Privileged SCM adapter used only by the Windows installer/recovery process."""

    _SC_MANAGER_CONNECT = 0x0001
    _SERVICE_QUERY_CONFIG = 0x0001
    _SERVICE_CHANGE_CONFIG = 0x0002
    _SERVICE_QUERY_STATUS = 0x0004
    _SERVICE_STOP = 0x0020
    _SERVICE_CONTROL_STOP = 0x00000001
    _SERVICE_STOPPED = 0x00000001
    _SERVICE_DISABLED = 0x00000004
    _START_TYPES = {2: "automatic", 3: "manual", 4: "disabled"}
    _SERVICE_NO_CHANGE = 0xFFFFFFFF
    _SC_STATUS_PROCESS_INFO = 0
    _ERROR_INSUFFICIENT_BUFFER = 122
    _ERROR_SERVICE_DOES_NOT_EXIST = 1060
    _ERROR_SERVICE_NOT_ACTIVE = 1062

    class _QueryServiceConfig(ctypes.Structure):
        _fields_ = [
            ("dwServiceType", wintypes.DWORD), ("dwStartType", wintypes.DWORD),
            ("dwErrorControl", wintypes.DWORD), ("lpBinaryPathName", wintypes.LPWSTR),
            ("lpLoadOrderGroup", wintypes.LPWSTR), ("dwTagId", wintypes.DWORD),
            ("lpDependencies", wintypes.LPWSTR), ("lpServiceStartName", wintypes.LPWSTR),
            ("lpDisplayName", wintypes.LPWSTR),
        ]

    class _ServiceStatus(ctypes.Structure):
        _fields_ = [
            ("dwServiceType", wintypes.DWORD), ("dwCurrentState", wintypes.DWORD),
            ("dwControlsAccepted", wintypes.DWORD), ("dwWin32ExitCode", wintypes.DWORD),
            ("dwServiceSpecificExitCode", wintypes.DWORD), ("dwCheckPoint", wintypes.DWORD),
            ("dwWaitHint", wintypes.DWORD), ("dwProcessId", wintypes.DWORD),
            ("dwServiceFlags", wintypes.DWORD),
        ]

    def __init__(self, *, stop_timeout_seconds: float = 30):
        if os.name != "nt":
            raise WindowsInstallerJournalError(
                "windows_installer_scm_unsupported", "Installer SCM control requires Windows.",
            )
        if stop_timeout_seconds <= 0:
            raise ValueError("SCM stop timeout must be positive.")
        self.stop_timeout_seconds = stop_timeout_seconds
        self.advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        self.advapi.OpenSCManagerW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
        self.advapi.OpenSCManagerW.restype = wintypes.HANDLE
        self.advapi.OpenServiceW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.DWORD]
        self.advapi.OpenServiceW.restype = wintypes.HANDLE
        self.advapi.CloseServiceHandle.argtypes = [wintypes.HANDLE]
        self.advapi.CloseServiceHandle.restype = wintypes.BOOL
        self.advapi.QueryServiceConfigW.argtypes = [
            wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi.QueryServiceConfigW.restype = wintypes.BOOL
        self.advapi.ChangeServiceConfigW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD),
            wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
        ]
        self.advapi.ChangeServiceConfigW.restype = wintypes.BOOL
        self.advapi.QueryServiceStatusEx.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi.QueryServiceStatusEx.restype = wintypes.BOOL
        self.advapi.ControlService.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p,
        ]
        self.advapi.ControlService.restype = wintypes.BOOL

    def _status(self, service) -> _ServiceStatus:
        status, needed = self._ServiceStatus(), wintypes.DWORD()
        if not self.advapi.QueryServiceStatusEx(
            service, self._SC_STATUS_PROCESS_INFO, ctypes.byref(status),
            ctypes.sizeof(status), ctypes.byref(needed),
        ):
            raise WindowsInstallerJournalError(
                "windows_installer_service_status_unreadable", "Service process state is unreadable.",
            )
        return status

    def ensure_disabled_and_stopped(self, service_name: str) -> WindowsInstallerServiceSafetyEvidence:
        manager = self.advapi.OpenSCManagerW(None, None, self._SC_MANAGER_CONNECT)
        if not manager:
            raise WindowsInstallerJournalError(
                "windows_installer_scm_unavailable", "Service Control Manager is unavailable.",
            )
        service = None
        try:
            access = (
                self._SERVICE_QUERY_CONFIG | self._SERVICE_CHANGE_CONFIG
                | self._SERVICE_QUERY_STATUS | self._SERVICE_STOP
            )
            ctypes.set_last_error(0)
            service = self.advapi.OpenServiceW(manager, service_name, access)
            if not service:
                if ctypes.get_last_error() == self._ERROR_SERVICE_DOES_NOT_EXIST:
                    return WindowsInstallerServiceSafetyEvidence(
                        service_name, True, True, 0, registered=False,
                        previous_start_type=None,
                    )
                raise WindowsInstallerJournalError(
                    "windows_installer_service_unavailable", "Installer cannot control the pinned service.",
                )
            needed = wintypes.DWORD()
            ctypes.set_last_error(0)
            self.advapi.QueryServiceConfigW(service, None, 0, ctypes.byref(needed))
            if ctypes.get_last_error() != self._ERROR_INSUFFICIENT_BUFFER:
                raise WindowsInstallerJournalError(
                    "windows_installer_service_config_unreadable", "Service configuration is unreadable.",
                )
            buffer = ctypes.create_string_buffer(needed.value)
            if not self.advapi.QueryServiceConfigW(
                service, buffer, needed.value, ctypes.byref(needed),
            ):
                raise WindowsInstallerJournalError(
                    "windows_installer_service_config_unreadable", "Service configuration is unreadable.",
                )
            config = ctypes.cast(buffer, ctypes.POINTER(self._QueryServiceConfig)).contents
            previous_start_type = self._START_TYPES.get(int(config.dwStartType))
            if previous_start_type is None:
                raise WindowsInstallerJournalError(
                    "windows_installer_service_start_type_unsupported",
                    "Service start type cannot be safely snapshotted.",
                )
            if int(config.dwStartType) != self._SERVICE_DISABLED:
                if not self.advapi.ChangeServiceConfigW(
                    service, self._SERVICE_NO_CHANGE, self._SERVICE_DISABLED,
                    self._SERVICE_NO_CHANGE, None, None, None, None, None, None, None,
                ):
                    raise WindowsInstallerJournalError(
                        "windows_installer_service_disable_failed", "Service could not be disabled.",
                    )
            status = self._status(service)
            if int(status.dwCurrentState) != self._SERVICE_STOPPED:
                ctypes.set_last_error(0)
                if not self.advapi.ControlService(
                    service, self._SERVICE_CONTROL_STOP, ctypes.byref(status),
                ) and ctypes.get_last_error() != self._ERROR_SERVICE_NOT_ACTIVE:
                    raise WindowsInstallerJournalError(
                        "windows_installer_service_stop_failed", "Service could not be stopped.",
                    )
                deadline = time.monotonic() + self.stop_timeout_seconds
                while time.monotonic() < deadline:
                    status = self._status(service)
                    if int(status.dwCurrentState) == self._SERVICE_STOPPED:
                        break
                    time.sleep(0.05)
            status = self._status(service)
            return WindowsInstallerServiceSafetyEvidence(
                service_name, True, int(status.dwCurrentState) == self._SERVICE_STOPPED,
                0 if int(status.dwProcessId) == 0 else 1, registered=True,
                previous_start_type=previous_start_type,
            )
        finally:
            if service:
                self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)


@dataclass(frozen=True)
class WindowsInstallerOperation:
    operation_id: str
    operation_type: str
    state: str
    install_root: str
    service_name: str
    service_sid: str
    catalog_id: str
    catalog_version: int
    catalog_digest: str
    runtime_build_digest: str
    installation_metadata_digest: str
    staged_artifact_set_digest: str | None
    error_code: str | None
    prior_service_registered: bool
    prior_service_start_type: str | None
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class WindowsServiceBootstrapAuthorization:
    authorization_id: str
    operation_id: str
    token: str
    catalog_digest: str
    installation_metadata_digest: str
    service_name: str
    expires_at: float


@dataclass(frozen=True)
class ConsumedWindowsServiceBootstrapReceipt:
    authorization_id: str
    operation_id: str
    catalog_digest: str
    installation_metadata_digest: str
    runtime_build_digest: str
    install_root: str
    service_name: str
    service_sid: str
    consumed_at: float
    expires_at: float


class WindowsInstallerOperationJournal:
    _OPERATION_TYPES = frozenset({"install", "upgrade", "repair", "rollback", "uninstall"})
    _INCOMPLETE = frozenset({
        "safe_disabled", "artifacts_staged", "package_verified", "service_registered",
        "rolling_back", "rollback_failed",
    })
    _TRANSITIONS = {
        "safe_disabled": frozenset({"artifacts_staged", "rolling_back"}),
        "artifacts_staged": frozenset({"service_registered", "rolling_back"}),
        "service_registered": frozenset({"package_verified", "rolling_back"}),
        "package_verified": frozenset({"committed", "rolling_back"}),
        "rolling_back": frozenset({"rolled_back", "rollback_failed"}),
        "rollback_failed": frozenset({"rolling_back"}),
        "committed": frozenset(),
        "rolled_back": frozenset(),
    }
    _DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
    _REASON = re.compile(r"[a-z0-9][a-z0-9_]{0,63}")

    def __init__(
        self,
        database: Path,
        safety_controller: WindowsInstallerSafetyController,
        *,
        clock=time.time,
        bootstrap_ttl_seconds: float = 300,
    ):
        if bootstrap_ttl_seconds <= 0:
            raise ValueError("Bootstrap authorization TTL must be positive.")
        self.database = Path(database)
        self.safety_controller = safety_controller
        self.clock = clock
        self.bootstrap_ttl_seconds = bootstrap_ttl_seconds
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_operations(
                    operation_id TEXT PRIMARY KEY, operation_type TEXT NOT NULL,
                    state TEXT NOT NULL, install_root TEXT NOT NULL, service_name TEXT NOT NULL,
                    service_sid TEXT NOT NULL, catalog_id TEXT NOT NULL,
                    catalog_version INTEGER NOT NULL, catalog_digest TEXT NOT NULL,
                    runtime_build_digest TEXT NOT NULL,
                    installation_metadata_digest TEXT NOT NULL,
                    staged_artifact_set_digest TEXT, error_code TEXT,
                    prior_service_registered INTEGER NOT NULL DEFAULT 0,
                    prior_service_start_type TEXT,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS runtime_windows_installer_one_active_root
                ON runtime_windows_installer_operations(install_root)
                WHERE state IN ('safe_disabled','artifacts_staged','package_verified',
                                'service_registered','rolling_back','rollback_failed');
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    operation_id TEXT NOT NULL, event TEXT NOT NULL,
                    detail TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_events_no_update
                BEFORE UPDATE ON runtime_windows_installer_events
                BEGIN SELECT RAISE(ABORT, 'installer events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_events_no_delete
                BEFORE DELETE ON runtime_windows_installer_events
                BEGIN SELECT RAISE(ABORT, 'installer events are append-only'); END;
                CREATE TABLE IF NOT EXISTS runtime_windows_bootstrap_authorizations(
                    authorization_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
                    token_digest TEXT NOT NULL UNIQUE, catalog_digest TEXT NOT NULL,
                    installation_metadata_digest TEXT NOT NULL, service_name TEXT NOT NULL,
                    status TEXT NOT NULL, issued_at REAL NOT NULL, expires_at REAL NOT NULL,
                    consumed_at REAL
                );
            """)
            columns = {
                str(row[1]) for row in connection.execute(
                    "PRAGMA table_info(runtime_windows_installer_operations)",
                ).fetchall()
            }
            if "prior_service_registered" not in columns:
                connection.execute(
                    "ALTER TABLE runtime_windows_installer_operations "
                    "ADD COLUMN prior_service_registered INTEGER NOT NULL DEFAULT 0",
                )
            if "prior_service_start_type" not in columns:
                connection.execute(
                    "ALTER TABLE runtime_windows_installer_operations "
                    "ADD COLUMN prior_service_start_type TEXT",
                )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _token_digest(token: str) -> str:
        return "sha256:" + hashlib.sha256(token.encode("ascii")).hexdigest()

    @staticmethod
    def _safe(evidence: WindowsInstallerServiceSafetyEvidence, service_name: str) -> None:
        if (
            not isinstance(evidence, WindowsInstallerServiceSafetyEvidence)
            or evidence.service_name != service_name or not evidence.disabled
            or not evidence.stopped or evidence.process_count != 0
            or (
                evidence.registered
                and evidence.previous_start_type not in {"automatic", "manual", "disabled"}
            )
            or (not evidence.registered and evidence.previous_start_type is not None)
        ):
            raise WindowsInstallerJournalError(
                "windows_installer_service_not_safe",
                "Installer operation requires a disabled, stopped service with no process.",
            )

    @staticmethod
    def _from_row(row: sqlite3.Row) -> WindowsInstallerOperation:
        return WindowsInstallerOperation(
            operation_id=str(row["operation_id"]), operation_type=str(row["operation_type"]),
            state=str(row["state"]), install_root=str(row["install_root"]),
            service_name=str(row["service_name"]), service_sid=str(row["service_sid"]),
            catalog_id=str(row["catalog_id"]), catalog_version=int(row["catalog_version"]),
            catalog_digest=str(row["catalog_digest"]),
            runtime_build_digest=str(row["runtime_build_digest"]),
            installation_metadata_digest=str(row["installation_metadata_digest"]),
            staged_artifact_set_digest=row["staged_artifact_set_digest"],
            error_code=row["error_code"],
            prior_service_registered=bool(row["prior_service_registered"]),
            prior_service_start_type=row["prior_service_start_type"],
            created_at=float(row["created_at"]),
            updated_at=float(row["updated_at"]),
        )

    def get(self, operation_id: str) -> WindowsInstallerOperation:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_operations WHERE operation_id=?",
                (operation_id,),
            ).fetchone()
        if row is None:
            raise WindowsInstallerJournalError(
                "windows_installer_operation_missing", "Installer operation does not exist.",
            )
        return self._from_row(row)

    @staticmethod
    def _event(
        connection: sqlite3.Connection,
        operation_id: str,
        event: str,
        detail: str,
        now: float,
    ) -> None:
        connection.execute(
            "INSERT INTO runtime_windows_installer_events(operation_id,event,detail,created_at) "
            "VALUES(?,?,?,?)", (operation_id, event, detail, now),
        )

    def begin(
        self,
        operation_type: str,
        catalog: VerifiedWindowsSecurityPackageCatalog,
    ) -> WindowsInstallerOperation:
        if operation_type not in self._OPERATION_TYPES:
            raise WindowsInstallerJournalError(
                "windows_installer_operation_type_invalid", "Installer operation type is invalid.",
            )
        if not isinstance(catalog, VerifiedWindowsSecurityPackageCatalog):
            raise TypeError("A verified Windows package catalog is required.")
        evidence = self.safety_controller.ensure_disabled_and_stopped(catalog.service_name)
        self._safe(evidence, catalog.service_name)
        operation_id, now = f"windows-installer-{uuid.uuid4()}", float(self.clock())
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "INSERT INTO runtime_windows_installer_operations("
                    "operation_id,operation_type,state,install_root,service_name,service_sid,"
                    "catalog_id,catalog_version,catalog_digest,runtime_build_digest,"
                    "installation_metadata_digest,staged_artifact_set_digest,error_code,"
                    "prior_service_registered,prior_service_start_type,created_at,updated_at) "
                    "VALUES(?,?,'safe_disabled',?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?)",
                    (operation_id, operation_type, str(catalog.install_root), catalog.service_name,
                     catalog.service_sid, catalog.catalog_id, catalog.version, catalog.digest,
                     catalog.runtime_build_digest, catalog.installation_metadata_digest,
                     int(evidence.registered), evidence.previous_start_type, now, now),
                )
                revoked = connection.execute(
                    "UPDATE runtime_windows_bootstrap_authorizations SET status='revoked' "
                    "WHERE status IN ('issued','consumed','activated') AND operation_id IN "
                    "(SELECT operation_id FROM runtime_windows_installer_operations "
                    "WHERE install_root=? AND operation_id!=?)",
                    (str(catalog.install_root), operation_id),
                ).rowcount
                self._event(
                    connection, operation_id, "installer.safe_disabled",
                    f"operation_type={operation_type}", now,
                )
                self.journal.append_in_transaction(
                    connection, "windows_installer.operation_started", operation_id,
                    {"operation_type": operation_type, "catalog_digest": catalog.digest}, now=now,
                )
                if revoked:
                    self.journal.append_in_transaction(
                        connection, "windows_installer.bootstrap_authorizations_revoked",
                        operation_id, {"revoked_count": revoked, "reason": "new_operation"}, now=now,
                    )
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise WindowsInstallerJournalError(
                "windows_installer_operation_conflict",
                "Another installer operation is active for this installation.",
            ) from error
        return self.get(operation_id)

    def _transition(
        self,
        operation_id: str,
        target: str,
        *,
        detail: str,
        staged_digest: str | None = None,
        error_code: str | None = None,
    ) -> WindowsInstallerOperation:
        now = float(self.clock())
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_operations WHERE operation_id=?",
                (operation_id,),
            ).fetchone()
            if row is None:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_operation_missing", "Installer operation does not exist.",
                )
            current = str(row["state"])
            if target not in self._TRANSITIONS.get(current, frozenset()):
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_transition_invalid", "Installer state transition is invalid.",
                )
            connection.execute(
                "UPDATE runtime_windows_installer_operations SET state=?,"
                "staged_artifact_set_digest=COALESCE(?,staged_artifact_set_digest),"
                "error_code=?,updated_at=? WHERE operation_id=? AND state=?",
                (target, staged_digest, error_code, now, operation_id, current),
            )
            self._event(connection, operation_id, f"installer.{target}", detail, now)
            self.journal.append_in_transaction(
                connection, f"windows_installer.{target}", operation_id,
                {"catalog_digest": str(row["catalog_digest"]), "detail_code": detail}, now=now,
            )
            connection.commit()
        return self.get(operation_id)

    def mark_artifacts_staged(
        self, operation_id: str, artifact_set_digest: str,
    ) -> WindowsInstallerOperation:
        if not self._DIGEST.fullmatch(artifact_set_digest):
            raise WindowsInstallerJournalError(
                "windows_installer_artifact_digest_invalid", "Staged artifact digest is invalid.",
            )
        operation = self.get(operation_id)
        self._safe(
            self.safety_controller.ensure_disabled_and_stopped(operation.service_name),
            operation.service_name,
        )
        return self._transition(
            operation_id, "artifacts_staged", detail="artifact_set_staged",
            staged_digest=artifact_set_digest,
        )

    @staticmethod
    def _identities_match(
        operation: WindowsInstallerOperation,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> bool:
        return (
            operation.catalog_id == catalog.catalog_id
            and operation.catalog_version == catalog.version
            and operation.catalog_digest == catalog.digest
            and operation.runtime_build_digest == catalog.runtime_build_digest
            and operation.installation_metadata_digest == installation.metadata_digest
            and operation.install_root == str(installation.install_root) == str(catalog.install_root)
            and operation.service_name == installation.service_name == catalog.service_name
            and operation.service_sid == installation.service_sid == catalog.service_sid
        )

    @staticmethod
    def _installer_safe_installation(
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> bool:
        service = installation.service_configuration
        return (
            installation.service_configuration_phase == "installer_safe"
            and isinstance(service.service_name, str)
            and isinstance(service.service_sid, str)
            and isinstance(service.start_account, str)
            and service.service_name == catalog.service_name
            and service.service_sid == catalog.service_sid
            and service.start_account.casefold() == catalog.service_start_account.casefold()
            and service.start_type == "disabled"
            and service.service_type == "own_process"
            and service.sid_type == catalog.service_sid_type
            and service.delayed_auto_start == catalog.service_delayed_auto_start
        )

    def mark_package_verified(
        self,
        operation_id: str,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsInstallerOperation:
        if (
            not isinstance(catalog, VerifiedWindowsSecurityPackageCatalog)
            or not isinstance(installation, VerifiedWindowsSecurityInstallation)
            or not self._identities_match(self.get(operation_id), catalog, installation)
            or not self._installer_safe_installation(catalog, installation)
        ):
            raise WindowsInstallerJournalError(
                "windows_installer_verified_identity_mismatch",
                "Verified package identity differs from the installer operation.",
            )
        operation = self.get(operation_id)
        self._safe(
            self.safety_controller.ensure_disabled_and_stopped(operation.service_name),
            operation.service_name,
        )
        return self._transition(operation_id, "package_verified", detail="package_verified")

    def mark_service_registered(
        self, operation_id: str, evidence: WindowsInstallerServiceSafetyEvidence,
    ) -> WindowsInstallerOperation:
        operation = self.get(operation_id)
        self._safe(evidence, operation.service_name)
        if not evidence.registered:
            raise WindowsInstallerJournalError(
                "windows_installer_service_not_registered", "Service registration is not present.",
            )
        current = self.safety_controller.ensure_disabled_and_stopped(operation.service_name)
        self._safe(current, operation.service_name)
        if not current.registered:
            raise WindowsInstallerJournalError(
                "windows_installer_service_not_registered", "Service registration disappeared.",
            )
        return self._transition(operation_id, "service_registered", detail="service_registered_disabled")

    def commit(
        self,
        operation_id: str,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsInstallerOperation:
        operation = self.get(operation_id)
        if (
            not self._identities_match(operation, catalog, installation)
            or not self._installer_safe_installation(catalog, installation)
        ):
            raise WindowsInstallerJournalError(
                "windows_installer_verified_identity_mismatch", "Commit identity differs from verified package.",
            )
        self._safe(
            self.safety_controller.ensure_disabled_and_stopped(operation.service_name),
            operation.service_name,
        )
        return self._transition(operation_id, "committed", detail="verified_commit")

    def issue_bootstrap_authorization(
        self,
        operation_id: str,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsServiceBootstrapAuthorization:
        authorization = self.prepare_bootstrap_authorization(
            operation_id, catalog, installation,
        )
        return self.record_bootstrap_authorization(authorization, catalog, installation)

    def prepare_bootstrap_authorization(
        self,
        operation_id: str,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsServiceBootstrapAuthorization:
        """Create recoverable authority material without making it consumable yet."""
        operation = self.get(operation_id)
        if (
            operation.state != "committed"
            or not self._identities_match(operation, catalog, installation)
            or not self._installer_safe_installation(catalog, installation)
        ):
            raise WindowsInstallerJournalError(
                "windows_installer_bootstrap_not_authorized",
                "Only the exact committed installation can receive bootstrap authority.",
            )
        self._safe(
            self.safety_controller.ensure_disabled_and_stopped(operation.service_name),
            operation.service_name,
        )
        token = secrets.token_urlsafe(32)
        authorization_id = f"windows-bootstrap-{uuid.uuid4()}"
        now = float(self.clock())
        expires_at = now + self.bootstrap_ttl_seconds
        return WindowsServiceBootstrapAuthorization(
            authorization_id, operation_id, token, catalog.digest,
            installation.metadata_digest, operation.service_name, expires_at,
        )

    def record_bootstrap_authorization(
        self,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsServiceBootstrapAuthorization:
        """Make an already protected/published authorization consumable durably."""
        if not isinstance(authorization, WindowsServiceBootstrapAuthorization):
            raise TypeError("A bootstrap authorization is required.")
        operation = self.get(authorization.operation_id)
        now = float(self.clock())
        valid = (
            operation.state == "committed"
            and self._identities_match(operation, catalog, installation)
            and self._installer_safe_installation(catalog, installation)
            and authorization.catalog_digest == catalog.digest
            and authorization.installation_metadata_digest == installation.metadata_digest
            and authorization.service_name == operation.service_name
            and isinstance(authorization.token, str) and len(authorization.token) >= 32
            and authorization.authorization_id.startswith("windows-bootstrap-")
            and authorization.expires_at > now
            and authorization.expires_at <= now + self.bootstrap_ttl_seconds
        )
        if not valid:
            raise WindowsInstallerJournalError(
                "windows_installer_bootstrap_not_authorized",
                "Bootstrap authority material is invalid or not bound to the committed installation.",
            )
        self._safe(
            self.safety_controller.ensure_disabled_and_stopped(operation.service_name),
            operation.service_name,
        )
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                latest = connection.execute(
                    "SELECT operation_id FROM runtime_windows_installer_operations "
                    "WHERE install_root=? ORDER BY rowid DESC LIMIT 1",
                    (operation.install_root,),
                ).fetchone()
                if latest is None or str(latest["operation_id"]) != authorization.operation_id:
                    connection.rollback()
                    raise WindowsInstallerJournalError(
                        "windows_installer_bootstrap_superseded",
                        "A newer installer operation superseded bootstrap authority.",
                    )
                connection.execute(
                    "INSERT INTO runtime_windows_bootstrap_authorizations VALUES"
                    "(?,?,?,?,?,?,'issued',?,?,NULL)",
                    (authorization.authorization_id, authorization.operation_id,
                     self._token_digest(authorization.token), catalog.digest,
                     installation.metadata_digest, operation.service_name, now,
                     authorization.expires_at),
                )
                self._event(
                    connection, authorization.operation_id,
                    "installer.bootstrap_authorization_issued",
                    authorization.authorization_id, now,
                )
                self.journal.append_in_transaction(
                    connection, "windows_installer.bootstrap_authorization_issued",
                    authorization.operation_id,
                    {"authorization_id": authorization.authorization_id,
                     "expires_at": authorization.expires_at}, now=now,
                )
                connection.commit()
        except sqlite3.IntegrityError as error:
            raise WindowsInstallerJournalError(
                "windows_installer_bootstrap_already_issued",
                "Committed operation already issued bootstrap authority.",
            ) from error
        return authorization

    def bootstrap_authorization_status_by_identity(
        self, operation_id: str, authorization_id: str,
    ) -> str | None:
        """Privileged recovery lookup; reveals no token and accepts no product identity."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT status FROM runtime_windows_bootstrap_authorizations "
                "WHERE operation_id=? AND authorization_id=?",
                (operation_id, authorization_id),
            ).fetchone()
        return str(row["status"]) if row is not None else None

    def consume_bootstrap_authorization(
        self,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> ConsumedWindowsServiceBootstrapReceipt:
        if not isinstance(authorization, WindowsServiceBootstrapAuthorization):
            raise TypeError("A bootstrap authorization is required.")
        now = float(self.clock())
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM runtime_windows_bootstrap_authorizations WHERE authorization_id=?",
                (authorization.authorization_id,),
            ).fetchone()
            operation = self.get(authorization.operation_id)
            valid = (
                row is not None and row["status"] == "issued" and float(row["expires_at"]) > now
                and secrets.compare_digest(str(row["token_digest"]), self._token_digest(authorization.token))
                and str(row["catalog_digest"]) == catalog.digest == authorization.catalog_digest
                and str(row["installation_metadata_digest"]) == installation.metadata_digest
                == authorization.installation_metadata_digest
                and str(row["service_name"]) == authorization.service_name
                and self._identities_match(operation, catalog, installation)
            )
            if not valid:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_bootstrap_invalid", "Bootstrap authority is invalid or expired.",
                )
            updated = connection.execute(
                "UPDATE runtime_windows_bootstrap_authorizations SET status='consumed',consumed_at=? "
                "WHERE authorization_id=? AND status='issued'",
                (now, authorization.authorization_id),
            ).rowcount
            if updated != 1:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_bootstrap_invalid", "Bootstrap authority was already consumed.",
                )
            self._event(
                connection, operation.operation_id, "installer.bootstrap_authorization_consumed",
                authorization.authorization_id, now,
            )
            self.journal.append_in_transaction(
                connection, "windows_installer.bootstrap_authorization_consumed",
                operation.operation_id, {"authorization_id": authorization.authorization_id}, now=now,
            )
            connection.commit()
        return ConsumedWindowsServiceBootstrapReceipt(
            authorization.authorization_id, operation.operation_id, catalog.digest,
            installation.metadata_digest, operation.runtime_build_digest,
            operation.install_root, operation.service_name, operation.service_sid,
            now, float(row["expires_at"]),
        )

    def bootstrap_authorization_status(
        self,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> str | None:
        """Return status only when the secret and every installation identity match."""
        if not isinstance(authorization, WindowsServiceBootstrapAuthorization):
            return None
        with self._connect() as connection:
            row = connection.execute(
                "SELECT a.*,o.install_root,o.service_sid,o.runtime_build_digest "
                "FROM runtime_windows_bootstrap_authorizations a "
                "JOIN runtime_windows_installer_operations o ON o.operation_id=a.operation_id "
                "WHERE a.authorization_id=? AND a.operation_id=?",
                (authorization.authorization_id, authorization.operation_id),
            ).fetchone()
            latest = None
            if row is not None:
                latest = connection.execute(
                    "SELECT operation_id FROM runtime_windows_installer_operations "
                    "WHERE install_root=? ORDER BY rowid DESC LIMIT 1",
                    (str(row["install_root"]),),
                ).fetchone()
        valid = (
            row is not None and latest is not None
            and str(latest["operation_id"]) == authorization.operation_id
            and secrets.compare_digest(
                str(row["token_digest"]), self._token_digest(authorization.token),
            )
            and str(row["catalog_digest"]) == catalog.digest == authorization.catalog_digest
            and str(row["installation_metadata_digest"]) == installation.metadata_digest
            == authorization.installation_metadata_digest
            and str(row["service_name"]) == authorization.service_name
            and float(row["expires_at"]) == authorization.expires_at
            and str(row["install_root"]) == str(catalog.install_root)
            == str(installation.install_root)
            and str(row["service_sid"]) == catalog.service_sid == installation.service_sid
            and str(row["runtime_build_digest"]) == catalog.runtime_build_digest
        )
        return str(row["status"]) if valid else None

    @classmethod
    def claim_bootstrap_for_runtime(
        cls,
        database: Path,
        receipt: ConsumedWindowsServiceBootstrapReceipt,
        *,
        clock=time.time,
    ) -> None:
        if not isinstance(receipt, ConsumedWindowsServiceBootstrapReceipt):
            raise TypeError("A consumed Windows service bootstrap receipt is required.")
        now = float(clock())
        journal = SecurityEventJournal(Path(database))
        connection = sqlite3.connect(
            Path(database), timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        with connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT a.*,o.state,o.catalog_digest AS operation_catalog_digest,"
                "o.installation_metadata_digest AS operation_metadata_digest,"
                "o.runtime_build_digest,o.install_root,o.service_sid,o.created_at "
                "FROM runtime_windows_bootstrap_authorizations a "
                "JOIN runtime_windows_installer_operations o ON o.operation_id=a.operation_id "
                "WHERE a.authorization_id=? AND a.operation_id=?",
                (receipt.authorization_id, receipt.operation_id),
            ).fetchone()
            latest = None
            if row is not None:
                latest = connection.execute(
                    "SELECT operation_id FROM runtime_windows_installer_operations "
                    "WHERE install_root=? ORDER BY rowid DESC LIMIT 1",
                    (str(row["install_root"]),),
                ).fetchone()
            valid = (
                row is not None and row["status"] == "consumed" and row["state"] == "committed"
                and float(row["expires_at"]) > now
                and latest is not None and str(latest["operation_id"]) == receipt.operation_id
                and str(row["catalog_digest"]) == str(row["operation_catalog_digest"])
                == receipt.catalog_digest
                and str(row["installation_metadata_digest"])
                == str(row["operation_metadata_digest"]) == receipt.installation_metadata_digest
                and str(row["runtime_build_digest"]) == receipt.runtime_build_digest
                and str(row["install_root"]) == receipt.install_root
                and str(row["service_name"]) == receipt.service_name
                and str(row["service_sid"]) == receipt.service_sid
                and float(row["consumed_at"]) == receipt.consumed_at
                and float(row["expires_at"]) == receipt.expires_at
            )
            if not valid:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_bootstrap_receipt_invalid",
                    "Consumed bootstrap receipt is stale, forged, expired, or superseded.",
                )
            updated = connection.execute(
                "UPDATE runtime_windows_bootstrap_authorizations SET status='activated' "
                "WHERE authorization_id=? AND status='consumed'",
                (receipt.authorization_id,),
            ).rowcount
            if updated != 1:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_bootstrap_receipt_invalid",
                    "Consumed bootstrap receipt was already claimed.",
                )
            journal.append_in_transaction(
                connection, "windows_installer.bootstrap_runtime_claimed", receipt.operation_id,
                {"authorization_id": receipt.authorization_id,
                 "catalog_digest": receipt.catalog_digest}, now=now,
            )
            connection.commit()

    def rollback(
        self,
        operation_id: str,
        rollback_handler: Callable[[WindowsInstallerOperation], None],
        *,
        reason: str,
    ) -> WindowsInstallerOperation:
        if not self._REASON.fullmatch(reason):
            raise WindowsInstallerJournalError(
                "windows_installer_reason_invalid", "Rollback reason must be a low-cardinality code.",
            )
        operation = self.get(operation_id)
        self._safe(
            self.safety_controller.ensure_disabled_and_stopped(operation.service_name),
            operation.service_name,
        )
        now = float(self.clock())
        with self._connect() as connection:
            # Keep the SQLite writer lock across the privileged rollback callback.
            # A process crash releases the transaction and leaves the prior stage
            # retryable; callbacks therefore must be idempotent.  A second Runtime
            # cannot execute the callback concurrently for the same operation.
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_operations WHERE operation_id=?",
                (operation_id,),
            ).fetchone()
            if row is None:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_operation_missing", "Installer operation does not exist.",
                )
            current = str(row["state"])
            if current not in self._INCOMPLETE:
                connection.rollback()
                raise WindowsInstallerJournalError(
                    "windows_installer_transition_invalid", "Terminal installer operation cannot roll back.",
                )
            connection.execute(
                "UPDATE runtime_windows_installer_operations SET state='rolling_back',"
                "error_code=NULL,updated_at=? WHERE operation_id=?",
                (now, operation_id),
            )
            self._event(connection, operation_id, "installer.rolling_back", reason, now)
            self.journal.append_in_transaction(
                connection, "windows_installer.rolling_back", operation_id,
                {"catalog_digest": str(row["catalog_digest"]), "detail_code": reason}, now=now,
            )
            rolling = replace(self._from_row(row), state="rolling_back", updated_at=now)
            try:
                handler_owner = getattr(rollback_handler, "__self__", None)
                transactional_handler = getattr(
                    handler_owner, "rollback_in_transaction", None,
                )
                if (
                    getattr(rollback_handler, "__name__", "") == "rollback"
                    and callable(transactional_handler)
                ):
                    transactional_handler(connection, rolling)
                else:
                    rollback_handler(rolling)
            except BaseException as error:
                terminal, error_code, detail = "rollback_failed", type(error).__name__, "rollback_failed"
            else:
                terminal, error_code, detail = "rolled_back", None, "rollback_complete"
            finished_at = float(self.clock())
            connection.execute(
                "UPDATE runtime_windows_installer_operations SET state=?,error_code=?,updated_at=? "
                "WHERE operation_id=? AND state='rolling_back'",
                (terminal, error_code, finished_at, operation_id),
            )
            self._event(connection, operation_id, f"installer.{terminal}", detail, finished_at)
            self.journal.append_in_transaction(
                connection, f"windows_installer.{terminal}", operation_id,
                {"catalog_digest": str(row["catalog_digest"]), "detail_code": detail},
                now=finished_at,
            )
            connection.commit()
        return self.get(operation_id)

    def recover_incomplete(
        self,
        rollback_handler: Callable[[WindowsInstallerOperation], None],
    ) -> list[WindowsInstallerOperation]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT operation_id FROM runtime_windows_installer_operations "
                "WHERE state IN ('safe_disabled','artifacts_staged','package_verified',"
                "'service_registered','rolling_back','rollback_failed') ORDER BY created_at,operation_id",
            ).fetchall()
        return [
            self.rollback(str(row["operation_id"]), rollback_handler, reason="startup_recovery")
            for row in rows
        ]
