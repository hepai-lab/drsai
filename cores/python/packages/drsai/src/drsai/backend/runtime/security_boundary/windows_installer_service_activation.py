"""Two-phase SCM finalization and start after a protected bootstrap publish."""

from __future__ import annotations

import ctypes
import os
import time
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .windows_installation_verifier import (
    NativeWindowsServiceConfigurationApi,
    VerifiedWindowsSecurityInstallation,
    WindowsServiceConfigurationEvidence,
)
from .windows_installer_journal import (
    NativeWindowsInstallerSafetyController,
    WindowsInstallerJournalError,
    WindowsInstallerOperationJournal,
    WindowsInstallerServiceSafetyEvidence,
    WindowsServiceBootstrapAuthorization,
)
from .windows_package_catalog import VerifiedWindowsSecurityPackageCatalog
from .windows_service_bootstrap_envelope import PublishedWindowsServiceBootstrapEnvelope


class WindowsInstallerServiceActivationError(WindowsInstallerJournalError):
    pass


@dataclass(frozen=True)
class WindowsInstallerServiceStartEvidence:
    service_name: str
    running: bool
    process_id: int


class WindowsInstallerServiceActivationApi(Protocol):
    def configure_start_type(self, service_name: str, start_type: str) -> None: ...
    def inspect(self, service_name: str) -> WindowsServiceConfigurationEvidence: ...
    def start(self, service_name: str) -> WindowsInstallerServiceStartEvidence: ...
    def inspect_running(self, service_name: str) -> WindowsInstallerServiceStartEvidence: ...
    def fail_safe_disable_and_stop(
        self, service_name: str,
    ) -> WindowsInstallerServiceSafetyEvidence: ...


