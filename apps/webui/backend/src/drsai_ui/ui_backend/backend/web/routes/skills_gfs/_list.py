"""List skills endpoint."""

from __future__ import annotations

import os
import tempfile

from fastapi import Depends, HTTPException, Query, Request

from ._constants import _PROFILE_EXT_WHITELIST, _SLUG_RE, router
from ._auth import _get_db, _public_skillmeta_to_dict, _require_type, _require_user_id, _resolve_user_from_apikey, _user_skillmeta_to_dict
from ._gfs import _annotate_user_skill_downloads, _ensure_cache_zip, _fill_user_skill_descriptions, _gfs_prefix, _require_gfs
from ._skillmd import _parse_skill_md, _read_skill_md_from_zip
from ..gfs_utils import gfs_get, gfs_ls


@router.get("")
async def list_skills(
    request: Request,
    type_: str = Depends(_require_type),
    user_id: str = Query(""),
) -> dict:
    """List skills. ?type=public or ?type=user&user_id=xxx"""
    if type_ == "public":
        return await _list_public(request)
    return await _list_user(request, user_id)


async def _list_public(request: Request) -> dict:
    from ....datamodel.db import SkillMeta
    user_id: str | None = None
    is_admin = False
    try:
        user_id = await _resolve_user_from_apikey(request)
    except HTTPException:
        pass
    if user_id:
        from ...authz import get_is_platform_admin
        db_mgr = await _get_db()
        is_admin = get_is_platform_admin(db_mgr, user_id)

    def _with_can_edit(item: dict) -> dict:
        item["can_edit"] = is_admin or (user_id is not None and user_id == item.get("owner", ""))
        return item

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, order="asc")
    if resp.status and resp.data:
        items = [_with_can_edit(_public_skillmeta_to_dict(row)) for row in resp.data]
        return {"status": True, "data": items}

    # GFS fallback
    cfg = _require_gfs()
    prefix = _gfs_prefix("public")
    entries = gfs_ls(prefix, cfg) or []
    items = []

    for entry in entries:
        if entry.get("is_dir"):
            continue
        ename = entry.get("name", "")
        if not ename.lower().endswith(".zip"):
            continue
        slug = ename[:-4]
        if not _SLUG_RE.match(slug):
            continue

        zip_path = f"{prefix}/{slug}.zip"
        text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
        parsed = _parse_skill_md(text) if text else None

        final_name = parsed["name"] if parsed else slug
        final_description = parsed.get("description", "") if parsed else ""
        final_icon = parsed.get("icon", "package") if parsed else "package"
        final_version = parsed.get("version", "0.0.0") if parsed else "0.0.0"
        final_owner = ""
        final_changelog = ""

        # Check for profile image in GFS
        final_profile = ""
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

        if zip_tmp:
            _ensure_cache_zip("public", slug, zip_tmp)
            try:
                os.unlink(zip_tmp)
            except OSError:
                pass

        try:
            db_mgr.upsert(SkillMeta(
                slug=slug, name=final_name, description=final_description,
                icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility") if parsed else None,
                owner=final_owner, downloads=0,
                profile=final_profile or None, changelog=final_changelog,
            ))
        except Exception:
            from ._constants import logger
            logger.warning("list_skills: DB backfill failed for %s", slug, exc_info=True)

        items.append(_with_can_edit({
            "slug": slug, "name": final_name, "description": final_description,
            "compatibility": parsed.get("compatibility") if parsed else None,
            "icon": final_icon, "version": final_version, "owner": final_owner,
            "updated_at": "", "downloads": 0,
            "profile": final_profile, "changelog": final_changelog,
            "category": "",
        }))

    items.sort(key=lambda x: x.get("name", ""))
    return {"status": True, "data": items}


