"""Frozen legacy Conversation/Session Event HTTP surface.

OAEP code must never import this module. It exists only for old clients during
the measured compatibility-retirement window.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse


def create_relay_legacy_conversation_router(
    *,
    oidc_subject: Callable[..., str],
    authorize_workspace: Callable[[str, str, str], None],
    runtime_call: Callable[..., Awaitable[Any]],
    protocol_observer: Callable[[str, str, str], None] | None = None,
) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation")
    async def conversation(
        runtime_id: str, workspace_id: str, session_id: str,
        x_subject: str = Depends(oidc_subject), cursor: str | None = None,
        limit: int = Query(100, ge=1, le=500),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if protocol_observer is not None:
            protocol_observer(runtime_id, "legacy", "oaep_unavailable")
        rows, next_cursor = await runtime_call(
            runtime_id, "conversation_for_subject", x_subject, workspace_id, session_id,
            cursor=cursor, limit=limit,
        )
        return {"items": rows, "next_cursor": next_cursor}

    @router.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/conversation-snapshot")
    async def conversation_snapshot(
        runtime_id: str, workspace_id: str, session_id: str,
        x_subject: str = Depends(oidc_subject),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if protocol_observer is not None:
            protocol_observer(runtime_id, "legacy", "oaep_unavailable")
        return await runtime_call(
            runtime_id, "conversation_snapshot_for_subject", x_subject, workspace_id, session_id,
        )

    @router.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events")
    async def session_events(
        runtime_id: str, workspace_id: str, session_id: str,
        x_subject: str = Depends(oidc_subject), after_sequence: int = Query(0, ge=0),
        limit: int = Query(500, ge=1, le=500),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if protocol_observer is not None:
            protocol_observer(runtime_id, "legacy", "oaep_unavailable")
        return await runtime_call(
            runtime_id, "session_events_for_subject", x_subject, workspace_id, session_id,
            after_sequence=after_sequence, limit=limit,
        )

    @router.get("/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/events/stream")
    async def session_event_stream(
        runtime_id: str, workspace_id: str, session_id: str,
        x_subject: str = Depends(oidc_subject), after_sequence: int = Query(0, ge=0),
    ):
        authorize_workspace(x_subject, runtime_id, workspace_id)
        if protocol_observer is not None:
            protocol_observer(runtime_id, "legacy", "oaep_unavailable")
        page = await runtime_call(
            runtime_id, "session_events_for_subject", x_subject, workspace_id, session_id,
            after_sequence=after_sequence, limit=500,
        )

        def encoded_session_events():
            for item in page.get("items", []):
                data = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
                yield (
                    f"id: {item['session_sequence']}\nevent: {item['kind']}\n"
                    f"data: {data}\n\n"
                ).encode()
            yield b": keep-alive\n\n"

        return StreamingResponse(
            encoded_session_events(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return router
