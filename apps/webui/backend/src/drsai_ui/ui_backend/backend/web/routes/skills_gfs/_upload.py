"""Upload skill endpoint."""

from __future__ import annotations

import os
import tempfile
import zipfile
from datetime import datetime, timezone

from fastapi import Depends, File, Form, HTTPException, Query, Request, UploadFile

from ._constants import _MAX_PROFILE_BYTES, _MAX_UPLOAD_BYTES, router, logger
from ._auth import _get_db, _require_type, _require_user_id, _resolve_user_from_apikey
from ._gfs import _ensure_cache_zip, _gfs_prefix, _gfs_zip_path, _require_gfs
from ._skillmd import _parse_skill_md, _profile_safe_ext, _read_file_from_zip, _slugify
from ..gfs_utils import gfs_ls, gfs_put


@router.post("/upload")
async def upload_skill(
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
    file: UploadFile = File(...),
    slug: str | None = Form(None),
    display_name: str | None = Form(None),
    name: str | None = Form(None),
    icon: str | None = Form(None),
    description: str | None = Form(None),
    version: str | None = Form(None),
    changelog: str | None = Form(None),
    source: str | None = Form(None),
    category: str | None = Form(None),
    profile: UploadFile | None = File(None),
) -> dict:
    """Upload a skill ZIP. ?type=public (auth required) or ?type=user&user_id=xxx"""
    logger.info("[publish] upload_skill called type=%s user_id=%s slug=%s display_name=%s file=%s",
                type_, user_id, slug, display_name or name, file.filename if file else None)
    if type_ == "public":
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            logger.warning("[publish] upload_skill public: no valid API key")
            raise HTTPException(status_code=401, detail="API key required for upload")
        return await _upload_public(file, slug, display_name or name, icon, description, version, changelog, profile, category, auth_user_id)

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot upload for another user")
    logger.info("[publish] upload_skill → _upload_user user_id=%s slug=%s", user_id, slug)
    return await _upload_user(file, user_id, slug, display_name or name, icon, description, version, changelog, source, profile, category)


