"""CLI config (``cli_config.json``) routes — structured agent settings.

Extracted from the legacy monolith (``gateway_legacy.py`` L11460-11515) in
Phase 1. Uses the shared ``manager.evict_user`` / ``_get_user_id`` accessors
(lazily imported from the ``gateway`` package, like ``gateway_wechat``) until
Phase 2 moves them into ``gateway._state``. No test patches these symbols.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Keys writable through the API. ``api_key`` family is intentionally excluded
# — those should go through /v1/config/env instead so they live in .env and
# benefit from masking.
_CLI_CONFIG_WRITABLE = {
    "user_id",
    "plan_mode",
    "workspace_enabled",
    "dangerous_allowed",
}

# Keys masked when returned via GET.
_CLI_CONFIG_SENSITIVE = {
    "api_key",
    "anthropic_api_key",
    "openai_api_key",
}


class CliConfigSetRequest(BaseModel):
    value: Any = Field(..., description="New value. Booleans, ints, strings, or null.")


api = APIRouter(tags=["cli-config"])


@api.get("/v1/config/cli")
async def get_cli_config():
    """Return cli_config.json with sensitive values masked."""
    from drsai.backend.cli.config import load_config, CLI_CONFIG_PATH

    cfg = load_config()
    safe = dict(cfg)
    for k in _CLI_CONFIG_SENSITIVE:
        v = safe.get(k)
        if isinstance(v, str) and v:
            safe[k] = f"***{v[-4:]}" if len(v) > 4 else "***"
    return {"path": str(CLI_CONFIG_PATH), "config": safe}


@api.put("/v1/config/cli/{key}")
async def set_cli_config(key: str, req: CliConfigSetRequest):
    """Update a single cli_config.json key, then evict cached agents."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns
    from drsai.backend.cli.config import update_config

    if key not in _CLI_CONFIG_WRITABLE:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Key '{key}' is not writable. Writable keys: "
                f"{sorted(_CLI_CONFIG_WRITABLE)}"
            ),
        )
    update_config(**{key: req.value})
    evicted = await gateway.manager.evict_user(gateway._get_user_id())
    return {"ok": True, "key": key, "value": req.value, "evicted_sessions": evicted}


def router() -> APIRouter:
    """Return the configured ``APIRouter`` for cli-config routes."""
    return api
