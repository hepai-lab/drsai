"""Skill management RPC handler for the DrSai TUI gateway.

Registered method:
    skills.manage  — unified CRUD for user skills
                     action: list | show | create | delete | update | reload

Skills are stored as SKILL.md files under the user skills directory:
    ~/.drsai/workspace/runs/<user_id>/configs/skills/<skill_name>/SKILL.md

SKILL.md format (YAML frontmatter + Markdown body):
    ---
    name: my-skill
    description: What this skill does and when to use it.
    ---
    # Body
    Detailed instructions here…

This handler is registered in ``_LONG_HANDLERS`` so file I/O never blocks
the stdin-reading main thread.
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any, Optional

from ..server import _err, _ok, _resolve_user_id, _sessions, method

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────

_SKILL_FILENAME = "SKILL.md"

# Only letters, digits, hyphens, underscores are allowed in skill names.
_VALID_NAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")

# Reasonable upper-bound to prevent accidental huge writes.
_MAX_CONTENT_BYTES = 4 * 1024 * 1024  # 4 MB


# ── Helpers ──────────────────────────────────────────────────────────

def _get_user_skills_dir(user_id: str) -> Path:
    """Return the user's skills directory path (may not yet exist)."""
    from drsai.configs.constant import WORKSPACE_RUNS_DIR
    # Skills are stored under ~/.drsai/workspace/runs/<user_id>/configs/skills/
    # NOT under ~/.drsai/runs/ (that's the old RUNS_DIR constant, kept for legacy fallback only)
    return Path(WORKSPACE_RUNS_DIR) / user_id / "configs" / "skills"


