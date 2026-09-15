"""Durable, ownership-marked Windows service registration and restoration."""

from __future__ import annotations

import ctypes
import hashlib
import json
import os
import sqlite3
import time
from ctypes import wintypes
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Protocol

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityEventJournal
from .windows_installation_verifier import (
    NativeWindowsServiceConfigurationApi,
    WindowsInstallationVerificationError,
    WindowsServiceConfigurationEvidence,
)
from .windows_installer_journal import (
    NativeWindowsInstallerSafetyController,
    WindowsInstallerJournalError,
    WindowsInstallerOperation,
    WindowsInstallerOperationJournal,
)
from .windows_package_catalog import VerifiedWindowsSecurityPackageCatalog


class WindowsInstallerScmActionError(WindowsInstallerJournalError):
    pass


@dataclass(frozen=True)
class WindowsInstallerScmConfiguration:
    service_name: str
    service_sid: str
    binary_path: str
    start_account: str
    start_type: str
    service_type: str
    sid_type: str
    delayed_auto_start: bool
    description: str


@dataclass(frozen=True)
class WindowsInstallerScmAction:
    action_id: str
    operation_id: str
    state: str
    service_name: str
    ownership_marker: str
    prior_registered: bool
    snapshot_digest: str
    snapshot: WindowsInstallerScmConfiguration | None
    desired_digest: str
    desired: WindowsInstallerScmConfiguration
    error_code: str | None
    created_at: float
    updated_at: float


class WindowsInstallerScmApi(Protocol):
    def inspect_optional(self, service_name: str) -> WindowsInstallerScmConfiguration | None: ...
    def register_disabled(
        self,
        desired: WindowsInstallerScmConfiguration,
        ownership_marker: str,
        *,
        create: bool,
    ) -> WindowsInstallerScmConfiguration: ...
    def restore(
        self,
        snapshot: WindowsInstallerScmConfiguration,
        ownership_marker: str,
    ) -> WindowsInstallerScmConfiguration: ...
    def delete_owned(self, service_name: str, ownership_marker: str) -> bool: ...
    def fail_safe_disable_and_stop(self, service_name: str) -> None: ...