async def _list_user(request: Request, user_id: str) -> dict:
    from datetime import datetime
    from ....datamodel.db import SkillMeta, UserSkillMeta
    from ._constants import logger
    logger.info("[list_user] enter user_id=%s", user_id)
    user_id = _require_user_id(user_id)

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot list skills for another user")

    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id}, order="desc")
    logger.info("[list_user] DB query status=%s count=%s", resp.status, len(resp.data) if resp.data else 0)

    if resp.status and resp.data:
        rows = []
        for item in resp.data:
            row = _user_skillmeta_to_dict(item, user_id)
            if getattr(item, "unlisted", False):
                row["unlisted"] = True
            rows.append(row)
    else:
        rows = []

    # Annotate each row with whether it is currently published (exists in SkillMeta)
    if rows:
        public_resp = db_mgr.get(SkillMeta, filters={"owner": user_id}, order="desc")
        public_slugs: set[str] = set()
        if public_resp.status and public_resp.data:
            public_slugs = {pub.slug for pub in public_resp.data}
        for r in rows:
            r["public"] = r["slug"] in public_slugs
        _fill_user_skill_descriptions(rows, user_id, db_mgr, _require_gfs())
        _annotate_user_skill_downloads(rows, db_mgr)
        logger.info("[list_user] DB path return count=%s slugs=%s", len(rows), [r["slug"] for r in rows])
        return {"status": True, "data": rows}

    logger.info("[list_user] DB empty, falling through to GFS scan")

    cfg = _require_gfs()
    prefix = _gfs_prefix("user", user_id)
    logger.info("[list_user] GFS scan prefix=%s", prefix)
    all_items: list[dict] = []

    for source in ("created", "imported"):
        dir_prefix = f"{prefix}/{source}/"
        entries = gfs_ls(dir_prefix, cfg)
        logger.info("[list_user] GFS scan source=%s dir=%s entries=%s", source, dir_prefix, len(entries) if entries else 0)
        if not entries:
            continue
        seen: set[str] = set()
        for entry in entries:
            if entry.get("is_dir"):
                continue
            ename = entry.get("name", "")
            if not ename.lower().endswith(".zip"):
                continue
            slug = ename[:-4]
            if not _SLUG_RE.match(slug) or slug in seen:
                continue
            seen.add(slug)
            all_items.append({
                "slug": slug, "name": slug,
                "description": "",
                "icon": "package",
                "version": "0.0.0",
                "owner": user_id,
                "source": source,
                "created_at": "",
                "updated_at": "",
                "downloads": 0,
                "changelog": "",
            })

    all_items.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    rows = []
    for item in all_items:
        rows.append(_user_skillmeta_to_dict(item, user_id))
        created_dt: datetime | None = None
        raw = item.get("created_at", "")
        if raw:
            try:
                created_dt = datetime.fromisoformat(raw)
            except (ValueError, TypeError):
                created_dt = datetime.now()
        db_mgr.upsert(UserSkillMeta(
            user_id=user_id, slug=item["slug"], name=item["name"],
            description=item.get("description", ""),
            icon=item.get("icon", "package"),
            version=item.get("version", "0.0.0"),
            compatibility=None, owner=item.get("owner", user_id),
            source=item["source"], changelog=item.get("changelog", ""),
            created_at=created_dt,
        ))

    # Annotate each row with whether it is currently published (exists in SkillMeta)
    if rows:
        public_resp2 = db_mgr.get(SkillMeta, filters={"owner": user_id}, order="desc")
        public_slugs2: set[str] = set()
        if public_resp2.status and public_resp2.data:
            public_slugs2 = {pub.slug for pub in public_resp2.data}
        for r in rows:
            r["public"] = r["slug"] in public_slugs2

    _fill_user_skill_descriptions(rows, user_id, db_mgr, cfg)
    _annotate_user_skill_downloads(rows, db_mgr)

    logger.info("[list_user] GFS path return count=%s slugs=%s", len(rows), [r["slug"] for r in rows])
    return {"status": True, "data": rows}