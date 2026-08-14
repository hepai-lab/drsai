"""Download, profile, and SKILL.md content endpoints."""

from __future__ import annotations

import os
import tempfile

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from ._constants import _PROFILE_EXT_WHITELIST, _SLUG_RE, router
from ._auth import _get_db, _require_type, _require_user_id, _resolve_user_from_apikey
from ._gfs import _gfs_prefix, _gfs_zip_path, _increment_public_downloads, _require_gfs
from ._skillmd import _read_file_from_zip
from ..gfs_utils import gfs_get


@router.get("/{slug}/download")
async def download_skill(
    slug: str,
    background_tasks: BackgroundTasks,
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
) -> FileResponse:
    """Download a skill ZIP. ?type=public or ?type=user&user_id=xxx"""
    from ....datamodel.db import SkillMeta
    import zipfile

    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    cfg = _require_gfs()
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    if type_ == "public":
        remote = _gfs_zip_path("public", slug)
        ok = gfs_get(remote, tmp_zip.name, cfg, timeout=60)
        if not ok:
            db_mgr = await _get_db()
            resp = db_mgr.get(SkillMeta, filters={"slug": slug})
            if resp.status and resp.data:
                owner = resp.data[0].owner
                if owner:
                    for src in ("created", "imported"):
                        remote = _gfs_zip_path("user", slug, owner, src)
                        if gfs_get(remote, tmp_zip.name, cfg, timeout=30):
                            ok = True
                            break
    else:
        user_id = _require_user_id(user_id)
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            raise HTTPException(status_code=401, detail="API key required")
        if auth_user_id != user_id:
            raise HTTPException(status_code=403, detail="Cannot download skills for another user")
        ok = False
        for src in ("created", "imported"):
            remote = _gfs_zip_path("user", slug, user_id, src)
            if gfs_get(remote, tmp_zip.name, cfg, timeout=30):
                ok = True
                break

    if not ok:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass
        raise HTTPException(status_code=404, detail="Skill not found")

    if type_ == "public":
        background_tasks.add_task(_increment_public_downloads, slug)

    def _cleanup() -> None:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass

    background_tasks.add_task(_cleanup)
    return FileResponse(
        tmp_zip.name, filename=f"{slug}.zip", media_type="application/zip",
        background=background_tasks,
    )


@router.get("/{slug}/profile")
async def get_skill_profile(slug: str) -> FileResponse:
    """Serve the profile/cover image for a public skill."""
    from ....datamodel.db import SkillMeta, UserSkillMeta

    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    cfg = _require_gfs()

    def _try_profile(prefix: str, sub: str = "") -> FileResponse | None:
        for ext in _PROFILE_EXT_WHITELIST:
            remote = f"{prefix}/{sub}profile{ext}" if sub else f"{prefix}/profile{ext}"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            tmp.close()
            ok = gfs_get(remote, tmp.name, cfg, timeout=15)
            if ok:
                media_map = {
                    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
                }
                return FileResponse(tmp.name, media_type=media_map.get(ext, "image/png"))
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        return None

    prefix = _gfs_prefix("public")
    result = _try_profile(prefix, f"{slug}/")
    if result:
        return result

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if resp.status and resp.data:
        owner = resp.data[0].owner
        if owner:
            for src in ("created", "imported"):
                user_prefix = _gfs_prefix("user", owner)
                result = _try_profile(f"{user_prefix}/{src}", f"{slug}/")
                if result:
                    return result

    user_resp = db_mgr.get(UserSkillMeta, filters={"slug": slug})
    if user_resp.status and user_resp.data:
        for usm in user_resp.data:
            uid = getattr(usm, "user_id", "")
            src = getattr(usm, "source", "created") or "created"
            if uid:
                user_prefix = _gfs_prefix("user", uid)
                result = _try_profile(f"{user_prefix}/{src}", f"{slug}/")
                if result:
                    return result

    raise HTTPException(status_code=404, detail="Profile image not found")


@router.get("/{slug}/skill-md")
async def get_skill_md(slug: str, request: Request, user_id: str = Query(...)) -> dict:
    """Read SKILL.md from a user's private skill ZIP."""
    import zipfile

    user_id = _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot read skills for another user")

    cfg = _require_gfs()
    for src in ("created", "imported"):
        remote = _gfs_zip_path("user", slug, user_id, src)
        tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_zip.close()
        ok = gfs_get(remote, tmp_zip.name, cfg, timeout=30)
        if not ok:
            try:
                os.unlink(tmp_zip.name)
            except OSError:
                pass
            continue
        try:
            with zipfile.ZipFile(tmp_zip.name, "r") as zf:
                skill_md_bytes = _read_file_from_zip(zf, "SKILL.md")
            if not skill_md_bytes:
                raise HTTPException(status_code=404, detail="SKILL.md not found in zip")
            text = skill_md_bytes.decode("utf-8")
            return {"status": True, "data": {"path": "SKILL.md", "content": text}}
        finally:
            try:
                os.unlink(tmp_zip.name)
            except OSError:
                pass

    raise HTTPException(status_code=404, detail="Skill not found")