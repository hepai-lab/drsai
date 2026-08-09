"""Durable, redacted history of Provider connectivity probes."""

from __future__ import annotations

import hashlib
import json
import os
import base64
import binascii
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Mapping

_LOCK = RLock()
_VERSION = 1
_LATEST: dict[str, dict[str, object]] = {}


def probe_fingerprint(
    provider: str,
    model: str,
    base_url: str,
    wire_api: str,
    credential: str = "",
) -> str:
    """Identify only changes that can affect a real model request.

    The credential itself is never persisted. Its digest makes credential
    rotation invalidate prior evidence without exposing the secret.
    """
    credential_digest = _credential_version(credential)
    canonical = json.dumps(
        {
            "provider": provider,
            "model": model,
            "base_url": base_url.rstrip("/"),
            "wire_api": wire_api,
            "credential_digest": credential_digest,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _credential_version(credential: str) -> str:
    if not credential:
        return "none"
    # OIDC access tokens rotate frequently. Bind their evidence to the stable
    # issuer/account/audience identity instead of the short-lived token bytes.
    parts = credential.split(".")
    if len(parts) == 3:
        try:
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
            identity = {key: payload.get(key) for key in ("iss", "sub", "aud") if payload.get(key) is not None}
            if "iss" in identity and "sub" in identity:
                stable = json.dumps(identity, sort_keys=True, separators=(",", ":"))
                return f"oidc:{hashlib.sha256(stable.encode('utf-8')).hexdigest()}"
        except (ValueError, TypeError, binascii.Error):
            pass
    return f"secret:{hashlib.sha256(credential.encode('utf-8')).hexdigest()}"


def record_probe_result(
    provider: str,
    model: str,
    mode: str,
    result: Mapping[str, object],
    *,
    fingerprint: str | None = None,
    persist: bool = True,
) -> None:
    value = {
        "provider": provider,
        "model": model,
        "mode": mode,
        "ok": bool(result.get("ok")),
        "tested_at": datetime.now(timezone.utc).isoformat(),
        **({"fingerprint": fingerprint} if fingerprint else {}),
        **({"error": result["error"]} if isinstance(result.get("error"), str) else {}),
        **({"status_code": result["status_code"]} if isinstance(result.get("status_code"), int) else {}),
        **({"duration_ms": result["duration_ms"]} if isinstance(result.get("duration_ms"), int) else {}),
    }
    key = fingerprint or f"legacy:{provider}:{model}"
    with _LOCK:
        _ensure_loaded()
        entry = dict(_LATEST.get(key, {}))
        entry["last_attempt"] = value
        # A lightweight /models check must not replace stronger evidence from
        # a successful real model call for the same fingerprint.
        if value["ok"] and (mode == "model" or not isinstance(entry.get("last_success"), dict)):
            entry["last_success"] = value
        _LATEST[key] = entry
        if persist:
            try:
                _write_store()
            except OSError:
                # Verification itself remains authoritative for this process
                # when a read-only or temporarily unavailable profile prevents
                # durability. A storage problem must never mask the Provider
                # result returned to the user.
                pass


def latest_probe_result(
    provider: str,
    model: str | None = None,
    fingerprint: str | None = None,
) -> dict[str, object] | None:
    with _LOCK:
        _ensure_loaded()
        if fingerprint:
            candidates = [_LATEST.get(fingerprint)]
        else:
            candidates = list(_LATEST.values())
        entries = [entry for entry in candidates if isinstance(entry, dict)]
        attempts = [
            entry for entry in entries
            if isinstance(entry.get("last_attempt"), dict)
            and entry["last_attempt"].get("provider") == provider
            and (model is None or entry["last_attempt"].get("model") == model)
        ]
        if not attempts:
            return None
        latest = max(attempts, key=lambda item: str(item["last_attempt"].get("tested_at", "")))
        attempt = dict(latest["last_attempt"])
        success = latest.get("last_success")
        if isinstance(success, dict):
            attempt["last_success"] = dict(success)
        return attempt


def clear_probe_history(*, persistent: bool = False) -> None:
    with _LOCK:
        _LATEST.clear()
        setattr(_ensure_loaded, "loaded_path", str(_store_path()))
        if persistent:
            try:
                _store_path().unlink()
            except FileNotFoundError:
                pass


def reload_probe_history() -> None:
    """Drop only the process cache so callers/tests can exercise restart behavior."""
    with _LOCK:
        _LATEST.clear()
        if hasattr(_ensure_loaded, "loaded_path"):
            delattr(_ensure_loaded, "loaded_path")


def _store_path() -> Path:
    from .loader import default_config_path
    return default_config_path().with_name("model-probe-history.json")


def _ensure_loaded() -> None:
    path = _store_path()
    path_key = str(path)
    if getattr(_ensure_loaded, "loaded_path", None) == path_key:
        return
    _LATEST.clear()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        probes = raw.get("probes") if isinstance(raw, dict) and raw.get("version") == _VERSION else None
        if isinstance(probes, dict):
            for key, entry in probes.items():
                if isinstance(key, str) and isinstance(entry, dict):
                    _LATEST[key] = entry
    except (FileNotFoundError, OSError, ValueError, TypeError):
        pass
    setattr(_ensure_loaded, "loaded_path", path_key)


def _write_store() -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps({"version": _VERSION, "probes": _LATEST}, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    os.replace(temporary, path)
    try:
        path.chmod(0o600)
    except OSError:
        pass