class NativeWindowsInstallerScmApi:
    """SCM Create/Change/Delete surface with an operation-specific description marker."""

    _SC_MANAGER_CONNECT = 0x0001
    _SC_MANAGER_CREATE_SERVICE = 0x0002
    _SERVICE_QUERY_CONFIG = 0x0001
    _SERVICE_CHANGE_CONFIG = 0x0002
    _SERVICE_QUERY_STATUS = 0x0004
    _SERVICE_STOP = 0x0020
    _DELETE = 0x00010000
    _SERVICE_ALL_REQUIRED = (
        _SERVICE_QUERY_CONFIG | _SERVICE_CHANGE_CONFIG | _SERVICE_QUERY_STATUS
        | _SERVICE_STOP | _DELETE
    )
    _SERVICE_WIN32_OWN_PROCESS = 0x10
    _SERVICE_ERROR_NORMAL = 1
    _SERVICE_DISABLED = 4
    _SERVICE_NO_CHANGE = 0xFFFFFFFF
    _SERVICE_CONFIG_DESCRIPTION = 1
    _SERVICE_CONFIG_DELAYED_AUTO_START_INFO = 3
    _SERVICE_CONFIG_SERVICE_SID_INFO = 5
    _SID_TYPES = {"none": 0, "unrestricted": 1, "restricted": 3}
    _START_TYPES = {"automatic": 2, "manual": 3, "disabled": 4}
    _ERROR_SERVICE_DOES_NOT_EXIST = 1060
    _ERROR_SERVICE_MARKED_FOR_DELETE = 1072
    _ERROR_INSUFFICIENT_BUFFER = 122

    class _ServiceDescription(ctypes.Structure):
        _fields_ = [("lpDescription", wintypes.LPWSTR)]

    class _ServiceSidInfo(ctypes.Structure):
        _fields_ = [("dwServiceSidType", wintypes.DWORD)]

    class _DelayedAutoStartInfo(ctypes.Structure):
        _fields_ = [("fDelayedAutostart", wintypes.BOOL)]

    def __init__(self, *, delete_timeout_seconds: float = 30):
        if os.name != "nt":
            raise WindowsInstallerScmActionError(
                "windows_installer_scm_action_unsupported", "SCM actions require Windows.",
            )
        if delete_timeout_seconds <= 0:
            raise ValueError("SCM delete timeout must be positive.")
        self.delete_timeout_seconds = delete_timeout_seconds
        self.advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        self.advapi.OpenSCManagerW.argtypes = [
            wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ]
        self.advapi.OpenSCManagerW.restype = wintypes.HANDLE
        self.advapi.OpenServiceW.argtypes = [
            wintypes.HANDLE, wintypes.LPCWSTR, wintypes.DWORD,
        ]
        self.advapi.OpenServiceW.restype = wintypes.HANDLE
        self.advapi.CreateServiceW.argtypes = [
            wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
            wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.LPCWSTR,
            wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD), wintypes.LPCWSTR,
            wintypes.LPCWSTR, wintypes.LPCWSTR,
        ]
        self.advapi.CreateServiceW.restype = wintypes.HANDLE
        self.advapi.ChangeServiceConfigW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD),
            wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
        ]
        self.advapi.ChangeServiceConfigW.restype = wintypes.BOOL
        self.advapi.ChangeServiceConfig2W.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p,
        ]
        self.advapi.ChangeServiceConfig2W.restype = wintypes.BOOL
        self.advapi.QueryServiceConfig2W.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi.QueryServiceConfig2W.restype = wintypes.BOOL
        self.advapi.DeleteService.argtypes = [wintypes.HANDLE]
        self.advapi.DeleteService.restype = wintypes.BOOL
        self.advapi.CloseServiceHandle.argtypes = [wintypes.HANDLE]
        self.advapi.CloseServiceHandle.restype = wintypes.BOOL
        self.configuration = NativeWindowsServiceConfigurationApi()
        self.safety = NativeWindowsInstallerSafetyController()

    def _manager(self, access: int):
        manager = self.advapi.OpenSCManagerW(None, None, access)
        if not manager:
            raise WindowsInstallerScmActionError(
                "windows_installer_scm_unavailable", "Service Control Manager is unavailable.",
            )
        return manager

    def _open_optional(self, manager, service_name: str, access: int):
        ctypes.set_last_error(0)
        service = self.advapi.OpenServiceW(manager, service_name, access)
        if not service and ctypes.get_last_error() != self._ERROR_SERVICE_DOES_NOT_EXIST:
            raise WindowsInstallerScmActionError(
                "windows_installer_service_unavailable", "Pinned service cannot be opened.",
            )
        return service

    def _description(self, service) -> str:
        needed = wintypes.DWORD()
        ctypes.set_last_error(0)
        self.advapi.QueryServiceConfig2W(
            service, self._SERVICE_CONFIG_DESCRIPTION, None, 0, ctypes.byref(needed),
        )
        if needed.value == 0:
            if ctypes.get_last_error() == self._ERROR_INSUFFICIENT_BUFFER:
                return ""
            raise WindowsInstallerScmActionError(
                "windows_installer_service_description_unreadable",
                "Service ownership marker size is unreadable.",
            )
        buffer = ctypes.create_string_buffer(needed.value)
        if not self.advapi.QueryServiceConfig2W(
            service, self._SERVICE_CONFIG_DESCRIPTION, buffer, needed.value,
            ctypes.byref(needed),
        ):
            raise WindowsInstallerScmActionError(
                "windows_installer_service_description_unreadable",
                "Service ownership marker is unreadable.",
            )
        value = ctypes.cast(buffer, ctypes.POINTER(self._ServiceDescription)).contents
        return str(value.lpDescription or "")

    @staticmethod
    def _from_evidence(
        evidence: WindowsServiceConfigurationEvidence,
        description: str,
    ) -> WindowsInstallerScmConfiguration:
        return WindowsInstallerScmConfiguration(
            evidence.service_name, evidence.service_sid, evidence.binary_path,
            evidence.start_account, evidence.start_type, evidence.service_type,
            evidence.sid_type, evidence.delayed_auto_start, description,
        )

    def inspect_optional(self, service_name: str) -> WindowsInstallerScmConfiguration | None:
        manager = self._manager(self._SC_MANAGER_CONNECT)
        service = None
        try:
            service = self._open_optional(manager, service_name, self._SERVICE_QUERY_CONFIG)
            if not service:
                return None
            evidence = self.configuration.inspect(service_name)
            return self._from_evidence(evidence, self._description(service))
        finally:
            if service:
                self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)

    @staticmethod
    def _binary_path(path: str) -> str:
        normalized = path.strip()
        if normalized.startswith('"'):
            if not normalized.endswith('"') or '"' in normalized[1:-1]:
                normalized = ""
            else:
                normalized = normalized[1:-1]
        value = Path(normalized)
        if not normalized or not value.is_absolute() or '"' in normalized or "%" in normalized:
            raise WindowsInstallerScmActionError(
                "windows_installer_service_binary_invalid",
                "Service binary must be one absolute non-expanded path.",
            )
        return f'"{value}"' if any(character.isspace() for character in normalized) else normalized

    def _set_extended(
        self, service, desired: WindowsInstallerScmConfiguration, marker: str,
    ) -> None:
        description = self._ServiceDescription(ctypes.c_wchar_p(marker))
        sid = self._ServiceSidInfo(self._SID_TYPES[desired.sid_type])
        delayed = self._DelayedAutoStartInfo(bool(desired.delayed_auto_start))
        for level, value in (
            (self._SERVICE_CONFIG_DESCRIPTION, description),
            (self._SERVICE_CONFIG_SERVICE_SID_INFO, sid),
            (self._SERVICE_CONFIG_DELAYED_AUTO_START_INFO, delayed),
        ):
            if not self.advapi.ChangeServiceConfig2W(service, level, ctypes.byref(value)):
                raise WindowsInstallerScmActionError(
                    "windows_installer_service_extended_config_failed",
                    "Service SID, delayed-start, or ownership marker could not be configured.",
                )

    def register_disabled(
        self,
        desired: WindowsInstallerScmConfiguration,
        ownership_marker: str,
        *,
        create: bool,
    ) -> WindowsInstallerScmConfiguration:
        if (
            desired.start_account.casefold() != "localsystem"
            or desired.service_type != "own_process"
        ):
            raise WindowsInstallerScmActionError(
                "windows_installer_service_account_unsupported",
                "Installer service registration supports only LocalSystem own-process services.",
            )
        manager = self._manager(self._SC_MANAGER_CONNECT | self._SC_MANAGER_CREATE_SERVICE)
        service = None
        try:
            service = self._open_optional(
                manager, desired.service_name, self._SERVICE_ALL_REQUIRED,
            )
            if create:
                if service:
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_create_collision",
                        "A service appeared before owned creation.",
                    )
                service = self.advapi.CreateServiceW(
                    manager, desired.service_name, desired.service_name,
                    self._SERVICE_ALL_REQUIRED, self._SERVICE_WIN32_OWN_PROCESS,
                    self._SERVICE_DISABLED, self._SERVICE_ERROR_NORMAL,
                    self._binary_path(desired.binary_path), None, None, None, None, None,
                )
                if not service:
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_create_failed",
                        "Pinned service could not be created.",
                    )
            else:
                if not service:
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_disappeared", "Existing service disappeared.",
                    )
                if not self.advapi.ChangeServiceConfigW(
                    service, self._SERVICE_WIN32_OWN_PROCESS, self._SERVICE_DISABLED,
                    self._SERVICE_ERROR_NORMAL, self._binary_path(desired.binary_path),
                    None, None, None, None, None, desired.service_name,
                ):
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_register_failed",
                        "Existing service could not be configured for installation.",
                    )
            self._set_extended(service, desired, ownership_marker)
        finally:
            if service:
                self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)
        current = self.inspect_optional(desired.service_name)
        if current is None:
            raise WindowsInstallerScmActionError(
                "windows_installer_service_register_unproven", "Registered service disappeared.",
            )
        return current

    def restore(
        self,
        snapshot: WindowsInstallerScmConfiguration,
        ownership_marker: str,
    ) -> WindowsInstallerScmConfiguration:
        current = self.inspect_optional(snapshot.service_name)
        snapshot_disabled = replace(snapshot, start_type="disabled")
        if current is None or not (
            current.description == ownership_marker or current == snapshot_disabled
        ):
            raise WindowsInstallerScmActionError(
                "windows_installer_service_restore_not_owned",
                "Service no longer carries this operation ownership marker.",
            )
        manager = self._manager(self._SC_MANAGER_CONNECT)
        service = None
        try:
            service = self._open_optional(
                manager, snapshot.service_name, self._SERVICE_ALL_REQUIRED,
            )
            if not service or not self.advapi.ChangeServiceConfigW(
                service, self._SERVICE_WIN32_OWN_PROCESS,
                self._START_TYPES[snapshot.start_type], self._SERVICE_ERROR_NORMAL,
                self._binary_path(snapshot.binary_path), None, None, None, None, None,
                snapshot.service_name,
            ):
                raise WindowsInstallerScmActionError(
                    "windows_installer_service_restore_failed",
                    "Prior service configuration could not be restored.",
                )
            self._set_extended(service, snapshot, snapshot.description)
        finally:
            if service:
                self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)
        restored = self.inspect_optional(snapshot.service_name)
        if restored is None:
            raise WindowsInstallerScmActionError(
                "windows_installer_service_restore_unproven", "Restored service disappeared.",
            )
        return restored

    def delete_owned(self, service_name: str, ownership_marker: str) -> bool:
        current = self.inspect_optional(service_name)
        if current is None:
            return True
        if current.description != ownership_marker:
            raise WindowsInstallerScmActionError(
                "windows_installer_service_delete_not_owned",
                "Service deletion requires the exact operation ownership marker.",
            )
        manager = self._manager(self._SC_MANAGER_CONNECT)
        service = None
        try:
            service = self._open_optional(manager, service_name, self._DELETE)
            if service and not self.advapi.DeleteService(service):
                if ctypes.get_last_error() != self._ERROR_SERVICE_MARKED_FOR_DELETE:
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_delete_failed", "Owned service deletion failed.",
                    )
        finally:
            if service:
                self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)
        deadline = time.monotonic() + self.delete_timeout_seconds
        while time.monotonic() < deadline:
            if self.inspect_optional(service_name) is None:
                return True
            time.sleep(0.05)
        raise WindowsInstallerScmActionError(
            "windows_installer_service_delete_timeout", "Owned service deletion was not confirmed.",
        )

    def fail_safe_disable_and_stop(self, service_name: str) -> None:
        evidence = self.safety.ensure_disabled_and_stopped(service_name)
        if not evidence.disabled or not evidence.stopped or evidence.process_count != 0:
            raise WindowsInstallerScmActionError(
                "windows_installer_service_safe_state_unproven",
                "Service could not be proven disabled, stopped, and process-free.",
            )


