"""Platform toggle routes (telegram / discord / slack / whatsapp / signal).

Extracted from the legacy monolith (``gateway_legacy.py`` L13231-13279) in
Phase 1. Placeholder endpoints kept compatible with the desktop UI; the on/off
state is persisted in ``cli_config.json`` under ``platforms``. No shared-state
dependencies and no test patches these symbols.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

_SUPPORTED_PLATFORMS = ("telegram", "discord", "slack", "whatsapp", "signal")


class PlatformToggleRequest(BaseModel):
    enabled: bool


api = APIRouter(tags=["platforms"])


@api.get("/v1/config/platforms")
async def list_platforms():
    """Return ``{platform: enabled}`` for every supported platform."""
    from drsai.backend.cli.config import load_config

    cfg = load_config()
    raw = cfg.get("platforms") or {}
    return {
        "platforms": {p: bool(raw.get(p, False)) for p in _SUPPORTED_PLATFORMS},
        "implemented": False,
        "note": (
            "Stored in cli_config.json[platforms]. OpenDrSai does not yet ship "
            "messaging-platform plugins; the toggles are persisted for future use."
        ),
    }


@api.put("/v1/config/platforms/{name}")
async def set_platform(name: str, req: PlatformToggleRequest):
    """Toggle a single platform on/off (persisted; not yet runtime-effective)."""
    if name not in _SUPPORTED_PLATFORMS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown platform '{name}'. Supported: {list(_SUPPORTED_PLATFORMS)}",
        )
    from drsai.backend.cli.config import load_config, save_config

    cfg = load_config()
    platforms = dict(cfg.get("platforms") or {})
    platforms[name] = bool(req.enabled)
    cfg["platforms"] = platforms
    save_config(cfg)
    return {"ok": True, "name": name, "enabled": platforms[name]}


def router() -> APIRouter:
    """Return the configured ``APIRouter`` for platform-toggle routes."""
    return api
