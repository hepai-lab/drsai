"""DocMaster-specific HTTP routes (template library catalog).

Only used by the frontend's RightPanel `模板库` tab. The underlying skill
(`TemplateLibrarySkill`) lives in
`examples/agent_groupchat/docmaster/document_skills/template_library_skill.py`
and is normally invoked through the DocMaster agent's tool-use flow; this
route exposes the read-only `list()` method so the UI can render the
catalog without going through the chat agent.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from ..deps import get_db

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
router = APIRouter()

_TEMPLATE_MEDIA_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def _find_docmaster_dir(start: Path) -> Path | None:
    """Walk parents from `start` until `examples/agent_groupchat/docmaster` exists."""
    p = start.resolve()
    for _ in range(16):
        cand = p / "examples" / "agent_groupchat" / "docmaster"
        if cand.is_dir():
            return cand.resolve()
        if p.parent == p:
            break
        p = p.parent
    return None


def _resolve_docmaster_dir() -> Path | None:
    env = os.environ.get("DOCMASTER_DIR")
    if env:
        p = Path(env).expanduser().resolve()
        result = p if p.is_dir() else None
        logger.info("[templates] DOCMASTER_DIR env=%s resolved=%s", env, result)
        return result
    result = _find_docmaster_dir(Path(__file__).resolve().parent)
    logger.info("[templates] auto-detected docmaster_dir=%s (search start=%s)", result, Path(__file__).resolve().parent)
    return result


def _load_template_library_skill():
    """Load TemplateLibrarySkill via direct file import.

    DocMaster's `document_skills` package is not on `sys.path` in the UI
    backend's environment, so we load the module file directly instead of
    relying on a package import.
    """
    docmaster_dir = _resolve_docmaster_dir()
    if docmaster_dir is None:
        return None, None
    skill_path = docmaster_dir / "document_skills" / "template_library_skill.py"
    if not skill_path.is_file():
        return None, None
    module_key = "drsai_ui._docmaster_template_library_skill"
    if module_key in sys.modules:
        module = sys.modules[module_key]
    else:
        spec = importlib.util.spec_from_file_location(module_key, skill_path)
        if spec is None or spec.loader is None:
            return None, None
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_key] = module
        spec.loader.exec_module(module)
    cls = getattr(module, "TemplateLibrarySkill", None)
    return cls, docmaster_dir


def _resolve_template_result(template_id: str, source: str, user_id: Optional[str]):
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        raise HTTPException(
            status_code=404,
            detail="DocMaster workspace not found; set DOCMASTER_DIR env var to override.",
        )

    if source not in ("shared", "mine"):
        raise HTTPException(status_code=400, detail="source must be 'shared' or 'mine'")
    if source == "mine" and not user_id:
        raise HTTPException(status_code=400, detail="user_id is required when source='mine'")

    workspace_dir = str(docmaster_dir / "workspace")
    skill = cls(workspace_dir=workspace_dir, user_id=user_id)
    result = skill.get_path(template_id, user_id=user_id if source == "mine" else None)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "Template not found"))
    template_path = result.get("template_path")
    if not template_path or not Path(template_path).is_file():
        raise HTTPException(status_code=404, detail="Template file missing on disk")
    return result, Path(template_path), docmaster_dir


def _find_ppt_preview_script(docmaster_dir: Path) -> Path:
    candidates = [
        docmaster_dir
        / "skills"
        / "presentation-skills"
        / "ppt-polished-deck-collab"
        / "scripts"
        / "export_pptx_previews.py",
        docmaster_dir
        / "skills"
        / "presentation-skills"
        / "ppt-polished-deck-collab-traditional"
        / "scripts"
        / "export_pptx_previews.py",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise HTTPException(status_code=404, detail="PPTX preview exporter not found")


def _ppt_preview_dir(template_path: Path) -> Path:
    return template_path.parent / "preview"


def _ensure_ppt_preview_images(
    template_path: Path,
    docmaster_dir: Path,
) -> Path:
    out_dir = _ppt_preview_dir(template_path)
    existing = sorted(out_dir.glob("slide_*.png"))
    if existing:
        return out_dir

    script_path = _find_ppt_preview_script(docmaster_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [
                sys.executable,
                str(script_path),
                "--pptx",
                str(template_path),
                "--out-dir",
                str(out_dir),
                "--prefix",
                "slide_",
                "--keep-pdf",
            ],
            check=True,
            capture_output=True,
            text=True,
            cwd=str(docmaster_dir),
        )
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        shutil.rmtree(out_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate PPTX preview: {detail}") from exc

    generated = sorted(out_dir.glob("slide_*.png"))
    if not generated:
        raise HTTPException(status_code=500, detail="Failed to generate PPTX preview images")
    return out_dir


@router.get("/templates")
async def list_templates(
    user_id: Optional[str] = Query(None, description="User identifier (typically email)"),
    category: Optional[str] = Query(None, description="Optional category filter"),
    query: Optional[str] = Query(None, description="Optional substring filter"),
) -> dict:
    """List shared + user template entries with their aliases.

    Returns the same payload shape as `TemplateLibrarySkill.list`:
    `{success, shared: [...], mine: [...], message}`, wrapped in the
    standard `{status, message, data}` envelope used by the rest of this
    API.
    """
    logger.info("[templates] list_templates request: user_id=%s category=%s query=%s", user_id, category, query)
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        logger.error("[templates] list_templates: docmaster_dir not found")
        raise HTTPException(
            status_code=404,
            detail="DocMaster workspace not found; set DOCMASTER_DIR env var to override.",
        )

    workspace_dir = str(docmaster_dir / "workspace")
    logger.info("[templates] list_templates: workspace_dir=%s", workspace_dir)
    skill = cls(workspace_dir=workspace_dir, user_id=user_id)
    logger.info("[templates] list_templates: _user_storage=%s", type(skill._user_storage).__name__ if skill._user_storage is not None else "None (local FS)")
    result = skill.list(user_id=user_id, category=category, query=query)
    logger.info("[templates] list_templates: shared=%d mine=%d", len(result.get("shared", [])), len(result.get("mine", [])))
    return {
        "status": bool(result.get("success", True)),
        "message": result.get("message", ""),
        "data": {
            "shared": result.get("shared", []),
            "mine": result.get("mine", []),
        },
    }


@router.get("/templates/file")
async def get_template_file(
    template_id: str = Query(..., description="Template id from list_templates"),
    source: str = Query("shared", description="'shared' or 'mine'"),
    user_id: Optional[str] = Query(None, description="Required when source='mine'"),
) -> FileResponse:
    """Stream a template file so the frontend can preview it."""
    result, template_path, _docmaster_dir = _resolve_template_result(template_id, source, user_id)

    meta = result.get("metadata") or {}
    suffix = template_path.suffix.lower()
    filename = f"{meta.get('name') or template_id}{suffix}"
    media_type = _TEMPLATE_MEDIA_TYPES.get(suffix, "application/octet-stream")
    return FileResponse(
        str(template_path),
        media_type=media_type,
        filename=filename,
    )


@router.get("/templates/pptx-preview")
async def get_template_pptx_preview(
    request: Request,
    template_id: str = Query(..., description="Template id from list_templates"),
    source: str = Query("shared", description="'shared' or 'mine'"),
    user_id: Optional[str] = Query(None, description="Required when source='mine'"),
) -> dict:
    """Generate and return slide image URLs for a PPTX template preview."""
    result, template_path, docmaster_dir = _resolve_template_result(template_id, source, user_id)
    if template_path.suffix.lower() != ".pptx":
        raise HTTPException(status_code=400, detail="Template is not a .pptx file")

    preview_dir = _ensure_ppt_preview_images(template_path, docmaster_dir)
    images = sorted(preview_dir.glob("slide_*.png"))
    base_qs = f"template_id={template_id}&source={source}"
    if source == "mine" and user_id:
        base_qs += f"&user_id={user_id}"
    slides = [
        {
            "index": index + 1,
            "name": path.name,
            "url": str(request.url_for("get_template_pptx_preview_image", image_name=path.name)).replace(
                str(request.base_url).rstrip("/"),
                str(request.base_url).rstrip("/"),
            ) + f"?{base_qs}&_={int(path.stat().st_mtime)}",
        }
        for index, path in enumerate(images)
    ]
    return {
        "status": True,
        "message": "",
        "data": {
            "template_id": template_id,
            "name": (result.get("metadata") or {}).get("name") or template_id,
            "slides": slides,
        },
    }


@router.get("/templates/pptx-preview/image/{image_name}")
async def get_template_pptx_preview_image(
    image_name: str,
    template_id: str = Query(..., description="Template id from list_templates"),
    source: str = Query("shared", description="'shared' or 'mine'"),
    user_id: Optional[str] = Query(None, description="Required when source='mine'"),
) -> FileResponse:
    """Serve one generated slide image for a PPTX template preview."""
    result, template_path, docmaster_dir = _resolve_template_result(template_id, source, user_id)
    if template_path.suffix.lower() != ".pptx":
        raise HTTPException(status_code=400, detail="Template is not a .pptx file")
    preview_dir = _ensure_ppt_preview_images(template_path, docmaster_dir)
    image_path = (preview_dir / image_name).resolve()
    if image_path.parent != preview_dir.resolve() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Preview image not found")
    return FileResponse(
        str(image_path),
        media_type="image/png",
        filename=image_path.name,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


def _parse_json_list(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    raw = raw.strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x).strip() for x in parsed if str(x).strip()]
    except json.JSONDecodeError:
        pass
    return [seg.strip() for seg in raw.split(",") if seg.strip()]


@router.post("/templates")
async def save_template(
    user_id: str = Form(..., description="Owner email; required"),
    name: str = Form(..., description="Display name"),
    description: str = Form("", description="Optional description"),
    category: Optional[str] = Form(None, description="Optional category"),
    tags: Optional[str] = Form(None, description="JSON array or comma-separated"),
    aliases: Optional[str] = Form(None, description="JSON array or comma-separated"),
    template_id: Optional[str] = Form(None, description="Optional fixed id"),
    file: UploadFile = File(..., description="The .docx or .pptx file to register"),
) -> dict:
    """Upload a template into the calling user's template library."""
    logger.info("[templates] save_template request: user_id=%s name=%s file=%s", user_id, name, file.filename)
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        logger.error("[templates] save_template: docmaster_dir not found")
        raise HTTPException(
            status_code=404,
            detail="DocMaster workspace not found; set DOCMASTER_DIR env var to override.",
        )
    filename = file.filename or "template.docx"
    suffix = Path(filename).suffix.lower()
    if suffix not in _TEMPLATE_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail="模板必须是 .docx 或 .pptx 文件")

    tmp_fd, tmp_name = tempfile.mkstemp(prefix="docmaster_tpl_", suffix=suffix)
    os.close(tmp_fd)
    try:
        contents = await file.read()
        with open(tmp_name, "wb") as f:
            f.write(contents)
        workspace_dir = str(docmaster_dir / "workspace")
        logger.info("[templates] save_template: docmaster_dir=%s workspace_dir=%s", docmaster_dir, workspace_dir)
        skill = cls(workspace_dir=workspace_dir, user_id=user_id)
        logger.info("[templates] save_template: _user_storage=%s", type(skill._user_storage).__name__ if skill._user_storage is not None else "None (local FS)")
        result = skill.save(
            source_path=tmp_name,
            user_id=user_id,
            name=name,
            description=description,
            category=category,
            tags=_parse_json_list(tags),
            aliases=_parse_json_list(aliases),
            template_id=template_id,
        )
    finally:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass

    logger.info("[templates] save_template result: success=%s template_id=%s path=%s message=%s",
                result.get("success"), result.get("template_id"), result.get("template_path"), result.get("message"))
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "保存模板失败"))
    return {
        "status": True,
        "message": result.get("message", ""),
        "data": {
            "template_id": result.get("template_id"),
            "metadata": result.get("metadata"),
        },
    }


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    user_id: str = Query(..., description="Owner email; required"),
) -> dict:
    """Delete a template from the calling user's library (shared is read-only)."""
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        raise HTTPException(
            status_code=404,
            detail="DocMaster workspace not found; set DOCMASTER_DIR env var to override.",
        )
    workspace_dir = str(docmaster_dir / "workspace")
    skill = cls(workspace_dir=workspace_dir, user_id=user_id)
    result = skill.delete(template_id=template_id, user_id=user_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "删除模板失败"))
    return {
        "status": True,
        "message": result.get("message", ""),
        "data": {"removed_id": result.get("removed_id")},
    }


# ── Demo seeding ──────────────────────────────────────────────────────────────
# Server-side fixture files used by the right-panel 试用 buttons. The buttons
# stand in for "user uploads three documents and clicks submit" so a demo can
# show the agent end-to-end without the user having any files locally.

_DEMO_SOURCE_SUBDIR = "workspace/关联业务测试"

# Each demo kind copies the same source files but builds a different prompt
# downstream. Keeping the file lists keyed by kind (rather than reading the
# source dir blindly) means we can later vary the fixtures per task without
# changing the route shape.
_DEMO_KIND_FILES = {
    "guanlianyewu": [
        "1.5GHz超导腔非标制造 关联业务申报书.docx",
        "1.5GHz超导腔非标制造 关联业务承诺书.jpg",
        "HT-IHEP-JQ-03282024 合同.pdf",
    ],
    "zonghe": [
        "1.5GHz超导腔非标制造 关联业务申报书.docx",
        "1.5GHz超导腔非标制造 关联业务承诺书.jpg",
        "HT-IHEP-JQ-03282024 合同.pdf",
    ],
}


@router.post("/demo/seed", response_model=dict)
async def seed_demo_files(
    background: BackgroundTasks,
    kind: str = Query(..., description="'guanlianyewu' or 'zonghe' — selects which fixture set"),
    user_id: str = Query(..., description="Caller email; required for GFS upload"),
    db=Depends(get_db),
) -> dict:
    """Copy fixture files into the user's GFS upload area and return the
    {uploaded:[{name, remote_path}]} payload the frontend already knows how
    to consume (same shape as POST /cloud/upload).

    Used by the 试用 buttons next to 申请资料审查 / 综合材料撰写 — instead of
    asking the demo viewer to upload anything, we seed real files server-side
    and hand the frontend the same `serverPath`s a real upload would produce.
    The agent then reads those paths exactly as it would in a normal session.
    """
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    if kind not in _DEMO_KIND_FILES:
        raise HTTPException(status_code=400, detail=f"unknown demo kind: {kind!r}")

    docmaster_dir = _resolve_docmaster_dir()
    if docmaster_dir is None:
        raise HTTPException(status_code=404, detail="DocMaster workspace not found")
    source_dir = docmaster_dir / _DEMO_SOURCE_SUBDIR
    if not source_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"demo fixture dir missing: {source_dir}")

    # GFS direct upload — same pattern /cloud/upload uses (no mirror layer)
    from .gfs_utils import get_gfs_config, get_gfs_bucket_configs, gfs_put

    cfg = get_gfs_config(db, user_id)
    if not cfg:
        raise HTTPException(status_code=404, detail="未找到 GFS 配置")

    bucket_cfgs = get_gfs_bucket_configs(cfg)
    if not bucket_cfgs:
        raise HTTPException(status_code=404, detail="未找到 GFS bucket 配置")
    bucket_cfg = bucket_cfgs[0]  # use first bucket for demo uploads

    uploaded: list[dict] = []
    errors: list[dict] = []
    prefix = "uploads/"  # match the destination the real /cloud/upload uses

    # Copy fixtures to temp files and upload directly to GFS
    import tempfile as _tempfile_mod
    tmp_dir = Path(_tempfile_mod.mkdtemp(prefix="docmaster_demo_"))

    def _cleanup_tmp():
        shutil.rmtree(str(tmp_dir), ignore_errors=True)

    for filename in _DEMO_KIND_FILES[kind]:
        src = source_dir / filename
        if not src.is_file():
            errors.append({"name": filename, "error": "fixture file missing"})
            continue
        # Sanitize same way /cloud/upload does, so jcli round-trips reliably.
        from .cloud import _sanitize_gfs_filename  # local import to avoid cycle
        safe_name = _sanitize_gfs_filename(filename)
        remote_path = f"{prefix}{safe_name}"
        tmp_dest = tmp_dir / safe_name
        try:
            shutil.copyfile(str(src), str(tmp_dest))
            ok = gfs_put(str(tmp_dest), remote_path, bucket_cfg)
            if not ok:
                errors.append({"name": filename, "error": "上传到 GFS 失败"})
                continue
        except Exception as e:
            errors.append({"name": filename, "error": f"上传失败: {str(e)[:200]}"})
            continue
        uploaded.append({
            "name": safe_name,
            "remote_path": remote_path,
            "original_name": filename,
        })

    background.add_task(_cleanup_tmp)

    return {
        "status": True,
        "message": f"seeded {len(uploaded)} demo file(s)",
        "data": {"uploaded": uploaded, "errors": errors},
    }
