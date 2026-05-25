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
import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

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
