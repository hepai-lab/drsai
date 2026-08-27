"""Toggle skill visibility endpoint."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _SLUG_RE, router
from ._auth import _get_db, _resolve_user_from_apikey


@router.put("/{slug}/visibility")
async def toggle_skill_visibility(
    slug: str,
    request: Request,
    visibility: str = Query(..., description="public, private, or team"),
) -> dict:
    """Toggle a skill's visibility. Auth required. Only owner can change."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    return await _toggle_visibility(slug, auth_user_id, visibility)


async def _toggle_visibility(slug: str, user_id: str, visibility: str) -> dict:
    from ....datamodel.db import SkillMeta

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing = resp.data[0]

    if existing.source == "higraf":
        raise HTTPException(status_code=403, detail="Cannot change visibility of synced skills")

    if existing.owner_id and existing.owner_id != user_id:
        from ....datamodel.db import Userinfo as _U
        uresp = db_mgr.get(_U, filters={"user_id": user_id}, return_json=False)
        if uresp.status and uresp.data:
            umeta = dict(getattr(uresp.data[0], "meta", None) or {})
            skill_role = umeta.get("skill_role", "user")
        else:
            skill_role = "user"
        if skill_role != "admin":
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    vis = visibility.strip().lower()
    if vis not in ("public", "private", "team"):
        raise HTTPException(status_code=400, detail="visibility must be public, private, or team")

    existing.visibility = vis
    db_mgr.upsert(existing)

    return {"status": True, "message": f"Skill '{slug}' visibility set to '{vis}'", "data": {"slug": slug, "visibility": vis}}