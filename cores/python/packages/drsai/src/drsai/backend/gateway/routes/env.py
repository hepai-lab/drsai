"""Env file (``.env``) routes — read/write the agent's environment variables.

Extracted from the legacy monolith (``gateway_legacy.py`` L11454-11577) in
Phase 1. Uses the shared ``manager.evict_user`` / ``_get_user_id`` accessors
(lazily imported from the ``gateway`` package, like ``gateway_wechat``) until
Phase 2 moves them into ``gateway._state``. No test patches these symbols.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from loguru import logger

from drsai.configs.constant import FS_DIR

_ENV_FILE = Path(FS_DIR) / ".env"
_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# Keys whose values are masked in GET responses. Writes still accept the real
# value via PUT; the mask exists so the value isn't echoed back to the UI
# unmasked.
_SENSITIVE_ENV_KEYS = (
    "_API_KEY",
    "_TOKEN",
    "_SECRET",
    "_PASSWORD",
)


class EnvSetRequest(BaseModel):
    value: str = Field(..., description="Value to write. Single-line strings only.")


def _read_env_file() -> dict[str, str]:
    """Parse FS_DIR/.env into a plain dict. Missing file → empty dict."""
    out: dict[str, str] = {}
    if not _ENV_FILE.exists():
        return out
    try:
        raw = _ENV_FILE.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning(f"Failed to read {_ENV_FILE}: {e}")
        return out
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        k = k.strip()
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (
            v.startswith("'") and v.endswith("'")
        ):
            v = v[1:-1]
        out[k] = v
    return out


def _write_env_file(env: dict[str, str]) -> None:
    """Persist env dict to FS_DIR/.env. Atomic via tempfile + replace."""
    _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(f"{k}={v}" for k, v in env.items()) + ("\n" if env else "")
    tmp = _ENV_FILE.with_suffix(_ENV_FILE.suffix + ".tmp")
    tmp.write_text(body, encoding="utf-8")
    os.replace(tmp, _ENV_FILE)


def _mask_env(env: dict[str, str]) -> dict[str, str]:
    """Replace sensitive values with a placeholder for display."""
    masked: dict[str, str] = {}
    for k, v in env.items():
        sensitive = any(suffix in k.upper() for suffix in _SENSITIVE_ENV_KEYS)
        if sensitive and v:
            masked[k] = f"***{v[-4:]}" if len(v) > 4 else "***"
        else:
            masked[k] = v
    return masked


api = APIRouter(tags=["env"])


@api.get("/v1/config/env")
async def get_env(
    masked: bool = Query(default=True, description="Mask sensitive values."),
):
    """Return the contents of FS_DIR/.env.

    Sensitive keys (containing API_KEY/TOKEN/SECRET/PASSWORD) are masked by
    default — pass ``masked=false`` only when the caller needs the real
    value (e.g. to populate a 'show key' modal).
    """
    env = _read_env_file()
    return {
        "path": str(_ENV_FILE),
        "env": _mask_env(env) if masked else env,
    }


@api.put("/v1/config/env/{key}")
async def set_env_value(
    key: str,
    req: EnvSetRequest,
):
    """Set or update a single env var, then evict cached agents so the next
    chat turn picks up the new value via :func:`load_dotenv`."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    if not _ENV_KEY_RE.match(key):
        raise HTTPException(
            status_code=400,
            detail="Invalid env var name. Use letters, digits, and underscores, and do not start with a digit.",
        )
    if "\n" in req.value or "\r" in req.value or "\0" in req.value:
        raise HTTPException(
            status_code=400,
            detail="Env var values must be single-line strings.",
        )

    env = _read_env_file()
    env[key] = req.value
    _write_env_file(env)
    # Refresh the running process so the next agent creation sees it
    os.environ[key] = req.value
    evicted = await gateway.manager.evict_user(gateway._get_user_id())
    return {"ok": True, "key": key, "evicted_sessions": evicted}


@api.delete("/v1/config/env/{key}")
async def delete_env_value(key: str):
    """Remove a single env var."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    if not _ENV_KEY_RE.match(key):
        raise HTTPException(status_code=400, detail="Invalid env var name.")
    env = _read_env_file()
    if key not in env:
        raise HTTPException(status_code=404, detail=f"Env var '{key}' not found.")
    env.pop(key)
    _write_env_file(env)
    os.environ.pop(key, None)
    evicted = await gateway.manager.evict_user(gateway._get_user_id())
    return {"ok": True, "evicted_sessions": evicted}


def router() -> APIRouter:
    """Return the configured ``APIRouter`` for env-file routes."""
    return api
