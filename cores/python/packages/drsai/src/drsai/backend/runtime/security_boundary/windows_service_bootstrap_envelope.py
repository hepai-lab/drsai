"""DPAPI and service-SID protected installer-to-service bootstrap channel."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import re
import stat
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from .windows_installer_journal import (
    ConsumedWindowsServiceBootstrapReceipt,
    WindowsInstallerJournalError,
    WindowsInstallerOperationJournal,
    WindowsServiceBootstrapAuthorization,
)
from .windows_installation_verifier import VerifiedWindowsSecurityInstallation
from .windows_package_catalog import VerifiedWindowsSecurityPackageCatalog


class WindowsServiceBootstrapEnvelopeError(WindowsInstallerJournalError):
    pass


@dataclass(frozen=True)
class PublishedWindowsServiceBootstrapEnvelope:
    path: str
    authorization_id: str
    operation_id: str
    catalog_digest: str
    runtime_build_digest: str
    installation_metadata_digest: str
    service_name: str
    service_sid: str
    expires_at: float


class BootstrapEnvelopeProtector(Protocol):
    def protect(self, plaintext: bytes, *, entropy: bytes) -> bytes: ...
    def unprotect(self, ciphertext: bytes, *, entropy: bytes) -> bytes: ...


class BootstrapEnvelopeFileApi(Protocol):
    def publish(self, path: Path, content: bytes, *, service_sid: str) -> None: ...
    def read(self, path: Path, *, service_sid: str, maximum_bytes: int) -> bytes: ...
    def delete(self, path: Path, *, service_sid: str) -> None: ...


class NativeWindowsMachineDpapiProtector:
    """Machine-scope DPAPI; the file ACL supplies the service identity boundary."""

    _LOCAL_MACHINE = 0x4

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    @classmethod
    def _blob(cls, value: bytes):
        buffer = ctypes.create_string_buffer(value)
        return buffer, cls._Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))

    def _crypt(self, value: bytes, entropy: bytes, *, decrypt: bool) -> bytes:
        if os.name != "nt":
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_dpapi_unsupported", "Machine DPAPI requires Windows.",
            )
        value_buffer, source = self._blob(value)
        entropy_buffer, entropy_blob = self._blob(entropy)
        target = self._Blob()
        crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        if decrypt:
            ok = crypt32.CryptUnprotectData(
                ctypes.byref(source), None, ctypes.byref(entropy_blob), None, None,
                0, ctypes.byref(target),
            )
        else:
            ok = crypt32.CryptProtectData(
                ctypes.byref(source), "OpenDrSai service bootstrap",
                ctypes.byref(entropy_blob), None, None, self._LOCAL_MACHINE,
                ctypes.byref(target),
            )
        del value_buffer, entropy_buffer
        if not ok:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_dpapi_failed", "DPAPI rejected the bootstrap envelope.",
            )
        try:
            return ctypes.string_at(target.pbData, target.cbData)
        finally:
            kernel32.LocalFree(target.pbData)

    def protect(self, plaintext: bytes, *, entropy: bytes) -> bytes:
        return self._crypt(plaintext, entropy, decrypt=False)

    def unprotect(self, ciphertext: bytes, *, entropy: bytes) -> bytes:
        return self._crypt(ciphertext, entropy, decrypt=True)


class NativeWindowsBootstrapEnvelopeFileApi:
    """Creates a non-inheriting SYSTEM/Admin/service-only envelope atomically."""

    _SID = re.compile(r"S-1-(?:\d+-)+\d+")

    @staticmethod
    def _is_reparse(path: Path) -> bool:
        try:
            information = path.stat(follow_symlinks=False)
        except OSError:
            return False
        return bool(
            stat.S_ISLNK(information.st_mode)
            or getattr(information, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        )

    @staticmethod
    def _modules():
        if os.name != "nt":
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_file_unsupported", "Secure bootstrap files require Windows.",
            )
        try:
            import pywintypes
            import win32con
            import win32file
            import win32security
        except ImportError as error:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_acl_api_unavailable", "PyWin32 security APIs are unavailable.",
            ) from error
        return pywintypes, win32con, win32file, win32security

    @classmethod
    def _security_attributes(cls, service_sid: str, *, directory: bool = False):
        if not cls._SID.fullmatch(service_sid):
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_service_sid_invalid", "A canonical service SID is required.",
            )
        pywintypes, _win32con, _win32file, win32security = cls._modules()
        inheritance = "OICI" if directory else ""
        descriptor = win32security.ConvertStringSecurityDescriptorToSecurityDescriptor(
            f"O:SYG:SYD:P(A;{inheritance};FA;;;SY)(A;{inheritance};FA;;;BA)"
            f"(A;{inheritance};FA;;;{service_sid})",
            win32security.SDDL_REVISION_1,
        )
        attributes = pywintypes.SECURITY_ATTRIBUTES()
        attributes.SECURITY_DESCRIPTOR = descriptor
        return attributes

    @classmethod
    def _verify_acl(cls, path: Path, service_sid: str, *, directory: bool = False) -> None:
        _pywintypes, win32con, _win32file, win32security = cls._modules()
        descriptor = win32security.GetFileSecurity(
            str(path),
            win32security.OWNER_SECURITY_INFORMATION
            | win32security.DACL_SECURITY_INFORMATION,
        )
        owner = str(win32security.ConvertSidToStringSid(
            descriptor.GetSecurityDescriptorOwner(),
        ))
        control, _revision = descriptor.GetSecurityDescriptorControl()
        acl = descriptor.GetSecurityDescriptorDacl()
        expected = {"S-1-5-18", "S-1-5-32-544", service_sid.upper()}
        actual: set[str] = set()
        valid = owner.upper() == "S-1-5-18" and bool(
            control & win32security.SE_DACL_PROTECTED
        ) and acl is not None
        if valid:
            for index in range(acl.GetAceCount()):
                header, mask, sid = acl.GetAce(index)
                sid_text = str(win32security.ConvertSidToStringSid(sid)).upper()
                valid = valid and header[0] == win32security.ACCESS_ALLOWED_ACE_TYPE
                expected_flags = (
                    win32con.OBJECT_INHERIT_ACE | win32con.CONTAINER_INHERIT_ACE
                    if directory else 0
                )
                valid = valid and header[1] == expected_flags
                valid = valid and int(mask) == int(win32con.FILE_ALL_ACCESS)
                actual.add(sid_text)
        if not valid or actual != expected:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_acl_invalid",
                "Bootstrap envelope owner or protected service-only DACL is invalid.",
            )

    def publish(self, path: Path, content: bytes, *, service_sid: str) -> None:
        _pywintypes, win32con, win32file, _win32security = self._modules()
        if path.exists():
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_exists", "A bootstrap envelope already exists.",
            )
        if self._is_reparse(path.parent):
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_directory_untrusted",
                "Bootstrap directory cannot be a reparse point.",
            )
        if not path.parent.exists():
            try:
                win32file.CreateDirectory(
                    str(path.parent), self._security_attributes(service_sid, directory=True),
                )
            except Exception as error:
                raise WindowsServiceBootstrapEnvelopeError(
                    "windows_bootstrap_directory_create_failed",
                    "Could not create the protected bootstrap directory.",
                ) from error
        self._verify_acl(path.parent, service_sid, directory=True)
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        handle = None
        try:
            handle = win32file.CreateFile(
                str(temporary), win32con.GENERIC_WRITE, 0,
                self._security_attributes(service_sid), win32con.CREATE_NEW,
                win32con.FILE_ATTRIBUTE_HIDDEN | win32con.FILE_ATTRIBUTE_TEMPORARY,
                None,
            )
            win32file.WriteFile(handle, content)
            win32file.FlushFileBuffers(handle)
            handle.Close()
            handle = None
            win32file.MoveFileEx(
                str(temporary), str(path),
                win32con.MOVEFILE_WRITE_THROUGH | win32con.MOVEFILE_FAIL_IF_NOT_TRACKABLE,
            )
            self._verify_acl(path, service_sid)
        except Exception as error:
            if handle is not None:
                handle.Close()
            try:
                win32file.DeleteFile(str(temporary))
            except Exception:
                pass
            if isinstance(error, WindowsServiceBootstrapEnvelopeError):
                raise
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_publish_failed",
                "Could not publish the service bootstrap envelope.",
            ) from error

    def read(self, path: Path, *, service_sid: str, maximum_bytes: int) -> bytes:
        _pywintypes, win32con, win32file, _win32security = self._modules()
        try:
            if self._is_reparse(path):
                raise WindowsServiceBootstrapEnvelopeError(
                    "windows_bootstrap_envelope_reparse_denied",
                    "Bootstrap envelope cannot be a reparse point.",
                )
            self._verify_acl(path, service_sid)
            handle = win32file.CreateFile(
                str(path), win32con.GENERIC_READ, 0, None, win32con.OPEN_EXISTING,
                win32con.FILE_FLAG_OPEN_REPARSE_POINT, None,
            )
            try:
                size = int(win32file.GetFileSize(handle))
                if size < 1 or size > maximum_bytes:
                    raise WindowsServiceBootstrapEnvelopeError(
                        "windows_bootstrap_envelope_size_invalid",
                        "Bootstrap envelope size is outside the accepted bound.",
                    )
                _status, content = win32file.ReadFile(handle, size)
                return bytes(content)
            finally:
                handle.Close()
        except WindowsServiceBootstrapEnvelopeError:
            raise
        except Exception as error:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_read_failed", "Could not read the bootstrap envelope.",
            ) from error

    def delete(self, path: Path, *, service_sid: str) -> None:
        _pywintypes, _win32con, win32file, _win32security = self._modules()
        try:
            if self._is_reparse(path):
                raise WindowsServiceBootstrapEnvelopeError(
                    "windows_bootstrap_envelope_reparse_denied",
                    "Bootstrap envelope cannot be a reparse point.",
                )
            self._verify_acl(path, service_sid)
            win32file.DeleteFile(str(path))
        except Exception as error:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_cleanup_failed",
                "Consumed bootstrap envelope could not be removed.",
            ) from error


class WindowsServiceBootstrapEnvelopeChannel:
    """Publishes once, consumes through the journal, then removes the ciphertext."""

    _SCHEMA = 1
    _MAXIMUM_BYTES = 64 * 1024
    _PAYLOAD_FIELDS = frozenset({
        "schema", "authorization", "runtime_build_digest", "install_root", "service_sid",
    })
    _AUTHORIZATION_FIELDS = frozenset({
        "authorization_id", "operation_id", "token", "catalog_digest",
        "installation_metadata_digest", "service_name", "expires_at",
    })

    def __init__(
        self,
        path: Path,
        service_sid: str,
        *,
        protector: BootstrapEnvelopeProtector | None = None,
        file_api: BootstrapEnvelopeFileApi | None = None,
    ):
        self.path = Path(path)
        if not self.path.is_absolute() or not self.path.name:
            raise ValueError("Bootstrap envelope path must be absolute.")
        self.service_sid = service_sid
        self.protector = protector or NativeWindowsMachineDpapiProtector()
        self.file_api = file_api or NativeWindowsBootstrapEnvelopeFileApi()

    def _entropy(self) -> bytes:
        return f"OpenDrSai/bootstrap/v1\0{self.service_sid}".encode("ascii")

    @staticmethod
    def _identity_matches(
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> bool:
        return (
            authorization.catalog_digest == catalog.digest
            and authorization.installation_metadata_digest == installation.metadata_digest
            and authorization.service_name == catalog.service_name == installation.service_name
            and str(catalog.install_root) == str(installation.install_root)
            and catalog.service_sid == installation.service_sid
        )

    def publish(
        self,
        authorization: WindowsServiceBootstrapAuthorization,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> PublishedWindowsServiceBootstrapEnvelope:
        if (
            not isinstance(authorization, WindowsServiceBootstrapAuthorization)
            or not isinstance(catalog, VerifiedWindowsSecurityPackageCatalog)
            or not isinstance(installation, VerifiedWindowsSecurityInstallation)
            or not self._identity_matches(authorization, catalog, installation)
            or installation.service_sid != self.service_sid
        ):
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_identity_mismatch",
                "Bootstrap envelope identity differs from the verified installation.",
            )
        payload = {
            "schema": self._SCHEMA,
            "authorization": asdict(authorization),
            "runtime_build_digest": catalog.runtime_build_digest,
            "install_root": str(catalog.install_root),
            "service_sid": catalog.service_sid,
        }
        plaintext = json.dumps(
            payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        ).encode("ascii")
        ciphertext = self.protector.protect(plaintext, entropy=self._entropy())
        encoded = base64.b64encode(ciphertext)
        if not encoded or len(encoded) > self._MAXIMUM_BYTES:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_size_invalid",
                "Protected bootstrap envelope is too large.",
            )
        self.file_api.publish(self.path, encoded, service_sid=self.service_sid)
        return PublishedWindowsServiceBootstrapEnvelope(
            str(self.path), authorization.authorization_id, authorization.operation_id,
            catalog.digest, catalog.runtime_build_digest, installation.metadata_digest,
            catalog.service_name, catalog.service_sid, authorization.expires_at,
        )

    def consume(
        self,
        journal: WindowsInstallerOperationJournal,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> ConsumedWindowsServiceBootstrapReceipt:
        authorization, _published = self.inspect(catalog, installation)
        try:
            receipt = journal.consume_bootstrap_authorization(
                authorization, catalog, installation,
            )
        except WindowsInstallerJournalError as error:
            status = journal.bootstrap_authorization_status(
                authorization, catalog, installation,
            )
            if status in {"consumed", "activated"}:
                self.file_api.delete(self.path, service_sid=self.service_sid)
                raise WindowsServiceBootstrapEnvelopeError(
                    "windows_bootstrap_envelope_replay_cleaned",
                    "Residual ciphertext from an already consumed bootstrap was removed.",
                ) from error
            raise
        # Delete only after the durable issued->consumed commit. If cleanup fails,
        # replay remains impossible and the residual ciphertext is explicitly surfaced.
        self.file_api.delete(self.path, service_sid=self.service_sid)
        return receipt

    def inspect(
        self,
        catalog: VerifiedWindowsSecurityPackageCatalog,
        installation: VerifiedWindowsSecurityInstallation,
    ) -> tuple[
        WindowsServiceBootstrapAuthorization,
        PublishedWindowsServiceBootstrapEnvelope,
    ]:
        """Authenticate an existing envelope without consuming its journal authority."""

        try:
            encoded = self.file_api.read(
                self.path, service_sid=self.service_sid, maximum_bytes=self._MAXIMUM_BYTES,
            )
            ciphertext = base64.b64decode(encoded, validate=True)
            plaintext = self.protector.unprotect(ciphertext, entropy=self._entropy())
            payload = json.loads(plaintext.decode("ascii"))
            authorization_data = payload["authorization"]
            if (
                not isinstance(payload, dict)
                or set(payload) != self._PAYLOAD_FIELDS
                or not isinstance(authorization_data, dict)
                or set(authorization_data) != self._AUTHORIZATION_FIELDS
                or not all(
                    isinstance(authorization_data[field], str)
                    for field in self._AUTHORIZATION_FIELDS - {"expires_at"}
                )
                or not isinstance(authorization_data["expires_at"], (int, float))
                or isinstance(authorization_data["expires_at"], bool)
            ):
                raise ValueError("bootstrap schema mismatch")
            authorization = WindowsServiceBootstrapAuthorization(**authorization_data)
        except WindowsServiceBootstrapEnvelopeError:
            raise
        except Exception as error:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_invalid",
                "Bootstrap envelope is malformed, corrupt, or protected for another identity.",
            ) from error
        valid = (
            payload.get("schema") == self._SCHEMA
            and payload.get("runtime_build_digest") == catalog.runtime_build_digest
            and payload.get("install_root") == str(catalog.install_root)
            and payload.get("service_sid") == self.service_sid == installation.service_sid
            and self._identity_matches(authorization, catalog, installation)
        )
        if not valid:
            raise WindowsServiceBootstrapEnvelopeError(
                "windows_bootstrap_envelope_identity_mismatch",
                "Protected bootstrap envelope differs from the verified installation.",
            )
        return authorization, PublishedWindowsServiceBootstrapEnvelope(
            str(self.path), authorization.authorization_id, authorization.operation_id,
            catalog.digest, catalog.runtime_build_digest, installation.metadata_digest,
            catalog.service_name, catalog.service_sid, authorization.expires_at,
        )
