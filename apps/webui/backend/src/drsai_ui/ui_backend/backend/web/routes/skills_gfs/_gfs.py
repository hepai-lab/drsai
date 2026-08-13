"""GFS config, prefix helpers, and cross-cutting GFS utilities."""

from __future__ import annotations

import os
import tempfile

from fastapi import HTTPException

from ...config import settings
from ._constants import _PROFILE_EXT_WHITELIST, SkillType, logger
from ..gfs_utils import gfs_get, gfs_ls, gfs_put, gfs_read_text, gfs_rm
from ._skillmd import _parse_skill_md, _read_skill_md_from_zip
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


def _fill_user_skill_descriptions(rows: list[dict], user_id: str, db_mgr, cfg: dict) -> None:
    """Backfill empty list descriptions from public catalog or SKILL.md frontmatter."""
    from ....datamodel.db import SkillMeta
    for row in rows:
        if (row.get("description") or "").strip():
            continue
        slug = row.get("slug", "")
        if not slug:
            continue
        pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
        if pub_resp.status and pub_resp.data:
            pub_desc = (pub_resp.data[0].description or "").strip()
            if pub_desc:
                row["description"] = pub_desc
                continue
        source = row.get("source", "created") or "created"
        text = _read_cached_skill_md("user", slug, user_id)
        if not text:
            zip_path = _gfs_zip_path("user", slug, user_id, source)
            gfs_text, zip_tmp = _read_skill_md_from_zip(zip_path, cfg)
            text = gfs_text
            if zip_tmp:
                _ensure_cache_zip("user", slug, zip_tmp, user_id)
                try:
                    os.unlink(zip_tmp)
                except OSError:
                    pass
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


def _annotate_user_skill_downloads(rows: list[dict], db_mgr) -> None:
    """Expose public-catalog download counts on user skill list rows."""
    from ....datamodel.db import SkillMeta
    for row in rows:
        slug = row.get("slug", "")
        if not slug:
            continue
        pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
        if pub_resp.status and pub_resp.data:
            row["downloads"] = int(pub_resp.data[0].downloads or 0)


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