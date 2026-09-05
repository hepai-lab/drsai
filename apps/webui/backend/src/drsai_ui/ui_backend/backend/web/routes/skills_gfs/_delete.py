"""Delete skill endpoint."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _SLUG_RE, router, logger
from ._auth import (
    _get_db,
    _is_collector,
    _is_created_by_user,
    _is_owner,
    _maybe_repair_dirty_collect,
    _normalize_uid,
    _repair_corrupted_owner,
    _repair_missing_owner_id,
    _resolve_user_from_apikey,
    _user_display_name,
)
from ._gfs import _gfs_user_zip_path, _gfs_higraf_zip_path, _require_gfs
from ..gfs_utils import gfs_rm


@router.delete("/{slug}")
async def delete_skill(
    slug: str,
    request: Request,
    intent: str = Query("", description="delete or uncollect"),
) -> dict:
    """Delete a skill. Auth required. Only owner/admins can delete."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required for write operations")
    return await _delete_skill(slug, auth_user_id, intent)


async def _delete_skill(slug: str, user_id: str, intent: str = "") -> dict:
    from ....datamodel.db import SkillMeta, SkillDetail

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing = resp.data[0]
    display_name = _user_display_name(db_mgr, user_id)
    if _repair_missing_owner_id(existing, user_id, display_name):
        db_mgr.upsert(existing)
    intent_clean = (intent or "").strip().lower()
    is_collector = _is_collector(existing, user_id)
    is_created = _is_created_by_user(existing, user_id, display_name)

    # ── Uncollect: remove from collector_ids and repair dirty owner_id ────
    if intent_clean == "uncollect" or (is_collector and not is_created):
        collector_ids = [
            x for x in (existing.collector_ids or [])
            if _normalize_uid(x) != _normalize_uid(user_id)
        ]
        existing.collector_ids = collector_ids
        _repair_corrupted_owner(existing, user_id)
        if _normalize_uid(existing.owner_id) == _normalize_uid(user_id):
            _maybe_repair_dirty_collect(existing, user_id)
        db_mgr.upsert(existing)
        return {"status": True, "message": f"Uncollected skill '{slug}'", "data": {"slug": slug}}

    if not is_created:
        if _is_owner(existing, user_id, display_name) and is_collector:
            collector_ids = [
                x for x in (existing.collector_ids or [])
                if _normalize_uid(x) != _normalize_uid(user_id)
            ]
            existing.collector_ids = collector_ids
            _repair_corrupted_owner(existing, user_id)
            db_mgr.upsert(existing)
            return {"status": True, "message": f"Removed skill '{slug}' from your library", "data": {"slug": slug}}
        if existing.owner_id and _normalize_uid(existing.owner_id) != _normalize_uid(user_id) and existing.source != "higraf":
            from ...authz import get_is_platform_admin
            if not get_is_platform_admin(db_mgr, user_id):
                raise HTTPException(status_code=403, detail="Not the owner of this skill")

    cfg = _require_gfs()
    if existing.source == "higraf":
        gfs_rm(_gfs_higraf_zip_path(slug), cfg)
    else:
        gfs_rm(_gfs_user_zip_path(slug, existing.owner_id or user_id), cfg)
    db_mgr.delete(SkillMeta, filters={"slug": slug})
    db_mgr.delete(SkillDetail, filters={"slug": slug})
    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}