"""Local disk cache for skill ZIPs."""

from __future__ import annotations

import os
import shutil
import tempfile
import zipfile

from ._constants import SkillType, logger


def _skills_cache_dir() -> str:
    env = os.getenv("DRSAI_UI_SKILLS_CACHE_DIR", "").strip()
    if env:
        return env.rstrip("/")
    return os.path.join(tempfile.gettempdir(), "drsai_skills_cache")


def _cache_skill_dir(skill_type: SkillType, slug: str, user_id: str = "") -> str:
    if skill_type == "public":
        return os.path.join(_skills_cache_dir(), "public", slug)
    return os.path.join(_skills_cache_dir(), "user", user_id, slug)


def _ensure_cache_zip(skill_type: SkillType, slug: str, zip_src: str, user_id: str = "") -> None:
    target_dir = _cache_skill_dir(skill_type, slug, user_id)
    os.makedirs(target_dir, exist_ok=True)
    try:
        shutil.copy(zip_src, os.path.join(target_dir, "skill.zip"))
    except OSError:
        logger.warning("_ensure_cache_zip: failed for %s/%s", skill_type, slug, exc_info=True)


def _read_cached_skill_md(skill_type: SkillType, slug: str, user_id: str = "") -> str | None:
    zip_path = os.path.join(_cache_skill_dir(skill_type, slug, user_id), "skill.zip")
    if not os.path.isfile(zip_path):
        return None
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            skill_md_names = [n for n in zf.namelist() if n.lower().endswith("skill.md")]
            if not skill_md_names:
                return None
            return zf.read(skill_md_names[0]).decode("utf-8")
    except Exception:
        return None