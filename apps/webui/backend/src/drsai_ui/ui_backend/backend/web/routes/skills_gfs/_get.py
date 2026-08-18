"""Get skill detail endpoint."""

from __future__ import annotations

import os
import tempfile

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _PROFILE_EXT_WHITELIST, _SLUG_RE, router
from ._auth import _get_db, _require_type, _require_user_id, _resolve_user_from_apikey, _user_skillmeta_to_dict, _field
from ._gfs import _ensure_cache_zip, _gfs_prefix, _gfs_zip_path, _require_gfs
from ._skillmd import _parse_skill_md, _read_file_from_zip, _read_skill_md_from_zip
from ._cache import _read_cached_skill_md
from ..gfs_utils import gfs_get


@router.get("/{slug}")
async def get_skill(
    slug: str,
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
) -> dict:
    """Get a single skill. ?type=public or ?type=user&user_id=xxx"""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    if type_ == "public":
        return await _get_public(slug, request)
    return await _get_user(request, slug, user_id)


async def _get_public(slug: str, request: Request) -> dict:
    from ....datamodel.db import SkillMeta
    from ..deer_flow import is_higraf_skill_slug

    user_id: str | None = None
    try:
        user_id = await _resolve_user_from_apikey(request)
    except HTTPException:
        pass

    if is_higraf_skill_slug(slug):
        # Higraf skills may exist in SkillMeta for list speed, but body lives on Higraf.
        return await _get_higraf_public(slug)

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})

    if resp.status and resp.data:
        row: SkillMeta = resp.data[0]
        body = ""
        text = _read_cached_skill_md("public", slug)
        if text:
            parsed = _parse_skill_md(text)
            if parsed:
                body = parsed["body"]
        if not body:
            cfg = _require_gfs()
            zip_path = _gfs_zip_path("public", slug)
            gfs_text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
            if gfs_text:
                gfs_parsed = _parse_skill_md(gfs_text)
                if gfs_parsed:
                    body = gfs_parsed["body"]
                if zip_tmp:
                    _ensure_cache_zip("public", slug, zip_tmp)
                    try:
                        os.unlink(zip_tmp)
                    except OSError:
                        pass

        can_edit = bool(user_id and user_id == row.owner)
        if not can_edit and user_id:
            from ...authz import get_is_platform_admin
            if get_is_platform_admin(db_mgr, user_id):
                can_edit = True

        return {
            "status": True,
            "data": {
                "slug": row.slug, "name": row.name, "description": row.description,
                "compatibility": row.compatibility, "icon": row.icon,
                "version": row.version, "body": body,
                "changelog": row.changelog or "", "owner": row.owner,
                "profile": row.profile or "",
                "category": row.category or "",
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
                "downloads": row.downloads, "can_edit": can_edit,
            },
        }

    # GFS fallback
    cfg = _require_gfs()
    zip_path = _gfs_zip_path("public", slug)
    text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
    if not text:
        if is_higraf_skill_slug(slug):
            return await _get_higraf_public(slug)
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

    final_name = parsed["name"]
    final_icon = parsed.get("icon", "package")
    final_desc = parsed.get("description", "")
    final_version = parsed.get("version", "0.0.0")
    final_owner = ""
    final_changelog = ""

    # Check for profile image in GFS
    final_profile = ""
    prefix = _gfs_prefix("public")
    for _ext in _PROFILE_EXT_WHITELIST:
        _profile_remote = f"{prefix}/{slug}/profile{_ext}"
        _profile_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=_ext)
        _profile_tmp.close()
        if gfs_get(_profile_remote, _profile_tmp.name, cfg, timeout=10):
            final_profile = f"/api/skills/{slug}/profile"
            try:
                os.unlink(_profile_tmp.name)
            except OSError:
                pass
            break
        try:
            os.unlink(_profile_tmp.name)
        except OSError:
            pass

    try:
        db_mgr.upsert(SkillMeta(
            slug=slug, name=final_name, description=final_desc, icon=final_icon,
            version=final_version, compatibility=parsed.get("compatibility"),
            owner=final_owner, downloads=0,
            profile=final_profile or None, changelog=final_changelog,
            category=", ".join(parsed.get("tags", [])) or None,
        ))
    except Exception:
        from ._constants import logger
        logger.warning("get_skill: DB backfill failed for %s", slug, exc_info=True)

    can_edit = bool(user_id and user_id == final_owner)
    if not can_edit and user_id:
        from ...authz import get_is_platform_admin
        if get_is_platform_admin(db_mgr, user_id):
            can_edit = True

    return {
        "status": True,
        "data": {
            "slug": slug, "name": final_name, "description": final_desc,
            "compatibility": parsed.get("compatibility"), "icon": final_icon,
            "version": final_version, "body": parsed["body"],
            "changelog": final_changelog, "owner": final_owner,
            "profile": final_profile,
            "created_at": "",
            "updated_at": "",
            "downloads": 0, "can_edit": can_edit,
            "category": ", ".join(parsed.get("tags", [])) or "",
        },
    }