class NativeWindowsInstallerServiceActivationApi:
    """SCM mutation surface limited to final start type and service start."""

    _SC_MANAGER_CONNECT = 0x0001
    _SERVICE_CHANGE_CONFIG = 0x0002
    _SERVICE_QUERY_STATUS = 0x0004
    _SERVICE_START = 0x0010
    _SERVICE_RUNNING = 0x00000004
    _SERVICE_NO_CHANGE = 0xFFFFFFFF
    _START_TYPES = {"automatic": 2, "manual": 3, "disabled": 4}
    _ERROR_SERVICE_ALREADY_RUNNING = 1056
    _SC_STATUS_PROCESS_INFO = 0

    class _ServiceStatus(ctypes.Structure):
        _fields_ = [
            ("dwServiceType", wintypes.DWORD), ("dwCurrentState", wintypes.DWORD),
            ("dwControlsAccepted", wintypes.DWORD), ("dwWin32ExitCode", wintypes.DWORD),
            ("dwServiceSpecificExitCode", wintypes.DWORD), ("dwCheckPoint", wintypes.DWORD),
            ("dwWaitHint", wintypes.DWORD), ("dwProcessId", wintypes.DWORD),
            ("dwServiceFlags", wintypes.DWORD),
        ]

    def __init__(self, *, start_timeout_seconds: float = 30):
        if os.name != "nt":
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_activation_unsupported",
                "SCM service activation requires Windows.",
            )
        if start_timeout_seconds <= 0:
            raise ValueError("SCM start timeout must be positive.")
        self.start_timeout_seconds = start_timeout_seconds
        self.advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        self.advapi.OpenSCManagerW.argtypes = [
            wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
        ]
        self.advapi.OpenSCManagerW.restype = wintypes.HANDLE
        self.advapi.OpenServiceW.argtypes = [
            wintypes.HANDLE, wintypes.LPCWSTR, wintypes.DWORD,
        ]
        self.advapi.OpenServiceW.restype = wintypes.HANDLE
        self.advapi.CloseServiceHandle.argtypes = [wintypes.HANDLE]
        self.advapi.CloseServiceHandle.restype = wintypes.BOOL
        self.advapi.ChangeServiceConfigW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(wintypes.DWORD),
            wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
        ]
        self.advapi.ChangeServiceConfigW.restype = wintypes.BOOL
        self.advapi.StartServiceW.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.LPCWSTR),
        ]
        self.advapi.StartServiceW.restype = wintypes.BOOL
        self.advapi.QueryServiceStatusEx.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi.QueryServiceStatusEx.restype = wintypes.BOOL
        self.configuration = NativeWindowsServiceConfigurationApi()
        self.safety = NativeWindowsInstallerSafetyController(
            stop_timeout_seconds=start_timeout_seconds,
        )

    def _open(self, service_name: str, access: int):
        manager = self.advapi.OpenSCManagerW(None, None, self._SC_MANAGER_CONNECT)
        if not manager:
            raise WindowsInstallerServiceActivationError(
                "windows_installer_scm_unavailable", "Service Control Manager is unavailable.",
            )
        service = self.advapi.OpenServiceW(manager, service_name, access)
        if not service:
            self.advapi.CloseServiceHandle(manager)
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_unavailable", "Pinned service is unavailable.",
            )
        return manager, service

    def configure_start_type(self, service_name: str, start_type: str) -> None:
        value = self._START_TYPES.get(start_type)
        if value is None:
            raise ValueError("Unsupported Windows service start type.")
        manager, service = self._open(service_name, self._SERVICE_CHANGE_CONFIG)
        try:
            if not self.advapi.ChangeServiceConfigW(
                service, self._SERVICE_NO_CHANGE, value, self._SERVICE_NO_CHANGE,
                None, None, None, None, None, None, None,
            ):
                raise WindowsInstallerServiceActivationError(
                    "windows_installer_service_finalize_failed",
                    "Pinned service start configuration could not be finalized.",
                )
        finally:
            self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)

    def inspect(self, service_name: str) -> WindowsServiceConfigurationEvidence:
        return self.configuration.inspect(service_name)

    def start(self, service_name: str) -> WindowsInstallerServiceStartEvidence:
        access = self._SERVICE_START | self._SERVICE_QUERY_STATUS
        manager, service = self._open(service_name, access)
        try:
            ctypes.set_last_error(0)
            if not self.advapi.StartServiceW(service, 0, None):
                if ctypes.get_last_error() != self._ERROR_SERVICE_ALREADY_RUNNING:
                    raise WindowsInstallerServiceActivationError(
                        "windows_installer_service_start_failed", "Pinned service could not start.",
                    )
            deadline = time.monotonic() + self.start_timeout_seconds
            status, needed = self._ServiceStatus(), wintypes.DWORD()
            while time.monotonic() < deadline:
                if not self.advapi.QueryServiceStatusEx(
                    service, self._SC_STATUS_PROCESS_INFO, ctypes.byref(status),
                    ctypes.sizeof(status), ctypes.byref(needed),
                ):
                    raise WindowsInstallerServiceActivationError(
                        "windows_installer_service_status_unreadable",
                        "Started service status is unreadable.",
                    )
                if int(status.dwCurrentState) == self._SERVICE_RUNNING:
                    return WindowsInstallerServiceStartEvidence(
                        service_name, True, int(status.dwProcessId),
                    )
                time.sleep(0.05)
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_start_timeout", "Pinned service did not become running.",
            )
        finally:
            self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)

    def inspect_running(self, service_name: str) -> WindowsInstallerServiceStartEvidence:
        manager, service = self._open(service_name, self._SERVICE_QUERY_STATUS)
        try:
            status, needed = self._ServiceStatus(), wintypes.DWORD()
            if not self.advapi.QueryServiceStatusEx(
                service, self._SC_STATUS_PROCESS_INFO, ctypes.byref(status),
                ctypes.sizeof(status), ctypes.byref(needed),
            ):
                raise WindowsInstallerServiceActivationError(
                    "windows_installer_service_status_unreadable",
                    "Pinned service status is unreadable.",
                )
            running = int(status.dwCurrentState) == self._SERVICE_RUNNING
            return WindowsInstallerServiceStartEvidence(
                service_name, running, int(status.dwProcessId) if running else 0,
            )
        finally:
            self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)

    def fail_safe_disable_and_stop(
        self, service_name: str,
    ) -> WindowsInstallerServiceSafetyEvidence:
        return self.safety.ensure_disabled_and_stopped(service_name)


