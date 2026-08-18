"""Update skill endpoint."""

from __future__ import annotations

import json
import os
import tempfile
import zipfile
from datetime import datetime, timezone

from fastapi import Depends, File, Form, HTTPException, Query, Request, UploadFile

from ._constants import _MAX_PROFILE_BYTES, _MAX_UPLOAD_BYTES, _SLUG_RE, router, logger
from ._auth import _get_db, _require_type, _require_user_id, _resolve_user_from_apikey, _user_skillmeta_to_dict, _field
from ._gfs import _ensure_cache_zip, _gfs_meta_path, _gfs_prefix, _gfs_zip_path, _require_gfs
from ._skillmd import _parse_skill_md, _profile_safe_ext, _read_file_from_zip, _write_gfs_text
from ..gfs_utils import gfs_ls, gfs_put


@router.put("/{slug}")
async def update_skill(
    slug: str,
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
    file: UploadFile | None = File(None),
    name: str | None = Form(None),
    display_name: str | None = Form(None),
    icon: str | None = Form(None),
    description: str | None = Form(None),
    version: str | None = Form(None),
    changelog: str | None = Form(None),
    source: str | None = Form(None),
    category: str | None = Form(None),
    profile: UploadFile | None = File(None),
) -> dict:
    """Update a skill. ?type=public (auth required) or ?type=user&user_id=xxx"""
    logger.info("[publish] update_skill called type=%s slug=%s user_id=%s file=%s",
                type_, slug, user_id, file.filename if file else None)
    if not _SLUG_RE.match(slug):
        logger.warning("[publish] update_skill invalid slug: %s", slug)
        raise HTTPException(status_code=400, detail="Invalid slug")

    if type_ == "public":
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            raise HTTPException(status_code=401, detail="API key required for write operations")
        return await _update_public(slug, auth_user_id, file, name or display_name, icon, description, version, changelog, profile, category)

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot update skills for another user")
    logger.info("[publish] update_skill → _update_user slug=%s user_id=%s", slug, user_id)
    return await _update_user(slug, user_id, file, display_name or name, icon, description, version, changelog, source, profile, category)


async def _update_public(
    slug: str, user_id: str, file: UploadFile | None,
    name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None, profile: UploadFile | None,
    category: str | None = None,
) -> dict:
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

    public_zip = _gfs_zip_path("public", slug)
    owner_id = existing.owner or user_id
    _user_backend = not bool(gfs_ls(public_zip, cfg))
    if _user_backend:
        source_val = ""
        for s in ("created", "imported"):
            if gfs_ls(_gfs_zip_path("user", slug, owner_id, s), cfg):
                source_val = s
                break
        remote_path = _gfs_zip_path("user", slug, owner_id, source_val) if source_val else public_zip
    else:
        remote_path = public_zip
        source_val = ""

    _new_compatibility = None
    if file is not None:
        if not file.filename or not file.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Please upload a .zip file")
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
                    raise HTTPException(status_code=400, detail="SKILL.md not found")
                parsed = _parse_skill_md(skill_md_bytes.decode("utf-8"))
                if not parsed:
                    raise HTTPException(status_code=422, detail="SKILL.md format invalid")
            except zipfile.BadZipFile as e:
                raise HTTPException(status_code=400, detail="Invalid zip file") from e
            if not gfs_put(tmp_zip.name, remote_path, cfg):
                raise HTTPException(status_code=500, detail="Upload to GFS failed")
            _ensure_cache_zip("user" if _user_backend else "public", slug, tmp_zip.name,
                              owner_id if _user_backend else "")
            _new_compatibility = parsed.get("compatibility")
            if name is None:
                name = parsed.get("name")
            if icon is None:
                icon = parsed.get("icon")
            if description is None:
                description = parsed.get("description")
            if version is None:
                version = parsed.get("version")
        finally:
            try:
                os.unlink(tmp_zip.name)
            except OSError:
                pass

    new_profile_url: str | None = None
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
            profile_remote = (f"{_gfs_prefix('user', owner_id)}/{source_val}/{slug}/profile{profile_ext}"
                              if _user_backend and source_val
                              else f"{_gfs_prefix('public')}/{slug}/profile{profile_ext}")
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                new_profile_url = f"/api/skills/{slug}/profile"
        finally:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass

    final_name = (name or "").strip() or existing.name
    final_icon = (icon or "").strip() or existing.icon
    final_description = description if description is not None else existing.description
    final_version = (version or "").strip() or existing.version
    final_changelog = changelog.strip() if (changelog is not None and changelog.strip()) else (changelog if changelog is not None else (existing.changelog or ""))
    final_profile = new_profile_url or existing.profile
    final_compat = _new_compatibility if _new_compatibility is not None else existing.compatibility
    final_category = (category or "").strip() or existing.category

    now = datetime.now(timezone.utc).isoformat()
    meta_gfs = {
        "owner": existing.owner, "created_at": existing.created_at.isoformat() if existing.created_at else now,
        "updated_at": now, "name": final_name, "icon": final_icon,
        "description": final_description, "version": final_version,
        "downloads": existing.downloads,
    }
    if final_changelog:
        meta_gfs["changelog"] = final_changelog
    if final_profile:
        meta_gfs["profile"] = final_profile
    if source_val:
        _write_gfs_text(_gfs_meta_path("user", slug, owner_id, source_val),
                        json.dumps(meta_gfs, ensure_ascii=False), cfg)

    existing.name = final_name
    existing.icon = final_icon
    existing.description = final_description
    existing.version = final_version
    existing.compatibility = final_compat
    existing.changelog = final_changelog
    existing.profile = final_profile
    existing.category = final_category
    upsert_resp = db_mgr.upsert(existing)
    if not upsert_resp.status:
        logger.error("DB upsert failed for slug=%s: %s", slug, upsert_resp.message)
        raise HTTPException(status_code=500, detail=f"Database upsert failed: {upsert_resp.message}")

    return {
        "status": True, "message": "Update successful",
        "data": {
            "slug": slug, "name": final_name, "version": final_version,
            "icon": final_icon, "description": final_description,
            "changelog": final_changelog, "profile": final_profile or "",
        },
    }


