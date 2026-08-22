"""Unified skills router — public + user skills in one bucket, one CRUD surface.

Bucket layout:
  20294-skills-square/
  ├── public_skills/{slug}.zip, {slug}/meta.json, {slug}/profile.{ext}
  └── user_skills/{user_id}/{source}/{slug}.zip, {slug}/meta.json

Every route requires ?type=public or ?type=user.  The type parameter drives
GFS prefix, DB model, auth, and response format — one handler for both.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

import yaml
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from ...datamodel.db import SkillMeta, UserSkillMeta
from ..config import settings
from .gfs_utils import gfs_get, gfs_ls, gfs_put, gfs_read_text, gfs_rm
from .deer_flow import fetch_higraf_skills

router = APIRouter()

_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_MAX_UPLOAD_BYTES = 32 * 1024 * 1024
_MAX_PROFILE_BYTES = 2 * 1024 * 1024
_PROFILE_EXT_WHITELIST = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"})

SkillType = Literal["public", "user"]


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


async def _clear_unlisted_flag(user_id: str, slug: str) -> None:
    """Clear the 'unlisted' flag on UserSkillMeta after re-publish."""
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
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        return
    row = resp.data[0]
    row.downloads = int(row.downloads or 0) + 1
    db_mgr.upsert(row)


def _annotate_user_skill_downloads(rows: list[dict], db_mgr) -> None:
    """Expose public-catalog download counts on user skill list rows."""
    for row in rows:
        slug = row.get("slug", "")
        if not slug:
            continue
        pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
        if pub_resp.status and pub_resp.data:
            row["downloads"] = int(pub_resp.data[0].downloads or 0)


# ═══════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_skill_md(text: str) -> dict | None:
    text = text.strip()
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    yaml_text = parts[1].strip()
    body = parts[2].strip() if len(parts) > 2 else ""
    try:
        frontmatter = yaml.safe_load(yaml_text)
    except yaml.YAMLError:
        return None
    if not isinstance(frontmatter, dict) or not frontmatter.get("name"):
        return None
    tags = frontmatter.get("tags", [])
    if not isinstance(tags, list):
        tags = []
    tags = [str(t).strip() for t in tags if str(t).strip()]
    return {
        "name": frontmatter.get("name", ""),
        "description": frontmatter.get("description", ""),
        "compatibility": frontmatter.get("compatibility"),
        "icon": frontmatter.get("icon", "package"),
        "version": frontmatter.get("version", "0.0.0"),
        "tags": tags,
        "required_tools": frontmatter.get("required_tools", []),
        "body": body,
    }


def _slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = s.strip("-._")
    return s[:64] or "skill"


def _read_file_from_zip(zf: zipfile.ZipFile, filename: str) -> bytes | None:
    for name in zf.namelist():
        if name.rstrip("/").endswith("/" + filename) or name == filename:
            return zf.read(name)
    return None


def _write_gfs_text(remote_path: str, content: str, cfg: dict) -> None:
    tmp = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt", encoding="utf-8")
    try:
        tmp.write(content)
        tmp_path = tmp.name
    finally:
        tmp.close()
    try:
        gfs_put(tmp_path, remote_path, cfg)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _read_skill_md_from_zip(remote_path: str, cfg: dict) -> tuple[str | None, str | None]:
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()
    try:
        ok = gfs_get(remote_path, tmp_zip.name, cfg, timeout=30)
        if not ok:
            return None, None
        with zipfile.ZipFile(tmp_zip.name) as zf:
            skill_md_names = [n for n in zf.namelist() if n.lower().endswith("skill.md")]
            if not skill_md_names:
                return None, None
            return zf.read(skill_md_names[0]).decode("utf-8"), tmp_zip.name
    except Exception:
        return None, None


def _gfs_read_meta_json(skill_type: SkillType, slug: str, cfg: dict, user_id: str = "", source: str = "") -> dict:
    path = _gfs_meta_path(skill_type, slug, user_id, source)
    text = gfs_read_text(path, cfg)
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}


def _profile_safe_ext(filename: str) -> str | None:
    stem_ext = os.path.splitext(filename)
    ext = stem_ext[1].lower() if len(stem_ext) > 1 else None
    if ext and ext in _PROFILE_EXT_WHITELIST:
        return ext
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# Cache
# ═══════════════════════════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════════════════════════
# Auth
# ═══════════════════════════════════════════════════════════════════════════════

async def _resolve_user_from_apikey(request: Request) -> str | None:
    from ..deps import resolve_user_from_apikey
    return await resolve_user_from_apikey(request)



def _require_user_id(user_id: str) -> str:
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="missing user_id")
    uid = user_id.strip()
    if ".." in uid or "/" in uid or "\\" in uid:
        raise HTTPException(status_code=400, detail="invalid user_id")
    return uid


async def _get_db():
    from ..deps import get_db
    return await get_db()


# ═══════════════════════════════════════════════════════════════════════════════
# Response formatters
# ═══════════════════════════════════════════════════════════════════════════════

def _public_skillmeta_to_dict(row: SkillMeta) -> dict:
    return {
        "slug": row.slug,
        "name": row.name,
        "description": row.description,
        "compatibility": row.compatibility,
        "icon": row.icon,
        "version": row.version,
        "owner": row.owner,
        "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        "downloads": row.downloads,
        "profile": row.profile or "",
        "changelog": row.changelog or "",
        "category": row.category or "",
    }


def _field(item, key: str, default: Any = "") -> Any:
    """Read a field from either a SQLModel row or a plain dict, with fallback default."""
    if isinstance(item, dict):
        return item.get(key, default)
    val = getattr(item, key, None)
    if val is not None and val != "":
        return val
    return default


def _user_skillmeta_to_dict(item, user_id: str) -> dict:
    """Convert a UserSkillMeta row or GFS meta dict to flat shape (matching public skills)."""
    slug = _field(item, "slug", "")
    name = _field(item, "name", slug)
    description = _field(item, "description", "")
    icon = _field(item, "icon", "package")
    version = _field(item, "version", "0.0.0")
    changelog = _field(item, "changelog", "")
    source = _field(item, "source", "created")
    owner = _field(item, "owner", user_id)
    profile = _field(item, "profile", "")

    created_at = None
    if hasattr(item, "created_at") and item.created_at:
        created_at = item.created_at
    else:
        raw = item.get("created_at", "") if isinstance(item, dict) else ""
        if raw:
            try:
                created_at = datetime.fromisoformat(raw)
            except (ValueError, TypeError):
                pass

    updated_at = None
    if hasattr(item, "updated_at") and item.updated_at:
        updated_at = item.updated_at
    else:
        raw_upd = item.get("updated_at", "") if isinstance(item, dict) else ""
        if raw_upd:
            try:
                updated_at = datetime.fromisoformat(raw_upd)
            except (ValueError, TypeError):
                pass

    unlisted = _field(item, "unlisted", None)

    return {
        "slug": slug,
        "name": name,
        "description": description,
        "icon": icon,
        "version": version,
        "owner": owner,
        "source": source,
        "unlisted": bool(unlisted) if unlisted else False,
        "created_at": created_at.isoformat() if created_at else "",
        "updated_at": updated_at.isoformat() if updated_at else "",
        "download_url": f"/api/skills/{slug}/download?type=user&user_id={user_id}",
        "profile": profile,
        "changelog": changelog,
        "downloads": int(_field(item, "downloads", 0) or 0),
        "category": _field(item, "category", ""),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Type validation dependency
# ═══════════════════════════════════════════════════════════════════════════════

def _require_type(type_: str = Query(..., alias="type")) -> SkillType:
    """Validate and normalize the ?type= query parameter."""
    t = type_.strip().lower()
    if t not in ("public", "user"):
        raise HTTPException(status_code=400, detail="type must be 'public' or 'user'")
    return t  # type: ignore[return-value]


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTES — unified CRUD
# ═══════════════════════════════════════════════════════════════════════════════

# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_skills(
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
) -> dict:
    """List skills. ?type=public or ?type=user&user_id=xxx"""
    if type_ == "public":
        return await _list_public(request)
    return await _list_user(request, user_id)


async def _list_public(request: Request) -> dict:
    user_id: str | None = None
    is_admin = False
    try:
        user_id = await _resolve_user_from_apikey(request)
    except HTTPException:
        pass
    if user_id:
        from ..authz import get_is_platform_admin
        db_mgr = await _get_db()
        is_admin = get_is_platform_admin(db_mgr, user_id)

    def _with_can_edit(item: dict) -> dict:
        item["can_edit"] = is_admin or (user_id is not None and user_id == item.get("owner", ""))
        return item

    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, order="asc")
    if resp.status and resp.data:
        items = [_with_can_edit(_public_skillmeta_to_dict(row)) for row in resp.data]
    else:
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

    # ── 合并 Higraf 技能广场数据 ──
    try:
        higraf_items = await fetch_higraf_skills("public")
        logger.info("_list_public: fetch_higraf_skills returned %d items", len(higraf_items))
        seen_slugs = {item["slug"] for item in items if item.get("slug")}
        merged = 0
        for h in higraf_items:
            slug = h.get("skillId") or h.get("id", "")
            if not slug or slug in seen_slugs:
                continue
            seen_slugs.add(slug)
            merged += 1
            items.append({
                "slug": slug,
                "name": h.get("name") or h.get("skillName", slug),
                "description": h.get("description", ""),
                "compatibility": None,
                "icon": h.get("emoji", "package"),
                "version": h.get("version") or h.get("currentVersion", "1.0.0"),
                "owner": h.get("authorName", ""),
                "updated_at": h.get("updatedAt", ""),
                "downloads": h.get("callCount", 0),
                "profile": "",
                "changelog": "",
                "category": h.get("categoryL2", ""),
                "can_edit": False,
            })
    except Exception:
        logger.warning("_list_public: failed to merge Higraf skills", exc_info=True)
    else:
        logger.info("_list_public: merged %d Higraf skills (total before=%d, after=%d)", merged, len(items) - merged, len(items))

    return {"status": True, "data": items}


async def _list_user(request: Request, user_id: str) -> dict:
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


# ── GET DETAIL ────────────────────────────────────────────────────────────────

@router.get("/{slug}")
async def get_skill(
    slug: str,
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
) -> dict:
    """Get a single skill. ?type=public or ?type=user&user_id=xxx"""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    if type_ == "public":
        return await _get_public(slug, request)
    return await _get_user(request, slug, user_id)


async def _get_public(slug: str, request: Request) -> dict:
    user_id: str | None = None
    try:
        user_id = await _resolve_user_from_apikey(request)
    except HTTPException:
        pass

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
            from ..authz import get_is_platform_admin
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
        logger.warning("get_skill: DB backfill failed for %s", slug, exc_info=True)

    can_edit = bool(user_id and user_id == final_owner)
    if not can_edit and user_id:
        from ..authz import get_is_platform_admin
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


async def _get_user(request: Request, slug: str, user_id: str) -> dict:
    """Get a single user skill detail, including body (SKILL.md content)."""
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


# ── UPLOAD ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_skill(
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
    file: UploadFile = File(...),
    slug: str | None = Form(None),
    display_name: str | None = Form(None),
    name: str | None = Form(None),
    icon: str | None = Form(None),
    description: str | None = Form(None),
    version: str | None = Form(None),
    changelog: str | None = Form(None),
    source: str | None = Form(None),
    category: str | None = Form(None),
    profile: UploadFile | None = File(None),
) -> dict:
    """Upload a skill ZIP. ?type=public (auth required) or ?type=user&user_id=xxx"""
    logger.info("[publish] upload_skill called type=%s user_id=%s slug=%s display_name=%s file=%s",
                type_, user_id, slug, display_name or name, file.filename if file else None)
    if type_ == "public":
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            logger.warning("[publish] upload_skill public: no valid API key")
            raise HTTPException(status_code=401, detail="API key required for upload")
        return await _upload_public(file, slug, display_name or name, icon, description, version, changelog, profile, category, auth_user_id)

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot upload for another user")
    logger.info("[publish] upload_skill → _upload_user user_id=%s slug=%s", user_id, slug)
    return await _upload_user(file, user_id, slug, display_name or name, icon, description, version, changelog, source, profile, category)


async def _upload_public(
    file: UploadFile, slug: str | None, display_name: str | None,
    icon: str | None, description: str | None, version: str | None,
    changelog: str | None, profile: UploadFile | None, category: str | None, user_id: str,
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

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

    cfg = _require_gfs()

    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    try:
        size = 0
        with open(tmp_zip.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
                out.write(chunk)

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

        slug_clean = (slug or "").strip()
        canon_slug = _slugify(slug_clean) if slug_clean else _slugify(parsed["name"] or "")

        remote_path = _gfs_zip_path("public", canon_slug)

        if gfs_ls(remote_path, cfg):
            check_db = await _get_db()
            check_resp = check_db.get(SkillMeta, filters={"slug": canon_slug})
            existing_owner = check_resp.data[0].owner if (check_resp.status and check_resp.data) else ""
            if existing_owner and existing_owner != user_id:
                db_mgr = await _get_db()
                resp = db_mgr.get(
                    __import__("...datamodel.db", fromlist=["Userinfo"]).Userinfo,
                    filters={"user_id": user_id}, return_json=False,
                )
                if resp.status and resp.data:
                    u = resp.data[0]
                    umeta = dict(getattr(u, "meta", None) or {})
                    skill_role = umeta.get("skill_role", "user")
                else:
                    skill_role = "user"
                if skill_role != "admin":
                    raise HTTPException(status_code=403, detail="Cannot overwrite another user's skill")

        if not gfs_put(tmp_zip.name, remote_path, cfg):
            raise HTTPException(status_code=500, detail="Upload to GFS failed")

        profile_url: str | None = None
        if profile_tmp:
            profile_remote = f"{_gfs_prefix('public')}/{canon_slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                profile_url = f"/api/skills/{canon_slug}/profile"

        now = datetime.now(timezone.utc).isoformat()
        final_name = (display_name or "").strip() or parsed["name"]
        final_icon = (icon or "").strip() or parsed.get("icon", "package")
        final_description = description if description is not None else parsed.get("description", "")
        final_version = (version or "").strip() or parsed.get("version", "0.0.0")
        final_changelog = (changelog or "").strip()
        final_category = (category or "").strip() or None

        _ensure_cache_zip("public", canon_slug, tmp_zip.name)

        db_mgr = await _get_db()
        existing_resp = db_mgr.get(SkillMeta, filters={"slug": canon_slug})
        if existing_resp.status and existing_resp.data:
            existing = existing_resp.data[0]
            existing.name = final_name
            existing.description = final_description
            existing.icon = final_icon
            existing.version = final_version
            existing.compatibility = parsed.get("compatibility")
            existing.owner = user_id
            existing.profile = profile_url or None
            existing.changelog = final_changelog
            existing.category = final_category
            to_upsert = existing
        else:
            to_upsert = SkillMeta(
                slug=canon_slug, name=final_name, description=final_description,
                icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility"), owner=user_id,
                downloads=0, profile=profile_url or None, changelog=final_changelog,
                category=final_category,
            )
        upsert_resp = db_mgr.upsert(to_upsert)
        if not upsert_resp.status:
            logger.error("DB upsert failed for slug=%s: %s", canon_slug, upsert_resp.message)
            raise HTTPException(status_code=500, detail=f"Database upsert failed: {upsert_resp.message}")

        # Also create/update UserSkillMeta record so the skill appears in "my creations"
        user_meta_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": canon_slug, "source": "created"})
        if user_meta_resp.status and user_meta_resp.data:
            user_existing = user_meta_resp.data[0]
            user_existing.name = final_name
            user_existing.description = final_description
            user_existing.icon = final_icon
            user_existing.version = final_version
            user_existing.compatibility = parsed.get("compatibility")
            user_existing.owner = user_id
            user_existing.changelog = final_changelog
            user_existing.profile = profile_url
            user_existing.category = final_category
            user_existing.unlisted = False  # clear unlisted flag since we're re-publishing
            user_to_upsert = user_existing
        else:
            user_to_upsert = UserSkillMeta(
                user_id=user_id, slug=canon_slug, name=final_name,
                description=final_description, icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility"), owner=user_id,
                source="created", changelog=final_changelog, profile=profile_url,
                category=final_category,
            )
        db_mgr.upsert(user_to_upsert)

        return {
            "status": True, "message": "Upload successful",
            "data": {
                "slug": canon_slug, "name": final_name, "description": final_description,
                "compatibility": parsed.get("compatibility"), "version": final_version,
                "icon": final_icon, "changelog": final_changelog or "",
                "profile": profile_url or "",
            },
        }
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


async def _upload_user(
    file: UploadFile, user_id: str, slug: str | None,
    display_name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None, source: str | None,
    profile: UploadFile | None = None,
    category: str | None = None,
) -> dict:
    logger.info("[publish] _upload_user enter user_id=%s slug=%s display_name=%s file=%s version=%s",
                user_id, slug, display_name, file.filename if file else None, version)
    user_id = _require_user_id(user_id)
    if not file.filename or not file.filename.lower().endswith(".zip"):
        logger.warning("[publish] _upload_user invalid file: %s", file.filename)
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

    # Handle profile image (optional)
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

    cfg = _require_gfs()
    source_val = (source or "").strip()
    if source_val not in ("created", "imported"):
        source_val = "created"

    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    try:
        size = 0
        with open(tmp_zip.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
                out.write(chunk)

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

        slug_clean = (slug or "").strip()
        canon_slug = _slugify(slug_clean) if slug_clean else _slugify(parsed["name"] or "")
        logger.info("[publish] _upload_user canon_slug=%s source=%s remote_path=%s",
                    canon_slug, source_val, _gfs_zip_path("user", canon_slug, user_id, source_val))

        remote_path = _gfs_zip_path("user", canon_slug, user_id, source_val)
        gfs_ok = gfs_put(tmp_zip.name, remote_path, cfg)
        logger.info("[publish] _upload_user gfs_put result=%s remote=%s", gfs_ok, remote_path)
        if not gfs_ok:
            raise HTTPException(status_code=500, detail="Upload to GFS failed")

        profile_url: str | None = None
        if profile_tmp:
            profile_remote = f"{_gfs_prefix('user', user_id)}/{source_val}/{canon_slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                profile_url = f"/api/skills/{canon_slug}/profile"

        now = datetime.now(timezone.utc).isoformat()
        final_name = (display_name or "").strip() or parsed["name"]
        final_icon = (icon or "").strip() or parsed.get("icon", "package")
        final_description = description if description is not None else parsed.get("description", "")
        final_version = (version or "").strip() or parsed.get("version", "0.0.0")
        final_changelog = (changelog or "").strip()
        final_category = (category or "").strip() or None

        db_mgr = await _get_db()
        existing_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": canon_slug, "source": source_val})
        if existing_resp.status and existing_resp.data:
            existing = existing_resp.data[0]
            existing.name = final_name
            existing.description = final_description
            existing.icon = final_icon
            existing.version = final_version
            existing.compatibility = parsed.get("compatibility")
            existing.owner = user_id
            existing.source = source_val
            existing.changelog = final_changelog
            existing.profile = profile_url
            existing.category = final_category
            to_upsert = existing
        else:
            to_upsert = UserSkillMeta(
                user_id=user_id, slug=canon_slug, name=final_name,
                description=final_description, icon=final_icon, version=final_version,
                compatibility=parsed.get("compatibility"), owner=user_id,
                source=source_val, changelog=final_changelog, profile=profile_url,
                category=final_category,
            )
        upsert_resp = db_mgr.upsert(to_upsert)
        if not upsert_resp.status:
            logger.error("[publish] _upload_user DB upsert failed for user=%s slug=%s: %s", user_id, canon_slug, upsert_resp.message)
            raise HTTPException(status_code=500, detail=f"Database upsert failed: {upsert_resp.message}")

        logger.info("[publish] _upload_user SUCCESS user=%s slug=%s filename=%s", user_id, canon_slug, file.filename)
        return {
            "status": True,
            "data": {
                "id": canon_slug,
                "filename": file.filename,
                "url": f"/api/skills/{canon_slug}/download?type=user&user_id={user_id}",
            },
        }
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


# ── UPDATE ────────────────────────────────────────────────────────────────────

@router.put("/{slug}")
async def update_skill(
    slug: str,
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
    file: UploadFile | None = File(None),
    name: str | None = Form(None),
    display_name: str | None = Form(None),
    icon: str | None = Form(None),
    description: str | None = Form(None),
    version: str | None = Form(None),
    changelog: str | None = Form(None),
    source: str | None = Form(None),
    category: str | None = Form(None),
    profile: UploadFile | None = File(None),
) -> dict:
    """Update a skill. ?type=public (auth required) or ?type=user&user_id=xxx"""
    logger.info("[publish] update_skill called type=%s slug=%s user_id=%s file=%s",
                type_, slug, user_id, file.filename if file else None)
    if not _SLUG_RE.match(slug):
        logger.warning("[publish] update_skill invalid slug: %s", slug)
        raise HTTPException(status_code=400, detail="Invalid slug")

    if type_ == "public":
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            raise HTTPException(status_code=401, detail="API key required for write operations")
        return await _update_public(slug, auth_user_id, file, name or display_name, icon, description, version, changelog, profile, category)

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot update skills for another user")
    logger.info("[publish] update_skill → _update_user slug=%s user_id=%s", slug, user_id)
    return await _update_user(slug, user_id, file, display_name or name, icon, description, version, changelog, source, profile, category)


async def _update_public(
    slug: str, user_id: str, file: UploadFile | None,
    name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None, profile: UploadFile | None,
    category: str | None = None,
) -> dict:
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing: SkillMeta = resp.data[0]

    if existing.owner and existing.owner != user_id:
        from ...datamodel.db import Userinfo as _U
        uresp = db_mgr.get(_U, filters={"user_id": user_id}, return_json=False)
        if uresp.status and uresp.data:
            umeta = dict(getattr(uresp.data[0], "meta", None) or {})
            skill_role = umeta.get("skill_role", "user")
        else:
            skill_role = "user"
        if skill_role != "admin":
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    cfg = _require_gfs()

    # Resolve effective GFS target: public zip if it exists, else owner's user zip
    public_zip = _gfs_zip_path("public", slug)
    owner_id = existing.owner or user_id
    _user_backend = not bool(gfs_ls(public_zip, cfg))
    if _user_backend:
        source_val = ""
        for s in ("created", "imported"):
            if gfs_ls(_gfs_zip_path("user", slug, owner_id, s), cfg):
                source_val = s
                break
        remote_path = _gfs_zip_path("user", slug, owner_id, source_val) if source_val else public_zip
    else:
        remote_path = public_zip
        source_val = ""

    # Handle new ZIP
    _new_compatibility = None
    if file is not None:
        if not file.filename or not file.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Please upload a .zip file")
        tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_zip.close()
        try:
            size = 0
            with open(tmp_zip.name, "wb") as out:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > _MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
                    out.write(chunk)
            try:
                with zipfile.ZipFile(tmp_zip.name, "r") as zf:
                    skill_md_bytes = _read_file_from_zip(zf, "SKILL.md")
                if not skill_md_bytes:
                    raise HTTPException(status_code=400, detail="SKILL.md not found")
                parsed = _parse_skill_md(skill_md_bytes.decode("utf-8"))
                if not parsed:
                    raise HTTPException(status_code=422, detail="SKILL.md format invalid")
            except zipfile.BadZipFile as e:
                raise HTTPException(status_code=400, detail="Invalid zip file") from e
            if not gfs_put(tmp_zip.name, remote_path, cfg):
                raise HTTPException(status_code=500, detail="Upload to GFS failed")
            _ensure_cache_zip("user" if _user_backend else "public", slug, tmp_zip.name,
                              owner_id if _user_backend else "")
            _new_compatibility = parsed.get("compatibility")
            if name is None:
                name = parsed.get("name")
            if icon is None:
                icon = parsed.get("icon")
            if description is None:
                description = parsed.get("description")
            if version is None:
                version = parsed.get("version")
        finally:
            try:
                os.unlink(tmp_zip.name)
            except OSError:
                pass

    # Handle profile
    new_profile_url: str | None = None
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
            profile_remote = (f"{_gfs_prefix('user', owner_id)}/{source_val}/{slug}/profile{profile_ext}"
                              if _user_backend and source_val
                              else f"{_gfs_prefix('public')}/{slug}/profile{profile_ext}")
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                new_profile_url = f"/api/skills/{slug}/profile"
        finally:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass

    final_name = (name or "").strip() or existing.name
    final_icon = (icon or "").strip() or existing.icon
    final_description = description if description is not None else existing.description
    final_version = (version or "").strip() or existing.version
    final_changelog = changelog.strip() if (changelog is not None and changelog.strip()) else (changelog if changelog is not None else (existing.changelog or ""))
    final_profile = new_profile_url or existing.profile
    final_compat = _new_compatibility if _new_compatibility is not None else existing.compatibility
    final_category = (category or "").strip() or existing.category

    now = datetime.now(timezone.utc).isoformat()
    meta_gfs = {
        "owner": existing.owner, "created_at": existing.created_at.isoformat() if existing.created_at else now,
        "updated_at": now, "name": final_name, "icon": final_icon,
        "description": final_description, "version": final_version,
        "downloads": existing.downloads,
    }
    if final_changelog:
        meta_gfs["changelog"] = final_changelog
    if final_profile:
        meta_gfs["profile"] = final_profile
    if source_val:
        _write_gfs_text(_gfs_meta_path("user", slug, owner_id, source_val),
                        json.dumps(meta_gfs, ensure_ascii=False), cfg)

    existing.name = final_name
    existing.icon = final_icon
    existing.description = final_description
    existing.version = final_version
    existing.compatibility = final_compat
    existing.changelog = final_changelog
    existing.profile = final_profile
    existing.category = final_category
    upsert_resp = db_mgr.upsert(existing)
    if not upsert_resp.status:
        logger.error("DB upsert failed for slug=%s: %s", slug, upsert_resp.message)
        raise HTTPException(status_code=500, detail=f"Database upsert failed: {upsert_resp.message}")

    return {
        "status": True, "message": "Update successful",
        "data": {
            "slug": slug, "name": final_name, "version": final_version,
            "icon": final_icon, "description": final_description,
            "changelog": final_changelog, "profile": final_profile or "",
        },
    }


async def _update_user(
    slug: str, user_id: str, file: UploadFile | None,
    display_name: str | None, icon: str | None, description: str | None,
    version: str | None, changelog: str | None, source: str | None,
    profile: UploadFile | None = None,
    category: str | None = None,
) -> dict:
    logger.info("[publish] _update_user enter slug=%s user_id=%s display_name=%s file=%s",
                slug, user_id, display_name, file.filename if file else None)
    user_id = _require_user_id(user_id)
    cfg = _require_gfs()

    # Find source dir — query DB first, then fall back to GFS
    source_val = None
    db_mgr_update = await _get_db()
    resp_db = db_mgr_update.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if resp_db.status and resp_db.data:
        source_val = str(getattr(resp_db.data[0], "source", "created") or "created")
    else:
        prefix = _gfs_prefix("user", user_id)
        for src in ("created", "imported"):
            dir_path = f"{prefix}/{src}/"
            entries = gfs_ls(dir_path, cfg)
            if entries:
                slug_zip = f"{slug}.zip"
                if any(e.get("name") == slug_zip for e in entries):
                    source_val = src
                    break
    if source_val is None:
        logger.warning("[publish] _update_user skill not found slug=%s user_id=%s", slug, user_id)
        raise HTTPException(status_code=404, detail="Skill not found")

    # Owner check via DB
    db_mgr = await _get_db()
    check_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug, "source": source_val})
    if check_resp.status and check_resp.data:
        existing_owner = getattr(check_resp.data[0], "owner", "")
        if existing_owner and existing_owner != user_id:
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    now = datetime.now(timezone.utc).isoformat()

    if file is not None:
        if not file.filename or not file.filename.lower().endswith(".zip"):
            raise HTTPException(status_code=400, detail="Please upload a .zip file")
        tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp_zip.close()
        try:
            size = 0
            with open(tmp_zip.name, "wb") as out:
                while True:
                    chunk = await file.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > _MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail=f"File exceeds {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB limit")
                    out.write(chunk)
            try:
                with zipfile.ZipFile(tmp_zip.name, "r") as zf:
                    skill_md_bytes = _read_file_from_zip(zf, "SKILL.md")
                if not skill_md_bytes:
                    raise HTTPException(status_code=400, detail="SKILL.md not found")
                parsed = _parse_skill_md(skill_md_bytes.decode("utf-8"))
                if not parsed:
                    raise HTTPException(status_code=422, detail="SKILL.md format invalid")
            except zipfile.BadZipFile as e:
                raise HTTPException(status_code=400, detail="Invalid zip file") from e
            remote_path = _gfs_zip_path("user", slug, user_id, source_val)
            if not gfs_put(tmp_zip.name, remote_path, cfg):
                raise HTTPException(status_code=500, detail="Upload to GFS failed")
            if display_name is None:
                display_name = parsed.get("name")
            if icon is None:
                icon = parsed.get("icon")
            if description is None:
                description = parsed.get("description")
            if version is None:
                version = parsed.get("version")
        finally:
            try:
                os.unlink(tmp_zip.name)
            except OSError:
                pass

    # Handle profile image
    new_profile_url: str | None = None
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
            profile_remote = f"{_gfs_prefix('user', user_id)}/{source_val}/{slug}/profile{profile_ext}"
            if gfs_put(profile_tmp.name, profile_remote, cfg):
                new_profile_url = f"/api/skills/{slug}/profile"
        finally:
            try:
                os.unlink(profile_tmp.name)
            except OSError:
                pass

    final_name = display_name.strip() if (display_name is not None and display_name.strip()) else None
    final_icon = icon.strip() if (icon is not None and icon.strip()) else None
    final_description = description.strip() if (description is not None and description.strip()) else None
    final_version = version.strip() if (version is not None and version.strip()) else None
    final_changelog = changelog.strip() if (changelog is not None and changelog.strip()) else (changelog if changelog is not None else None)
    final_source = source.strip() if (source is not None and source.strip()) else None
    final_profile = new_profile_url  # None if no new profile, else the GFS URL
    final_category = category.strip() if (category is not None and category.strip()) else None

    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug, "source": source_val})
    if resp.status and resp.data:
        existing = resp.data[0]
        if final_name is not None:
            existing.name = final_name
        if final_icon is not None:
            existing.icon = final_icon
        if final_description is not None:
            existing.description = final_description
        if final_version is not None:
            existing.version = final_version
        if final_changelog is not None:
            existing.changelog = final_changelog
        if final_source is not None:
            existing.source = final_source
        if final_profile is not None:
            existing.profile = final_profile
        if final_category is not None:
            existing.category = final_category
        upsert_resp = db_mgr.upsert(existing)
        result_row = existing
    else:
        new_row = UserSkillMeta(
            user_id=user_id, slug=slug, name=final_name or slug,
            icon=final_icon or "package", description=final_description or "",
            version=final_version or "0.0.0", compatibility=None,
            owner=user_id, source=final_source or source_val or "created",
            changelog=final_changelog or "",
            profile=final_profile or "",
            category=final_category or "",
        )
        upsert_resp = db_mgr.upsert(new_row)
        result_row = new_row
    if not upsert_resp.status:
        logger.error("[publish] _update_user DB upsert failed for user=%s slug=%s: %s", user_id, slug, upsert_resp.message)

    # Sync profile/category to SkillMeta if this skill is published
    pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if pub_resp.status and pub_resp.data:
        pub_row = pub_resp.data[0]
        user_category = getattr(result_row, "category", None) or ""
        if final_profile is not None:
            pub_row.profile = final_profile
        pub_row.category = user_category
        db_mgr.upsert(pub_row)

    logger.info("[publish] _update_user SUCCESS user=%s slug=%s", user_id, slug)
    return {
        "status": True, "message": "Update successful",
        "data": _user_skillmeta_to_dict(result_row, user_id),
    }


# ── DELETE ────────────────────────────────────────────────────────────────────

@router.delete("/{slug}")
async def delete_skill(
    slug: str,
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
) -> dict:
    """Delete a skill. ?type=public (auth required) or ?type=user&user_id=xxx"""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    if type_ == "public":
        auth_user_id = await _resolve_user_from_apikey(request)
        if not auth_user_id:
            raise HTTPException(status_code=401, detail="API key required for write operations")
        return await _delete_public(slug, auth_user_id)

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete skills for another user")
    return await _delete_user(slug, user_id)


async def _delete_public(slug: str, user_id: str) -> dict:
    db_mgr = await _get_db()
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not found")
    existing: SkillMeta = resp.data[0]

    if existing.owner and existing.owner != user_id:
        from ...datamodel.db import Userinfo as _U
        uresp = db_mgr.get(_U, filters={"user_id": user_id}, return_json=False)
        if uresp.status and uresp.data:
            umeta = dict(getattr(uresp.data[0], "meta", None) or {})
            skill_role = umeta.get("skill_role", "user")
        else:
            skill_role = "user"
        if skill_role != "admin":
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    cfg = _require_gfs()
    prefix = _gfs_prefix("public")
    gfs_rm(f"{prefix}/{slug}.zip", cfg)
    gfs_rm(f"{prefix}/{slug}/meta.json", cfg)
    db_mgr.delete(SkillMeta, filters={"slug": slug})
    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}


async def _delete_user(slug: str, user_id: str) -> dict:
    user_id = _require_user_id(user_id)
    cfg = _require_gfs()

    # 1) Check DB first — faster and handles both created/imported
    db_mgr = await _get_db()
    resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    if resp.status and resp.data:
        meta_row = resp.data[0]
        source_val: str = getattr(meta_row, "source", "created") or "created"
    else:
        # 2) GFS fallback: ls the directory (not the file!) like _list_user does
        source_val = None
        prefix = _gfs_prefix("user", user_id)
        for src in ("created", "imported"):
            dir_path = f"{prefix}/{src}/"
            entries = gfs_ls(dir_path, cfg)
            if entries:
                slug_zip = f"{slug}.zip"
                if any(e.get("name") == slug_zip for e in entries):
                    source_val = src
                    break
        if source_val is None:
            # 3) Not in UserSkillMeta or GFS → maybe it's a public skill owned by this user
            #    (shown in list via _list_user's SkillMeta merge). Delete from public table.
            pub_resp = db_mgr.get(SkillMeta, filters={"slug": slug})
            if pub_resp.status and pub_resp.data:
                pub = pub_resp.data[0]
                if getattr(pub, "owner", None) == user_id:
                    pub_cfg = _require_gfs()
                    pub_prefix = _gfs_prefix("public")
                    gfs_rm(f"{pub_prefix}/{slug}.zip", pub_cfg)
                    gfs_rm(f"{pub_prefix}/{slug}/meta.json", pub_cfg)
                    db_mgr.delete(SkillMeta, filters={"slug": slug})
                    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}
            raise HTTPException(status_code=404, detail="Skill not found")

    # Owner check via DB
    if resp.status and resp.data:
        existing_owner = getattr(resp.data[0], "owner", "")
        if existing_owner and existing_owner != user_id:
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    # Delete GFS zip file first — if this fails, don't touch DB
    user_gfs_path = _gfs_zip_path("user", slug, user_id, source_val)
    if not gfs_rm(user_gfs_path, cfg):
        # File may not exist at user path (e.g. public-only skill), continue
        logger.warning("Failed to delete GFS file at %s, continuing", user_gfs_path)

    # Delete DB record(s) — may have both created + imported for same slug
    if resp.status and resp.data:
        for rec in resp.data:
            db_mgr.delete(UserSkillMeta, filters={"id": rec.id})

    # Also clean up public SkillMeta if user is the owner (skill was published publicly)
    pub_check = db_mgr.get(SkillMeta, filters={"slug": slug, "owner": user_id})
    if pub_check.status and pub_check.data:
        pub_cfg = _require_gfs()
        pub_prefix = _gfs_prefix("public")
        gfs_rm(f"{pub_prefix}/{slug}.zip", pub_cfg)
        gfs_rm(f"{pub_prefix}/{slug}/meta.json", pub_cfg)
        db_mgr.delete(SkillMeta, filters={"slug": slug})

    return {"status": True, "message": f"Skill '{slug}' deleted", "data": {"slug": slug}}


# ── VISIBILITY TOGGLE ─────────────────────────────────────────────────────────

@router.put("/{slug}/visibility")
async def toggle_skill_visibility(
    slug: str,
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
    public: bool = Query(...),
) -> dict:
    """Toggle a user skill's public visibility. ?type=user&user_id=xxx&public=true"""
    _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    # Auth: resolve user from api_key, then verify it matches requested user_id
    auth_user_id = await _resolve_user_from_apikey(request)
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="API key required")
    if auth_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot change visibility for another user")
    return await _toggle_visibility(slug, user_id, public)