class WindowsInstallerServiceActivationController:
    """Requires issued authority before config and final re-verification before start."""

    def __init__(
        self,
        journal: WindowsInstallerOperationJournal,
        api: WindowsInstallerServiceActivationApi | None = None,
        *,
        clock=time.time,
    ):
        self.journal = journal
        self.api = api or NativeWindowsInstallerServiceActivationApi()
        self.clock = clock

    @staticmethod
    def _published_matches(
        published: PublishedWindowsServiceBootstrapEnvelope,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> bool:
        return (
            isinstance(published, PublishedWindowsServiceBootstrapEnvelope)
            and Path(published.path).is_absolute()
            and published.path == str(Path(published.path))
            and published.authorization_id == authorization.authorization_id
            and published.operation_id == authorization.operation_id
            and published.catalog_digest == catalog.digest == authorization.catalog_digest
            and published.runtime_build_digest == catalog.runtime_build_digest
            and published.installation_metadata_digest == installation.metadata_digest
            == authorization.installation_metadata_digest
            and published.service_name == catalog.service_name == authorization.service_name
            and published.service_sid == catalog.service_sid == installation.service_sid
            and published.expires_at == authorization.expires_at
            and str(catalog.install_root) == str(installation.install_root)
        )

    @staticmethod
    def _configuration_matches(
        evidence: WindowsServiceConfigurationEvidence,
        catalog: VerifiedWindowsSecurityPackageCatalog,
    ) -> bool:
        return (
            evidence.service_name == catalog.service_name
            and evidence.service_sid == catalog.service_sid
            and evidence.start_account.casefold() == catalog.service_start_account.casefold()
            and evidence.start_type == catalog.service_start_type
            and evidence.service_type == "own_process"
            and evidence.sid_type == catalog.service_sid_type
            and evidence.delayed_auto_start == catalog.service_delayed_auto_start
        )

    def finalize_configuration(
        self,
        published: PublishedWindowsServiceBootstrapEnvelope,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        staged_installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsServiceConfigurationEvidence:
        valid = (
            staged_installation.service_configuration_phase == "installer_safe"
            and staged_installation.service_configuration.start_type == "disabled"
            and self._published_matches(published, authorization, catalog, staged_installation)
            and self.journal.bootstrap_authorization_status(
                authorization, catalog, staged_installation,
            ) == "issued"
            and authorization.expires_at > float(self.clock())
        )
        if not valid:
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_activation_not_authorized",
                "Final SCM configuration requires a published issued bootstrap envelope.",
            )
        self.api.configure_start_type(catalog.service_name, catalog.service_start_type)
        evidence = self.api.inspect(catalog.service_name)
        if not self._configuration_matches(evidence, catalog):
            safety = self.api.fail_safe_disable_and_stop(catalog.service_name)
            if not (
                safety.disabled and safety.stopped and safety.process_count == 0
            ):
                raise WindowsInstallerServiceActivationError(
                    "windows_installer_service_finalize_rollback_unproven",
                    "Invalid final SCM configuration could not be returned to a safe state.",
                )
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_final_config_invalid",
                "SCM did not retain the exact final service configuration.",
            )
        return evidence

    def start_verified_service(
        self,
        published: PublishedWindowsServiceBootstrapEnvelope,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        final_installation: VerifiedWindowsSecurityInstallation,
    ) -> WindowsInstallerServiceStartEvidence:
        valid = (
            final_installation.service_configuration_phase == "final"
            and self._published_matches(published, authorization, catalog, final_installation)
            and self._configuration_matches(final_installation.service_configuration, catalog)
            and self.journal.bootstrap_authorization_status(
                authorization, catalog, final_installation,
            ) == "issued"
            and authorization.expires_at > float(self.clock())
        )
        if not valid:
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_start_not_authorized",
                "Service start requires final verification and an issued bootstrap envelope.",
            )
        evidence = self.api.inspect(catalog.service_name)
        if evidence != final_installation.service_configuration:
            safety = self.api.fail_safe_disable_and_stop(catalog.service_name)
            if not (
                safety.disabled and safety.stopped and safety.process_count == 0
            ):
                raise WindowsInstallerServiceActivationError(
                    "windows_installer_service_drift_rollback_unproven",
                    "Changed SCM configuration could not be returned to a safe state.",
                )
            raise WindowsInstallerServiceActivationError(
                "windows_installer_service_final_config_changed",
                "SCM configuration changed after final installation verification.",
            )
        try:
            started = self.api.start(catalog.service_name)
            if (
                not isinstance(started, WindowsInstallerServiceStartEvidence)
                or not started.running or started.process_id <= 0
                or started.service_name != catalog.service_name
            ):
                raise WindowsInstallerServiceActivationError(
                    "windows_installer_service_start_unproven",
                    "SCM did not prove a running pinned service process.",
                )
        except BaseException:
            safety = self.api.fail_safe_disable_and_stop(catalog.service_name)
            if not (
                safety.disabled and safety.stopped and safety.process_count == 0
            ):
                raise WindowsInstallerServiceActivationError(
                    "windows_installer_service_start_rollback_unproven",
                    "Failed service start could not be returned to a safe state.",
                )
            raise
        return started
