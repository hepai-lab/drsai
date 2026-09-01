"""Get skill detail endpoint."""

from __future__ import annotations

import os
import re
import tempfile

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _SLUG_RE, router, logger
from ._auth import _get_db, _resolve_user_from_apikey, _skillmeta_to_dict, _skilldetail_to_dict
from ._gfs import _gfs_zip_path, _require_gfs
from ._skillmd import _parse_skill_md, _read_skill_md_from_zip
from ._cache import _ensure_cache_zip

_HIGRAF_SKILL_SLUG_RE = re.compile(r"^skill-[a-zA-Z0-9-]+$")


@router.get("/{slug}")
async def get_skill(
    slug: str,
    request: Request,
) -> dict:
    """Get a single skill by slug. Returns SkillMeta + SkillDetail merged."""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    return await _get_skill(slug, request)


async def _get_skill(slug: str, request: Request) -> dict:
    from ....datamodel.db import SkillMeta, SkillDetail

    user_id: str | None = None
    try:
        user_id = await _resolve_user_from_apikey(request)
    except HTTPException:
        pass

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})

    if not resp.status or not resp.data:
        # Try Higraf fallback for skill-xxx style slugs
        if _HIGRAF_SKILL_SLUG_RE.match(slug):
            detail = await _try_higraf_fallback(slug, db_mgr)
            if detail:
                return detail

        # Try GFS fallback — check both higraf/ and user_skills/ paths
        cfg = _require_gfs()
        # Try higraf path first
        zip_path = _gfs_zip_path(slug, source="higraf")
        text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
        if not text:
            # Try user_skills fallback with empty user_id
            zip_path = _gfs_zip_path(slug, source="user")
            text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
        if not text:
            raise HTTPException(status_code=404, detail="Skill not found")
        parsed = _parse_skill_md(text)
        if not parsed:
            raise HTTPException(status_code=422, detail="SKILL.md format invalid")

        if zip_tmp:
            _ensure_cache_zip("public", slug, zip_tmp)
            try:
                os.unlink(zip_tmp)
            except OSError:
                pass

        # Backfill SkillMeta from GFS
        try:
            db_mgr.upsert(SkillMeta(
                slug=slug,
                name=parsed["name"],
                icon=parsed.get("icon", "package"),
                version=parsed.get("version", "0.0.0"),
                description=parsed.get("description", ""),
                author="",
                tags=parsed.get("tags", []),
            ))
        except Exception:
            logger.warning("get_skill: DB backfill failed for %s", slug, exc_info=True)

        # Backfill SkillDetail
        try:
            db_mgr.upsert(SkillDetail(
                slug=slug,
                description=parsed.get("description", ""),
                body=parsed.get("body", ""),
                changelog="",
                required_tools=parsed.get("required_tools", []),
            ))
        except Exception:
            logger.warning("get_skill: SkillDetail backfill failed for %s", slug, exc_info=True)

        can_edit = bool(user_id)
        meta = {
            "slug": slug, "name": parsed["name"],
            "icon": parsed.get("icon", "package"),
            "version": parsed.get("version", "0.0.0"),
            "description": parsed.get("description", ""),
            "tags": parsed.get("tags", []),
            "owner": "", "owner_id": "", "author": "", "visibility": "public",
            "source": "user", "uskills_type": None, "imported_ref": None,
            "downloads": 0,
            "collects": 0,
            "collector_ids": [], "agent_ids": [], "team_ids": [],
            "profile": "", "created_at": "", "updated_at": "",
            "can_edit": can_edit,
        }
        detail = {
            "description": parsed.get("description", ""),
            "body": parsed.get("body", ""),
            "changelog": "",
            "author_email": None,
            "author_id": None,
            "required_tools": parsed.get("required_tools", []),
            "detail_raw": None,
        }
        return {"status": True, "data": {**meta, **detail}}

    row: SkillMeta = resp.data[0]
    can_edit = bool(user_id and user_id == row.owner_id)
    if not can_edit and user_id:
        from ...authz import get_is_platform_admin
        if get_is_platform_admin(db_mgr, user_id):
            can_edit = True

    meta = _skillmeta_to_dict(row)
    meta["can_edit"] = can_edit

    # Load SkillDetail
    detail_resp = db_mgr.get(SkillDetail, filters={"slug": slug})
    if detail_resp.status and detail_resp.data:
        detail = _skilldetail_to_dict(detail_resp.data[0])
    else:
        # Try to populate SkillDetail from GFS zip
        detail = await _populate_detail_from_gfs(slug, row.source, row.owner_id)

    return {"status": True, "data": {**meta, **detail}}


