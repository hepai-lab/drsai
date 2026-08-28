"""Upload skill endpoint."""

from __future__ import annotations

import os
import tempfile
import zipfile
from datetime import datetime, timezone

from fastapi import Depends, File, Form, HTTPException, Query, Request, UploadFile

from ._constants import _MAX_PROFILE_BYTES, _MAX_UPLOAD_BYTES, router, logger
from ._auth import _get_db, _resolve_user_from_apikey
from ._gfs import _ensure_cache_zip, _gfs_user_zip_path, _require_gfs
from ._skillmd import _parse_skill_md, _profile_safe_ext, _read_file_from_zip, _slugify
from ..gfs_utils import gfs_ls, gfs_put
from ...auth_source import get_display_name


@router.post("/upload")
async def upload_skill(
    request: Request,
    file: UploadFile = File(...),
    slug: str | None = Form(None),
    display_name: str | None = Form(None),
    name: str | None = Form(None),
    icon: str | None = Form(None),
    description: str | None = Form(None),
    version: str | None = Form(None),
    changelog: str | None = Form(None),
    tags: str | None = Form(None),
    visibility: str | None = Form(None),
    source: str | None = Form(None),
    profile: UploadFile | None = File(None),
) -> dict:
    """Upload a skill ZIP. Auth required."""
    logger.info("[publish] upload_skill called slug=%s display_name=%s file=%s",
                slug, display_name or name, file.filename if file else None)

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        logger.warning("[publish] upload_skill: no valid API key")
        raise HTTPException(status_code=401, detail="API key required for upload")

    return await _upload_skill(
        file, auth_user_id, slug, display_name or name, icon, description,
        version, changelog, profile, tags, visibility, source,
    )


async def _upload_skill(
    file: UploadFile, user_id: str, slug: str | None,
    display_name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None,
    profile: UploadFile | None = None,
    tags: str | None = None,
    visibility: str | None = None,
    source: str | None = None,
) -> dict:
    from ....datamodel.db import SkillMeta, SkillDetail

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

        # Write to user_skills/{user_id}/{slug}.zip
        remote_path = _gfs_user_zip_path(canon_slug, user_id)

        if gfs_ls(remote_path, cfg):
            db_mgr = await _get_db()
            check_resp = db_mgr.get(SkillMeta, filters={"slug": canon_slug})
            existing_owner = check_resp.data[0].owner_id if (check_resp.status and check_resp.data) else ""
            if existing_owner and existing_owner != user_id:
                from ....datamodel.db import Userinfo
                resp = db_mgr.get(Userinfo, filters={"user_id": user_id}, return_json=False)
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
            profile_remote = f"user_skills/{user_id}/{canon_slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                profile_url = f"/api/skills/{canon_slug}/profile"

        final_name = (display_name or "").strip() or parsed["name"]
        final_icon = (icon or "").strip() or parsed.get("icon", "package")
        final_description = description if description is not None else parsed.get("description", "")
        final_version = (version or "").strip() or parsed.get("version", "0.0.0")
        final_changelog = (changelog or "").strip()

        # Parse tags from frontmatter or form input
        tag_input = (tags or "").strip()
        final_tags = []
        if tag_input:
            final_tags = [t.strip() for t in tag_input.split(",") if t.strip()]
        if not final_tags:
            final_tags = parsed.get("tags", [])

        final_visibility = (visibility or "").strip().lower()
        if final_visibility not in ("public", "private", "team"):
            final_visibility = "public"

        _ensure_cache_zip("public", canon_slug, tmp_zip.name)

        db_mgr = await _get_db()

        # Resolve display name for author
        author_name = get_display_name(db_mgr, user_id) or user_id

        existing_resp = db_mgr.get(SkillMeta, filters={"slug": canon_slug})
        # Determine uskills_type from legacy source param or default to "created"
        source_val = (source or "").strip().lower()
        if source_val == "imported":
            utype = "imported"
        else:
            utype = "created"

        if existing_resp.status and existing_resp.data:
            existing = existing_resp.data[0]
            existing.name = final_name
            existing.icon = final_icon
            existing.version = final_version
            existing.description = final_description
            existing.owner_id = user_id
            existing.author = author_name
            existing.visibility = final_visibility
            existing.tags = final_tags
            existing.profile = profile_url or None
            # Keep existing uskills_type unless explicitly changed
            if source_val:
                existing.uskills_type = utype
            to_upsert = existing
        else:
            to_upsert = SkillMeta(
                slug=canon_slug, name=final_name, icon=final_icon,
                version=final_version,
                description=final_description,
                owner_id=user_id, author=author_name,
                visibility=final_visibility, source="user",
                uskills_type=utype,
                tags=final_tags, download_count=0,
                profile=profile_url or None,
            )
        db_mgr.upsert(to_upsert)

        # Upsert SkillDetail
        detail_resp = db_mgr.get(SkillDetail, filters={"slug": canon_slug})
        if detail_resp.status and detail_resp.data:
            detail = detail_resp.data[0]
            detail.description = final_description
            detail.body = parsed.get("body", "")
            detail.changelog = final_changelog
            detail.required_tools = parsed.get("required_tools", [])
        else:
            detail = SkillDetail(
                slug=canon_slug, description=final_description,
                body=parsed.get("body", ""), changelog=final_changelog,
                required_tools=parsed.get("required_tools", []),
            )
        db_mgr.upsert(detail)

        return {
            "status": True, "message": "Upload successful",
            "data": {
                "slug": canon_slug, "name": final_name,
                "description": final_description,
                "version": final_version, "icon": final_icon,
                "changelog": final_changelog or "",
                "profile": profile_url or "",
                "tags": final_tags,
                "visibility": final_visibility,
                "uskills_type": "created",
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