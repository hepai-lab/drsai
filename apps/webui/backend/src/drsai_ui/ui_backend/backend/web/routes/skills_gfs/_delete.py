"""Delete skill endpoint."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _SLUG_RE, router, logger
from ._auth import _get_db, _require_type, _require_user_id, _resolve_user_from_apikey
from ._gfs import _gfs_prefix, _gfs_zip_path, _require_gfs
from ..gfs_utils import gfs_ls, gfs_rm


@router.delete("/{slug}")
async def delete_skill(
    slug: str,
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
) -> dict:
    """Delete a skill. ?type=public (auth required) or ?type=user&user_id=xxx"""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    if type_ == "public":
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            raise HTTPException(status_code=401, detail="API key required for write operations")
        return await _delete_public(slug, auth_user_id)

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete skills for another user")
    return await _delete_user(slug, user_id)


async def _delete_public(slug: str, user_id: str) -> dict:
    from ....datamodel.db import SkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing: SkillMeta = resp.data[0]

    if existing.owner and existing.owner != user_id:
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
    prefix = _gfs_prefix("public")
    gfs_rm(f"{prefix}/{slug}.zip", cfg)
    gfs_rm(f"{prefix}/{slug}/meta.json", cfg)
    db_mgr.delete(SkillMeta, filters={"slug": slug})
    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}


async def _delete_user(slug: str, user_id: str) -> dict:
    from ....datamodel.db import SkillMeta, UserSkillMeta
    user_id = _require_user_id(user_id)
    cfg = _require_gfs()

    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if resp.status and resp.data:
        meta_row = resp.data[0]
        source_val: str = getattr(meta_row, "source", "created") or "created"
    else:
        source_val = None
        prefix = _gfs_prefix("user", user_id)
        for src in ("created", "imported"):
            dir_path = f"{prefix}/{src}/"
            entries = gfs_ls(dir_path, cfg)
            if entries:
                slug_zip = f"{slug}.zip"
                if any(e.get("name") == slug_zip for e in entries):
                    source_val = src
                    break
        if source_val is None:
            pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
            if pub_resp.status and pub_resp.data:
                pub = pub_resp.data[0]
                if getattr(pub, "owner", None) == user_id:
                    pub_cfg = _require_gfs()
                    pub_prefix = _gfs_prefix("public")
                    gfs_rm(f"{pub_prefix}/{slug}.zip", pub_cfg)
                    gfs_rm(f"{pub_prefix}/{slug}/meta.json", pub_cfg)
                    db_mgr.delete(SkillMeta, filters={"slug": slug})
                    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}
            raise HTTPException(status_code=404, detail="Skill not found")

    if resp.status and resp.data:
        existing_owner = getattr(resp.data[0], "owner", "")
        if existing_owner and existing_owner != user_id:
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    user_gfs_path = _gfs_zip_path("user", slug, user_id, source_val)
    if not gfs_rm(user_gfs_path, cfg):
        logger.warning("Failed to delete GFS file at %s, continuing", user_gfs_path)

    if resp.status and resp.data:
        for rec in resp.data:
            db_mgr.delete(UserSkillMeta, filters={"id": rec.id})

    pub_check = db_mgr.get(SkillMeta, filters={"slug": slug, "owner": user_id})
    if pub_check.status and pub_check.data:
        pub_cfg = _require_gfs()
        pub_prefix = _gfs_prefix("public")
        gfs_rm(f"{pub_prefix}/{slug}.zip", pub_cfg)
        gfs_rm(f"{pub_prefix}/{slug}/meta.json", pub_cfg)
        db_mgr.delete(SkillMeta, filters={"slug": slug})

    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}