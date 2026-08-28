"""Update skill endpoint."""

from __future__ import annotations

import os
import tempfile
import zipfile

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile

from ._constants import _MAX_PROFILE_BYTES, _MAX_UPLOAD_BYTES, _SLUG_RE, router, logger
from ._auth import _get_db, _resolve_user_from_apikey, _skillmeta_to_dict
from ._gfs import _ensure_cache_zip, _gfs_user_zip_path, _require_gfs
from ._skillmd import _parse_skill_md, _profile_safe_ext, _read_file_from_zip
from ..gfs_utils import gfs_put


@router.put("/{slug}")
async def update_skill(
    slug: str,
    request: Request,
    file: UploadFile | None = File(None),
    display_name: str | None = Form(None),
    name: str | None = Form(None),
    icon: str | None = Form(None),
    description: str | None = Form(None),
    version: str | None = Form(None),
    changelog: str | None = Form(None),
    tags: str | None = Form(None),
    visibility: str | None = Form(None),
    profile: UploadFile | None = File(None),
) -> dict:
    """Update a skill. Auth required. Only owner/admins can edit."""
    logger.info("[publish] update_skill called slug=%s", slug)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required for write operations")
    return await _update_skill(
        slug, auth_user_id, file, name or display_name, icon, description,
        version, changelog, tags, visibility, profile,
    )


async def _update_skill(
    slug: str, user_id: str, file: UploadFile | None,
    name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None,
    tags: str | None = None,
    visibility: str | None = None,
    profile: UploadFile | None = None,
) -> dict:
    from ....datamodel.db import SkillMeta, SkillDetail

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing: SkillMeta = resp.data[0]

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
    remote_path = _gfs_user_zip_path(slug, existing.owner_id or user_id)

    if file is not None:
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

        tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_zip.close()
        try:
            val = await file.read()
            if len(val) > _MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
            with open(tmp_zip.name, "wb") as out:
                out.write(val)

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

            if not gfs_put(tmp_zip.name, remote_path, cfg):
                raise HTTPException(status_code=500, detail="Upload to GFS failed")

            _ensure_cache_zip("public", slug, tmp_zip.name)

            existing.name = name or existing.name or parsed.get("name")
            existing.icon = icon or existing.icon or parsed.get("icon", "package")
            existing.version = version or existing.version or parsed.get("version", "0.0.0")
            existing.description = description or parsed.get("description", "")
            if tags:
                existing.tags = [t.strip() for t in tags.split(",") if t.strip()]
            elif parsed.get("tags"):
                existing.tags = parsed["tags"]

            if profile_tmp:
                profile_remote = f"user_skills/{existing.owner_id or user_id}/{slug}/profile{profile_ext}"
                if gfs_put(profile_tmp.name, profile_remote, cfg):
                    existing.profile = f"/api/skills/{slug}/profile"

            detail_resp = db_mgr.get(SkillDetail, filters={"slug": slug})
            if detail_resp.status and detail_resp.data:
                detail = detail_resp.data[0]
                detail.description = description or parsed.get("description", "")
                detail.body = parsed.get("body", "")
                detail.changelog = changelog or ""
                detail.required_tools = parsed.get("required_tools", [])
                db_mgr.upsert(detail)
            else:
                db_mgr.upsert(SkillDetail(
                    slug=slug, description=description or parsed.get("description", ""),
                    body=parsed.get("body", ""), changelog=changelog or "",
                    required_tools=parsed.get("required_tools", []),
                ))
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
    else:
        if name:
            existing.name = name
        if icon:
            existing.icon = icon
        if version:
            existing.version = version
        if description:
            existing.description = description
        if tags:
            existing.tags = [t.strip() for t in tags.split(",") if t.strip()]

    if description:
        detail_resp = db_mgr.get(SkillDetail, filters={"slug": slug})
        if detail_resp.status and detail_resp.data:
            detail = detail_resp.data[0]
            detail.description = description
            if changelog:
                detail.changelog = changelog
            db_mgr.upsert(detail)
        else:
            db_mgr.upsert(SkillDetail(
                slug=slug, description=description,
                body="", changelog=changelog or "",
            ))

    if visibility:
        existing.visibility = visibility

    db_mgr.upsert(existing)

    return {
        "status": True, "message": f"Skill '{slug}' updated",
        "data": _skillmeta_to_dict(existing),
    }