async def _upload_public(
    file: UploadFile, slug: str | None, display_name: str | None,
    icon: str | None, description: str | None, version: str | None,
    changelog: str | None, profile: UploadFile | None, category: str | None, user_id: str,
) -> dict:
    from ....datamodel.db import SkillMeta, UserSkillMeta

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

    profile_ext = None
    profile_tmp = None
    if profile is not None and profile.filename:
        profile_ext = _profile_safe_ext(profile.filename or "")
        if profile_ext is None:
            raise HTTPException(status_code=400, detail="Profile image must be png/jpg/jpeg/gif/webp/svg")
        profile_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=profile_ext)
        profile_tmp.close()
        psize = 0
        try:
            with open(profile_tmp.name, "wb") as pout:
                while True:
                    pchunk = await profile.read(1024 * 1024)
                    if not pchunk:
                        break
                    psize += len(pchunk)
                    if psize > _MAX_PROFILE_BYTES:
                        raise HTTPException(status_code=413, detail=f"Profile image exceeds {_MAX_PROFILE_BYTES // (1024 * 1024)} MiB limit")
                    pout.write(pchunk)
        except Exception:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass
            raise

    cfg = _require_gfs()

    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    try:
        size = 0
        with open(tmp_zip.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
                out.write(chunk)

        try:
            with zipfile.ZipFile(tmp_zip.name, "r") as zf:
                skill_md_bytes = _read_file_from_zip(zf, "SKILL.md")
            if not skill_md_bytes:
                raise HTTPException(status_code=400, detail="SKILL.md not found in package")
            parsed = _parse_skill_md(skill_md_bytes.decode("utf-8"))
            if not parsed:
                raise HTTPException(status_code=422, detail="SKILL.md format invalid")
        except zipfile.BadZipFile as e:
            raise HTTPException(status_code=400, detail="Invalid zip file") from e

        slug_clean = (slug or "").strip()
        canon_slug = _slugify(slug_clean) if slug_clean else _slugify(parsed["name"] or "")

        remote_path = _gfs_zip_path("public", canon_slug)

        if gfs_ls(remote_path, cfg):
            check_db = await _get_db()
            check_resp = check_db.get(SkillMeta, filters={"slug": canon_slug})
            existing_owner = check_resp.data[0].owner if (check_resp.status and check_resp.data) else ""
            if existing_owner and existing_owner != user_id:
                db_mgr = await _get_db()
                resp = db_mgr.get(
                    __import__("....datamodel.db", fromlist=["Userinfo"]).Userinfo,
                    filters={"user_id": user_id}, return_json=False,
                )
                if resp.status and resp.data:
                    u = resp.data[0]
                    umeta = dict(getattr(u, "meta", None) or {})
                    skill_role = umeta.get("skill_role", "user")
                else:
                    skill_role = "user"
                if skill_role != "admin":
                    raise HTTPException(status_code=403, detail="Cannot overwrite another user's skill")

        if not gfs_put(tmp_zip.name, remote_path, cfg):
            raise HTTPException(status_code=500, detail="Upload to GFS failed")

        profile_url: str | None = None
        if profile_tmp:
            profile_remote = f"{_gfs_prefix('public')}/{canon_slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                profile_url = f"/api/skills/{canon_slug}/profile"

        final_name = (display_name or "").strip() or parsed["name"]
        final_icon = (icon or "").strip() or parsed.get("icon", "package")
        final_description = description if description is not None else parsed.get("description", "")
        final_version = (version or "").strip() or parsed.get("version", "0.0.0")
        final_changelog = (changelog or "").strip()
        final_category = (category or "").strip() or None

        _ensure_cache_zip("public", canon_slug, tmp_zip.name)

        db_mgr = await _get_db()
        existing_resp = db_mgr.get(SkillMeta, filters={"slug": canon_slug})
        if existing_resp.status and existing_resp.data:
            existing = existing_resp.data[0]
            existing.name = final_name
            existing.description = final_description
            existing.icon = final_icon
            existing.version = final_version
            existing.compatibility = parsed.get("compatibility")
            existing.owner = user_id
            existing.profile = profile_url or None
            existing.changelog = final_changelog
            existing.category = final_category
            to_upsert = existing
        else:
            to_upsert = SkillMeta(
                slug=canon_slug, name=final_name, description=final_description,
                icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility"), owner=user_id,
                downloads=0, profile=profile_url or None, changelog=final_changelog,
                category=final_category,
            )
        upsert_resp = db_mgr.upsert(to_upsert)
        if not upsert_resp.status:
            logger.error("DB upsert failed for slug=%s: %s", canon_slug, upsert_resp.message)
            raise HTTPException(status_code=500, detail=f"Database upsert failed: {upsert_resp.message}")

        # Also create/update UserSkillMeta record so the skill appears in "my creations"
        user_meta_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": canon_slug, "source": "created"})
        if user_meta_resp.status and user_meta_resp.data:
            user_existing = user_meta_resp.data[0]
            user_existing.name = final_name
            user_existing.description = final_description
            user_existing.icon = final_icon
            user_existing.version = final_version
            user_existing.compatibility = parsed.get("compatibility")
            user_existing.owner = user_id
            user_existing.changelog = final_changelog
            user_existing.profile = profile_url
            user_existing.category = final_category
            user_existing.unlisted = False
            user_to_upsert = user_existing
        else:
            user_to_upsert = UserSkillMeta(
                user_id=user_id, slug=canon_slug, name=final_name,
                description=final_description, icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility"), owner=user_id,
                source="created", changelog=final_changelog, profile=profile_url,
                category=final_category,
            )
        db_mgr.upsert(user_to_upsert)

        return {
            "status": True, "message": "Upload successful",
            "data": {
                "slug": canon_slug, "name": final_name, "description": final_description,
                "compatibility": parsed.get("compatibility"), "version": final_version,
                "icon": final_icon, "changelog": final_changelog or "",
                "profile": profile_url or "",
            },
        }
    finally:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass
        if profile_tmp:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass


async def _upload_user(
    file: UploadFile, user_id: str, slug: str | None,
    display_name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None, source: str | None,
    profile: UploadFile | None = None,
    category: str | None = None,
) -> dict:
    from ....datamodel.db import UserSkillMeta

    logger.info("[publish] _upload_user enter user_id=%s slug=%s display_name=%s file=%s version=%s",
                user_id, slug, display_name, file.filename if file else None, version)
    user_id = _require_user_id(user_id)
    if not file.filename or not file.filename.lower().endswith(".zip"):
        logger.warning("[publish] _upload_user invalid file: %s", file.filename)
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

    profile_ext = None
    profile_tmp = None
    if profile is not None and profile.filename:
        profile_ext = _profile_safe_ext(profile.filename or "")
        if profile_ext is None:
            raise HTTPException(status_code=400, detail="Profile image must be png/jpg/jpeg/gif/webp/svg")
        profile_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=profile_ext)
        profile_tmp.close()
        psize = 0
        try:
            with open(profile_tmp.name, "wb") as pout:
                while True:
                    pchunk = await profile.read(1024 * 1024)
                    if not pchunk:
                        break
                    psize += len(pchunk)
                    if psize > _MAX_PROFILE_BYTES:
                        raise HTTPException(status_code=413, detail=f"Profile image exceeds {_MAX_PROFILE_BYTES // (1024 * 1024)} MiB limit")
                    pout.write(pchunk)
        except Exception:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass
            raise

    cfg = _require_gfs()
    source_val = (source or "").strip()
    if source_val not in ("created", "imported"):
        source_val = "created"

    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    try:
        size = 0
        with open(tmp_zip.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
                out.write(chunk)

        try:
            with zipfile.ZipFile(tmp_zip.name, "r") as zf:
                skill_md_bytes = _read_file_from_zip(zf, "SKILL.md")
            if not skill_md_bytes:
                raise HTTPException(status_code=400, detail="SKILL.md not found in package")
            parsed = _parse_skill_md(skill_md_bytes.decode("utf-8"))
            if not parsed:
                raise HTTPException(status_code=422, detail="SKILL.md format invalid")
        except zipfile.BadZipFile as e:
            raise HTTPException(status_code=400, detail="Invalid zip file") from e

        slug_clean = (slug or "").strip()
        canon_slug = _slugify(slug_clean) if slug_clean else _slugify(parsed["name"] or "")
        logger.info("[publish] _upload_user canon_slug=%s source=%s remote_path=%s",
                    canon_slug, source_val, _gfs_zip_path("user", canon_slug, user_id, source_val))

        remote_path = _gfs_zip_path("user", canon_slug, user_id, source_val)
        gfs_ok = gfs_put(tmp_zip.name, remote_path, cfg)
        logger.info("[publish] _upload_user gfs_put result=%s remote=%s", gfs_ok, remote_path)
        if not gfs_ok:
            raise HTTPException(status_code=500, detail="Upload to GFS failed")

        profile_url: str | None = None
        if profile_tmp:
            profile_remote = f"{_gfs_prefix('user', user_id)}/{source_val}/{canon_slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                profile_url = f"/api/skills/{canon_slug}/profile"

        final_name = (display_name or "").strip() or parsed["name"]
        final_icon = (icon or "").strip() or parsed.get("icon", "package")
        final_description = description if description is not None else parsed.get("description", "")
        final_version = (version or "").strip() or parsed.get("version", "0.0.0")
        final_changelog = (changelog or "").strip()
        final_category = (category or "").strip() or None

        db_mgr = await _get_db()
        existing_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": canon_slug, "source": source_val})
        if existing_resp.status and existing_resp.data:
            existing = existing_resp.data[0]
            existing.name = final_name
            existing.description = final_description
            existing.icon = final_icon
            existing.version = final_version
            existing.compatibility = parsed.get("compatibility")
            existing.owner = user_id
            existing.source = source_val
            existing.changelog = final_changelog
            existing.profile = profile_url
            existing.category = final_category
            to_upsert = existing
        else:
            to_upsert = UserSkillMeta(
                user_id=user_id, slug=canon_slug, name=final_name,
                description=final_description, icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility"), owner=user_id,
                source=source_val, changelog=final_changelog, profile=profile_url,
                category=final_category,
            )
        upsert_resp = db_mgr.upsert(to_upsert)
        if not upsert_resp.status:
            logger.error("[publish] _upload_user DB upsert failed for user=%s slug=%s: %s", user_id, canon_slug, upsert_resp.message)
            raise HTTPException(status_code=500, detail=f"Database upsert failed: {upsert_resp.message}")

        logger.info("[publish] _upload_user SUCCESS user=%s slug=%s filename=%s", user_id, canon_slug, file.filename)
        return {
            "status": True,
            "data": {
                "id": canon_slug,
                "filename": file.filename,
                "url": f"/api/skills/{canon_slug}/download?type=user&user_id={user_id}",
            },
        }
    finally:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass
        if profile_tmp:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass