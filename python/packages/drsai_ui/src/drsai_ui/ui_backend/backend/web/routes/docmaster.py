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
import sys
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

router = APIRouter()


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
        return p if p.is_dir() else None
    return _find_docmaster_dir(Path(__file__).resolve().parent)


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
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        raise HTTPException(
            status_code=404,
            detail="DocMaster workspace not found; set DOCMASTER_DIR env var to override.",
        )

    workspace_dir = str(docmaster_dir / "workspace")
    skill = cls(workspace_dir=workspace_dir)
    result = skill.list(user_id=user_id, category=category, query=query)
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
    """Stream a template's `.docx` file so the frontend can preview it.

    Read-only — `TemplateLibrarySkill.get_path` looks up the entry's
    on-disk location (in `shared/` or the user's catalog) and returns the
    resolved `.docx` path; the file is then served back as a download with
    the correct OOXML mime type.
    """
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
    skill = cls(workspace_dir=workspace_dir)
    # `get_path` resolves by id OR alias; passing the id is unambiguous.
    result = skill.get_path(template_id, user_id=user_id if source == "mine" else None)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "Template not found"))
    template_path = result.get("template_path")
    if not template_path or not Path(template_path).is_file():
        raise HTTPException(status_code=404, detail="Template file missing on disk")

    meta = result.get("metadata") or {}
    filename = f"{meta.get('name') or template_id}.docx"
    return FileResponse(
        template_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=filename,
    )


def _parse_json_list(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    raw = raw.strip()
    if not raw:
        return []
    # Allow either a JSON array or a comma-separated string.
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
    file: UploadFile = File(..., description="The .docx file to register"),
) -> dict:
    """Upload a `.docx` into the calling user's template library."""
    cls, docmaster_dir = _load_template_library_skill()
    if cls is None or docmaster_dir is None:
        raise HTTPException(
            status_code=404,
            detail="DocMaster workspace not found; set DOCMASTER_DIR env var to override.",
        )
    filename = file.filename or "template.docx"
    if not filename.lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="模板必须是 .docx 文件")

    # Stream the upload to a temp file so the skill can copy from a real path.
    tmp_fd, tmp_name = tempfile.mkstemp(prefix="docmaster_tpl_", suffix=".docx")
    os.close(tmp_fd)
    try:
        contents = await file.read()
        with open(tmp_name, "wb") as f:
            f.write(contents)
        workspace_dir = str(docmaster_dir / "workspace")
        skill = cls(workspace_dir=workspace_dir)
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
    skill = cls(workspace_dir=workspace_dir)
    result = skill.delete(template_id=template_id, user_id=user_id)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("message", "删除模板失败"))
    return {
        "status": True,
        "message": result.get("message", ""),
        "data": {"removed_id": result.get("removed_id")},
    }
