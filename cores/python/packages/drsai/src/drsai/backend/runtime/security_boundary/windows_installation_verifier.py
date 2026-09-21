"""Read-only Windows installation identity and ACL verifier."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Protocol, Sequence

from .isolated_worker_artifact import IsolatedWorkerArtifact
from .models import canonical_digest
from .security_observability_deployment import VerifiedSecurityObservabilityDeployment
from .security_observability_release import SecurityObservabilityReleasePins
from .windows_package_catalog import VerifiedWindowsSecurityPackageCatalog


class WindowsInstallationVerificationError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class WindowsAccessControlEntry:
    ace_type: str
    sid: str
    access_mask: int
    inherited: bool


@dataclass(frozen=True)
class WindowsFileSecurityEvidence:
    owner_sid: str
    dacl_protected: bool
    null_dacl: bool
    reparse_point: bool
    object_kind: str
    device_id: str
    file_id: str
    entries: tuple[WindowsAccessControlEntry, ...]


class WindowsInstallationSecurityApi(Protocol):
    def inspect(self, path: Path) -> WindowsFileSecurityEvidence: ...


@dataclass(frozen=True)
class WindowsServiceConfigurationEvidence:
    service_name: str
    service_sid: str
    binary_path: str
    start_account: str
    start_type: str
    service_type: str
    sid_type: str
    delayed_auto_start: bool


class WindowsServiceConfigurationApi(Protocol):
    def inspect(self, service_name: str) -> WindowsServiceConfigurationEvidence: ...


class NativeWindowsServiceConfigurationApi:
    """Reads SCM configuration through Advapi32 without changing service state."""

    _START_TYPES = {2: "automatic", 3: "manual", 4: "disabled"}
    _SID_TYPES = {0: "none", 1: "unrestricted", 3: "restricted"}
    _SC_MANAGER_CONNECT = 0x0001
    _SERVICE_QUERY_CONFIG = 0x0001
    _SERVICE_CONFIG_DELAYED_AUTO_START_INFO = 3
    _SERVICE_CONFIG_SERVICE_SID_INFO = 5
    _ERROR_INSUFFICIENT_BUFFER = 122

    class _QueryServiceConfig(ctypes.Structure):
        _fields_ = [
            ("dwServiceType", wintypes.DWORD), ("dwStartType", wintypes.DWORD),
            ("dwErrorControl", wintypes.DWORD), ("lpBinaryPathName", wintypes.LPWSTR),
            ("lpLoadOrderGroup", wintypes.LPWSTR), ("dwTagId", wintypes.DWORD),
            ("lpDependencies", wintypes.LPWSTR), ("lpServiceStartName", wintypes.LPWSTR),
            ("lpDisplayName", wintypes.LPWSTR),
        ]

    class _ServiceSidInfo(ctypes.Structure):
        _fields_ = [("dwServiceSidType", wintypes.DWORD)]

    class _DelayedAutoStartInfo(ctypes.Structure):
        _fields_ = [("fDelayedAutostart", wintypes.BOOL)]

    def __init__(self):
        if os.name != "nt":
            raise WindowsInstallationVerificationError(
                "windows_service_verifier_unsupported", "SCM verification requires Windows.",
            )
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
        self.advapi.QueryServiceConfig2W.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        ]
        self.advapi.QueryServiceConfig2W.restype = wintypes.BOOL

    def _query_config2(self, service, level: int, structure):
        needed = wintypes.DWORD()
        ctypes.set_last_error(0)
        self.advapi.QueryServiceConfig2W(service, level, None, 0, ctypes.byref(needed))
        if ctypes.get_last_error() != self._ERROR_INSUFFICIENT_BUFFER or needed.value < ctypes.sizeof(structure):
            raise WindowsInstallationVerificationError(
                "windows_service_config_unreadable", "Extended SCM configuration is unavailable.",
            )
        buffer = ctypes.create_string_buffer(needed.value)
        if not self.advapi.QueryServiceConfig2W(
            service, level, buffer, needed.value, ctypes.byref(needed),
        ):
            raise WindowsInstallationVerificationError(
                "windows_service_config_unreadable", "Extended SCM configuration is unreadable.",
            )
        return ctypes.cast(buffer, ctypes.POINTER(structure)).contents

    @staticmethod
    def _service_sid(service_name: str) -> str:
        try:
            import win32security
            sid, _domain, _kind = win32security.LookupAccountName(None, f"NT SERVICE\\{service_name}")
            return str(win32security.ConvertSidToStringSid(sid))
        except (ImportError, OSError) as error:
            raise WindowsInstallationVerificationError(
                "windows_service_sid_unavailable", "Windows service SID cannot be resolved.",
            ) from error

    def inspect(self, service_name: str) -> WindowsServiceConfigurationEvidence:
        manager = self.advapi.OpenSCManagerW(None, None, self._SC_MANAGER_CONNECT)
        if not manager:
            raise WindowsInstallationVerificationError(
                "windows_service_manager_unavailable", "Service Control Manager is unavailable.",
            )
        service = None
        try:
            service = self.advapi.OpenServiceW(manager, service_name, self._SERVICE_QUERY_CONFIG)
            if not service:
                raise WindowsInstallationVerificationError(
                    "windows_service_missing", "Pinned Windows service is not installed.",
                )
            needed = wintypes.DWORD()
            ctypes.set_last_error(0)
            self.advapi.QueryServiceConfigW(service, None, 0, ctypes.byref(needed))
            if ctypes.get_last_error() != self._ERROR_INSUFFICIENT_BUFFER:
                raise WindowsInstallationVerificationError(
                    "windows_service_config_unreadable", "SCM configuration size is unavailable.",
                )
            buffer = ctypes.create_string_buffer(needed.value)
            if not self.advapi.QueryServiceConfigW(
                service, buffer, needed.value, ctypes.byref(needed),
            ):
                raise WindowsInstallationVerificationError(
                    "windows_service_config_unreadable", "SCM configuration is unreadable.",
                )
            config = ctypes.cast(buffer, ctypes.POINTER(self._QueryServiceConfig)).contents
            sid_info = self._query_config2(service, self._SERVICE_CONFIG_SERVICE_SID_INFO, self._ServiceSidInfo)
            delayed = self._query_config2(
                service, self._SERVICE_CONFIG_DELAYED_AUTO_START_INFO, self._DelayedAutoStartInfo,
            )
            service_type = "own_process" if int(config.dwServiceType) == 0x10 else f"other:{config.dwServiceType}"
            return WindowsServiceConfigurationEvidence(
                service_name=service_name, service_sid=self._service_sid(service_name),
                binary_path=str(config.lpBinaryPathName or ""),
                start_account=str(config.lpServiceStartName or ""),
                start_type=self._START_TYPES.get(int(config.dwStartType), f"other:{config.dwStartType}"),
                service_type=service_type,
                sid_type=self._SID_TYPES.get(int(sid_info.dwServiceSidType), f"other:{sid_info.dwServiceSidType}"),
                delayed_auto_start=bool(delayed.fDelayedAutostart),
            )
        finally:
            if service:
                self.advapi.CloseServiceHandle(service)
            self.advapi.CloseServiceHandle(manager)


class NativeWindowsInstallationSecurityApi:
    """Reads effective file security without changing the installation."""

    _ALLOW_TYPES = frozenset({0, 5, 9, 11})
    _DENY_TYPES = frozenset({1, 6, 10, 12})

    def __init__(self):
        if os.name != "nt":
            raise WindowsInstallationVerificationError(
                "windows_installation_verifier_unsupported", "Installation ACL verification requires Windows.",
            )
        try:
            import win32security
        except ImportError as error:
            raise WindowsInstallationVerificationError(
                "windows_installation_acl_api_unavailable", "PyWin32 security APIs are unavailable.",
            ) from error
        self.security = win32security

    def inspect(self, path: Path) -> WindowsFileSecurityEvidence:
        try:
            information = path.stat(follow_symlinks=False)
            descriptor = self.security.GetFileSecurity(
                str(path), self.security.OWNER_SECURITY_INFORMATION | self.security.DACL_SECURITY_INFORMATION,
            )
            owner = descriptor.GetSecurityDescriptorOwner()
            dacl = descriptor.GetSecurityDescriptorDacl()
            control, _revision = descriptor.GetSecurityDescriptorControl()
        except (OSError, ValueError) as error:
            raise WindowsInstallationVerificationError(
                "windows_installation_security_unreadable", "Installation object security is unreadable.",
            ) from error
        reparse = bool(
            stat.S_ISLNK(information.st_mode)
            or getattr(information, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )
        kind = (
            "directory" if stat.S_ISDIR(information.st_mode)
            else "file" if stat.S_ISREG(information.st_mode) else "other"
        )
        entries: list[WindowsAccessControlEntry] = []
        if dacl is not None:
            for index in range(dacl.GetAceCount()):
                ace = dacl.GetAce(index)
                ace_type, ace_flags = int(ace[0][0]), int(ace[0][1])
                if ace_type in self._ALLOW_TYPES:
                    kind_name = "allow"
                elif ace_type in self._DENY_TYPES:
                    kind_name = "deny"
                else:
                    kind_name = f"unknown:{ace_type}"
                try:
                    mask, sid = int(ace[1]), ace[-1]
                    sid_string = self.security.ConvertSidToStringSid(sid)
                except (TypeError, ValueError) as error:
                    raise WindowsInstallationVerificationError(
                        "windows_installation_acl_unsupported", "Installation ACL contains an unreadable ACE.",
                    ) from error
                entries.append(WindowsAccessControlEntry(
                    kind_name, str(sid_string), mask, bool(ace_flags & 0x10),
                ))
        return WindowsFileSecurityEvidence(
            owner_sid=str(self.security.ConvertSidToStringSid(owner)),
            dacl_protected=bool(control & self.security.SE_DACL_PROTECTED),
            null_dacl=dacl is None, reparse_point=reparse, object_kind=kind,
            device_id=str(information.st_dev), file_id=str(information.st_ino), entries=tuple(entries),
        )


@dataclass(frozen=True)
class WindowsInstalledArtifact:
    role: str
    filename: str
    digest: str
    path: Path
    owner_sid: str
    dacl_protected: bool
    device_id: str
    file_id: str


@dataclass(frozen=True)
class VerifiedWindowsSecurityInstallation:
    metadata_id: str
    version: int
    metadata_digest: str
    install_root: Path
    service_name: str
    service_sid: str
    service_configuration: WindowsServiceConfigurationEvidence
    artifacts: tuple[WindowsInstalledArtifact, ...]
    service_configuration_phase: str = "final"


class WindowsSecurityInstallationVerifier:
    SCHEMA_VERSION = "windows-security-installation/1"
    _MAX_METADATA_BYTES = 64 * 1024
    _FIELDS = frozenset({
        "schema_version", "metadata_id", "version", "product", "channel",
        "runtime_build_digest", "service_name", "service_sid", "artifacts",
        "service_start_account", "service_start_type", "service_sid_type",
        "service_delayed_auto_start",
    })
    _ARTIFACT_FIELDS = frozenset({"role", "filename", "sha256"})
    _ROLES = frozenset({
        "deployment_manifest", "slo_policy", "isolated_worker_manifest",
        "isolated_worker_executable", "runtime_service_executable",
    })
    _SID = re.compile(r"^S-1-(?:\d+-){1,14}\d+$", re.IGNORECASE)
    _DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
    # Any one of these rights permits content replacement, deletion, ACL takeover,
    # or creation of a child that can shadow an installed artifact.
    _WRITE_MASK = (
        0x00000002 | 0x00000004 | 0x00000010 | 0x00000040 | 0x00000100
        | 0x00010000 | 0x00040000 | 0x00080000 | 0x10000000 | 0x40000000
    )

    def __init__(
        self,
        install_root: Path,
        *,
        expected_metadata_digest: str,
        expected_metadata_id: str,
        minimum_metadata_version: int,
        expected_product: str,
        expected_channel: str,
        expected_runtime_build_digest: str,
        expected_service_name: str,
        expected_service_sid: str,
        expected_service_start_account: str,
        expected_service_start_type: str,
        expected_service_sid_type: str,
        expected_service_delayed_auto_start: bool,
        trusted_writer_sids: Sequence[str],
        forbidden_roots: Sequence[Path] = (),
        security_api: WindowsInstallationSecurityApi | None = None,
        service_api: WindowsServiceConfigurationApi | None = None,
        installer_safe_mode: bool = False,
    ):
        raw_install_root = Path(install_root)
        try:
            if self._path_is_reparse(raw_install_root):
                raise WindowsInstallationVerificationError(
                    "windows_installation_reparse_denied", "Installation root cannot be a reparse point.",
                )
            self.install_root = raw_install_root.resolve(strict=True)
        except WindowsInstallationVerificationError:
            raise
        except OSError as error:
            raise WindowsInstallationVerificationError(
                "windows_installation_root_missing", "Installation root does not exist.",
            ) from error
        self.expected_metadata_digest = expected_metadata_digest
        self.expected_metadata_id = expected_metadata_id
        self.minimum_metadata_version = minimum_metadata_version
        self.expected_product = expected_product
        self.expected_channel = expected_channel
        self.expected_runtime_build_digest = expected_runtime_build_digest
        self.expected_service_name = expected_service_name
        self.expected_service_sid = expected_service_sid
        self.expected_service_start_account = expected_service_start_account
        self.expected_service_start_type = expected_service_start_type
        self.expected_service_sid_type = expected_service_sid_type
        self.expected_service_delayed_auto_start = expected_service_delayed_auto_start
        self.trusted_writer_sids = frozenset(value.upper() for value in trusted_writer_sids)
        if (
            not self._DIGEST.fullmatch(expected_metadata_digest)
            or not self._DIGEST.fullmatch(expected_runtime_build_digest)
            or not expected_metadata_id or minimum_metadata_version < 1
            or not expected_product or not expected_channel or not expected_service_name
            or not self._SID.fullmatch(expected_service_sid)
            or not expected_service_start_account
            or expected_service_start_type not in {"automatic", "manual", "disabled"}
            or expected_service_sid_type != "unrestricted"
            or not isinstance(expected_service_delayed_auto_start, bool)
            or not self.trusted_writer_sids
            or any(not self._SID.fullmatch(value) for value in self.trusted_writer_sids)
            or expected_service_sid.upper() in self.trusted_writer_sids
        ):
            raise ValueError("Pinned Windows installation identity and non-service writer SIDs are required.")
        for forbidden in forbidden_roots:
            root = Path(forbidden).resolve(strict=False)
            if self.install_root == root or self.install_root.is_relative_to(root):
                raise WindowsInstallationVerificationError(
                    "windows_installation_root_untrusted", "Installation root cannot be inside a Workspace.",
                )
        self.security_api = security_api or NativeWindowsInstallationSecurityApi()
        self.service_api = service_api or NativeWindowsServiceConfigurationApi()
        self.installer_safe_mode = installer_safe_mode
        self.verified_catalog: VerifiedWindowsSecurityPackageCatalog | None = None

    @classmethod
    def from_verified_catalog(
        cls,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        *,
        forbidden_roots: Sequence[Path] = (),
        security_api: WindowsInstallationSecurityApi | None = None,
        service_api: WindowsServiceConfigurationApi | None = None,
        installer_safe_mode: bool = False,
    ) -> "WindowsSecurityInstallationVerifier":
        if not isinstance(catalog, VerifiedWindowsSecurityPackageCatalog):
            raise TypeError("A verified Windows package catalog is required.")
        verifier = cls(
            catalog.install_root,
            expected_metadata_digest=catalog.installation_metadata_digest,
            expected_metadata_id=catalog.installation_metadata_id,
            minimum_metadata_version=catalog.installation_metadata_minimum_version,
            expected_product=catalog.product, expected_channel=catalog.channel,
            expected_runtime_build_digest=catalog.runtime_build_digest,
            expected_service_name=catalog.service_name, expected_service_sid=catalog.service_sid,
            expected_service_start_account=catalog.service_start_account,
            expected_service_start_type=catalog.service_start_type,
            expected_service_sid_type=catalog.service_sid_type,
            expected_service_delayed_auto_start=catalog.service_delayed_auto_start,
            trusted_writer_sids=catalog.trusted_writer_sids, forbidden_roots=forbidden_roots,
            security_api=security_api, service_api=service_api,
            installer_safe_mode=installer_safe_mode,
        )
        verifier.verified_catalog = catalog
        return verifier

    @staticmethod
    def _canonical(payload: Mapping[str, object]) -> bytes:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    @classmethod
    def metadata_digest(cls, payload: Mapping[str, object]) -> str:
        return canonical_digest(payload)

    @staticmethod
    def _path_is_reparse(path: Path) -> bool:
        information = path.stat(follow_symlinks=False)
        return bool(
            stat.S_ISLNK(information.st_mode)
            or getattr(information, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )

    @staticmethod
    def _file_digest(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        return "sha256:" + digest.hexdigest()

    def _verified_file_digest(
        self, path: Path, evidence: WindowsFileSecurityEvidence,
    ) -> str:
        before = path.stat(follow_symlinks=False)
        if (str(before.st_dev), str(before.st_ino)) != (evidence.device_id, evidence.file_id):
            raise WindowsInstallationVerificationError(
                "windows_installation_object_identity_changed", "Installation object identity changed.",
            )
        digest = self._file_digest(path)
        after = path.stat(follow_symlinks=False)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
        ):
            raise WindowsInstallationVerificationError(
                "windows_installation_object_identity_changed", "Installation object changed during verification.",
            )
        return digest

    def _inspect_secure(self, path: Path, *, require_directory: bool) -> WindowsFileSecurityEvidence:
        evidence = self.security_api.inspect(path)
        expected_kind = "directory" if require_directory else "file"
        if evidence.reparse_point:
            raise WindowsInstallationVerificationError(
                "windows_installation_reparse_denied", "Installation objects cannot be reparse points.",
            )
        if evidence.object_kind != expected_kind:
            raise WindowsInstallationVerificationError(
                "windows_installation_object_type_invalid", "Installation object type is invalid.",
            )
        if evidence.null_dacl:
            raise WindowsInstallationVerificationError(
                "windows_installation_null_dacl_denied", "Installation objects cannot have a null DACL.",
            )
        if not evidence.dacl_protected:
            raise WindowsInstallationVerificationError(
                "windows_installation_inherited_dacl_denied",
                "Installation objects require a protected non-inheriting DACL.",
            )
        if evidence.owner_sid.upper() not in self.trusted_writer_sids:
            raise WindowsInstallationVerificationError(
                "windows_installation_owner_untrusted", "Installation object owner is not a trusted installer.",
            )
        for entry in evidence.entries:
            if entry.ace_type.startswith("unknown:"):
                raise WindowsInstallationVerificationError(
                    "windows_installation_acl_unsupported", "Installation ACL contains an unsupported ACE.",
                )
            if (
                entry.ace_type == "allow" and entry.access_mask & self._WRITE_MASK
                and entry.sid.upper() == self.expected_service_sid.upper()
            ):
                raise WindowsInstallationVerificationError(
                    "windows_installation_service_writable", "The Runtime service must not modify its installation.",
                )
            if (
                entry.ace_type == "allow" and entry.access_mask & self._WRITE_MASK
                and entry.sid.upper() not in self.trusted_writer_sids
            ):
                raise WindowsInstallationVerificationError(
                    "windows_installation_untrusted_writer", "An untrusted identity can modify installation objects.",
                )
        return evidence

    def verify(
        self,
        metadata_filename: str,
        *,
        deployment: VerifiedSecurityObservabilityDeployment,
        release_pins: SecurityObservabilityReleasePins,
        worker: IsolatedWorkerArtifact,
    ) -> VerifiedWindowsSecurityInstallation:
        if Path(metadata_filename).name != metadata_filename or not metadata_filename.endswith(".json"):
            raise WindowsInstallationVerificationError(
                "windows_installation_metadata_path_invalid", "Installation metadata must be a JSON basename.",
            )
        if (
            self.verified_catalog is not None
            and metadata_filename != self.verified_catalog.installation_metadata_filename
        ):
            raise WindowsInstallationVerificationError(
                "windows_installation_catalog_binding_mismatch",
                "Installation metadata filename differs from the signed catalog.",
            )
        metadata_path = self.install_root / metadata_filename
        try:
            unresolved = metadata_path.lstat()
            if self._path_is_reparse(metadata_path):
                raise WindowsInstallationVerificationError(
                    "windows_installation_reparse_denied", "Installation metadata cannot be a reparse point.",
                )
            if unresolved.st_size > self._MAX_METADATA_BYTES:
                raise WindowsInstallationVerificationError(
                    "windows_installation_metadata_too_large", "Installation metadata exceeds its size limit.",
                )
            metadata_path = metadata_path.resolve(strict=True)
            if not metadata_path.is_relative_to(self.install_root):
                raise WindowsInstallationVerificationError(
                    "windows_installation_metadata_escape", "Installation metadata escaped its root.",
                )
            parsed = json.loads(metadata_path.read_text(encoding="utf-8"))
        except WindowsInstallationVerificationError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise WindowsInstallationVerificationError(
                "windows_installation_metadata_unreadable", "Installation metadata is unreadable.",
            ) from error
        if not isinstance(parsed, dict) or set(parsed) != self._FIELDS:
            raise WindowsInstallationVerificationError(
                "windows_installation_metadata_invalid", "Installation metadata fields are invalid.",
            )
        digest = self.metadata_digest(parsed)
        if digest != self.expected_metadata_digest:
            raise WindowsInstallationVerificationError(
                "windows_installation_metadata_digest_mismatch", "Installation metadata differs from the Runtime pin.",
            )
        identity = (
            parsed["metadata_id"], parsed["product"], parsed["channel"],
            parsed["runtime_build_digest"], parsed["service_name"], parsed["service_sid"],
            parsed["service_start_account"], parsed["service_start_type"],
            parsed["service_sid_type"], parsed["service_delayed_auto_start"],
        )
        expected = (
            self.expected_metadata_id, self.expected_product, self.expected_channel,
            self.expected_runtime_build_digest, self.expected_service_name, self.expected_service_sid,
            self.expected_service_start_account, self.expected_service_start_type,
            self.expected_service_sid_type, self.expected_service_delayed_auto_start,
        )
        version = parsed["version"]
        string_fields = (
            "metadata_id", "product", "channel", "runtime_build_digest", "service_name",
            "service_sid", "service_start_account", "service_start_type", "service_sid_type",
        )
        if (
            any(not isinstance(parsed[name], str) for name in string_fields)
            or not isinstance(parsed["service_delayed_auto_start"], bool)
        ):
            raise WindowsInstallationVerificationError(
                "windows_installation_metadata_invalid", "Installation metadata value types are invalid.",
            )
        if identity != expected:
            raise WindowsInstallationVerificationError(
                "windows_installation_identity_mismatch", "Installation identity does not match Runtime pins.",
            )
        if isinstance(version, bool) or not isinstance(version, int) or version < self.minimum_metadata_version:
            raise WindowsInstallationVerificationError(
                "windows_installation_version_rollback", "Installation metadata version is below its pin.",
            )
        artifacts = parsed["artifacts"]
        if not isinstance(artifacts, list) or len(artifacts) != len(self._ROLES):
            raise WindowsInstallationVerificationError(
                "windows_installation_artifacts_invalid", "Installation artifact inventory is incomplete.",
            )
        by_role: dict[str, tuple[str, str]] = {}
        filenames: set[str] = set()
        for item in artifacts:
            if not isinstance(item, dict) or set(item) != self._ARTIFACT_FIELDS:
                raise WindowsInstallationVerificationError(
                    "windows_installation_artifacts_invalid", "Installation artifact entry is invalid.",
                )
            role, filename, artifact_digest = item["role"], item["filename"], item["sha256"]
            if (
                not isinstance(role, str) or role not in self._ROLES or role in by_role
                or not isinstance(filename, str)
                or Path(filename).name != filename or filename in filenames
                or not isinstance(artifact_digest, str) or not self._DIGEST.fullmatch(artifact_digest)
            ):
                raise WindowsInstallationVerificationError(
                    "windows_installation_artifacts_invalid", "Installation artifact identity is invalid.",
                )
            by_role[role] = (filename, artifact_digest)
            filenames.add(filename)
        if set(by_role) != self._ROLES:
            raise WindowsInstallationVerificationError(
                "windows_installation_artifacts_invalid", "Installation artifact roles are incomplete.",
            )
        bindings = {
            "deployment_manifest": (release_pins.manifest_filename, release_pins.manifest_file_digest),
            "slo_policy": (release_pins.slo_policy_filename, release_pins.slo_policy_file_digest),
            "isolated_worker_manifest": (
                worker.manifest_path.name, self._file_digest(worker.manifest_path),
            ),
            "isolated_worker_executable": (worker.executable_path.name, worker.executable_digest),
        }
        service_filename, service_digest = by_role["runtime_service_executable"]
        if service_digest != self.expected_runtime_build_digest:
            raise WindowsInstallationVerificationError(
                "windows_service_build_digest_mismatch",
                "Service executable digest differs from the pinned Runtime build.",
            )
        bindings["runtime_service_executable"] = (service_filename, service_digest)
        if by_role != bindings:
            raise WindowsInstallationVerificationError(
                "windows_installation_artifact_binding_mismatch",
                "Artifact inventory differs from verified release identities.",
            )
        if (
            deployment.install_root != self.install_root
            or deployment.runtime_build_digest != self.expected_runtime_build_digest
            or deployment.service_sid != self.expected_service_sid
            or deployment.digest != release_pins.manifest_digest
            or worker.manifest_path.parent != self.install_root
            or worker.executable_path.parent != self.install_root
        ):
            raise WindowsInstallationVerificationError(
                "windows_installation_verified_identity_mismatch",
                "Verified artifacts belong to another installation.",
            )
        root_evidence = self._inspect_secure(self.install_root, require_directory=True)
        installed: list[WindowsInstalledArtifact] = []
        metadata_evidence = self._inspect_secure(metadata_path, require_directory=False)
        if (metadata_evidence.device_id, metadata_evidence.file_id) != (
            str(unresolved.st_dev), str(unresolved.st_ino),
        ):
            raise WindowsInstallationVerificationError(
                "windows_installation_object_identity_changed", "Installation metadata identity changed.",
            )
        try:
            confirmed = json.loads(metadata_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise WindowsInstallationVerificationError(
                "windows_installation_object_identity_changed", "Installation metadata changed during verification.",
            ) from error
        if not isinstance(confirmed, dict) or self.metadata_digest(confirmed) != digest:
            raise WindowsInstallationVerificationError(
                "windows_installation_object_identity_changed", "Installation metadata changed during verification.",
            )
        checked_paths = {metadata_path}
        for role in sorted(self._ROLES):
            filename, expected_digest = by_role[role]
            unresolved_path = self.install_root / filename
            try:
                if self._path_is_reparse(unresolved_path):
                    raise WindowsInstallationVerificationError(
                        "windows_installation_reparse_denied", "Installed artifacts cannot be reparse points.",
                    )
                path = unresolved_path.resolve(strict=True)
            except WindowsInstallationVerificationError:
                raise
            except OSError as error:
                raise WindowsInstallationVerificationError(
                    "windows_installation_artifact_unreadable", "Installed artifact is unavailable.",
                ) from error
            if not path.is_relative_to(self.install_root) or path in checked_paths:
                raise WindowsInstallationVerificationError(
                    "windows_installation_artifact_escape", "Installed artifact escaped its root.",
                )
            checked_paths.add(path)
            evidence = self._inspect_secure(path, require_directory=False)
            if self._verified_file_digest(path, evidence) != expected_digest:
                raise WindowsInstallationVerificationError(
                    "windows_installation_artifact_digest_mismatch", "Installed artifact content changed.",
                )
            installed.append(WindowsInstalledArtifact(
                role, filename, expected_digest, path, evidence.owner_sid, evidence.dacl_protected,
                evidence.device_id, evidence.file_id,
            ))
        service_configuration = self.service_api.inspect(self.expected_service_name)
        service_executable = next(
            item for item in installed if item.role == "runtime_service_executable"
        ).path
        configured_binary = service_configuration.binary_path.strip()
        if configured_binary.startswith('"'):
            if not configured_binary.endswith('"') or '"' in configured_binary[1:-1]:
                raise WindowsInstallationVerificationError(
                    "windows_service_binary_command_invalid",
                    "Service binary path quoting is invalid or contains arguments.",
                )
            configured_binary = configured_binary[1:-1]
        elif '"' in configured_binary or any(character.isspace() for character in configured_binary):
            raise WindowsInstallationVerificationError(
                "windows_service_binary_command_invalid",
                "Service binary path must be one absolute executable without arguments.",
            )
        if not configured_binary or "%" in configured_binary or not Path(configured_binary).is_absolute():
            raise WindowsInstallationVerificationError(
                "windows_service_binary_command_invalid", "Service binary path cannot use environment expansion.",
            )
        try:
            configured_path = Path(configured_binary).resolve(strict=True)
        except OSError as error:
            raise WindowsInstallationVerificationError(
                "windows_service_binary_missing", "Configured service executable is unavailable.",
            ) from error
        if configured_path != service_executable:
            raise WindowsInstallationVerificationError(
                "windows_service_binary_mismatch", "SCM points to an unpinned service executable.",
            )
        actual_service_identity = (
            service_configuration.service_name, service_configuration.service_sid.upper(),
            service_configuration.start_account.casefold(), service_configuration.start_type,
            service_configuration.service_type, service_configuration.sid_type,
            service_configuration.delayed_auto_start,
        )
        expected_service_identity = (
            self.expected_service_name, self.expected_service_sid.upper(),
            self.expected_service_start_account.casefold(),
            "disabled" if self.installer_safe_mode else self.expected_service_start_type,
            "own_process", self.expected_service_sid_type,
            self.expected_service_delayed_auto_start,
        )
        if actual_service_identity != expected_service_identity:
            raise WindowsInstallationVerificationError(
                "windows_service_identity_mismatch", "SCM service identity differs from package pins.",
            )
        # Preserve evidence for the two trust-root objects even though metadata is
        # not part of the signed artifact inventory and root is a directory.
        installed.extend((
            WindowsInstalledArtifact(
                "installation_metadata", metadata_path.name, digest, metadata_path,
                metadata_evidence.owner_sid, metadata_evidence.dacl_protected,
                metadata_evidence.device_id, metadata_evidence.file_id,
            ),
            WindowsInstalledArtifact(
                "installation_root", self.install_root.name, "", self.install_root,
                root_evidence.owner_sid, root_evidence.dacl_protected,
                root_evidence.device_id, root_evidence.file_id,
            ),
        ))
        if self.verified_catalog is not None:
            from .security_observability_release import SecurityObservabilityReleaseTool

            catalog = self.verified_catalog
            actual_pins = SecurityObservabilityReleaseTool.load_pins(
                self.install_root / catalog.release_pins_filename,
            )
            if actual_pins != release_pins:
                raise WindowsInstallationVerificationError(
                    "windows_installation_release_pins_mismatch",
                    "Release pins object differs from the signed installed pins.",
                )
            for role, path, artifact_digest in (
                ("package_catalog", catalog.catalog_path, catalog.digest),
                (
                    "release_pins", self.install_root / catalog.release_pins_filename,
                    catalog.release_pins_file_digest,
                ),
            ):
                evidence = self._inspect_secure(path, require_directory=False)
                if role == "release_pins" and self._verified_file_digest(path, evidence) != artifact_digest:
                    raise WindowsInstallationVerificationError(
                        "windows_installation_release_pins_mismatch",
                        "Installed release pins differ from the signed catalog.",
                    )
                installed.append(WindowsInstalledArtifact(
                    role, path.name, artifact_digest, path, evidence.owner_sid,
                    evidence.dacl_protected, evidence.device_id, evidence.file_id,
                ))
        return VerifiedWindowsSecurityInstallation(
            self.expected_metadata_id, version, digest, self.install_root,
            self.expected_service_name, self.expected_service_sid, service_configuration,
            tuple(installed), "installer_safe" if self.installer_safe_mode else "final",
        )
