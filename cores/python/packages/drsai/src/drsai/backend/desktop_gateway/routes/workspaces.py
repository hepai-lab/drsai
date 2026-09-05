"""Workspaces: the container a session belongs to (2.5) and its files (2.3, 4.1).

Five routes. ``POST /v1/workspaces`` is idempotent on path -- the registry
returns the existing record when the directory is already open -- so the
renderer can call it on every launch without accumulating duplicates.
``DELETE /v1/workspaces/{id}`` is likewise idempotent: closing a workspace
that is already absent returns 200 instead of 404.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.requests import Request

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


@api.delete("/v1/workspaces/{workspace_id}", operation_id="closeWorkspace")
async def workspace_close(workspace_id: str):
    """Close (archive) a Workspace on the Runtime side (feature 2.5).

    If the Workspace is not registered the endpoint still returns 200 with a
    minimal body so the renderer can delete its local record without a 404
    round-trip — this mirrors the idempotent semantics of POST /v1/workspaces.
    """
    record = _state.runtime_registry().close_workspace(workspace_id)
    if record is not None:
        return record.as_dict()
    # Idempotent: workspace already absent on the gateway side.
    return {"workspace_id": workspace_id, "lifecycle": "archived", "path": None}


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
    # list_files() calls _git_statuses() which runs `git status` via
    # subprocess.run (up to 10s timeout) — offload to thread pool so the
    # event loop is not blocked during the git subprocess execution.
    return await asyncio.to_thread(
        _workspace_files.list_files,
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
    # read_file() does synchronous file I/O (open + read + sha256) — offload
    # to thread pool for consistency with the list_files handler above.
    return await asyncio.to_thread(
        _workspace_files.read_file, workspace_id, path, max_bytes=max_bytes
    )


@api.get(
    "/v1/workspaces/{workspace_id}/session-catalog-events/stream",
    operation_id="streamWorkspaceSessionCatalog",
)
async def stream_workspace_session_catalog(
    workspace_id: str,
    request: Request,
):
    """SSE stream of session catalog changes for a workspace.

    Migrated from ``gateway_legacy.py`` L5257.  Drives trusted local clients
    from the same committed Session Journal as Relay: every time a session is
    created, updated, or archived within this workspace, a
    ``session.catalog.changed`` event is emitted.
    """
    if _state.runtime_registry().get_workspace(workspace_id, include_closed=True) is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    journal = _state.runtime_engine().conversation_journal
    cursor = journal.workspace_catalog_watermark(workspace_id)

    async def stream():
        nonlocal cursor
        yield ": connected\n\n"
        while not await request.is_disconnected():
            events = await asyncio.to_thread(
                journal.wait_for_workspace_catalog_events,
                workspace_id,
                after_cursor=cursor,
                timeout=15.0,
                limit=500,
            )
            if not events:
                yield ": heartbeat\n\n"
                continue
            for event in events:
                cursor = int(event["cursor"])
                public = {key: value for key, value in event.items() if key != "cursor"}
                payload = json.dumps(public, ensure_ascii=False, separators=(",", ":"))
                yield f"id: {public['event_id']}\nevent: session.catalog.changed\ndata: {payload}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def router() -> APIRouter:
    return api
