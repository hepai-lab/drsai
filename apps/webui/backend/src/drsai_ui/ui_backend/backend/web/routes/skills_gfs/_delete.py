"""Delete skill endpoint."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from ._constants import _SLUG_RE, router, logger
from ._auth import _get_db, _resolve_user_from_apikey
from ._gfs import _gfs_user_zip_path, _gfs_higraf_zip_path, _require_gfs
from ..gfs_utils import gfs_rm


@router.delete("/{slug}")
async def delete_skill(
    slug: str,
    request: Request,
) -> dict:
    """Delete a skill. Auth required. Only owner/admins can delete."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required for write operations")
    return await _delete_skill(slug, auth_user_id)


async def _delete_skill(slug: str, user_id: str) -> dict:
    from ....datamodel.db import SkillMeta, SkillDetail

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing = resp.data[0]

    if existing.owner_id and existing.owner_id != user_id and existing.source != "higraf":
        from ....datamodel.db import Userinfo as _U
        uresp = db_mgr.get(_U, filters={"user_id": user_id}, return_json=False)
        if uresp.status and uresp.data:
            umeta = dict(getattr(uresp.data[0], "meta", None) or {})
            skill_role = umeta.get("skill_role", "user")
        else:
            skill_role = "user"
        if skill_role != "admin":
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    cfg = _require_gfs()
    if existing.source == "higraf":
        gfs_rm(_gfs_higraf_zip_path(slug), cfg)
    else:
        gfs_rm(_gfs_user_zip_path(slug, existing.owner_id or user_id), cfg)
    gfs_rm(f"public_skills/{slug}/meta.json", cfg)
    db_mgr.delete(SkillMeta, filters={"slug": slug})
    db_mgr.delete(SkillDetail, filters={"slug": slug})
    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}