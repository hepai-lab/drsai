"""Threads (sessions) routes — list / search / get / pause / resume / stop / rename.

Extracted from the legacy monolith (``gateway_legacy.py`` L9765-9959) in
Phase 1. Uses the shared ``_get_store`` / ``_workspace_root`` /
``_session_info_to_dict`` / ``_normalize_message`` / ``manager`` accessors
(lazily imported from the ``gateway`` package, like ``gateway_wechat``) until
Phase 2 moves them into ``gateway._state``. No test patches these route
symbols.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

api = APIRouter(tags=["threads"])


@api.get("/v1/threads")
async def list_threads(
    user_id: str | None = Query(default=None),
    limit: int = Query(default=30, le=100),
    offset: int = Query(default=0, ge=0),
    workspace_id: str | None = Query(default=None),
):
    """List sessions for the given user, newest first."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    store = gateway._get_store(user_id)
    infos = store.list(limit=max(limit + offset, 100) if workspace_id else limit)
    if workspace_id:
        root = str(gateway._workspace_root(workspace_id))
        infos = [info for info in infos if getattr(info, "workdir", None) == root]
    # Paginate in Python (CLISessionStore.list doesn't support offset natively)
    result = infos[offset:offset + limit]
    return {
        "object": "list",
        "data": [gateway._session_info_to_dict(s) for s in result],
        "total": len(infos),
    }


@api.get("/v1/threads/search")
async def search_threads(
    query: str = Query(..., min_length=1),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=20, le=50),
):
    """Search sessions by query string."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    store = gateway._get_store(user_id)
    results = store.search(query, limit=limit)
    return {
        "object": "list",
        "data": [gateway._session_info_to_dict(s) for s in results],
    }


@api.get("/v1/threads/{thread_id}")
async def get_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
):
    """Get messages for a specific session.

    Returns messages normalized to a uniform {role, content, type} format
    so the desktop renderer does not need to understand autogen internals.
    """
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    store = gateway._get_store(user_id)
    msgs = store.load(thread_id)
    info = store.resolve(thread_id)
    normalized = [gateway._normalize_message(m) for m in msgs]
    return {
        "thread_id": thread_id,
        "name": info.name if info else "",
        "messages": normalized,
    }


# ── Agent control (pause / resume / stop) ──────────────────────────────────────


@api.post("/v1/threads/{thread_id}/pause")
async def pause_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
):
    """Pause the running agent for this session."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    success = await gateway.manager.pause_agent(thread_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found or not running")
    return {"status": "paused", "thread_id": thread_id}


@api.post("/v1/threads/{thread_id}/resume")
async def resume_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
):
    """Resume a paused agent for this session."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    success = await gateway.manager.resume_agent(thread_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found or not paused")
    return {"status": "active", "thread_id": thread_id}


@api.post("/v1/threads/{thread_id}/stop")
async def stop_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
):
    """Stop the agent and persist its final state."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    success = await gateway.manager.stop_agent(thread_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "stopped", "thread_id": thread_id}


@api.post("/v1/threads/{thread_id}/rename")
async def rename_thread(
    thread_id: str,
    user_id: str | None = Query(default=None),
    name: str = Query(..., min_length=1, description="New session name"),
):
    """Rename a session thread."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    store = gateway._get_store(user_id)
    success = store.rename(thread_id, name)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "ok", "thread_id": thread_id, "name": name}


def router() -> APIRouter:
    """Return the configured ``APIRouter`` for threads (session) routes."""
    return api
