"""Token storage with OS-native credential service or Fernet fallback.

Reference: desktop ``apps/desktop/shared/main/auth.ts`` writeStoredSession().

The access_token, refresh_token and id_token are encrypted at rest:
  1. If the ``keyring`` package is available → OS Keychain (macOS Keychain,
     Windows Credential Manager, Linux Secret Service / gnome-keyring).
  2. Otherwise → Fernet symmetric encryption with a machine-derived key.

The plaintext tokens are **never** written to ``auth.json`` — only the
encrypted ciphertext (or a ``keyring:`` sentinel pointing into the OS
keychain) is persisted.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# ── Paths ────────────────────────────────────────────────────────────

_DRSAI_HOME = Path(os.environ.get("OPENDRSAI", os.environ.get("DRSAI_HOME", Path.home() / ".drsai")))
AUTH_DIR = _DRSAI_HOME / "auth"
AUTH_SESSION_FILE = AUTH_DIR / "auth.json"

SESSION_DAYS = 30
ACCESS_TOKEN_REFRESH_WINDOW_S = 300  # refresh 5 min before expiry

# ── Optional keyring ─────────────────────────────────────────────────

try:
    import keyring as _keyring
    HAS_KEYRING = True
except ImportError:
    HAS_KEYRING = False

KEYRING_SERVICE = "opendrsai-tui"

# ── Fernet fallback ──────────────────────────────────────────────────

_FERNET_KEY_CACHE: bytes | None = None


def _get_machine_fernet_key() -> bytes:
    """Derive a stable Fernet key from machine identity.

    Linux: ``/etc/machine-id`` (or ``/var/lib/dbus/machine-id``).
    macOS: ``ioreg -d2 -c IOPlatformUUID`` or hostname fallback.
    Other: hostname.
    """
    global _FERNET_KEY_CACHE
    if _FERNET_KEY_CACHE is not None:
        return _FERNET_KEY_CACHE

    raw = ""
    for candidate in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            raw = Path(candidate).read_text("utf-8").strip()
            if raw:
                break
        except OSError:
            continue
    if not raw:
        import platform
        raw = platform.node() or "opendrsai-fallback"

    # Fernet keys must be 32 url-safe base64 bytes.
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    _FERNET_KEY_CACHE = base64.urlsafe_b64encode(digest)
    return _FERNET_KEY_CACHE


def _protect(plaintext: str) -> str:
    """Encrypt a secret string.

    Returns either ``"keyring:<key>"`` (sentinel pointing into the OS
    keychain) or a Fernet ciphertext string.
    """
    if HAS_KEYRING:
        # Use a unique key per field so we can store multiple secrets.
        key = f"auth-{uuid.uuid4().hex[:8]}"
        _keyring.set_password(KEYRING_SERVICE, key, plaintext)
        return f"keyring:{key}"

    from cryptography.fernet import Fernet
    key = _get_machine_fernet_key()
    return Fernet(key).encrypt(plaintext.encode("utf-8")).decode("ascii")


def _unprotect(protected: str) -> str | None:
    """Decrypt a secret string previously produced by :func:`_protect`."""
    if not protected:
        return None
    if protected.startswith("keyring:"):
        if not HAS_KEYRING:
            return None
        key = protected.removeprefix("keyring:")
        return _keyring.get_password(KEYRING_SERVICE, key)

    from cryptography.fernet import Fernet
    key = _get_machine_fernet_key()
    try:
        return Fernet(key).decrypt(protected.encode("ascii")).decode("utf-8")
    except Exception:
        return None


# ── Public API ───────────────────────────────────────────────────────

def load_auth_session() -> dict | None:
    """Load and decrypt the persisted auth session.

    Returns ``None`` if no session file exists.  The returned dict has
    plaintext ``access_token``, ``refresh_token``, ``id_token`` fields
    added alongside the encrypted originals.
    """
    if not AUTH_SESSION_FILE.exists():
        return None
    try:
        data = json.loads(AUTH_SESSION_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    # Decrypt token fields
    if data.get("encrypted_access_token"):
        data["access_token"] = _unprotect(data["encrypted_access_token"])
    if data.get("encrypted_refresh_token"):
        data["refresh_token"] = _unprotect(data["encrypted_refresh_token"])
    if data.get("encrypted_id_token"):
        data["id_token"] = _unprotect(data["encrypted_id_token"])

    return data


def save_auth_session(
    tokens: dict,
    user_info: dict,
    issuer: str,
    client_id: str,
) -> dict:
    """Encrypt and atomically persist the auth session.

    Args:
        tokens: Dict with ``access_token``, ``refresh_token``, ``id_token``.
        user_info: Dict with ``user_id``, ``email``, ``name``, ``roles``.
        issuer: OIDC issuer URL.
        client_id: OIDC client ID.

    Returns:
        The plaintext session dict (for the caller to use immediately).
    """
    AUTH_DIR.mkdir(parents=True, exist_ok=True)

    session: dict[str, Any] = {
        "session_id": str(uuid.uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat(),
        "auth_mode": "oidc",
        "user": user_info,
        "issuer": issuer,
        "client_id": client_id,
        "encrypted_access_token": _protect(tokens.get("access_token", "")),
        "encrypted_refresh_token": _protect(tokens.get("refresh_token", "")),
        "encrypted_id_token": _protect(tokens.get("id_token", "")),
    }

    # Atomic write: temp file → rename
    tmp = AUTH_SESSION_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(session, indent=2, ensure_ascii=False), "utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(AUTH_SESSION_FILE)

    # Return a plaintext copy for the caller
    plaintext = dict(session)
    plaintext["access_token"] = tokens.get("access_token", "")
    plaintext["refresh_token"] = tokens.get("refresh_token", "")
    plaintext["id_token"] = tokens.get("id_token", "")
    return plaintext


def clear_auth_session() -> None:
    """Delete the auth session file and clear keyring entries."""
    if not AUTH_SESSION_FILE.exists():
        return
    try:
        data = json.loads(AUTH_SESSION_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        data = {}

    # Clear keyring entries
    if HAS_KEYRING:
        for field in ("encrypted_access_token", "encrypted_refresh_token", "encrypted_id_token"):
            val = data.get(field, "")
            if isinstance(val, str) and val.startswith("keyring:"):
                key = val.removeprefix("keyring:")
                try:
                    _keyring.delete_password(KEYRING_SERVICE, key)
                except Exception:
                    pass

    try:
        AUTH_SESSION_FILE.unlink()
    except OSError:
        pass


def is_token_expired(session: dict, refresh_window_s: int = ACCESS_TOKEN_REFRESH_WINDOW_S) -> bool:
    """Check whether the access_token needs refreshing.

    Parses the JWT ``exp`` claim and returns ``True`` if the token
    expires within *refresh_window_s* seconds.
    """
    access_token = session.get("access_token")
    if not access_token:
        return True
    try:
        parts = access_token.split(".")
        if len(parts) < 2:
            return True
        payload_b64 = parts[1]
        # Add padding
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        exp = payload.get("exp")
        if not isinstance(exp, (int, float)):
            return True
        return time.time() >= (exp - refresh_window_s)
    except Exception:
        # If we can't parse the JWT, assume it's expired.
        return True