async def _get_higraf_public(slug: str) -> dict:
    import io
    import zipfile

    from ..deer_flow import download_higraf_skill_bytes, fetch_higraf_skill_detail

    detail = await fetch_higraf_skill_detail(slug)
    if not detail:
        raise HTTPException(status_code=404, detail="Skill not found")

    body = (detail.get("content") or "").strip()
    compatibility = None
    if not body:
        zip_bytes = await download_higraf_skill_bytes(slug)
        if zip_bytes:
            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    md_bytes = _read_file_from_zip(zf, "SKILL.md")
                if md_bytes:
                    parsed = _parse_skill_md(md_bytes.decode("utf-8"))
                    if parsed:
                        body = parsed.get("body", "")
                        compatibility = parsed.get("compatibility")
            except zipfile.BadZipFile:
                from ._constants import logger
                logger.warning("get_skill: invalid Higraf zip for %s", slug)

    return {
        "status": True,
        "data": {
            "slug": slug,
            "name": detail.get("name") or detail.get("skillName", slug),
            "description": detail.get("description", ""),
            "compatibility": compatibility,
            "icon": detail.get("emoji", "package"),
            "version": detail.get("version") or detail.get("currentVersion", "1.0.0"),
            "body": body,
            "changelog": "",
            "owner": detail.get("authorName", ""),
            "profile": "",
            "category": detail.get("categoryL2", ""),
            "created_at": detail.get("createdAt", ""),
            "updated_at": detail.get("updatedAt", ""),
            "downloads": detail.get("callCount", 0),
            "source": "higraf",
            "can_edit": False,
        },
    }


async def _get_user(request: Request, slug: str, user_id: str) -> dict:
    """Get a single user skill detail, including body (SKILL.md content)."""
    import zipfile
    from ....datamodel.db import UserSkillMeta
    user_id = _require_user_id(user_id)

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot view skills for another user")

    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if resp.status and resp.data:
        # Prefer 'created' when both sources exist for the same slug
        rows = sorted(resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)
        row = rows[0]
        source = str(_field(row, "source", "created"))
        cfg = _require_gfs()

        # Read body from cache or GFS
        body = _read_cached_skill_md("user", slug, user_id)
        if not body:
            zip_path = _gfs_zip_path("user", slug, user_id, source)
            gfs_text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
            if gfs_text:
                parsed = _parse_skill_md(gfs_text)
                if parsed:
                    body = parsed["body"]
                if zip_tmp:
                    _ensure_cache_zip("user", slug, zip_tmp, user_id)
                    try:
                        os.unlink(zip_tmp)
                    except OSError:
                        pass

        result = _user_skillmeta_to_dict(row, user_id)
        if body:
            result["body"] = body
        if getattr(row, "unlisted", False):
            result["unlisted"] = True
        if result.get("source") == "imported":
            from ._gfs import (
                _apply_imported_catalog_fields,
                _catalog_fields_for_slug,
                _higraf_catalog_by_slug,
                _skillmeta_by_slugs,
            )
            pub_map = _skillmeta_by_slugs(db_mgr, {slug})
            _apply_imported_catalog_fields(
                result,
                user_id,
                _catalog_fields_for_slug(slug, pub_map.get(slug), _higraf_catalog_by_slug().get(slug)),
            )
        return {"status": True, "data": result}

    # GFS fallback
    cfg = _require_gfs()
    for source in ("created", "imported"):
        remote = _gfs_zip_path("user", slug, user_id, source)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        ok = gfs_get(remote, tmp.name, cfg, timeout=30)
        if not ok:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            continue
        try:
            with zipfile.ZipFile(tmp.name, "r") as zf:
                md_bytes = _read_file_from_zip(zf, "SKILL.md")
            text = md_bytes.decode("utf-8") if md_bytes else None
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

        parsed = _parse_skill_md(text) if text else None
        item = {
            "slug": slug, "name": parsed["name"] if parsed else slug,
            "description": parsed.get("description", "") if parsed else "",
            "icon": parsed.get("icon", "package") if parsed else "package",
            "version": parsed.get("version", "0.0.0") if parsed else "0.0.0",
            "owner": user_id, "source": source,
            "created_at": "",
            "updated_at": "",
            "downloads": 0,
            "changelog": "",
            "unlisted": False,
        }
        result = _user_skillmeta_to_dict(item, user_id)
        if parsed and parsed.get("body"):
            result["body"] = parsed["body"]
        return {"status": True, "data": result}

    raise HTTPException(status_code=404, detail="Skill not found")