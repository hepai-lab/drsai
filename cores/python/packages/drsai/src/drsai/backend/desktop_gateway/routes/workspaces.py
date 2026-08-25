"""Workspaces: the container a session belongs to (2.5) and its files (2.3, 4.1).

Four routes. ``POST /v1/workspaces`` is idempotent on path -- the registry
returns the existing record when the directory is already open -- so the
renderer can call it on every launch without accumulating duplicates.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from .. import _state, _workspace_files
from .._models import WorkspaceOpenRequest

api = APIRouter(tags=["workspaces"])


@api.get("/v1/workspaces", operation_id="listWorkspaces")
async def workspace_list(include_closed: bool = False):
    """Every Workspace this Runtime knows about (feature 2.5)."""
    return {
        "data": [
            record.as_dict()
            for record in _state.runtime_registry().list_workspaces(include_closed=include_closed)
        ]
    }


@api.post("/v1/workspaces", operation_id="openWorkspace")
async def workspace_open(request: WorkspaceOpenRequest):
    """Register a directory as a Workspace, or return the existing record."""
    try:
        record = _state.runtime_registry().open_workspace(
            request.path, display_name=request.display_name,
        )
    except (FileNotFoundError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _state.remember_workspace_root(record.workspace_id, Path(record.path))
    return record.as_dict()


@api.get("/v1/workspaces/{workspace_id}/files", operation_id="listWorkspaceFiles")
async def workspace_files(
    workspace_id: str,
    path: str = ".",
    depth: int = Query(default=2, ge=0, le=5),
    query: str = "",
    offset: int = Query(default=0, ge=0),
    max_entries: int = Query(default=500, ge=1, le=5000),
):
    """Bounded Workspace tree with git status badges (feature 2.3)."""
    return _workspace_files.list_files(
        workspace_id,
        path=path,
        depth=depth,
        query=query,
        offset=offset,
        max_entries=max_entries,
    )


@api.get("/v1/workspaces/{workspace_id}/file", operation_id="readWorkspaceFile")
async def workspace_file(
    workspace_id: str,
    path: str,
    max_bytes: int = Query(default=262_144, ge=1, le=1_048_576),
):
    """One file's content for the preview pane (feature 4.1)."""
    return _workspace_files.read_file(workspace_id, path, max_bytes=max_bytes)


def router() -> APIRouter:
    return api