async def _populate_detail_from_gfs(slug: str, source: str = "user", owner_id: str = "") -> dict:
    from ....datamodel.db import SkillDetail

    cfg = _require_gfs()
    zip_path = _gfs_zip_path(slug, owner_id=owner_id, source=source)
    text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
    if text:
        parsed = _parse_skill_md(text)
        if parsed:
            if zip_tmp:
                _ensure_cache_zip("public", slug, zip_tmp)
                try:
                    os.unlink(zip_tmp)
                except OSError:
                    pass

            db_mgr = await _get_db()
            try:
                db_mgr.upsert(SkillDetail(
                    slug=slug,
                    description=parsed.get("description", ""),
                    body=parsed.get("body", ""),
                    changelog="",
                    required_tools=parsed.get("required_tools", []),
                ))
            except Exception:
                logger.warning("_populate_detail_from_gfs: upsert failed for %s", slug, exc_info=True)

            return {
                "description": parsed.get("description", ""),
                "body": parsed.get("body", ""),
                "changelog": "",
                "author_email": None,
                "author_id": None,
                "required_tools": parsed.get("required_tools", []),
                "detail_raw": None,
            }
    return {"description": "", "body": "", "changelog": "", "author_email": None,
            "author_id": None, "required_tools": [], "detail_raw": None}


async def _try_higraf_fallback(slug: str, db_mgr) -> dict | None:
    """Try to fetch skill detail from Higraf and persist it locally."""
    try:
        from ..deer_flow import (
            fetch_higraf_skill_detail,
            download_higraf_skill_bytes,
            _HIGRAF_SKILL_SLUG_RE as _HIGRAF_RE,
            _persist_higraf_skills,
        )
    except ImportError:
        return None

    if not _HIGRAF_RE.match(slug):
        return None

    # Fetch skill detail from Higraf
    detail = await fetch_higraf_skill_detail(slug)
    if not detail:
        return None

    name = detail.get("name") or detail.get("skillName") or slug
    description = detail.get("description") or ""
    icon = detail.get("emoji") or "package"
    version = detail.get("version") or detail.get("currentVersion") or "1.0.0"
    author = detail.get("authorName") or "系统预置"
    tags = [detail.get("categoryL2")] if detail.get("categoryL2") else []
    downloads = int(detail.get("callCount") or 0)

    # Try to get the body content from a download
    body = ""
    try:
        zip_bytes, restricted = await download_higraf_skill_bytes(slug)
        if zip_bytes and not restricted:
            import io, zipfile
            with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                for name in zf.namelist():
                    if name.rstrip("/").split("/")[-1].lower() == "skill.md":
                        body = zf.read(name).decode("utf-8", errors="replace")
                        break
    except Exception:
        logger.warning("_try_higraf_fallback: download failed for %s", slug, exc_info=True)

    # Construct response
    meta = {
        "slug": slug,
        "name": name,
        "icon": icon,
        "version": version,
        "description": description,
        "tags": tags,
        "owner": author,
        "owner_id": "system",
        "author": author,
        "visibility": "public",
        "source": "higraf",
        "uskills_type": None,
        "imported_ref": None,
        "downloads": downloads,
        "collects": 0,
        "collector_ids": [],
        "agent_ids": [],
        "team_ids": [],
        "profile": "",
        "created_at": "",
        "updated_at": "",
        "can_edit": False,
    }
    skill_detail = {
        "description": description,
        "body": body,
        "changelog": "",
        "author_email": None,
        "author_id": None,
        "required_tools": detail.get("required_tools") or [],
        "detail_raw": None,
    }

    return {"status": True, "data": {**meta, **skill_detail}}