def _ensure_skills_dir(user_id: str) -> Path:
    p = _get_user_skills_dir(user_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _validate_name(name: str) -> Optional[str]:
    """Return an error message or None if the name is valid."""
    if not name:
        return "skill name is required"
    if not _VALID_NAME_RE.match(name):
        return (
            f"invalid skill name '{name}': "
            "only letters, digits, hyphens and underscores are allowed"
        )
    if len(name) > 64:
        return f"skill name too long ({len(name)} chars, max 64)"
    return None


def _parse_skill_md(content: str) -> Optional[dict[str, str]]:
    """Parse SKILL.md content into {name, description, body}.

    Supports both simple ``key: value`` and YAML block scalars
    (``description: |`` multi-line) via the ``yaml`` stdlib module.

    Returns None if the frontmatter is missing or required fields absent.
    """
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
    if not m:
        return None
    frontmatter_str, body = m.groups()
    try:
        import yaml
        metadata = yaml.safe_load(frontmatter_str) or {}
    except Exception:
        # Fallback: simple line-by-line parse for non-YAML frontmatter
        metadata = {}
        for line in frontmatter_str.strip().splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                metadata[k.strip()] = v.strip().strip("\"'")
    if not isinstance(metadata, dict):
        return None
    if "name" not in metadata or "description" not in metadata:
        return None
    return {
        "name": str(metadata["name"]),
        "description": str(metadata["description"]).strip(),
        "body": body.strip(),
    }


def _read_skill(skill_dir: Path) -> Optional[dict[str, Any]]:
    """Read one skill directory and return a summary dict, or None."""
    skill_file = skill_dir / _SKILL_FILENAME
    if not skill_file.exists():
        return None
    try:
        content = skill_file.read_text(encoding="utf-8")
    except OSError:
        return None
    parsed = _parse_skill_md(content)
    if parsed is None:
        return None
    return {
        "name": parsed["name"],
        "description": parsed["description"],
        "dir": str(skill_dir),
        "size": skill_file.stat().st_size,
        "mtime": skill_file.stat().st_mtime,
    }


def _reload_agent_skills(session_id: Optional[str]) -> None:
    """Trigger update_user_skills() on the active agent, if available."""
    if session_id:
        state = _sessions.get(session_id)
        if state:
            sess = state.get("agent_session")
            if sess and sess.agent and hasattr(sess.agent, "update_user_skills"):
                try:
                    sess.agent.update_user_skills()
                    logger.info("skills: reloaded agent skills for session %s", session_id)
                except Exception:
                    logger.exception("skills: update_user_skills failed")


# ── RPC handler ──────────────────────────────────────────────────────

@method("skills.manage")
def _skills_manage(rid, params: dict) -> dict:
    """Unified CRUD handler for user skills.

    params:
        action      str  — "list" | "show" | "create" | "delete" | "update" | "reload"
        session_id  str  — optional; used to hot-reload skills on the active agent
        name        str  — skill name (required for show/create/delete/update)
        content     str  — full SKILL.md content (required for create/update)
    """
    action = (params.get("action") or "list").strip().lower()
    session_id: Optional[str] = params.get("session_id") or None
    name: str = (params.get("name") or "").strip()
    content: str = params.get("content") or ""

    user_id = _resolve_user_id()

    # ── list ─────────────────────────────────────────────────────────
    if action == "list":
        skills_dir = _get_user_skills_dir(user_id)
        if not skills_dir.exists():
            return _ok(rid, {"skills": []})
        skills: list[dict] = []
        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            info = _read_skill(skill_dir)
            if info:
                skills.append(info)
        return _ok(rid, {"skills": skills})

    # ── show ─────────────────────────────────────────────────────────
    if action == "show":
        err = _validate_name(name)
        if err:
            return _err(rid, 4002, err)
        skills_dir = _get_user_skills_dir(user_id)
        skill_dir = skills_dir / name
        skill_file = skill_dir / _SKILL_FILENAME
        if not skill_file.exists():
            return _err(rid, 4004, f"skill '{name}' not found")
        try:
            raw = skill_file.read_text(encoding="utf-8")
        except OSError as exc:
            return _err(rid, 5010, f"read failed: {exc}")
        parsed = _parse_skill_md(raw)
        return _ok(rid, {
            "name": name,
            "content": raw,
            "parsed": parsed,
            "path": str(skill_file),
        })

    # ── create ───────────────────────────────────────────────────────
    if action == "create":
        err = _validate_name(name)
        if err:
            return _err(rid, 4002, err)
        if not content.strip():
            return _err(rid, 4002, "content is required for create")
        if len(content.encode()) > _MAX_CONTENT_BYTES:
            return _err(rid, 4002, f"content too large (max {_MAX_CONTENT_BYTES // 1024} KB)")

        # Validate SKILL.md format
        parsed = _parse_skill_md(content)
        if parsed is None:
            return _err(
                rid, 4002,
                "content must be a valid SKILL.md with YAML frontmatter "
                "containing 'name' and 'description' fields"
            )

        skills_dir = _ensure_skills_dir(user_id)
        skill_dir = skills_dir / name
        if skill_dir.exists():
            return _err(rid, 4009, f"skill '{name}' already exists; use action='update' to overwrite")
        try:
            skill_dir.mkdir(parents=True)
            (skill_dir / _SKILL_FILENAME).write_text(content, encoding="utf-8")
        except OSError as exc:
            return _err(rid, 5010, f"write failed: {exc}")

        _reload_agent_skills(session_id)
        logger.info("skills.create: created skill '%s' for user %s", name, user_id)
        return _ok(rid, {"ok": True, "name": name, "path": str(skill_dir / _SKILL_FILENAME)})

    # ── update ───────────────────────────────────────────────────────
    if action == "update":
        err = _validate_name(name)
        if err:
            return _err(rid, 4002, err)
        if not content.strip():
            return _err(rid, 4002, "content is required for update")
        if len(content.encode()) > _MAX_CONTENT_BYTES:
            return _err(rid, 4002, f"content too large (max {_MAX_CONTENT_BYTES // 1024} KB)")

        parsed = _parse_skill_md(content)
        if parsed is None:
            return _err(
                rid, 4002,
                "content must be a valid SKILL.md with YAML frontmatter "
                "containing 'name' and 'description' fields"
            )

        skills_dir = _ensure_skills_dir(user_id)
        skill_dir = skills_dir / name
        skill_file = skill_dir / _SKILL_FILENAME
        if not skill_file.exists():
            return _err(rid, 4004, f"skill '{name}' not found; use action='create' to add it")
        try:
            skill_file.write_text(content, encoding="utf-8")
        except OSError as exc:
            return _err(rid, 5010, f"write failed: {exc}")

        _reload_agent_skills(session_id)
        logger.info("skills.update: updated skill '%s' for user %s", name, user_id)
        return _ok(rid, {"ok": True, "name": name, "path": str(skill_file)})

    # ── delete ───────────────────────────────────────────────────────
    if action == "delete":
        err = _validate_name(name)
        if err:
            return _err(rid, 4002, err)
        skills_dir = _get_user_skills_dir(user_id)
        skill_dir = skills_dir / name
        if not skill_dir.exists():
            return _err(rid, 4004, f"skill '{name}' not found")
        try:
            shutil.rmtree(skill_dir)
        except OSError as exc:
            return _err(rid, 5010, f"delete failed: {exc}")

        _reload_agent_skills(session_id)
        logger.info("skills.delete: deleted skill '%s' for user %s", name, user_id)
        return _ok(rid, {"ok": True, "name": name})

    # ── reload ───────────────────────────────────────────────────────
    if action == "reload":
        if not session_id:
            return _err(rid, 4002, "session_id is required for reload")
        _reload_agent_skills(session_id)
        return _ok(rid, {"ok": True, "reloaded": True})

    return _err(rid, 4002, f"unknown action '{action}'; expected: list|show|create|update|delete|reload")
