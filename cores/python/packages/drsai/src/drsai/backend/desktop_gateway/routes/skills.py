"""``/v1/skills*`` routes for ``desktop_gateway``.

The local installed-skills contract the Desktop renderer calls.  Moved here
from ``drsai.backend.skills_api`` so that the HTTP surface the Desktop app
talks to lives inside this package rather than beside unrelated ``backend``
modules; the filesystem half now lives in ``desktop_gateway/_skills_store.py``.

Routes are mounted by ``desktop_gateway.app`` via ``skills.router()``.  They are
mounted **last** so the declaration order of the whole app is unchanged by the
move.

Declaration order is part of the contract: ``/v1/skills/available`` comes before
``/v1/skills/{skill_path}``, because Starlette matches in registration order and
the catch-all would otherwise swallow it.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from drsai.config import list_agent_names, load_agent_runtime_policy
from drsai.modules.components.skills.core_skills import CORE_PREINSTALL_SKILL_IDS

from .._skills_store import (
    available_skills_dirs,
    copy_physical_tree,
    find_bundled_skill_md,
    load_deleted_skills,
    parse_skill_frontmatter,
    resolve_bundled_skill_root,
    save_deleted_skills,
    seed_user_skills_once,
    skill_summary_from_dir,
    skills_dir,
)


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


api = APIRouter(tags=["skills"])


@api.get("/v1/skills")
async def list_skills(user_id: str | None = Query(default=None)):
    # First-run seeding: copy the packaged catalogue into this user's directory
    # exactly once. Guarded by a marker, so later edits/deletions stick and the
    # catalogue is never re-imposed. No-op after the first call.
    seed_user_skills_once(user_id)
    directory = skills_dir(user_id)
    skills: list[dict] = []
    if directory.exists():
        for skill_dir in sorted(directory.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            try:
                content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
                name, description, category = parse_skill_frontmatter(content)
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


@api.get("/v1/skills/available")
async def list_available_skills(
    user_id: str | None = Query(default=None),
    core_only: bool = Query(default=False),
):
    seed_user_skills_once(user_id)
    installed_names: set[str] = set()
    user_skills_dir = skills_dir(user_id)
    if user_skills_dir.exists():
        for entry in user_skills_dir.iterdir():
            if entry.is_dir() and (entry / "SKILL.md").exists():
                installed_names.add(entry.name)

    results: list[dict] = []
    if core_only:
        for skill_id in CORE_PREINSTALL_SKILL_IDS:
            root = resolve_bundled_skill_root(skill_id)
            if root is None:
                continue
            results.append(
                skill_summary_from_dir(root, source_name="skills", installed_names=installed_names),
            )
    else:
        for directory in available_skills_dirs():
            source_name = directory.name
            if not directory.exists():
                continue
            for skill_dir in sorted(directory.iterdir()):
                if not skill_dir.is_dir():
                    continue
                if not (skill_dir / "SKILL.md").exists():
                    continue
                results.append(
                    skill_summary_from_dir(
                        skill_dir, source_name=source_name, installed_names=installed_names,
                    ),
                )
        for skill_id in CORE_PREINSTALL_SKILL_IDS:
            if skill_id in {item.get("bundled_id") for item in results}:
                continue
            root = resolve_bundled_skill_root(skill_id)
            if root is None:
                continue
            results.append(
                skill_summary_from_dir(root, source_name="skills", installed_names=installed_names),
            )

    seen: set[str] = set()
    deduped: list[dict] = []
    for item in results:
        key = str(item.get("bundled_id") or item["name"])
        if key not in seen:
            seen.add(key)
            deduped.append(item)
    return {"object": "list", "data": sorted(deduped, key=lambda s: (s["category"], s["name"]))}


@api.get("/v1/skills/{skill_path:path}", operation_id="getSkillContent")
async def get_skill_content(skill_path: str):
    path = Path(skill_path)
    if not path.is_absolute():
        path = skills_dir() / skill_path
    skill_md = path / "SKILL.md" if path.is_dir() else path
    if not skill_md.exists():
        raise HTTPException(status_code=404, detail="Skill not found")
    try:
        content = skill_md.read_text(encoding="utf-8", errors="replace")
        return {"path": str(skill_md), "content": content}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@api.post("/v1/skills/install")
async def install_skill(req: SkillInstallRequest, user_id: str | None = Query(default=None)):
    directory = skills_dir(user_id)
    skill_dir = directory / req.name
    content = req.content
    bundled_skill_dir: Path | None = None
    if req.source and not content:
        bundled_skill_md = find_bundled_skill_md(req.name, req.source)
        if bundled_skill_md is None:
            # Allow install by bundled folder id when frontmatter name differs.
            bundled_skill_dir = resolve_bundled_skill_root(req.name, req.source)
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
        copy_physical_tree(bundled_skill_dir, skill_dir)
        # Clear any prior deletion tombstone — the user is explicitly
        # re-installing this skill, so future sync cycles should not skip it.
        deleted = load_deleted_skills(user_id)
        if req.name in deleted:
            deleted.discard(req.name)
            save_deleted_skills(deleted, user_id)
    else:
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")

    installed_files = sorted(
        path.relative_to(skill_dir).as_posix()
        for path in skill_dir.rglob("*")
        if path.is_file()
    )
    return {
        "status": "ok",
        "name": req.name,
        "path": str(skill_dir),
        "installed_files": installed_files,
    }


@api.put("/v1/skills/{skill_name}", operation_id="updateSkill")
async def update_skill(skill_name: str, req: SkillUpdateRequest, user_id: str | None = Query(default=None)):
    if skill_name != req.name:
        raise HTTPException(status_code=400, detail="Skill name mismatch")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", skill_name):
        raise HTTPException(status_code=400, detail="Skill name is invalid")
    directory = skills_dir(user_id)
    skill_dir = directory / skill_name
    if not skill_dir.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(req.content, encoding="utf-8")
    return {"status": "ok", "name": skill_name, "path": str(skill_dir)}


@api.delete("/v1/skills/{skill_name}", operation_id="uninstallSkill")
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

    directory = skills_dir(user_id)
    skill_dir = directory / skill_name
    if not skill_dir.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    # Check if this skill exists in the bundled repository. If so, record
    # the deletion in a persistent tombstone so that `update_user_skills`
    # and the TUI setup handler do not automatically re-sync it.
    is_bundled = resolve_bundled_skill_root(skill_name) is not None
    if is_bundled:
        deleted = load_deleted_skills(user_id)
        deleted.add(skill_name)
        save_deleted_skills(deleted, user_id)

    shutil.rmtree(skill_dir)
    return {"status": "ok", "name": skill_name, "bundled": is_bundled}


@api.post("/v1/skills/reload")
async def reload_skills(req: SkillReloadRequest):
    from .. import _state

    await _state.agent_manager().evict_user(req.user_id)
    return {"ok": True, "reloaded": True}


def router() -> APIRouter:
    """供 ``desktop_gateway.app`` 挂载的本地技能路由表。"""
    return api
