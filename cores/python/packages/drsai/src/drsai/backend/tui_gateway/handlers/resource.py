"""Session-bound OWOP file resource RPCs for terminal hosts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from drsai.modules.managers.datamodel.db import Thread
from drsai.owop.protocol import OWOPError

from ..resources import read_tui_resource, register_tui_resource, resolve_tui_resource, tui_workspace_id
from ..server import _err, _get_db_manager, _ok, _resolve_user_id, method


def _workdir(session_id: str) -> Path:
    response = _get_db_manager().get(
        Thread,
        filters={"user_id": _resolve_user_id(), "thread_id": session_id},
        return_json=False,
    )
    if not response.status or not response.data:
        raise ValueError("session not found")
    meta = getattr(response.data[0], "meta", None) or {}
    workdir = meta.get("workdir") if isinstance(meta, dict) else None
    if not workdir:
        raise ValueError("session has no Workspace")
    return Path(workdir).resolve(strict=True)


def _context(params: dict[str, Any]) -> tuple[str, Path, str]:
    session_id = str(params.get("session_id") or "")
    if not session_id:
        raise ValueError("session_id is required")
    user_id = _resolve_user_id()
    root = _workdir(session_id)
    workspace_id = tui_workspace_id(user_id, root)
    requested_workspace = str(params.get("workspace_id") or "")
    if requested_workspace and requested_workspace != workspace_id:
        raise PermissionError("resource belongs to another Workspace")
    return user_id, root, workspace_id


def _error(rid: Any, exc: Exception) -> dict[str, Any]:
    if isinstance(exc, PermissionError):
        return _err(rid, 4031, "resource_forbidden")
    if isinstance(exc, OWOPError):
        if exc.code == "resource_not_found":
            return _err(rid, 4042, "resource_unavailable")
        return _err(rid, 4005, exc.code)
    if isinstance(exc, (OSError, ValueError, KeyError, TypeError)):
        return _err(rid, 4042, "resource_unavailable")
    raise exc


@method("files.register")
def files_register(rid: Any, params: dict[str, Any]) -> dict[str, Any]:
    try:
        user_id, root, workspace_id = _context(params)
        resource = register_tui_resource(
            user_id,
            root,
            str(params["path"]),
            expected_digest=str(params["expected_digest"]) if params.get("expected_digest") else None,
        )
        return _ok(rid, {"resource": resource})
    except Exception as exc:
        return _error(rid, exc)


@method("files.resolve")
def files_resolve(rid: Any, params: dict[str, Any]) -> dict[str, Any]:
    try:
        user_id, root, workspace_id = _context(params)
        resource = resolve_tui_resource(
            user_id,
            root,
            str(params["file_id"]),
            expected_digest=str(params["expected_digest"]) if params.get("expected_digest") else None,
        )
        return _ok(rid, {"resource": resource})
    except Exception as exc:
        return _error(rid, exc)


@method("files.read")
def files_read(rid: Any, params: dict[str, Any]) -> dict[str, Any]:
    try:
        user_id, root, workspace_id = _context(params)
        offset = int(params.get("offset", 0))
        length = int(params.get("length", 0))
        if offset < 0 or length < 1 or length > 8 * 1024 * 1024:
            return _err(rid, 4004, "resource_range_invalid")
        result = read_tui_resource(
            user_id,
            root,
            str(params["path"]),
            offset=offset,
            length=length,
        )
        return _ok(rid, result)
    except Exception as exc:
        return _error(rid, exc)
