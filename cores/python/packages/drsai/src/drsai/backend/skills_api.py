"""Skills REST routes for the desktop gateway.

Extracted from ``gateway_legacy.py`` so Workbench / ``desktop_gateway`` (:28643)
can serve the same Skills UI contract as the legacy gateway without importing
the monolithic legacy module.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from drsai.config import list_agent_names, load_agent_runtime_policy
from drsai.modules.components.skills.core_skills import CORE_PREINSTALL_SKILL_IDS

from drsai.backend.desktop_gateway._auth import effective_user_id


class SkillInstallRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
    content: str = Field(default="", description="SKILL.md content (optional if source is provided)")
    source: str | None = Field(default=None, description="Bundled skills collection name")


class SkillUpdateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    content: str = Field(..., min_length=1)


class SkillReloadRequest(BaseModel):
    thread_id: str | None = Field(default=None, alias="threadId")
    user_id: str | None = Field(default=None, alias="userId")

    model_config = {"populate_by_name": True}


def _get_skills_dir(user_id: str | None = None) -> Path:
    uid = effective_user_id(user_id)
    from drsai.backend.run_drsai_agent_factory import WORKDIR

    return Path(WORKDIR) / uid / "configs" / "skills"


def _get_available_skills_dirs() -> list[Path]:
    from drsai.modules.components.skills import resolve_builtin_skills_dir

    root = resolve_builtin_skills_dir(search_from=(Path(__file__), Path.cwd()))
    return [root] if root is not None else []


def _get_deleted_skills_path(user_id: str | None = None) -> Path:
    """Return the persistent tombstone file for user-deleted bundled skills."""
    return _get_skills_dir(user_id).parent / "skills_deleted.json"


def _load_deleted_skills(user_id: str | None = None) -> set[str]:
    path = _get_deleted_skills_path(user_id)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return {str(item) for item in value if isinstance(item, str)} if isinstance(value, list) else set()
    except (OSError, ValueError, TypeError):
        return set()


def _save_deleted_skills(names: set[str], user_id: str | None = None) -> None:
    path = _get_deleted_skills_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(sorted(names), ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _is_symlink_or_junction(path: Path) -> bool:
    """Return True if *path* is a symbolic link, junction, or reparse point.

    Uses ``Path.is_symlink()`` which on Windows detects both POSIX symlinks
    and NTFS junctions.  A ``stat(follow_symlinks=False)`` cross-check is
    done for robustness on older Python runtimes.
    """
    try:
        if path.is_symlink():
            return True
        # On some Windows/Python combos, junctions slip through is_symlink().
        # Check the reparse-point attribute via os.lstat.
        import os
        import stat as stat_mod
        st = os.lstat(str(path))
        # FILE_ATTRIBUTE_REPARSE_POINT = 0x400
        if stat_mod.S_ISLNK(st.st_mode) or (getattr(st, "st_reparse_tag", 0) != 0):
            return True
    except OSError:
        pass
    return False


# Directories that are build artifacts or caches — never copied into
# the installed skill tree.  Note: node_modules IS copied because some
# skills (e.g. presentations) bundle vendored packages via npm file:
# links and the user's machine may not have npm available to regenerate
# them.  Symlinks/junctions within node_modules are resolved by the
# realpath logic in _copy_physical_tree.
_SKIP_DIRS = frozenset({
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".pytest_cache",
    ".mypy_cache",
    "__MACOSX",
    ".DS_Store",
})

# File suffixes to skip.
_SKIP_FILE_SUFFIXES = (".pyc", ".pyo")


def _copy_physical_tree(src: Path, dst: Path) -> None:
    """Recursively copy *src* into *dst* as physical files/directories.

    Build artifacts and package-manager caches (``node_modules``, ``.git``,
    ``__pycache__``, etc.) are skipped entirely — they are regenerated at
    the destination by the skill's setup script.

    Symbolic links / junctions are **resolved and followed** rather than
    rejected, so a vendored package linked via npm's ``file:`` protocol
    is materialised as real files at the destination.
    """
    if _is_symlink_or_junction(src):
        resolved = src.resolve()
        if not resolved.exists():
            return  # broken symlink — skip silently
        if resolved.is_dir():
            _copy_physical_tree(resolved, dst)
        elif resolved.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(resolved), str(dst))
        return

    if not src.is_dir():
        raise ValueError(f"Source is not a directory: {src}")

    dst.mkdir(parents=True, exist_ok=True)

    for entry in sorted(src.iterdir()):
        if entry.name in _SKIP_DIRS:
            continue
        if any(entry.name.endswith(suffix) for suffix in _SKIP_FILE_SUFFIXES):
            continue

        src_entry = entry
        dst_entry = dst / entry.name

        if _is_symlink_or_junction(src_entry):
            resolved = src_entry.resolve()
            if not resolved.exists():
                continue  # broken symlink — skip silently
            if resolved.is_dir():
                _copy_physical_tree(resolved, dst_entry)
            elif resolved.is_file():
                shutil.copy2(str(resolved), str(dst_entry))
            continue

        if src_entry.is_dir():
            _copy_physical_tree(src_entry, dst_entry)
        elif src_entry.is_file():
            shutil.copy2(str(src_entry), str(dst_entry))
        # Skip special files (sockets, devices, FIFOs) silently.


def _resolve_bundled_skill_root(name: str, source: str | None = None) -> Path | None:
    for skills_dir in _get_available_skills_dirs():
        if source and skills_dir.name != source:
            continue
        candidate = skills_dir / name
        if (candidate / "SKILL.md").exists():
            return candidate

    # docx ships under anthropic_skills_collection until promoted to skills/skills.
    if name == "docx" and not source:
        for skills_dir in _get_available_skills_dirs():
            extra = skills_dir.parent / "anthropic_skills_collection" / name
            if (extra / "SKILL.md").exists():
                return extra
    return None


def _find_bundled_skill_md(name: str, source: str | None = None) -> Path | None:
    root = _resolve_bundled_skill_root(name, source)
    return (root / "SKILL.md") if root is not None else None


def _skill_summary_from_dir(skill_dir: Path, *, source_name: str, installed_names: set[str]) -> dict:
    skill_md = skill_dir / "SKILL.md"
    try:
        content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
        name, description, _category = _parse_skill_frontmatter(content)
        name = name or skill_dir.name
        return {
            "name": name,
            "description": description or "",
            "category": source_name,
            "source": source_name,
            "installed": name in installed_names or skill_dir.name in installed_names,
            "bundled_id": skill_dir.name,
        }
    except Exception:
        return {
            "name": skill_dir.name,
            "description": "",
            "category": source_name,
            "source": source_name,
            "installed": skill_dir.name in installed_names,
            "bundled_id": skill_dir.name,
        }


def _parse_skill_frontmatter(content: str) -> tuple[str, str, str]:
    name, description, category = "", "", ""
    if not content.startswith("---"):
        heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)
        if heading:
            name = heading.group(1).strip()
        para = re.search(r"^(?!#)(?!---).+", content, re.MULTILINE)
        if para:
            description = para.group(0).strip()[:120]
        return name, description, category

    end_idx = content.find("---", 3)
    if end_idx == -1:
        return name, description, category

    frontmatter = content[3:end_idx]
    name_match = re.search(r"^\s*name:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if name_match:
        name = name_match.group(1).strip()
    desc_match = re.search(r"^\s*description:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if desc_match:
        description = desc_match.group(1).strip()
    cat_match = re.search(r"^\s*category:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if cat_match:
        category = cat_match.group(1).strip()
    return name, description, category


def register_skills_routes(app: FastAPI) -> None:
    """Attach ``/v1/skills*`` endpoints to the gateway app."""

    @app.get("/v1/skills")
    async def list_skills(user_id: str | None = Query(default=None)):
        skills_dir = _get_skills_dir(user_id)
        skills: list[dict] = []
        if skills_dir.exists():
            for skill_dir in sorted(skills_dir.iterdir()):
                if not skill_dir.is_dir():
                    continue
                skill_md = skill_dir / "SKILL.md"
                if not skill_md.exists():
                    continue
                try:
                    content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
                    name, description, category = _parse_skill_frontmatter(content)
                    st = skill_md.stat()
                    skills.append(
                        {
                            "name": name or skill_dir.name,
                            "category": category or "",
                            "description": description or "",
                            "path": str(skill_dir),
                            "size": int(st.st_size),
                            "mtime": int(st.st_mtime),
                        },
                    )
                except Exception:
                    try:
                        st = skill_md.stat()
                        mtime = int(st.st_mtime)
                        size = int(st.st_size)
                    except OSError:
                        mtime = 0
                        size = 0
                    skills.append(
                        {
                            "name": skill_dir.name,
                            "category": "",
                            "description": "",
                            "path": str(skill_dir),
                            "size": size,
                            "mtime": mtime,
                        },
                    )
        # 按名称升序（与桌面端「已安装」一致）
        return {
            "object": "list",
            "data": sorted(
                skills,
                key=lambda s: str(s.get("name") or "").lower(),
            ),
        }

    @app.get("/v1/skills/available")
    async def list_available_skills(
        user_id: str | None = Query(default=None),
        core_only: bool = Query(default=False),
    ):
        installed_names: set[str] = set()
        user_skills_dir = _get_skills_dir(user_id)
        if user_skills_dir.exists():
            for entry in user_skills_dir.iterdir():
                if entry.is_dir() and (entry / "SKILL.md").exists():
                    installed_names.add(entry.name)

        results: list[dict] = []
        if core_only:
            for skill_id in CORE_PREINSTALL_SKILL_IDS:
                root = _resolve_bundled_skill_root(skill_id)
                if root is None:
                    continue
                results.append(_skill_summary_from_dir(root, source_name="skills", installed_names=installed_names))
        else:
            for skills_dir in _get_available_skills_dirs():
                source_name = skills_dir.name
                if not skills_dir.exists():
                    continue
                for skill_dir in sorted(skills_dir.iterdir()):
                    if not skill_dir.is_dir():
                        continue
                    if not (skill_dir / "SKILL.md").exists():
                        continue
                    results.append(
                        _skill_summary_from_dir(skill_dir, source_name=source_name, installed_names=installed_names),
                    )
            for skill_id in CORE_PREINSTALL_SKILL_IDS:
                if skill_id in {item.get("bundled_id") for item in results}:
                    continue
                root = _resolve_bundled_skill_root(skill_id)
                if root is None:
                    continue
                results.append(_skill_summary_from_dir(root, source_name="skills", installed_names=installed_names))

        seen: set[str] = set()
        deduped: list[dict] = []
        for item in results:
            key = str(item.get("bundled_id") or item["name"])
            if key not in seen:
                seen.add(key)
                deduped.append(item)
        return {"object": "list", "data": sorted(deduped, key=lambda s: (s["category"], s["name"]))}

    @app.get("/v1/skills/{skill_path:path}", operation_id="getSkillContent")
    async def get_skill_content(skill_path: str):
        path = Path(skill_path)
        if not path.is_absolute():
            path = _get_skills_dir() / skill_path
        skill_md = path / "SKILL.md" if path.is_dir() else path
        if not skill_md.exists():
            raise HTTPException(status_code=404, detail="Skill not found")
        try:
            content = skill_md.read_text(encoding="utf-8", errors="replace")
            return {"path": str(skill_md), "content": content}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/v1/skills/install")
    async def install_skill(req: SkillInstallRequest, user_id: str | None = Query(default=None)):
        skills_dir = _get_skills_dir(user_id)
        skill_dir = skills_dir / req.name
        content = req.content
        bundled_skill_dir: Path | None = None
        if req.source and not content:
            bundled_skill_md = _find_bundled_skill_md(req.name, req.source)
            if bundled_skill_md is None:
                # Allow install by bundled folder id when frontmatter name differs.
                bundled_skill_dir = _resolve_bundled_skill_root(req.name, req.source)
                if bundled_skill_dir is None:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Bundled skill '{req.name}' not found in source '{req.source}'",
                    )
                bundled_skill_md = bundled_skill_dir / "SKILL.md"
            else:
                bundled_skill_dir = bundled_skill_md.parent
            content = bundled_skill_md.read_text(encoding="utf-8", errors="replace")

        if not content:
            raise HTTPException(status_code=400, detail="content must not be empty")

        if bundled_skill_dir is not None:
            # Use symlink-safe physical copy instead of shutil.copytree which
            # may silently follow junctions in the bundled skill directory.
            if skill_dir.exists():
                shutil.rmtree(skill_dir)
            _copy_physical_tree(bundled_skill_dir, skill_dir)
            # Clear any prior deletion tombstone — the user is explicitly
            # re-installing this skill, so future sync cycles should not skip it.
            deleted = _load_deleted_skills(user_id)
            if req.name in deleted:
                deleted.discard(req.name)
                _save_deleted_skills(deleted, user_id)
        else:
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")

        installed_files = sorted(
            path.relative_to(skill_dir).as_posix() for path in skill_dir.rglob("*") if path.is_file()
        )
        return {"status": "ok", "name": req.name, "path": str(skill_dir), "installed_files": installed_files}

    @app.put("/v1/skills/{skill_name}", operation_id="updateSkill")
    async def update_skill(skill_name: str, req: SkillUpdateRequest, user_id: str | None = Query(default=None)):
        if skill_name != req.name:
            raise HTTPException(status_code=400, detail="Skill name mismatch")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", skill_name):
            raise HTTPException(status_code=400, detail="Skill name is invalid")
        skills_dir = _get_skills_dir(user_id)
        skill_dir = skills_dir / skill_name
        if not skill_dir.exists():
            raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_md = skill_dir / "SKILL.md"
        skill_md.write_text(req.content, encoding="utf-8")
        return {"status": "ok", "name": skill_name, "path": str(skill_dir)}

    @app.delete("/v1/skills/{skill_name}", operation_id="uninstallSkill")
    async def uninstall_skill(skill_name: str, user_id: str | None = Query(default=None)):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", skill_name):
            raise HTTPException(status_code=400, detail="Skill name is invalid")

        # 仅当 Agent 策略里显式列出该 skill（enabled / disabled）时视为占用。
        # inherit / all_enabled 表示「目录可用」，不等于固定引用；否则默认 all_enabled
        # 会让任意已装 skill 都删不掉。
        references = []
        for agent_name in list_agent_names():
            policy = load_agent_runtime_policy(agent_name)
            if skill_name in policy.skills.enabled or skill_name in policy.skills.disabled:
                references.append(
                    {"kind": "agent_skill_reference", "agent_name": agent_name, "skill_id": skill_name},
                )
        if references:
            agents = ", ".join(sorted({str(r["agent_name"]) for r in references}))
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "skill_in_use",
                    "message": (
                        f"Skill is referenced by one or more Agents ({agents}). "
                        "Remove it from those agents' skill policy (enabled/disabled lists) first."
                    ),
                    "references": references,
                },
            )

        skills_dir = _get_skills_dir(user_id)
        skill_dir = skills_dir / skill_name
        if not skill_dir.exists():
            raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

        # Check if this skill exists in the bundled repository. If so, record
        # the deletion in a persistent tombstone so that `update_user_skills`
        # and the TUI setup handler do not automatically re-sync it.
        is_bundled = _resolve_bundled_skill_root(skill_name) is not None
        if is_bundled:
            deleted = _load_deleted_skills(user_id)
            deleted.add(skill_name)
            _save_deleted_skills(deleted, user_id)

        shutil.rmtree(skill_dir)
        return {"status": "ok", "name": skill_name, "bundled": is_bundled}

    @app.post("/v1/skills/reload")
    async def reload_skills(req: SkillReloadRequest):
        from drsai.backend.desktop_gateway import _state

        await _state.agent_manager().evict_user(req.user_id)
        return {"ok": True, "reloaded": True}
