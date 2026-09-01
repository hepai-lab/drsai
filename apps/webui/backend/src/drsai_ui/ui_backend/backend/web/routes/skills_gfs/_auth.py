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

def _normalize_uid(uid: str | None) -> str:
    return (uid or "").strip().lower()


def _is_collector(row, user_id: str) -> bool:
    uid = _normalize_uid(user_id)
    if not uid:
        return False
    return any(_normalize_uid(x) == uid for x in (getattr(row, "collector_ids", None) or []))


def _author_matches_user(author: str, user_id: str, display_name: str = "") -> bool:
    author = (author or "").strip()
    if not author:
        return False
    if "@" in author:
        return _normalize_uid(author) == _normalize_uid(user_id)
    if display_name and author == display_name.strip():
        return True
    return False


def _user_display_name(db_mgr, user_id: str) -> str:
    from ....datamodel.db import Userinfo

    resp = db_mgr.get(Userinfo, filters={"user_id": user_id})
    if resp.status and resp.data:
        meta = resp.data[0].meta
        if isinstance(meta, dict):
            return (meta.get("display_name") or "").strip()
    return ""


def _is_owner(row, user_id: str, display_name: str = "") -> bool:
    uid = _normalize_uid(user_id)
    if not uid:
        return False
    owner = _normalize_uid(getattr(row, "owner_id", None))
    if owner == uid:
        return True
    # owner_id may have been cleared by a bad repair; infer from created + author
    if not owner and getattr(row, "uskills_type", None) == "created":
        author = (getattr(row, "author", None) or "").strip()
        return _author_matches_user(author, user_id, display_name)
    return False


def _is_created_by_user(row, user_id: str, display_name: str = "") -> bool:
    """True only for skills the user actually created — not collected/imported."""
    if not _is_owner(row, user_id, display_name):
        return False
    if getattr(row, "uskills_type", None) == "imported":
        return False
    if _is_collector(row, user_id):
        return False
    ref = getattr(row, "imported_ref", None)
    if isinstance(ref, dict) and ref.get("origin") == "public":
        return False
    # Dirty collect: another user's email stored as author while user is collector
    author = (getattr(row, "author", None) or "").strip()
    if (
        "@" in author
        and _normalize_uid(author) != _normalize_uid(user_id)
        and _is_collector(row, user_id)
    ):
        return False
    return True


def _repair_missing_owner_id(existing, user_id: str, display_name: str = "") -> bool:
    """Restore owner_id on user-created skills when it was wrongly cleared."""
    if (getattr(existing, "owner_id", None) or "").strip():
        return False
    if getattr(existing, "uskills_type", None) != "created":
        return False
    author = (getattr(existing, "author", None) or "").strip()
    if _author_matches_user(author, user_id, display_name):
        existing.owner_id = user_id.strip()
        return True
    return False


def _maybe_repair_dirty_collect(row, user_id: str) -> bool:
    """Repair owner_id on list/delete when a collected public skill was mis-attributed."""
    if getattr(row, "uskills_type", None) == "created":
        return False
    if _normalize_uid(getattr(row, "owner_id", None)) != _normalize_uid(user_id):
        return False
    if _is_collector(row, user_id) or getattr(row, "uskills_type", None) == "imported":
        return _repair_corrupted_owner(row, user_id)
    return False


def _repair_corrupted_owner(existing, user_id: str) -> bool:
    """Restore owner_id when a collect bug wrongly set it to the collector."""
    if getattr(existing, "uskills_type", None) == "created":
        return False
    if _normalize_uid(getattr(existing, "owner_id", None)) != _normalize_uid(user_id):
        return False
    ref = existing.imported_ref if isinstance(getattr(existing, "imported_ref", None), dict) else {}
    orig_owner_id = (ref.get("owner_id") or "").strip()
    if orig_owner_id and _normalize_uid(orig_owner_id) != _normalize_uid(user_id):
        existing.owner_id = orig_owner_id
        if ref.get("owner"):
            existing.author = str(ref["owner"])
        return True
    author = (getattr(existing, "author", None) or "").strip()
    if "@" in author and _normalize_uid(author) != _normalize_uid(user_id):
        existing.owner_id = author
        return True
    return False


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
        "collects": len(row.collector_ids) if isinstance(row.collector_ids, list) else 0,
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