"""Sessions: the conversation, its history, and its live event stream.

Seven routes covering features 2.1, 2.2, 3.1 and 3.3. The three OAEP routes are
the interesting ones, and they exist as a set for one reason: a client must be
able to join a conversation at any moment and land on exactly the same state as
a client that watched it from the start.

    snapshot          "here is everything up to sequence N"
    events?after=N    "here is what you missed"
    events/stream     "here is what happens next"

``after_sequence`` is exclusive and the sequence space is dense, so a hole is
indistinguishable from loss -- which is why an expired cursor is a 409 and not
an empty list. See ``_errors.cursor_expired``.

Run status (feature 3.3) needs no route of its own: ``run.status`` rides the
event stream, so the renderer's 运行中/等待/完成/失败 badge is a fold over events
it is already consuming.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from typing_extensions import Annotated

from drsai.backend.runtime.journal import SessionCursorExpired

from .. import _errors, _oaep, _state
from .._models import SessionCreateRequest, SessionUpdateRequest
from .. import _stream_watchers

api = APIRouter(tags=["sessions"])


@api.post("/v1/sessions", status_code=201, operation_id="createSession")
async def session_create(request: SessionCreateRequest):
    """Start a new conversation in a Workspace (feature 2.1)."""
    with _errors.http_errors(not_found="Unknown or closed Workspace", invalid=422):
        if request.remote_worker_id:
            worker_id = request.remote_worker_id.strip()
            definition = _state.write_remote_worker_definition({
                "backend": "remote-worker",
                "instructions": "Proxy a remote HepAI/DDF worker agent through this Runtime.",
                "permissions": [],
                "remote_worker": {"name": worker_id},
            })
            return _state.runtime_engine().create_session(
                _state.ensure_remote_agents_workspace(),
                request.title,
                agent_definition=definition,
                backend_id="remote-worker",
                model=request.model,
                reasoning_effort=request.reasoning_effort,
                plan_mode=request.plan_mode,
                remote_worker_id=worker_id,
                remote_worker_name=(request.remote_worker_name or worker_id).strip(),
            )
        return _state.runtime_engine().create_session(
            request.workspace_id or "",
            request.title,
            agent_definition=_state.DEFAULT_AGENT_DEFINITION,
            backend_id="opendrsai",
            model=request.model,
            reasoning_effort=request.reasoning_effort,
            plan_mode=request.plan_mode,
        )


@api.get("/v1/sessions", operation_id="listSessions")
async def session_list(
    workspace_id: str | None = None,
    remote_worker_id: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    archived: bool | None = False,
):
    """History list for one Workspace (features 2.2 and 2.5)."""
    with _errors.http_errors(not_found="Unknown Workspace"):
        return _state.runtime_engine().list_sessions(
            workspace_id, remote_worker_id=remote_worker_id,
            offset=offset, limit=limit, archived=archived,
        )


@api.get("/v1/sessions/{session_id}", operation_id="getSession")
async def session_get(session_id: str):
    """One session's metadata: title, lifecycle, workspace, revision."""
    with _errors.http_errors(not_found="Unknown Session"):
        return _state.runtime_engine().get_session(session_id)


@api.patch("/v1/sessions/{session_id}", operation_id="updateSession")
async def session_update(session_id: str, request: SessionUpdateRequest):
    """Rename or archive a session (feature 2.2)."""
    with _errors.http_errors(not_found="Unknown Session"):
        return _state.runtime_engine().update_session(
            session_id,
            title=request.title,
            archived=request.archived,
            lifecycle=request.lifecycle,
            model=request.model,
            reasoning_effort=request.reasoning_effort,
            plan_mode=request.plan_mode,
        )


@api.get("/v1/sessions/{session_id}/oaep-snapshot", operation_id="getSessionSnapshot")
async def session_oaep_snapshot(
    session_id: str,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    """The full conversation projection, for opening a history entry (2.2)."""
    with _errors.http_errors(not_found="Unknown Session"):
        engine = _state.runtime_engine()
        snapshot = engine.oaep_snapshot(session_id, cursor=cursor, limit=limit)
        window = snapshot.get("window") or {}
        # Only an unpaginated first window is the full checkpoint Item set.
        # All other windows use a streamed full digest on cache miss; never a
        # page digest. The helper caches hashes/counts, not history bodies.
        checkpoint_items = (
            snapshot["items"] if cursor is None and window.get("has_more") is False else None
        )
        return _oaep.migrate_snapshot(
            snapshot, checkpoint_items=checkpoint_items, journal=engine.conversation_journal,
        )


@api.get("/v1/sessions/{session_id}/oaep-events", operation_id="listSessionEvents")
async def session_oaep_events(
    session_id: str,
    after_sequence: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
):
    """Replay durable events after an exclusive cursor (reconnect path, 3.1)."""
    with _errors.http_errors(not_found="Unknown Session"):
        events = _state.runtime_engine().list_oaep_events(
            session_id, after_sequence=after_sequence, limit=limit,
        )
        return {
            "version": "1.0",
            "object": "list",
            "data": [_oaep.migrate_event(event) for event in events],
            "next_sequence": int(events[-1]["sequence"]) if events else after_sequence,
            "has_more": len(events) == limit,
        }


@api.get("/v1/sessions/{session_id}/oaep-events/stream", operation_id="streamSessionEvents")
async def session_oaep_event_stream(
    session_id: str,
    raw_request: Request,
    after_sequence: int = Query(default=0, ge=0),
):
    """Live SSE token stream (feature 3.1).

    The cursor is validated with a one-event read *before* the response starts,
    so a bad session id or an expired cursor is a real HTTP error rather than a
    200 that closes immediately -- the latter is indistinguishable from an idle
    stream on the client.
    """
    with _errors.http_errors(not_found="Unknown Session"):
        _state.runtime_engine().list_oaep_events(session_id, after_sequence=after_sequence, limit=1)

    # Register this connection so the orphan-run reaper knows the session still
    # has a consumer (routes/runs.py). Registered before the first await in the
    # generator body so no event can slip past an unregistered stream.
    _stream_watchers.enter(session_id)

    async def stream():
        cursor = after_sequence
        try:
            while not await raw_request.is_disconnected():
                try:
                    # The journal wait is a blocking SQLite poll; off-loop keeps
                    # every other request served while this connection idles.
                    events = await asyncio.to_thread(
                        _state.runtime_engine().wait_oaep_events,
                        session_id,
                        after_sequence=cursor,
                        timeout=15.0,
                        limit=500,
                    )
                except SessionCursorExpired:
                    return
                if not events:
                    # Keeps proxies and the renderer's own idle timer from closing
                    # a healthy but quiet stream.
                    yield ": heartbeat\n\n"
                    continue
                for event in events:
                    cursor = int(event["sequence"])
                    payload = json.dumps(
                        _oaep.migrate_event(event), ensure_ascii=False, separators=(",", ":"),
                    )
                    yield f"id: {cursor}\nevent: oaep.event\ndata: {payload}\n\n"
        finally:
            _stream_watchers.leave(session_id)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def router() -> APIRouter:
    return api
