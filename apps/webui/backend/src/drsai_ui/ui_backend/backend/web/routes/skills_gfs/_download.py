"""Download, profile, and SKILL.md content endpoints."""

from __future__ import annotations

import os
import tempfile

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from ._constants import _PROFILE_EXT_WHITELIST, _SLUG_RE, router
from ._auth import _get_db, _resolve_user_from_apikey
from ._gfs import (
    _gfs_zip_path, _gfs_higraf_zip_path, _gfs_user_zip_path,
    _increment_download_count, _require_gfs, _gfs_profile_dir,
)
from ._skillmd import _read_file_from_zip
from ..gfs_utils import gfs_get


def _resolve_zip_path(slug: str, cfg: dict) -> str | None:
    """Resolve the GFS zip path for a slug by checking SkillMeta, falling back to GFS scan."""
    # First try to look up from DB
    from ....datamodel.db import SkillMeta
    # We need to synchronously get the DB, but since this is a helper, we'll
    # let callers pass the resolved path. For now, default to user_skills scan.
    # Try higraf first, then user_skills
    if gfs_get(_gfs_higraf_zip_path(slug), tempfile.NamedTemporaryFile(delete=False, suffix=".zip").name, cfg, timeout=5):
        return _gfs_higraf_zip_path(slug)
    return _gfs_user_zip_path(slug, "")


@router.get("/{slug}/download")
async def download_skill(
    slug: str,
    background_tasks: BackgroundTasks,
    request: Request,
) -> FileResponse:
    """Download a skill ZIP. Resolves source from SkillMeta to find the correct GFS path."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    # Look up source and owner from SkillMeta
    from ....datamodel.db import SkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    source = "user"
    owner_id = ""
    if resp.status and resp.data:
        row = resp.data[0]
        source = row.source or "user"
        owner_id = row.owner_id or ""

    cfg = _require_gfs()
    remote = _gfs_zip_path(slug, owner_id=owner_id, source=source)
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    ok = gfs_get(remote, tmp_zip.name, cfg, timeout=60)

    if not ok:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass
        raise HTTPException(status_code=404, detail="Skill not found")

    background_tasks.add_task(_increment_download_count, slug)

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
async def get_profile(slug: str) -> FileResponse:
    """Serve the profile image for a skill. Tries user_skills, higraf, then public_skills."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    from ....datamodel.db import SkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    source = "user"
    owner_id = ""
    if resp.status and resp.data:
        row = resp.data[0]
        source = row.source or "user"
        owner_id = row.owner_id or ""

    cfg = _require_gfs()
    profile_dir = _gfs_profile_dir(slug, source=source, owner_id=owner_id)

    for ext in _PROFILE_EXT_WHITELIST:
        remote = f"{profile_dir}/profile{ext}"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        tmp.close()
        if gfs_get(remote, tmp.name, cfg, timeout=10):
            content_type_map = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
            }
            return FileResponse(
                tmp.name, media_type=content_type_map.get(ext, "application/octet-stream"),
            )
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    raise HTTPException(status_code=404, detail="Profile image not found")


@router.get("/{slug}/skill-md")
async def get_skill_md(slug: str, request: Request) -> dict:
    """Read SKILL.md content from the skill ZIP."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    from ._cache import _read_cached_skill_md
    from ....datamodel.db import SkillMeta

    text = _read_cached_skill_md("public", slug)
    if text:
        return {"status": True, "data": {"content": text}}

    # Look up source and owner from SkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    source = "user"
    owner_id = ""
    if resp.status and resp.data:
        row = resp.data[0]
        source = row.source or "user"
        owner_id = row.owner_id or ""

    cfg = _require_gfs()
    remote = _gfs_zip_path(slug, owner_id=owner_id, source=source)
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()
    try:
        ok = gfs_get(remote, tmp_zip.name, cfg, timeout=30)
        if not ok:
            raise HTTPException(status_code=404, detail="Skill not found")
        import zipfile
        with zipfile.ZipFile(tmp_zip.name) as zf:
            for name in zf.namelist():
                if name.lower().endswith("skill.md"):
                    content = zf.read(name).decode("utf-8", errors="replace")
                    _ensure_cache_zip("public", slug, tmp_zip.name)
                    return {"status": True, "data": {"content": content}}
        raise HTTPException(status_code=404, detail="SKILL.md not found in package")
    finally:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass


def _ensure_cache_zip(type_: str, slug: str, zip_path: str) -> None:
    from ._cache import _ensure_cache_zip as _f
    _f(type_, slug, zip_path)


# ═══════════════════════════════════════════════════════════════════════════════
# Internal download helpers used by deer_flow.py and agent_skills.py
# ═══════════════════════════════════════════════════════════════════════════════

async def _gfs_download_public_skill_bytes(slug: str) -> bytes | None:
    """Download skill ZIP bytes from GFS. Resolves source from SkillMeta."""
    import tempfile
    import os
    from ..gfs_utils import gfs_get

    # Look up source and owner
    from ....datamodel.db import SkillMeta
    from ._auth import _get_db as _get_db_sync
    db_mgr = await _get_db_sync()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    source = "user"
    owner_id = ""
    if resp.status and resp.data:
        row = resp.data[0]
        source = row.source or "user"
        owner_id = row.owner_id or ""

    cfg = _require_gfs()
    remote = _gfs_zip_path(slug, owner_id=owner_id, source=source)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    try:
        ok = gfs_get(remote, tmp.name, cfg, timeout=60)
        if not ok:
            return None
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


async def _gfs_download_user_skill_bytes(slug: str, user_id: str) -> bytes | None:
    """Download user skill ZIP bytes from user_skills/{user_id}/{slug}.zip."""
    import tempfile
    import os
    from ..gfs_utils import gfs_get

    cfg = _require_gfs()
    remote = _gfs_user_zip_path(slug, user_id)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    try:
        ok = gfs_get(remote, tmp.name, cfg, timeout=60)
        if not ok:
            return None
        with open(tmp.name, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass