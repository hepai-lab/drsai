"""Catalog of agent skills (SKILL.md under a configured or auto-discovered directory)."""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..config import settings

router = APIRouter()

_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")

_MAX_UPLOAD_BYTES = 32 * 1024 * 1024  # 32 MiB


def get_catalog_root() -> Path | None:
    from drsai.modules.components.skills import resolve_builtin_skills_dir

    return resolve_builtin_skills_dir(
        settings.AGENT_SKILLS_CATALOG_DIR,
        search_from=(Path(__file__), Path.cwd()),
    )


def _parse_skill_md(skill_md: Path) -> dict | None:
    from drsai.modules.components.skills.skill_loader import SkillLoader

    dummy = SkillLoader.__new__(SkillLoader)
    return SkillLoader.parse_skill_md(dummy, skill_md)


@router.get("/catalog")
async def list_skills_catalog() -> dict:
    root = get_catalog_root()
    if not root:
        return {"status": True, "data": [], "message": "技能目录未配置或不存在"}

    items: list[dict] = []
    for skill_dir in sorted(root.iterdir(), key=lambda x: x.name.lower()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        parsed = _parse_skill_md(skill_md)
        if not parsed:
            continue
        items.append(
            {
                "slug": skill_dir.name,
                "name": parsed["name"],
                "description": parsed["description"],
                "compatibility": parsed.get("compatibility"),
            }
        )

    return {"status": True, "data": items}


def _safe_extract_zip(zip_path: Path, dest: Path) -> None:
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            name = info.filename
            if name.startswith("/") or name.startswith("\\"):
                raise HTTPException(status_code=400, detail="zip 包含非法路径")
            parts = Path(name).parts
            if ".." in parts:
                raise HTTPException(status_code=400, detail="zip 包含非法路径")
            target = (dest / name).resolve()
            try:
                target.relative_to(dest)
            except ValueError as e:
                raise HTTPException(status_code=400, detail="zip 路径不安全") from e
        zf.extractall(dest)


def _ignored_entry(name: str) -> bool:
    return name.startswith(".") or name == "__MACOSX"


def _resolve_uploaded_skill_dir(extracted: Path, slug_hint: str | None) -> tuple[Path, str]:
    """Return (skill directory to install, canonical slug)."""
    entries = [p for p in extracted.iterdir() if not _ignored_entry(p.name)]
    if len(entries) == 1 and entries[0].is_dir() and (entries[0] / "SKILL.md").is_file():
        name = entries[0].name
        if slug_hint and slug_hint != name:
            raise HTTPException(
                status_code=400,
                detail=f"压缩包内目录名为 {name!r}，与 slug={slug_hint!r} 不一致",
            )
        if not _SLUG_RE.match(name):
            raise HTTPException(status_code=400, detail="技能目录名不符合 slug 规则")
        return entries[0], name

    if (extracted / "SKILL.md").is_file():
        if not slug_hint:
            raise HTTPException(
                status_code=400,
                detail="压缩包根目录包含 SKILL.md 时，请在上传表单中填写 slug（目录名）",
            )
        if not _SLUG_RE.match(slug_hint):
            raise HTTPException(status_code=400, detail="slug 格式无效")
        return extracted, slug_hint

    raise HTTPException(
        status_code=400,
        detail="无效的压缩包：应为「单个子目录内含 SKILL.md」，或根目录直接包含 SKILL.md（此时需填写 slug）",
    )


@router.post("/catalog/upload")
async def upload_skill_catalog(
    file: UploadFile = File(...),
    slug: str | None = Form(None),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 .zip 文件")

    root = get_catalog_root()
    if not root:
        raise HTTPException(status_code=503, detail="技能目录未配置或不存在，无法上传")

    root_r = root.resolve()
    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()
    stage = Path(tempfile.mkdtemp(prefix="skill-upload-"))
    try:
        size = 0
        with open(tmp_zip.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > _MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"文件超过 {_MAX_UPLOAD_BYTES // (1024 * 1024)} MiB 上限")
                out.write(chunk)

        try:
            _safe_extract_zip(Path(tmp_zip.name), stage)
        except zipfile.BadZipFile as e:
            raise HTTPException(status_code=400, detail="不是有效的 zip 文件") from e

        slug_clean = (slug or "").strip() or None
        skill_src, canon_slug = _resolve_uploaded_skill_dir(stage, slug_clean)
        skill_md = skill_src / "SKILL.md"
        parsed = _parse_skill_md(skill_md)
        if not parsed:
            raise HTTPException(status_code=422, detail="SKILL.md 格式无效（需 YAML frontmatter 与 name/description）")

        dest = (root_r / canon_slug).resolve()
        try:
            dest.relative_to(root_r)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="invalid destination") from e
        if dest.parent != root_r:
            raise HTTPException(status_code=400, detail="invalid destination")

        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(skill_src), str(dest))

        return {
            "status": True,
            "message": "上传成功",
            "data": {
                "slug": canon_slug,
                "name": parsed["name"],
                "description": parsed["description"],
                "compatibility": parsed.get("compatibility"),
            },
        }
    finally:
        try:
            os.unlink(tmp_zip.name)
        except OSError:
            pass
        shutil.rmtree(stage, ignore_errors=True)


@router.get("/catalog/{slug}/download")
async def download_skill_catalog_archive(slug: str, background_tasks: BackgroundTasks) -> FileResponse:
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="invalid slug")

    root = get_catalog_root()
    if not root:
        raise HTTPException(status_code=404, detail="技能目录未配置或不存在")

    root_r = root.resolve()
    skill_dir = (root_r / slug).resolve()
    try:
        skill_dir.relative_to(root_r)
    except ValueError as e:
        raise HTTPException(status_code=404, detail="not found") from e
    if skill_dir.parent != root_r or not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail="not found")

    if not (skill_dir / "SKILL.md").exists():
        raise HTTPException(status_code=404, detail="not found")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    base = tmp.name[:-4]
    archive_path = shutil.make_archive(base, "zip", root_dir=str(skill_dir))

    def _cleanup() -> None:
        try:
            os.unlink(archive_path)
        except OSError:
            pass

    background_tasks.add_task(_cleanup)
    return FileResponse(
        archive_path,
        filename=f"{slug}.zip",
        media_type="application/zip",
        background=background_tasks,
    )


@router.get("/catalog/{slug}")
async def get_skill_catalog_entry(slug: str) -> dict:
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="invalid slug")

    root = get_catalog_root()
    if not root:
        raise HTTPException(status_code=404, detail="技能目录未配置或不存在")

    root_r = root.resolve()
    skill_dir = (root_r / slug).resolve()
    try:
        skill_dir.relative_to(root_r)
    except ValueError as e:
        raise HTTPException(status_code=404, detail="not found") from e
    if skill_dir.parent != root_r or not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail="not found")

    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        raise HTTPException(status_code=404, detail="not found")

    parsed = _parse_skill_md(skill_md)
    if not parsed:
        raise HTTPException(status_code=422, detail="SKILL.md 格式无效")

    return {
        "status": True,
        "data": {
            "slug": slug,
            "name": parsed["name"],
            "description": parsed["description"],
            "compatibility": parsed.get("compatibility"),
            "body": parsed["body"],
        },
    }


# ── private skills (HepAI Files backed) ──────────────────────────────────────

@router.get("/private")
async def list_private_skills() -> dict:
    """Placeholder: private skills are managed through HepAI Files API.

    The frontend fetches private skills directly via the fileAPI (hepai files upload).
    This endpoint serves as a documentation anchor and can be extended later.
    """
    return {
        "status": True,
        "data": [],
        "message": "Private skills are managed via HepAI Files. Use fileAPI endpoints for CRUD.",
    }
