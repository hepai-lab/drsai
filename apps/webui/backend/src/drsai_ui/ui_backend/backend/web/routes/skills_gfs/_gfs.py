"""GFS config, prefix helpers, and cross-cutting GFS utilities."""

from __future__ import annotations

import os
import tempfile

from fastapi import HTTPException

from ...config import settings
from ._constants import SkillType
from ..gfs_utils import gfs_get, gfs_ls, gfs_put, gfs_read_text
from ._skillmd import _parse_skill_md
from ._cache import _ensure_cache_zip, _read_cached_skill_md


# ═══════════════════════════════════════════════════════════════════════════════
# GFS config
# ═══════════════════════════════════════════════════════════════════════════════

def _gfs_cfg() -> dict | None:
    ak = os.getenv("DRSAI_UI_GFS_SKILLS_AK") or settings.GFS_SKILLS_AK
    sk = os.getenv("DRSAI_UI_GFS_SKILLS_SK") or settings.GFS_SKILLS_SK
    bucket = os.getenv("DRSAI_UI_GFS_SKILLS_BUCKET") or settings.GFS_SKILLS_BUCKET
    endpoint = os.getenv("DRSAI_UI_GFS_SKILLS_ENDPOINT") or settings.GFS_SKILLS_ENDPOINT
    if not (ak and sk and bucket):
        return None
    return {"access_key": ak, "secret_key": sk, "bucket_name": bucket, "endpoint": endpoint}


def _require_gfs() -> dict:
    cfg = _gfs_cfg()
    if not cfg:
        raise HTTPException(status_code=503, detail="Skills GFS not configured")
    return cfg


# ═══════════════════════════════════════════════════════════════════════════════
# GFS prefix helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _gfs_prefix(skill_type: SkillType, user_id: str = "") -> str:
    if skill_type == "public":
        return "public_skills"
    return f"user_skills/{user_id}"


def _gfs_zip_path(skill_type: SkillType, slug: str, user_id: str = "", source: str = "") -> str:
    prefix = _gfs_prefix(skill_type, user_id)
    if skill_type == "public":
        return f"{prefix}/{slug}.zip"
    return f"{prefix}/{source}/{slug}.zip"


def _gfs_meta_path(skill_type: SkillType, slug: str, user_id: str = "", source: str = "") -> str:
    prefix = _gfs_prefix(skill_type, user_id)
    if skill_type == "public":
        return f"{prefix}/{slug}/meta.json"
    return f"{prefix}/{source}/{slug}/meta.json"


def _gfs_source_dir_prefix(skill_type: SkillType, source: str, user_id: str = "") -> str:
    prefix = _gfs_prefix(skill_type, user_id)
    return f"{prefix}/{source}/"


# ═══════════════════════════════════════════════════════════════════════════════
# GFS operations
# ═══════════════════════════════════════════════════════════════════════════════

async def _clear_unlisted_flag(user_id: str, slug: str) -> None:
    """Clear the 'unlisted' flag on UserSkillMeta after re-publish."""
    from ._auth import _get_db
    from ....datamodel.db import UserSkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if resp.status and resp.data:
        for rec in resp.data:
            if getattr(rec, "unlisted", False):
                rec.unlisted = False
                db_mgr.upsert(rec)


def _user_zip_exists(cfg: dict, slug: str, user_id: str) -> bool:
    for src in ("created", "imported"):
        if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
            return True
    return False


def _ensure_user_zip_from_public(cfg: dict, slug: str, user_id: str) -> bool:
    """Copy public skill ZIP into user GFS when the owner copy is missing."""
    if _user_zip_exists(cfg, slug, user_id):
        return True
    public_zip = _gfs_zip_path("public", slug)
    user_zip = _gfs_zip_path("user", slug, user_id, "created")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    try:
        if gfs_get(public_zip, tmp.name, cfg) and gfs_put(tmp.name, user_zip, cfg):
            _ensure_cache_zip("user", slug, tmp.name, user_id)
            return True
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
    return False


def _skillmeta_by_slugs(db_mgr, slugs: set[str]) -> dict:
    """Load SkillMeta rows for the given slugs in as few queries as possible."""
    from sqlmodel import Session, select

    from ....datamodel.db import SkillMeta

    if not slugs:
        return {}
    result: dict = {}
    slug_list = list(slugs)
    # Stay under typical SQL bind-variable limits (sqlite: 999).
    chunk_size = 400
    with Session(db_mgr.engine) as session:
        for i in range(0, len(slug_list), chunk_size):
            chunk = slug_list[i : i + chunk_size]
            rows = session.exec(select(SkillMeta).where(SkillMeta.slug.in_(chunk))).all()
            for row in rows:
                result[row.slug] = row
    return result


def _higraf_catalog_by_slug() -> dict[str, dict]:
    try:
        from ..deer_flow import get_cached_higraf_skills
    except Exception:
        return {}
    out: dict[str, dict] = {}
    for h in get_cached_higraf_skills("public") or []:
        slug = str(h.get("skillId") or h.get("id") or "")
        if slug:
            out[slug] = h
    return out