class WindowsInstallerScmActionJournal:
    def __init__(
        self,
        database: Path,
        installer_journal: WindowsInstallerOperationJournal,
        api: WindowsInstallerScmApi | None = None,
        *,
        clock=time.time,
    ):
        self.database = Path(database)
        self.installer_journal = installer_journal
        self.api = api or NativeWindowsInstallerScmApi()
        self.clock = clock
        self.security_journal = SecurityEventJournal(self.database)
        with self._connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_scm_actions(
                    action_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL, service_name TEXT NOT NULL,
                    ownership_marker TEXT NOT NULL UNIQUE,
                    prior_registered INTEGER NOT NULL,
                    snapshot_digest TEXT NOT NULL, snapshot_json TEXT,
                    desired_digest TEXT NOT NULL, desired_json TEXT NOT NULL,
                    error_code TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS runtime_windows_installer_one_active_scm_service
                ON runtime_windows_installer_scm_actions(service_name)
                WHERE state IN (
                    'prepared','registering','registered','rolling_back','rollback_failed'
                );
                CREATE TABLE IF NOT EXISTS runtime_windows_installer_scm_events(
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    action_id TEXT NOT NULL, event TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_scm_events_no_update
                BEFORE UPDATE ON runtime_windows_installer_scm_events
                BEGIN SELECT RAISE(ABORT, 'installer SCM events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_scm_events_no_delete
                BEFORE DELETE ON runtime_windows_installer_scm_events
                BEGIN SELECT RAISE(ABORT, 'installer SCM events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_windows_installer_scm_identity_immutable
                BEFORE UPDATE ON runtime_windows_installer_scm_actions
                WHEN OLD.action_id!=NEW.action_id OR OLD.operation_id!=NEW.operation_id
                  OR OLD.service_name!=NEW.service_name
                  OR OLD.ownership_marker!=NEW.ownership_marker
                  OR OLD.prior_registered!=NEW.prior_registered
                  OR OLD.snapshot_digest!=NEW.snapshot_digest
                  OR COALESCE(OLD.snapshot_json,'')!=COALESCE(NEW.snapshot_json,'')
                  OR OLD.desired_digest!=NEW.desired_digest
                  OR OLD.desired_json!=NEW.desired_json
                BEGIN SELECT RAISE(ABORT, 'installer SCM identity is immutable'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _digest(value) -> str:
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return "sha256:" + hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _configuration(value: str | None) -> WindowsInstallerScmConfiguration | None:
        return WindowsInstallerScmConfiguration(**json.loads(value)) if value else None

    @classmethod
    def _from_row(cls, row: sqlite3.Row) -> WindowsInstallerScmAction:
        return WindowsInstallerScmAction(
            str(row["action_id"]), str(row["operation_id"]), str(row["state"]),
            str(row["service_name"]), str(row["ownership_marker"]),
            bool(row["prior_registered"]), str(row["snapshot_digest"]),
            cls._configuration(row["snapshot_json"]), str(row["desired_digest"]),
            cls._configuration(row["desired_json"]), row["error_code"],
            float(row["created_at"]), float(row["updated_at"]),
        )

    def get(self, action_id: str) -> WindowsInstallerScmAction:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_scm_actions WHERE action_id=?",
                (action_id,),
            ).fetchone()
        if row is None:
            raise WindowsInstallerScmActionError(
                "windows_installer_scm_action_missing", "Installer SCM action does not exist.",
            )
        action = self._from_row(row)
        self._validate(action)
        return action

    def get_for_operation(self, operation_id: str) -> WindowsInstallerScmAction | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runtime_windows_installer_scm_actions WHERE operation_id=?",
                (operation_id,),
            ).fetchone()
        if row is None:
            return None
        action = self._from_row(row)
        self._validate(action)
        return action

    def _validate(self, action: WindowsInstallerScmAction) -> None:
        snapshot_payload = asdict(action.snapshot) if action.snapshot else None
        desired_payload = asdict(action.desired) if action.desired else None
        expected_marker = f"OpenDrSai installer ownership/{action.operation_id}"
        if (
            action.snapshot_digest != self._digest(snapshot_payload)
            or action.desired is None
            or action.desired_digest != self._digest(desired_payload)
            or action.prior_registered != (action.snapshot is not None)
            or action.ownership_marker != expected_marker
            or action.service_name != action.desired.service_name
        ):
            raise WindowsInstallerScmActionError(
                "windows_installer_scm_action_identity_invalid",
                "Durable SCM action identity is corrupt or inconsistent.",
            )

    def _state(
        self,
        connection: sqlite3.Connection,
        action: WindowsInstallerScmAction,
        state: str,
        *,
        error_code: str | None = None,
    ) -> None:
        now = float(self.clock())
        connection.execute(
            "UPDATE runtime_windows_installer_scm_actions SET state=?,error_code=?,updated_at=? "
            "WHERE action_id=?", (state, error_code, now, action.action_id),
        )
        connection.execute(
            "INSERT INTO runtime_windows_installer_scm_events(action_id,event,created_at) "
            "VALUES(?,?,?)", (action.action_id, state, now),
        )
        self.security_journal.append_in_transaction(
            connection, f"windows_installer_scm.{state}", action.operation_id,
            {"action_id": action.action_id, "service_name": action.service_name}, now=now,
        )

    @staticmethod
    def _desired(
        catalog: VerifiedWindowsSecurityPackageCatalog,
        binary_path: Path,
    ) -> WindowsInstallerScmConfiguration:
        return WindowsInstallerScmConfiguration(
            catalog.service_name, catalog.service_sid, str(binary_path),
            catalog.service_start_account, "disabled", "own_process",
            catalog.service_sid_type, False, "",
        )

    def prepare(
        self,
        operation: WindowsInstallerOperation,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        binary_path: Path,
    ) -> WindowsInstallerScmAction:
        current_operation = self.installer_journal.get(operation.operation_id)
        binary = Path(binary_path).resolve(strict=True)
        if (
            current_operation != operation or operation.state != "artifacts_staged"
            or operation.service_name != catalog.service_name
            or operation.service_sid != catalog.service_sid
            or not binary.is_relative_to(Path(operation.install_root).resolve(strict=True))
        ):
            raise WindowsInstallerScmActionError(
                "windows_installer_scm_action_not_authorized",
                "SCM registration requires the promoted exact installer operation.",
            )
        observed = self.api.inspect_optional(operation.service_name)
        if operation.prior_service_registered:
            valid_observed = (
                observed is not None and operation.prior_service_start_type is not None
                and observed.service_name == catalog.service_name
                and observed.service_sid == catalog.service_sid
                and observed.start_account.casefold()
                == catalog.service_start_account.casefold()
                and observed.start_type == "disabled"
                and observed.service_type == "own_process"
                and observed.sid_type == catalog.service_sid_type
            )
            if not valid_observed:
                raise WindowsInstallerScmActionError(
                    "windows_installer_scm_snapshot_missing",
                    "Prior service snapshot is unavailable.",
                )
            snapshot = WindowsInstallerScmConfiguration(
                observed.service_name, observed.service_sid, observed.binary_path,
                observed.start_account, operation.prior_service_start_type,
                observed.service_type, observed.sid_type, observed.delayed_auto_start,
                observed.description,
            )
        else:
            if observed is not None:
                raise WindowsInstallerScmActionError(
                    "windows_installer_service_create_collision",
                    "An unowned service appeared after the missing-service snapshot.",
                )
            snapshot = None
        desired = self._desired(catalog, binary)
        action_id = f"windows-scm-{operation.operation_id.removeprefix('windows-installer-')}"
        marker = f"OpenDrSai installer ownership/{operation.operation_id}"
        snapshot_payload = asdict(snapshot) if snapshot else None
        desired_payload = asdict(desired)
        now = float(self.clock())
        with self._connect() as connection:
            try:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "INSERT INTO runtime_windows_installer_scm_actions VALUES"
                    "(?,?, 'prepared',?,?,?,?,?,?,?,?,?,?)",
                    (action_id, operation.operation_id, operation.service_name, marker,
                     int(snapshot is not None), self._digest(snapshot_payload),
                     json.dumps(snapshot_payload, sort_keys=True) if snapshot else None,
                     self._digest(desired_payload), json.dumps(desired_payload, sort_keys=True),
                     None, now, now),
                )
                row = connection.execute(
                    "SELECT * FROM runtime_windows_installer_scm_actions WHERE action_id=?",
                    (action_id,),
                ).fetchone()
                action = self._from_row(row)
                self._validate(action)
                self._state(connection, action, "prepared")
                connection.commit()
            except sqlite3.IntegrityError as error:
                connection.rollback()
                raise WindowsInstallerScmActionError(
                    "windows_installer_scm_action_conflict",
                    "Another SCM action is active for this service.",
                ) from error
        return self.get(action_id)

    @staticmethod
    def _matches(current, expected, *, marker: str) -> bool:
        return current == WindowsInstallerScmConfiguration(
            expected.service_name, expected.service_sid, expected.binary_path,
            expected.start_account, expected.start_type, expected.service_type,
            expected.sid_type, expected.delayed_auto_start, marker,
        )

    def register(self, action_id: str) -> WindowsInstallerScmAction:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            action = self.get(action_id)
            operation = self.installer_journal.get(action.operation_id)
            if (
                action.state not in {"prepared", "registering"}
                or operation.state != "artifacts_staged"
            ):
                connection.rollback()
                raise WindowsInstallerScmActionError(
                    "windows_installer_scm_register_not_authorized",
                    "SCM registration state or installer operation is invalid.",
                )
            self._state(connection, action, "registering")
            current = self.api.inspect_optional(action.service_name)
            if not self._matches(current, action.desired, marker=action.ownership_marker):
                if action.prior_registered:
                    expected_prechange = WindowsInstallerScmConfiguration(
                        action.snapshot.service_name, action.snapshot.service_sid,
                        action.snapshot.binary_path, action.snapshot.start_account,
                        "disabled", action.snapshot.service_type, action.snapshot.sid_type,
                        action.snapshot.delayed_auto_start, action.snapshot.description,
                    )
                    safe_to_change = current == expected_prechange
                else:
                    safe_to_change = current is None
                if not safe_to_change:
                    self.api.fail_safe_disable_and_stop(action.service_name)
                    raise WindowsInstallerScmActionError(
                        "windows_installer_scm_prechange_identity_drift",
                        "SCM identity changed after its durable pre-change snapshot.",
                    )
                current = self.api.register_disabled(
                    action.desired, action.ownership_marker,
                    create=not action.prior_registered,
                )
            if not self._matches(current, action.desired, marker=action.ownership_marker):
                self.api.fail_safe_disable_and_stop(action.service_name)
                raise WindowsInstallerScmActionError(
                    "windows_installer_scm_register_unproven",
                    "SCM registration did not produce the exact owned disabled service.",
                )
            self._state(connection, action, "registered")
            connection.commit()
        return self.get(action_id)

    def _rollback_in_connection(
        self,
        connection: sqlite3.Connection,
        operation: WindowsInstallerOperation,
    ) -> None:
        row = connection.execute(
            "SELECT * FROM runtime_windows_installer_scm_actions WHERE operation_id=?",
            (operation.operation_id,),
        ).fetchone()
        if row is None:
            return
        action = self._from_row(row)
        self._validate(action)
        if action.state == "rolled_back":
            return
        self._state(connection, action, "rolling_back")
        try:
            current = self.api.inspect_optional(action.service_name)
            if action.prior_registered:
                snapshot_disabled = replace(action.snapshot, start_type="disabled")
                if current == action.snapshot:
                    restored = current
                elif current == snapshot_disabled:
                    restored = self.api.restore(action.snapshot, action.ownership_marker)
                else:
                    if current is None or current.description != action.ownership_marker:
                        raise WindowsInstallerScmActionError(
                            "windows_installer_service_restore_not_owned",
                            "Changed service lost the operation ownership marker.",
                        )
                    restored = self.api.restore(action.snapshot, action.ownership_marker)
                if restored != action.snapshot:
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_restore_unproven",
                        "Prior SCM configuration was not restored exactly.",
                    )
            elif current is not None:
                if not self._matches(current, action.desired, marker=action.ownership_marker):
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_delete_not_owned",
                        "New service no longer matches the owned desired configuration.",
                    )
                if not self.api.delete_owned(action.service_name, action.ownership_marker):
                    raise WindowsInstallerScmActionError(
                        "windows_installer_service_delete_unproven",
                        "Owned new service deletion was not confirmed.",
                    )
            self._state(connection, action, "rolled_back")
        except BaseException as error:
            self.api.fail_safe_disable_and_stop(action.service_name)
            self._state(
                connection, action, "rollback_failed", error_code=type(error).__name__,
            )
            raise

    def rollback_in_transaction(
        self, connection: sqlite3.Connection, operation: WindowsInstallerOperation,
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

    def mark_committed(self, action_id: str) -> WindowsInstallerScmAction:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            action = self.get(action_id)
            operation = self.installer_journal.get(action.operation_id)
            current = self.api.inspect_optional(action.service_name)
            if (
                action.state != "registered" or operation.state != "committed"
                or not self._matches(
                    current, action.desired, marker=action.ownership_marker,
                )
            ):
                connection.rollback()
                raise WindowsInstallerScmActionError(
                    "windows_installer_scm_commit_not_authorized",
                    "SCM action can commit only with the exact disabled owned service.",
                )
            self._state(connection, action, "committed")
            connection.commit()
        return self.get(action_id)
