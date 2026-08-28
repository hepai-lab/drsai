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

def _skillmeta_to_dict(row) -> dict:
    """Convert a SkillMeta row to a flat dict for API responses."""
    return {
        "slug": row.slug,
        "name": row.name,
        "icon": row.icon,
        "version": row.version,
        "description": row.description or "",
        "owner": row.author or row.owner_id,
        "owner_id": row.owner_id,
        "author": row.author,
        "visibility": row.visibility,
        "source": row.source,
        "source_ref": row.source_ref,
        "uskills_type": row.uskills_type,
        "imported_ref": row.imported_ref if isinstance(row.imported_ref, dict) else None,
        "tags": row.tags if isinstance(row.tags, list) else [],
        "downloads": row.download_count,
        "collector_ids": row.collector_ids if isinstance(row.collector_ids, list) else [],
        "agent_ids": row.agent_ids if isinstance(row.agent_ids, list) else [],
        "team_ids": row.team_ids if isinstance(row.team_ids, list) else [],
        "profile": row.profile or "",
        "created_at": row.created_at.isoformat() if row.created_at else "",
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
    }


def _skilldetail_to_dict(row) -> dict:
    """Convert a SkillDetail row to a flat dict."""
    return {
        "slug": row.slug,
        "description": row.description,
        "body": row.body,
        "changelog": row.changelog,
        "author_email": row.author_email,
        "author_id": row.author_id,
        "required_tools": row.required_tools if isinstance(row.required_tools, list) else [],
        "detail_raw": row.detail_raw,
    }


def _field(item, key: str, default: Any = "") -> Any:
    """Read a field from either a SQLModel row or a plain dict, with fallback default."""
    if isinstance(item, dict):
        return item.get(key, default)
    val = getattr(item, key, None)
    if val is not None and val != "":
        return val
    return default


# ═══════════════════════════════════════════════════════════════════════════════
# Type validation dependency
# ═══════════════════════════════════════════════════════════════════════════════

def _require_type(type_: str = Query(..., alias="type")) -> SkillType:
    """Validate and normalize the ?type= query parameter."""
    t = type_.strip().lower()
    if t not in ("public", "user"):
        raise HTTPException(status_code=400, detail="type must be 'public' or 'user'")
    return t  # type: ignore[return-value]