def _catalog_fields_for_slug(slug: str, pub=None, higraf: dict | None = None) -> dict:
    """Original author / icon / cover from the public catalog or Higraf cache."""
    fields: dict = {}
    if pub is not None:
        owner = (getattr(pub, "owner", None) or "").strip()
        icon = (getattr(pub, "icon", None) or "").strip()
        profile = (getattr(pub, "profile", None) or "").strip()
        description = (getattr(pub, "description", None) or "").strip()
        category = (getattr(pub, "category", None) or "").strip()
        version = (getattr(pub, "version", None) or "").strip()
        if owner:
            fields["owner"] = owner
        if icon:
            fields["icon"] = icon
        if profile:
            fields["profile"] = profile
        if description:
            fields["description"] = description
        if category:
            fields["category"] = category
        if version:
            fields["version"] = version
    h = higraf or {}
    if h:
        owner = (h.get("authorName") or h.get("author") or "").strip()
        icon = (h.get("emoji") or "").strip()
        description = (h.get("description") or "").strip()
        category = (h.get("categoryL2") or "").strip()
        version = (h.get("version") or h.get("currentVersion") or "").strip()
        if owner and not fields.get("owner"):
            fields["owner"] = owner
        if icon and (not fields.get("icon") or fields.get("icon") == "package"):
            fields["icon"] = icon
        if description and not fields.get("description"):
            fields["description"] = description
        if category and not fields.get("category"):
            fields["category"] = category
        if version and (not fields.get("version") or fields.get("version") == "0.0.0"):
            fields["version"] = version
    if not fields.get("owner"):
        try:
            from ..deer_flow import is_higraf_skill_slug
            if is_higraf_skill_slug(slug):
                fields["owner"] = "系统预置"
        except Exception:
            pass
    return fields


def _apply_imported_catalog_fields(row: dict, user_id: str, catalog: dict) -> None:
    """Restore original author/logo on a collected skill. Never treat the collector as author."""
    if not catalog:
        return
    cur_owner = (row.get("owner") or "").strip()
    if catalog.get("owner") and (not cur_owner or cur_owner == user_id):
        row["owner"] = catalog["owner"]
    cur_icon = (row.get("icon") or "").strip()
    if catalog.get("icon") and (not cur_icon or cur_icon == "package"):
        row["icon"] = catalog["icon"]
    if catalog.get("profile") and not (row.get("profile") or "").strip():
        row["profile"] = catalog["profile"]
    if catalog.get("description") and not (row.get("description") or "").strip():
        row["description"] = catalog["description"]
    if catalog.get("category") and not (row.get("category") or "").strip():
        row["category"] = catalog["category"]
    cur_ver = (row.get("version") or "").strip()
    if catalog.get("version") and (not cur_ver or cur_ver == "0.0.0"):
        row["version"] = catalog["version"]


def _enrich_user_skill_rows(rows: list[dict], user_id: str, db_mgr) -> None:
    """Annotate list rows from a single SkillMeta batch. Never hits GFS.

    Sets ``public``, ``downloads``, and fills empty descriptions from the
    public catalog or a local SKILL.md cache. Downloading zips during list
    used to make 100+ item responses several seconds.
    """
    if not rows:
        return
    slugs = {r.get("slug", "") for r in rows if r.get("slug")}
    public_by_slug = _skillmeta_by_slugs(db_mgr, slugs)
    higraf_by_slug = _higraf_catalog_by_slug() if any(r.get("source") == "imported" for r in rows) else {}
    for row in rows:
        slug = row.get("slug", "")
        pub = public_by_slug.get(slug)
        row["public"] = bool(pub is not None and getattr(pub, "owner", "") == user_id)
        if pub is not None:
            row["downloads"] = int(getattr(pub, "downloads", 0) or 0)
        if row.get("source") == "imported":
            _apply_imported_catalog_fields(
                row, user_id, _catalog_fields_for_slug(slug, pub, higraf_by_slug.get(slug)),
            )
        if not (row.get("description") or "").strip() and pub is not None:
            pub_desc = (getattr(pub, "description", None) or "").strip()
            if pub_desc:
                row["description"] = pub_desc
        if (row.get("description") or "").strip() or not slug:
            continue
        text = _read_cached_skill_md("user", slug, user_id)
        if not text:
            continue
        parsed = _parse_skill_md(text)
        if parsed and (parsed.get("description") or "").strip():
            row["description"] = parsed["description"]


async def _increment_public_downloads(slug: str) -> None:
    """Bump the public catalog download counter for a published skill."""
    from ._auth import _get_db
    from ....datamodel.db import SkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        return
    row = resp.data[0]
    row.downloads = int(row.downloads or 0) + 1
    db_mgr.upsert(row)


def _gfs_read_meta_json(skill_type: SkillType, slug: str, cfg: dict, user_id: str = "", source: str = "") -> dict:
    import json
    path = _gfs_meta_path(skill_type, slug, user_id, source)
    text = gfs_read_text(path, cfg)
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}