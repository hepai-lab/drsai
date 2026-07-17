from __future__ import annotations

import base64
import ctypes
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


class SecretProtector(Protocol):
    def protect(self, value: bytes) -> bytes: ...
    def unprotect(self, value: bytes) -> bytes: ...


class WindowsDpapiProtector:
    """Current-user DPAPI. Ciphertext is unusable by another Windows account."""

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    def _crypt(self, value: bytes, decrypt: bool) -> bytes:
        if os.name != "nt":
            raise RuntimeError("DPAPI is only available on Windows; configure a platform SecretProtector")
        source_buffer = ctypes.create_string_buffer(value)
        source = self._Blob(len(value), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_byte)))
        target = self._Blob()
        crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
        if decrypt:
            ok = crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target))
        else:
            ok = crypt32.CryptProtectData(ctypes.byref(source), "OpenDrSai Runtime", None, None, None, 0,
                                          ctypes.byref(target))
        if not ok:
            raise OSError(ctypes.get_last_error(), "DPAPI operation failed")
        try:
            return ctypes.string_at(target.pbData, target.cbData)
        finally:
            kernel32.LocalFree(target.pbData)

    def protect(self, value: bytes) -> bytes:
        return self._crypt(value, False)

    def unprotect(self, value: bytes) -> bytes:
        return self._crypt(value, True)


@dataclass(frozen=True)
class DeviceIdentity:
    private_key: Ed25519PrivateKey

    @property
    def public_key(self) -> str:
        raw = self.private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    def sign(self, message: bytes) -> str:
        return base64.urlsafe_b64encode(self.private_key.sign(message)).rstrip(b"=").decode()


class DeviceIdentityStore:
    def __init__(self, path: Path, protector: SecretProtector | None = None) -> None:
        self.path = path
        self.protector = protector or WindowsDpapiProtector()

    def load_or_create(self) -> DeviceIdentity:
        if self.path.exists():
            raw = self.protector.unprotect(base64.b64decode(self.path.read_bytes()))
            return DeviceIdentity(Ed25519PrivateKey.from_private_bytes(raw))
        return self._save(Ed25519PrivateKey.generate())

    def rotate(self) -> tuple[DeviceIdentity, DeviceIdentity]:
        old = self.load_or_create()
        return old, self._save(Ed25519PrivateKey.generate())

    def _save(self, key: Ed25519PrivateKey) -> DeviceIdentity:
        raw = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                serialization.NoEncryption())
        encoded = base64.b64encode(self.protector.protect(raw))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_bytes(encoded)
        try:
            os.chmod(temporary, 0o600)
        except OSError:
            pass
        temporary.replace(self.path)
        return DeviceIdentity(key)