async def _toggle_visibility(slug: str, user_id: str, public: bool) -> dict:
    """Publish or unpublish a user skill to/from the public skills square.

    Unpublish: only deletes the SkillMeta DB record; GFS files are preserved so the
    skill can be re-published with a single DB upsert — no file copy needed.
    """
    cfg = _require_gfs()
    db_mgr = await _get_db()

    if public:
        # ── Publish (or re-publish) ──
        # 1. Check if already published (SkillMeta exists and not in unlisted state)
        existing = db_mgr.get(SkillMeta, filters={"slug": slug})
        already_published = existing.status and existing.data
        if already_published:
            pub_row = existing.data[0]
            user_check = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
            if user_check.status and user_check.data:
                for uc in user_check.data:
                    if getattr(uc, "unlisted", False):
                        await _clear_unlisted_flag(user_id, slug)
                        _ensure_user_zip_from_public(cfg, slug, user_id)
                        return {"status": True, "message": f"Skill '{slug}' is now public", "data": {"slug": slug, "public": True}}
            # Owner already has a public catalog entry — idempotent success (avoids 409 when UI is out of sync)
            if not pub_row.owner or pub_row.owner == user_id:
                await _clear_unlisted_flag(user_id, slug)
                _ensure_user_zip_from_public(cfg, slug, user_id)
                return {"status": True, "message": f"Skill '{slug}' is already public", "data": {"slug": slug, "public": True}}
            raise HTTPException(status_code=409, detail="Already published")

        # 2. Check if public GFS files still exist (from a previous unpublish)
        public_zip = _gfs_zip_path("public", slug)
        if gfs_ls(public_zip, cfg):
            # Read metadata from UserSkillMeta (public meta.json no longer exists)
            user_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
            if user_resp.status and user_resp.data:
                usm = sorted(user_resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)[0]
                name = usm.name or slug
                description = usm.description or ""
                icon = usm.icon or "package"
                version = usm.version or "0.0.0"
                changelog = usm.changelog or ""
                profile = getattr(usm, "profile", None) or None
                category = getattr(usm, "category", None) or None
            else:
                # Fallback: read from user GFS meta.json
                for src in ("created", "imported"):
                    if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
                        umeta = _gfs_read_meta_json("user", slug, cfg, user_id, src)
                        name = umeta.get("name", slug)
                        description = umeta.get("description", "")
                        icon = umeta.get("icon", "package")
                        version = umeta.get("version", "0.0.0")
                        changelog = umeta.get("changelog", "")
                        profile = umeta.get("profile")
                        break
                else:
                    name, description, icon, version, changelog, profile = slug, "", "package", "0.0.0", "", None
                category = None
            # Re-create SkillMeta + clear unlisted flag on user copy
            db_mgr.upsert(SkillMeta(
                slug=slug, name=name, description=description,
                icon=icon, version=version, owner=user_id,
                downloads=0, changelog=changelog or None,
                profile=profile, category=category,
            ))
            await _clear_unlisted_flag(user_id, slug)
            _ensure_user_zip_from_public(cfg, slug, user_id)
            return {"status": True, "message": f"Skill '{slug}' is now public", "data": {"slug": slug, "public": True}}

        # 3. No public GFS files — create SkillMeta from user skill data
        resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
        if resp.status and resp.data:
            usm = sorted(resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)[0]
            name = usm.name or slug
            description = usm.description or ""
            icon = usm.icon or "package"
            version = usm.version or "0.0.0"
            changelog = usm.changelog or ""
            profile = getattr(usm, "profile", None) or None
            category = getattr(usm, "category", None) or None
            source_val = str(getattr(usm, "source", "created") or "created")
        else:
            source_val = ""
            prefix = _gfs_prefix("user", user_id)
            for src in ("created", "imported"):
                dir_path = f"{prefix}/{src}/"
                entries = gfs_ls(dir_path, cfg)
                if entries:
                    slug_zip = f"{slug}.zip"
                    if any(e.get("name") == slug_zip for e in entries):
                        source_val = src
                        break
            if not source_val:
                raise HTTPException(status_code=404, detail="Skill data not found. Please re-upload the skill first.")
            meta = _gfs_read_meta_json("user", slug, cfg, user_id, source_val)
            name = meta.get("name", slug)
            description = meta.get("description", "")
            icon = meta.get("icon", "package")
            version = meta.get("version", "0.0.0")
            changelog = meta.get("changelog", "")
            profile = meta.get("profile")
            category = None

        _ensure_user_zip_from_public(cfg, slug, user_id)

        # 4. Copy ZIP from user GFS to public GFS
        user_zip = _gfs_zip_path("user", slug, user_id, source_val)
        public_zip = _gfs_zip_path("public", slug)
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        try:
            if gfs_get(user_zip, tmp.name, cfg):
                gfs_put(tmp.name, public_zip, cfg)
                _ensure_cache_zip("public", slug, tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

        # 5. Copy profile if exists
        user_profile_prefix = f"{_gfs_prefix('user', user_id)}/{source_val}/{slug}/profile"
        public_profile_prefix = f"{_gfs_prefix('public')}/{slug}/profile"
        for ext in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"):
            if gfs_ls(user_profile_prefix + ext, cfg):
                profile_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
                profile_tmp.close()
                try:
                    if gfs_get(user_profile_prefix + ext, profile_tmp.name, cfg):
                        gfs_put(profile_tmp.name, public_profile_prefix + ext, cfg)
                finally:
                    try:
                        os.unlink(profile_tmp.name)
                    except OSError:
                        pass
                break

        db_mgr.upsert(SkillMeta(
            slug=slug, name=name, description=description,
            icon=icon, version=version, owner=user_id,
            downloads=0, changelog=changelog or None, profile=profile,
            category=category,
        ))
        await _clear_unlisted_flag(user_id, slug)

        return {"status": True, "message": f"Skill '{slug}' is now public", "data": {"slug": slug, "public": True}}

    # ── Unpublish: delete DB record only, keep GFS files ──
    resp = db_mgr.get(SkillMeta, filters={"slug": slug})
    if not resp.status or not resp.data:
        raise HTTPException(status_code=404, detail="Skill not published")
    existing = resp.data[0]
    if existing.owner and existing.owner != user_id:
        from ...datamodel.db import Userinfo as _U
        uresp = db_mgr.get(_U, filters={"user_id": user_id}, return_json=False)
        if uresp.status and uresp.data:
            umeta = dict(getattr(uresp.data[0], "meta", None) or {})
            skill_role = umeta.get("skill_role", "user")
        else:
            skill_role = "user"
        if skill_role != "admin":
            raise HTTPException(status_code=403, detail="Not the owner of this skill")

    # Ensure user has a private copy before unpublishing (so re-publish always works)
    user_resp = db_mgr.get(UserSkillMeta, filters={"user_id": user_id, "slug": slug})
    has_user_copy = bool(user_resp.status and user_resp.data)
    if user_resp.status and user_resp.data:
        user_resp_data0 = sorted(user_resp.data, key=lambda r: 0 if str(_field(r, "source", "created")) == "created" else 1)[0]
    else:
        user_resp_data0 = None
    if not has_user_copy:
        # Check user GFS
        for src in ("created", "imported"):
            if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
                has_user_copy = True
                break
    if has_user_copy:
        # Verify the ZIP file actually exists in user GFS (DB record may exist
        # from _upload_public without a corresponding user GFS file).
        source_val = ""
        if user_resp_data0 is not None:
            source_val = str(getattr(user_resp_data0, "source", "created") or "created")
        user_gfs_exists = False
        if source_val and gfs_ls(_gfs_zip_path("user", slug, user_id, source_val), cfg):
            user_gfs_exists = True
        if not user_gfs_exists:
            for src in ("created", "imported"):
                if gfs_ls(_gfs_zip_path("user", slug, user_id, src), cfg):
                    source_val = src
                    user_gfs_exists = True
                    break
        if not user_gfs_exists:
            # DB record exists but no ZIP in user GFS — copy from public
            public_zip = _gfs_zip_path("public", slug)
            user_zip = _gfs_zip_path("user", slug, user_id, "created")
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
            tmp.close()
            try:
                if gfs_get(public_zip, tmp.name, cfg):
                    gfs_put(tmp.name, user_zip, cfg)
                    _ensure_cache_zip("user", slug, tmp.name, user_id)
                    source_val = "created"
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass
        # Set unlisted flag on the existing user copy so frontend shows badge + 上架 toggle
        if source_val and user_resp_data0 is not None:
            user_resp_data0.unlisted = True
            db_mgr.upsert(user_resp_data0)
    else:
        # Copy public ZIP to user GFS as a created skill
        public_zip = _gfs_zip_path("public", slug)
        user_zip = _gfs_zip_path("user", slug, user_id, "created")
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        tmp.close()
        try:
            if gfs_get(public_zip, tmp.name, cfg):
                gfs_put(tmp.name, user_zip, cfg)
                _ensure_cache_zip("user", slug, tmp.name, user_id)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        # Create UserSkillMeta record (marked as unlisted so frontend shows status)
        db_mgr.upsert(UserSkillMeta(
            user_id=user_id, slug=slug, name=existing.name,
            description=existing.description, icon=existing.icon,
            version=existing.version, changelog=existing.changelog or "",
            source="created", unlisted=True,
        ))

    db_mgr.delete(SkillMeta, filters={"slug": slug})
    return {"status": True, "message": f"Skill '{slug}' is now private", "data": {"slug": slug, "public": False}}


# ── DOWNLOAD ──────────────────────────────────────────────────────────────────

@router.get("/{slug}/download")
async def download_skill(
    slug: str,
    background_tasks: BackgroundTasks,
    request: Request,
    type_: SkillType = Depends(_require_type),
    user_id: str = Query(""),
) -> FileResponse:
    """Download a skill ZIP. ?type=public or ?type=user&user_id=xxx"""
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    cfg = _require_gfs()
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    if type_ == "public":
        remote = _gfs_zip_path("public", slug)
        ok = gfs_get(remote, tmp_zip.name, cfg, timeout=60)
        if not ok:
            # Fallback: DB-only published skill — look up owner, try user GFS
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
        # Auth: resolve user from api_key, then verify it matches requested user_id
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


# ── PROFILE (public only) ─────────────────────────────────────────────────────

@router.get("/{slug}/profile")
async def get_skill_profile(slug: str) -> FileResponse:
    """Serve the profile/cover image for a public skill."""
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

    # 1. Try public GFS path
    prefix = _gfs_prefix("public")
    result = _try_profile(prefix, f"{slug}/")
    if result:
        return result

    # 2. Fallback: DB-only published skill — look up owner, try user GFS
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

    # 3. Fallback: user-only skill (not published) — look up UserSkillMeta
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


# ── SKILL.md content (user only) ──────────────────────────────────────────────

@router.get("/{slug}/skill-md")
async def get_skill_md(slug: str, request: Request, user_id: str = Query(...)) -> dict:
    """Read SKILL.md from a user's private skill ZIP."""
    user_id = _require_user_id(user_id)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Invalid slug")

    # Auth: resolve user from api_key, then verify it matches requested user_id
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
