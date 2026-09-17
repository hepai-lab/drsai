"""Atomic, secret-free registration for generic OpenDrSai Runtime clients."""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

from .contracts import OAEP_PROFILE, OAEP_SCHEMA_SHA256, OAEP_VERSION, CONTROL_VERSION


class RuntimeRegistrationError(ValueError):
    pass


@dataclass
class RuntimeRegistrationLease:
    manifest_path: Path
    token_path: Path
    bearer_token: str
    _closed: bool = False

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for path in (self.manifest_path, self.token_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                # A stale registration cannot pass the live probe after the
                # carrier exits, so cleanup remains best-effort and safe.
                pass


def write_runtime_registration(
    *,
    registry_root: Path,
    base_url: str,
    initialize_result: Mapping[str, Any],
    bearer_token: str | None = None,
) -> RuntimeRegistrationLease:
    root = registry_root.expanduser().resolve(strict=False)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    endpoint = _loopback_origin(base_url)
    runtime_id = initialize_result.get("runtime_id")
    protocols = initialize_result.get("protocols")
    if not isinstance(runtime_id, str) or not _valid_id(runtime_id):
        raise RuntimeRegistrationError("Runtime id is invalid")
    if not isinstance(protocols, Mapping):
        raise RuntimeRegistrationError("Runtime protocols are missing")
    control, oaep = protocols.get("control"), protocols.get("oaep")
    if (
        not isinstance(control, Mapping) or control.get("version") != CONTROL_VERSION
        or not isinstance(oaep, Mapping) or oaep.get("version") != OAEP_VERSION
        or oaep.get("schema_sha256") != OAEP_SCHEMA_SHA256
        or not isinstance(oaep.get("profiles"), list) or OAEP_PROFILE not in oaep["profiles"]
    ):
        raise RuntimeRegistrationError("Runtime protocol identity is incompatible")
    token = bearer_token or secrets.token_urlsafe(48)
    if len(token) < 32 or any(character.isspace() for character in token):
        raise RuntimeRegistrationError("Runtime bearer token is invalid")
    slug = runtime_id.replace(":", "-")
    manifest_path = root / f"{slug}.json"
    token_path = root / f"{slug}.token"
    token_temporary = root / f".{slug}.token.tmp"
    manifest_temporary = root / f".{slug}.json.tmp"
    payload = {
        "schema_version": 1,
        "runtime_id": runtime_id,
        "endpoint": {"base_url": endpoint, "bearer_token_file": str(token_path)},
        "agent": {
            "id": "runtime:deepseek-harness",
            "name": "DeepSeek Harness",
            "description": "DeepSeek Harness through an independent OAEP Agent Runtime Bridge.",
            "owner": "DeepSeek",
        },
        "protocols": {
            "control": {"version": CONTROL_VERSION},
            "oaep": {
                "version": OAEP_VERSION,
                "profiles": [OAEP_PROFILE],
                "schema_sha256": OAEP_SCHEMA_SHA256,
            },
        },
    }
    try:
        token_temporary.write_text(token, encoding="utf-8")
        os.chmod(token_temporary, 0o600)
        os.replace(token_temporary, token_path)
        manifest_temporary.write_text(
            json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")),
            encoding="utf-8",
        )
        os.chmod(manifest_temporary, 0o600)
        os.replace(manifest_temporary, manifest_path)
    except Exception:
        token_temporary.unlink(missing_ok=True)
        manifest_temporary.unlink(missing_ok=True)
        token_path.unlink(missing_ok=True)
        raise
    return RuntimeRegistrationLease(manifest_path, token_path, token)


def _loopback_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "::1"}
        or parsed.username or parsed.password or parsed.query or parsed.fragment
        or parsed.path not in {"", "/"}
        or parsed.port is None
    ):
        raise RuntimeRegistrationError("Bundled Runtime registration requires a loopback HTTP origin")
    host = f"[{parsed.hostname}]" if parsed.hostname == "::1" else parsed.hostname
    return f"http://{host}:{parsed.port}"


def _valid_id(value: str) -> bool:
    return bool(value) and len(value) <= 160 and all(character.isalnum() or character in "._:-" for character in value)
