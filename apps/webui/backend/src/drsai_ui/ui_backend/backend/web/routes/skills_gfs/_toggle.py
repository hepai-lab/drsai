"""Toggle skill visibility endpoint."""

from __future__ import annotations

import os
import tempfile

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _SLUG_RE, router
from ._auth import _get_db, _require_type, _require_user_id, _resolve_user_from_apikey, _field
from ._gfs import _clear_unlisted_flag, _ensure_cache_zip, _ensure_user_zip_from_public, _gfs_prefix, _gfs_zip_path, _gfs_read_meta_json, _require_gfs
from ..gfs_utils import gfs_get, gfs_ls, gfs_put


@router.put("/{slug}/visibility")
async def toggle_skill_visibility(
    slug: str,
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
    public: bool = Query(...),
) -> dict:
    """Toggle a user skill's public visibility. ?type=user&user_id=xxx&public=true"""
    _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot change visibility for another user")
    return await _toggle_visibility(slug, user_id, public)


async def _toggle_visibility(slug: str, user_id: str, public: bool) -> dict:
    """Publish or unpublish a user skill to/from the public skills square.

    Unpublish: only deletes the SkillMeta DB record; GFS files are preserved so the
    skill can be re-published with a single DB upsert — no file copy needed.
    """
    from ....datamodel.db import SkillMeta, UserSkillMeta

    cfg = _require_gfs()
    db_mgr = await _get_db()

    if public:
        # ── Publish (or re-publish) ──
        existing = db_mgr.get(SkillMeta, filters={"slug": slug})
        already_published = existing.status and existing.data
        if already_published:
            pub_row = existing.data[0]
            user_check = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
            if user_check.status and user_check.data:
                for uc in user_check.data:
                    if getattr(uc, "unlisted", False):
                        await _clear_unlisted_flag(user_id, slug)
                        _ensure_user_zip_from_public(cfg, slug, user_id)
                        return {"status": True, "message": f"Skill '{slug}' is now public", "data": {"slug": slug, "public": True}}
            if not pub_row.owner or pub_row.owner == user_id:
                await _clear_unlisted_flag(user_id, slug)
                _ensure_user_zip_from_public(cfg, slug, user_id)
                return {"status": True, "message": f"Skill '{slug}' is already public", "data": {"slug": slug, "public": True}}
            raise HTTPException(status_code=409, detail="Already published")

        public_zip = _gfs_zip_path("public", slug)
        if gfs_ls(public_zip, cfg):
            user_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
            if user_resp.status and user_resp.data:
                usm = sorted(user_resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)[0]
                name = usm.name or slug
                description = usm.description or ""
                icon = usm.icon or "package"
                version = usm.version or "0.0.0"
                changelog = usm.changelog or ""
                pprofile = getattr(usm, "profile", None) or None
                category = getattr(usm, "category", None) or None
            else:
                for src in ("created", "imported"):
                    if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
                        umeta = _gfs_read_meta_json("user", slug, cfg, user_id, src)
                        name = umeta.get("name", slug)
                        description = umeta.get("description", "")
                        icon = umeta.get("icon", "package")
                        version = umeta.get("version", "0.0.0")
                        changelog = umeta.get("changelog", "")
                        pprofile = umeta.get("profile")
                        break
                else:
                    name, description, icon, version, changelog, pprofile = slug, "", "package", "0.0.0", "", None
                category = None
            db_mgr.upsert(SkillMeta(
                slug=slug, name=name, description=description,
                icon=icon, version=version, owner=user_id,
                downloads=0, changelog=changelog or None,
                profile=pprofile, category=category,
            ))
            await _clear_unlisted_flag(user_id, slug)
            _ensure_user_zip_from_public(cfg, slug, user_id)
            return {"status": True, "message": f"Skill '{slug}' is now public", "data": {"slug": slug, "public": True}}

        resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
        if resp.status and resp.data:
            usm = sorted(resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)[0]
            name = usm.name or slug
            description = usm.description or ""
            icon = usm.icon or "package"
            version = usm.version or "0.0.0"
            changelog = usm.changelog or ""
            pprofile = getattr(usm, "profile", None) or None
            category = getattr(usm, "category", None) or None
            source_val = str(getattr(usm, "source", "created") or "created")
        else:
            source_val = ""
            prefix = _gfs_prefix("user", user_id)
            for src in ("created", "imported"):
                dir_path = f"{prefix}/{src}/"
                entries = gfs_ls(dir_path, cfg)
                if entries:
                    slug_zip = f"{slug}.zip"
                    if any(e.get("name") == slug_zip for e in entries):
                        source_val = src
                        break
            if not source_val:
                raise HTTPException(status_code=404, detail="Skill data not found. Please re-upload the skill first.")
            meta = _gfs_read_meta_json("user", slug, cfg, user_id, source_val)
            name = meta.get("name", slug)
            description = meta.get("description", "")
            icon = meta.get("icon", "package")
            version = meta.get("version", "0.0.0")
            changelog = meta.get("changelog", "")
            pprofile = meta.get("profile")
            category = None

        _ensure_user_zip_from_public(cfg, slug, user_id)

        user_zip = _gfs_zip_path("user", slug, user_id, source_val)
        public_zip = _gfs_zip_path("public", slug)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        try:
            if gfs_get(user_zip, tmp.name, cfg):
                gfs_put(tmp.name, public_zip, cfg)
                _ensure_cache_zip("public", slug, tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

        user_profile_prefix = f"{_gfs_prefix('user', user_id)}/{source_val}/{slug}/profile"
        public_profile_prefix = f"{_gfs_prefix('public')}/{slug}/profile"
        for ext in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"):
            if gfs_ls(user_profile_prefix + ext, cfg):
                profile_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
                profile_tmp.close()
                try:
                    if gfs_get(user_profile_prefix + ext, profile_tmp.name, cfg):
                        gfs_put(profile_tmp.name, public_profile_prefix + ext, cfg)
                finally:
                    try:
                        os.unlink(profile_tmp.name)
                    except OSError:
                        pass
                break

        db_mgr.upsert(SkillMeta(
            slug=slug, name=name, description=description,
            icon=icon, version=version, owner=user_id,
            downloads=0, changelog=changelog or None, profile=pprofile,
            category=category,
        ))
        await _clear_unlisted_flag(user_id, slug)

        return {"status": True, "message": f"Skill '{slug}' is now public", "data": {"slug": slug, "public": True}}

    # ── Unpublish: delete DB record only, keep GFS files ──
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not published")
    existing = resp.data[0]
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

    user_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    has_user_copy = bool(user_resp.status and user_resp.data)
    if user_resp.status and user_resp.data:
        user_resp_data0 = sorted(user_resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)[0]
    else:
        user_resp_data0 = None
    if not has_user_copy:
        for src in ("created", "imported"):
            if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
                has_user_copy = True
                break
    if has_user_copy:
        source_val = ""
        if user_resp_data0 is not None:
            source_val = str(getattr(user_resp_data0, "source", "created") or "created")
        user_gfs_exists = False
        if source_val and gfs_ls(_gfs_zip_path("user", slug, user_id, source_val), cfg):
            user_gfs_exists = True
        if not user_gfs_exists:
            for src in ("created", "imported"):
                if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
                    source_val = src
                    user_gfs_exists = True
                    break
        if not user_gfs_exists:
            public_zip = _gfs_zip_path("public", slug)
            user_zip = _gfs_zip_path("user", slug, user_id, "created")
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            tmp.close()
            try:
                if gfs_get(public_zip, tmp.name, cfg):
                    gfs_put(tmp.name, user_zip, cfg)
                    _ensure_cache_zip("user", slug, tmp.name, user_id)
                    source_val = "created"
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass
        if source_val and user_resp_data0 is not None:
            user_resp_data0.unlisted = True
            db_mgr.upsert(user_resp_data0)
    else:
        public_zip = _gfs_zip_path("public", slug)
        user_zip = _gfs_zip_path("user", slug, user_id, "created")
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        try:
            if gfs_get(public_zip, tmp.name, cfg):
                gfs_put(tmp.name, user_zip, cfg)
                _ensure_cache_zip("user", slug, tmp.name, user_id)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        db_mgr.upsert(UserSkillMeta(
            user_id=user_id, slug=slug, name=existing.name,
            description=existing.description, icon=existing.icon,
            version=existing.version, changelog=existing.changelog or "",
            source="created", unlisted=True,
        ))

    db_mgr.delete(SkillMeta, filters={"slug": slug})
    return {"status": True, "message": f"Skill '{slug}' is now private", "data": {"slug": slug, "public": False}}