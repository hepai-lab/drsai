"""GFS config, prefix helpers, and cross-cutting GFS utilities."""

from __future__ import annotations

import os
import tempfile

from fastapi import HTTPException

from ...config import settings
from ._constants import SkillType
from ..gfs_utils import gfs_get, gfs_ls, gfs_put
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
# GFS prefix helpers — new layout: higraf/{slug}.zip, user_skills/{uid}/{slug}.zip
# ═══════════════════════════════════════════════════════════════════════════════

def _gfs_higraf_prefix() -> str:
    return "higraf"


def _gfs_user_prefix(user_id: str = "") -> str:
    if user_id:
        return f"user_skills/{user_id}"
    return "user_skills"


def _gfs_higraf_zip_path(slug: str) -> str:
    return f"higraf/{slug}.zip"


def _gfs_user_zip_path(slug: str, user_id: str) -> str:
    return f"user_skills/{user_id}/{slug}.zip"


def _gfs_zip_path(slug: str, owner_id: str = "", source: str = "user") -> str:
    """Resolve the correct GFS zip path based on source and owner."""
    if source == "higraf":
        return _gfs_higraf_zip_path(slug)
    if owner_id:
        return _gfs_user_zip_path(slug, owner_id)
    return _gfs_user_zip_path(slug, "")


def _gfs_profile_dir(slug: str, source: str = "user", owner_id: str = "") -> str:
    if source == "higraf":
        return f"higraf/{slug}"
    return f"user_skills/{owner_id}/{slug}" if owner_id else f"user_skills/{slug}"


# ═══════════════════════════════════════════════════════════════════════════════
# GFS operations
# ═══════════════════════════════════════════════════════════════════════════════

def _skillmeta_by_slugs(db_mgr, slugs: set[str]) -> dict:
    """Load SkillMeta rows for the given slugs in as few queries as possible."""
    from sqlmodel import Session, select

    from ....datamodel.db import SkillMeta

    if not slugs:
        return {}
    result: dict = {}
    slug_list = list(slugs)
    chunk_size = 400
    with Session(db_mgr.engine) as session:
        for i in range(0, len(slug_list), chunk_size):
            chunk = slug_list[i : i + chunk_size]
            rows = session.exec(select(SkillMeta).where(SkillMeta.slug.in_(chunk))).all()
            for row in rows:
                result[row.slug] = row
    return result


async def _increment_download_count(slug: str) -> None:
    """Bump the download counter for a skill."""
    from ._auth import _get_db
    from ....datamodel.db import SkillMeta
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        return
    row = resp.data[0]
    row.download_count = int(row.download_count or 0) + 1
    db_mgr.upsert(row)