async def _update_user(
    slug: str, user_id: str, file: UploadFile | None,
    display_name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None, source: str | None,
    profile: UploadFile | None = None,
    category: str | None = None,
) -> dict:
    from ....datamodel.db import SkillMeta, UserSkillMeta

    logger.info("[publish] _update_user enter slug=%s user_id=%s display_name=%s file=%s",
                slug, user_id, display_name, file.filename if file else None)
    user_id = _require_user_id(user_id)
    cfg = _require_gfs()

    source_val = None
    db_mgr_update = await _get_db()
    resp_db = db_mgr_update.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if resp_db.status and resp_db.data:
        rows = sorted(
            resp_db.data,
            key=lambda r: 0 if str(getattr(r, "source", "created") or "created") == "created" else 1,
        )
        source_val = str(getattr(rows[0], "source", "created") or "created")
    else:
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
        logger.warning("[publish] _update_user skill not found slug=%s user_id=%s", slug, user_id)
        raise HTTPException(status_code=404, detail="Skill not found")
    if source_val == "imported":
        raise HTTPException(status_code=403, detail="Collected skills cannot be edited")

    db_mgr = await _get_db()
    check_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug, "source": source_val})
    if check_resp.status and check_resp.data:
        existing_owner = getattr(check_resp.data[0], "owner", "")
        if existing_owner and existing_owner != user_id:
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    now = datetime.now(timezone.utc).isoformat()

    if file is not None:
        if not file.filename or not file.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Please upload a .zip file")
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
                    raise HTTPException(status_code=400, detail="SKILL.md not found")
                parsed = _parse_skill_md(skill_md_bytes.decode("utf-8"))
                if not parsed:
                    raise HTTPException(status_code=422, detail="SKILL.md format invalid")
            except zipfile.BadZipFile as e:
                raise HTTPException(status_code=400, detail="Invalid zip file") from e
            remote_path = _gfs_zip_path("user", slug, user_id, source_val)
            if not gfs_put(tmp_zip.name, remote_path, cfg):
                raise HTTPException(status_code=500, detail="Upload to GFS failed")
            if display_name is None:
                display_name = parsed.get("name")
            if icon is None:
                icon = parsed.get("icon")
            if description is None:
                description = parsed.get("description")
            if version is None:
                version = parsed.get("version")
        finally:
            try:
                os.unlink(tmp_zip.name)
            except OSError:
                pass

    new_profile_url: str | None = None
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
            profile_remote = f"{_gfs_prefix('user', user_id)}/{source_val}/{slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                new_profile_url = f"/api/skills/{slug}/profile"
        finally:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass

    final_name = display_name.strip() if (display_name is not None and display_name.strip()) else None
    final_icon = icon.strip() if (icon is not None and icon.strip()) else None
    final_description = description.strip() if (description is not None and description.strip()) else None
    final_version = version.strip() if (version is not None and version.strip()) else None
    final_changelog = changelog.strip() if (changelog is not None and changelog.strip()) else (changelog if changelog is not None else None)
    final_source = source.strip() if (source is not None and source.strip()) else None
    final_profile = new_profile_url
    final_category = category.strip() if (category is not None and category.strip()) else None

    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug, "source": source_val})
    if resp.status and resp.data:
        existing = resp.data[0]
        if final_name is not None:
            existing.name = final_name
        if final_icon is not None:
            existing.icon = final_icon
        if final_description is not None:
            existing.description = final_description
        if final_version is not None:
            existing.version = final_version
        if final_changelog is not None:
            existing.changelog = final_changelog
        if final_source is not None:
            existing.source = final_source
        if final_profile is not None:
            existing.profile = final_profile
        if final_category is not None:
            existing.category = final_category
        upsert_resp = db_mgr.upsert(existing)
        result_row = existing
    else:
        new_row = UserSkillMeta(
            user_id=user_id, slug=slug, name=final_name or slug,
            icon=final_icon or "package", description=final_description or "",
            version=final_version or "0.0.0", compatibility=None,
            owner=user_id, source=final_source or source_val or "created",
            changelog=final_changelog or "",
            profile=final_profile or "",
            category=final_category or "",
        )
        upsert_resp = db_mgr.upsert(new_row)
        result_row = new_row
    if not upsert_resp.status:
        logger.error("[publish] _update_user DB upsert failed for user=%s slug=%s: %s", user_id, slug, upsert_resp.message)

    pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if pub_resp.status and pub_resp.data:
        pub_row = pub_resp.data[0]
        user_category = getattr(result_row, "category", None) or ""
        if final_profile is not None:
            pub_row.profile = final_profile
        pub_row.category = user_category
        db_mgr.upsert(pub_row)

    logger.info("[publish] _update_user SUCCESS user=%s slug=%s", user_id, slug)
    return {
        "status": True, "message": "Update successful",
        "data": _user_skillmeta_to_dict(result_row, user_id),
    }