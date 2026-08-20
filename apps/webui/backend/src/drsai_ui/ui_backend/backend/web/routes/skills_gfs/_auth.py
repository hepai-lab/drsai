"""Auth helpers, DB access, and response formatters."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, Query, Request

from ._constants import SkillType


# ═══════════════════════════════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════════════════════════════

async def _resolve_user_from_apikey(request: Request) -> str | None:
    from ...deps import resolve_user_from_apikey
    return await resolve_user_from_apikey(request)


def _require_user_id(user_id: str) -> str:
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="missing user_id")
    uid = user_id.strip()
    if ".." in uid or "/" in uid or "\\" in uid:
        raise HTTPException(status_code=400, detail="invalid user_id")
    return uid


async def _get_db():
    from ...deps import get_db
    return await get_db()


# ═══════════════════════════════════════════════════════════════════════════════
# Response formatters
# ═══════════════════════════════════════════════════════════════════════════════

def _public_skillmeta_to_dict(row) -> dict:
    from ....datamodel.db import SkillMeta
    return {
        "slug": row.slug,
        "name": row.name,
        "description": row.description,
        "compatibility": row.compatibility,
        "icon": row.icon,
        "version": row.version,
        "owner": row.owner,
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        "downloads": row.downloads,
        "profile": row.profile or "",
        "changelog": row.changelog or "",
        "category": row.category or "",
    }


def _field(item, key: str, default: Any = "") -> Any:
    """Read a field from either a SQLModel row or a plain dict, with fallback default."""
    if isinstance(item, dict):
        return item.get(key, default)
    val = getattr(item, key, None)
    if val is not None and val != "":
        return val
    return default


def _user_skillmeta_to_dict(item, user_id: str) -> dict:
    """Convert a UserSkillMeta row or GFS meta dict to flat shape (matching public skills)."""
    slug = _field(item, "slug", "")
    name = _field(item, "name", slug)
    description = _field(item, "description", "")
    icon = _field(item, "icon", "package")
    version = _field(item, "version", "0.0.0")
    changelog = _field(item, "changelog", "")
    source = _field(item, "source", "created")
    owner = _field(item, "owner", user_id)
    profile = _field(item, "profile", "")

    created_at = None
    if hasattr(item, "created_at") and item.created_at:
        created_at = item.created_at
    else:
        raw = item.get("created_at", "") if isinstance(item, dict) else ""
        if raw:
            try:
                created_at = datetime.fromisoformat(raw)
            except (ValueError, TypeError):
                pass

    updated_at = None
    if hasattr(item, "updated_at") and item.updated_at:
        updated_at = item.updated_at
    else:
        raw_upd = item.get("updated_at", "") if isinstance(item, dict) else ""
        if raw_upd:
            try:
                updated_at = datetime.fromisoformat(raw_upd)
            except (ValueError, TypeError):
                pass

    unlisted = _field(item, "unlisted", None)

    return {
        "slug": slug,
        "name": name,
        "description": description,
        "icon": icon,
        "version": version,
        "owner": owner,
        "source": source,
        "unlisted": bool(unlisted) if unlisted else False,
        "created_at": created_at.isoformat() if created_at else "",
        "updated_at": updated_at.isoformat() if updated_at else "",
        "download_url": f"/api/skills/{slug}/download?type=user&user_id={user_id}",
        "profile": profile,
        "changelog": changelog,
        "downloads": int(_field(item, "downloads", 0) or 0),
        "category": _field(item, "category", ""),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Type validation dependency
# ═══════════════════════════════════════════════════════════════════════════════

def _require_type(type_: str = Query(..., alias="type")) -> SkillType:
    """Validate and normalize the ?type= query parameter."""
    t = type_.strip().lower()
    if t not in ("public", "user"):
        raise HTTPException(status_code=400, detail="type must be 'public' or 'user'")
    return t  # type: ignore[return-value]