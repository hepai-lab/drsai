"""Skills REST routes for the desktop gateway.

Extracted from ``gateway_legacy.py`` so Workbench / ``desktop_gateway`` (:28643)
can serve the same Skills UI contract as the legacy gateway without importing
the monolithic legacy module.
"""

from __future__ import annotations

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

    @app.get("/v1/skills/{skill_path:path}")
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
            shutil.copytree(
                bundled_skill_dir,
                skill_dir,
                dirs_exist_ok=True,
                copy_function=shutil.copy2,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"),
            )
        else:
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")

        installed_files = sorted(
            path.relative_to(skill_dir).as_posix() for path in skill_dir.rglob("*") if path.is_file()
        )
        return {"status": "ok", "name": req.name, "path": str(skill_dir), "installed_files": installed_files}

    @app.put("/v1/skills/{skill_name}")
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

    @app.delete("/v1/skills/{skill_name}")
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
        shutil.rmtree(skill_dir)
        return {"status": "ok", "name": skill_name}

    @app.post("/v1/skills/reload")
    async def reload_skills(req: SkillReloadRequest):
        from drsai.backend.desktop_gateway import _state

        await _state.agent_manager().evict_user(req.user_id)
        return {"ok": True, "reloaded": True}
