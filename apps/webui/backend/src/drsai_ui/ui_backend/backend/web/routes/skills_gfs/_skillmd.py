"""SKILL.md parsing, slugify, zip reading helpers."""

from __future__ import annotations

import os
import re
import tempfile
import zipfile

import yaml

from ._constants import _PROFILE_EXT_WHITELIST
from ..gfs_utils import gfs_get


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
    if not isinstance(frontmatter, dict) or not frontmatter.get("name") or not frontmatter.get("description"):
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
    from ..gfs_utils import gfs_put
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


def _profile_safe_ext(filename: str) -> str | None:
    stem_ext = os.path.splitext(filename)
    ext = stem_ext[1].lower() if len(stem_ext) > 1 else None
    if ext and ext in _PROFILE_EXT_WHITELIST:
        return ext
    return None