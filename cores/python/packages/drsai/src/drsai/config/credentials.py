"""Platform-backed storage for model Provider API keys."""

from __future__ import annotations

import base64
import ctypes
import os
import sys
from pathlib import Path
from uuid import UUID, uuid4

from cryptography.fernet import Fernet, InvalidToken

from drsai.relay.device_identity import WindowsDpapiProtector
from drsai.configs.constant import FS_DIR

from .loader import ConfigError

_PREFIX = "drsai-credential:"
_KEYCHAIN_SERVICE = "ai.drsai.model-provider"


def default_credentials_dir() -> Path:
    return Path(os.environ.get("DRSAI_HOME", FS_DIR)).expanduser() / "credentials"


def store_credential(secret: str, *, root: Path | None = None) -> str:
    if not isinstance(secret, str) or not secret or len(secret) > 64 * 1024:
        raise ConfigError("API key must be a non-empty string no larger than 64 KiB")
    credential_id = str(uuid4())
    if sys.platform == "darwin" and root is None:
        if not _macos_store_secret(credential_id, secret):
            raise ConfigError("macOS Keychain could not store the model Provider credential")
    else:
        try:
            target_root = root or default_credentials_dir()
            _secure_directory(target_root)
            protected = _protect(secret.encode(), target_root)
            target = target_root / f"{credential_id}.bin"
            temporary = target.with_suffix(".tmp")
            temporary.write_bytes(base64.b64encode(protected))
            _chmod_private(temporary)
            temporary.replace(target)
        except Exception as exc:
            raise ConfigError("Platform credential storage is unavailable") from exc
    return f"{_PREFIX}{credential_id}"


def resolve_credential(reference: str, *, root: Path | None = None) -> str | None:
    credential_id = _parse_reference(reference)
    if sys.platform == "darwin" and root is None:
        return _macos_resolve_secret(credential_id)
    target_root = root or default_credentials_dir()
    target = target_root / f"{credential_id}.bin"
    if not target.is_file():
        return None
    try:
        return _unprotect(base64.b64decode(target.read_bytes()), target_root).decode()
    except Exception:
        return None


def credential_available(reference: str, *, root: Path | None = None) -> bool:
    """Validate both the reference format and the underlying secret."""
    return resolve_credential(reference, root=root) is not None


def delete_credential(reference: str, *, root: Path | None = None) -> bool:
    credential_id = _parse_reference(reference)
    if sys.platform == "darwin" and root is None:
        return _macos_delete_secret(credential_id)
    target = (root or default_credentials_dir()) / f"{credential_id}.bin"
    try:
        target.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def _parse_reference(reference: str) -> str:
    if not isinstance(reference, str) or not reference.startswith(_PREFIX):
        raise ConfigError("Unsupported model Provider credential reference")
    value = reference[len(_PREFIX):]
    try:
        return str(UUID(value))
    except ValueError as exc:
        raise ConfigError("Invalid model Provider credential reference") from exc


def _macos_security_framework() -> tuple[ctypes.CDLL, ctypes.CDLL]:
    security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    core_foundation = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
    security.SecKeychainAddGenericPassword.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p),
    ]
    security.SecKeychainAddGenericPassword.restype = ctypes.c_int32
    security.SecKeychainFindGenericPassword.argtypes = [
        ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32,
        ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    security.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    security.SecKeychainItemFreeContent.restype = ctypes.c_int32
    security.SecKeychainItemDelete.argtypes = [ctypes.c_void_p]
    security.SecKeychainItemDelete.restype = ctypes.c_int32
    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
    core_foundation.CFRelease.restype = None
    return security, core_foundation


def _macos_store_secret(account: str, secret: str) -> bool:
    """Store secret bytes through Security.framework, never a process argument."""
    security, _ = _macos_security_framework()
    service = _KEYCHAIN_SERVICE.encode("utf-8")
    account_bytes = account.encode("utf-8")
    secret_bytes = secret.encode("utf-8")
    status = security.SecKeychainAddGenericPassword(
        None,
        len(service),
        service,
        len(account_bytes),
        account_bytes,
        len(secret_bytes),
        secret_bytes,
        None,
    )
    return status == 0


def _macos_resolve_secret(account: str) -> str | None:
    security, _ = _macos_security_framework()
    service = _KEYCHAIN_SERVICE.encode("utf-8")
    account_bytes = account.encode("utf-8")
    length = ctypes.c_uint32()
    data = ctypes.c_void_p()
    status = security.SecKeychainFindGenericPassword(
        None,
        len(service),
        service,
        len(account_bytes),
        account_bytes,
        ctypes.byref(length),
        ctypes.byref(data),
        None,
    )
    if status != 0:
        return None
    try:
        return ctypes.string_at(data, length.value).decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        return None
    finally:
        security.SecKeychainItemFreeContent(None, data)


def _macos_delete_secret(account: str) -> bool:
    security, core_foundation = _macos_security_framework()
    service = _KEYCHAIN_SERVICE.encode("utf-8")
    account_bytes = account.encode("utf-8")
    item = ctypes.c_void_p()
    status = security.SecKeychainFindGenericPassword(
        None,
        len(service),
        service,
        len(account_bytes),
        account_bytes,
        None,
        None,
        ctypes.byref(item),
    )
    if status != 0 or not item.value:
        return False
    try:
        return security.SecKeychainItemDelete(item) == 0
    finally:
        core_foundation.CFRelease(item)


def _protect(value: bytes, root: Path) -> bytes:
    if os.name == "nt":
        return WindowsDpapiProtector().protect(value)
    return Fernet(_load_or_create_key(root)).encrypt(value)


def _unprotect(value: bytes, root: Path) -> bytes:
    if os.name == "nt":
        return WindowsDpapiProtector().unprotect(value)
    return Fernet(_load_or_create_key(root)).decrypt(value)


def _load_or_create_key(root: Path) -> bytes:
    path = root / "master.key"
    if path.exists():
        return path.read_bytes()
    key = Fernet.generate_key()
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(key)
    _chmod_private(temporary)
    try:
        temporary.replace(path)
    except OSError:
        temporary.unlink(missing_ok=True)
    return path.read_bytes() if path.exists() else key


def _secure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    try:
        path.chmod(0o700)
    except OSError:
        pass


def _chmod_private(path: Path) -> None:
    try:
        path.chmod(0o600)
    except OSError:
        pass
