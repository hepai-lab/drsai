"""Frozen Runtime routes for pre-OAEP Conversation clients."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from drsai.backend.runtime.journal import SessionCursorExpired


class RuntimeLegacyConversationHandlers:
    def __init__(self, *, sync_session: Callable[[str], Any], engine: Callable[[], Any]):
        self._sync_session = sync_session
        self._engine = engine

    def router(self) -> APIRouter:
        router = APIRouter()
        router.add_api_route("/v1/sessions/{session_id}/conversation", self.conversation, methods=["GET"])
        router.add_api_route(
            "/v1/sessions/{session_id}/conversation-snapshot", self.conversation_snapshot,
            methods=["GET"],
        )
        router.add_api_route("/v1/sessions/{session_id}/events", self.event_list, methods=["GET"])
        router.add_api_route(
            "/v1/sessions/{session_id}/events/stream", self.event_stream, methods=["GET"],
        )
        return router

    async def conversation(
        self, session_id: str, cursor: str | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
    ):
        try:
            projection = self._sync_session(session_id)
            if projection.has_thread(session_id):
                desktop_items = projection.conversation(session_id)
                runtime_items: list[dict[str, Any]] = []
                runtime_cursor = None
                while len(runtime_items) < 5_000:
                    runtime_page = self._engine().list_conversation(
                        session_id, cursor=runtime_cursor, limit=500,
                    )
                    runtime_items.extend(runtime_page["data"])
                    runtime_cursor = runtime_page.get("next_cursor")
                    if not runtime_cursor:
                        break
                combined = desktop_items + runtime_items
                for sequence, item in enumerate(combined, start=1):
                    item["sequence"] = sequence
                start = projection.decode_cursor(cursor)
                page = combined[start:start + limit]
                next_cursor = (
                    projection.encode_cursor(start + len(page))
                    if start + len(page) < len(combined) else None
                )
                return {"object": "list", "data": page, "next_cursor": next_cursor}
            return self._engine().list_conversation(session_id, cursor=cursor, limit=limit)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def conversation_snapshot(self, session_id: str):
        try:
            self._sync_session(session_id)
            return self._engine().conversation_snapshot(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def event_list(
        self, session_id: str,
        after_sequence: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=2000)] = 500,
    ):
        try:
            self._sync_session(session_id)
            events = self._engine().list_session_events(
                session_id, after_sequence=after_sequence, limit=limit,
            )
            return {
                "object": "list", "data": events,
                "next_sequence": int(events[-1]["session_sequence"]) if events else after_sequence,
            }
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except SessionCursorExpired as exc:
            raise session_cursor_expired(exc) from exc

    async def event_stream(
        self, session_id: str, raw_request: Request,
        after_sequence: Annotated[int, Query(ge=0)] = 0,
    ):
        try:
            self._sync_session(session_id)
            self._engine().list_session_events(
                session_id, after_sequence=after_sequence, limit=1,
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except SessionCursorExpired as exc:
            raise session_cursor_expired(exc) from exc

        async def stream():
            cursor = after_sequence
            while not await raw_request.is_disconnected():
                try:
                    events = await asyncio.to_thread(
                        self._engine().wait_session_events, session_id,
                        after_sequence=cursor, timeout=15.0, limit=500,
                    )
                except SessionCursorExpired:
                    return
                if not events:
                    yield ": heartbeat\n\n"
                    continue
                for event in events:
                    cursor = int(event["session_sequence"])
                    payload = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                    yield f"id: {cursor}\nevent: session.event\ndata: {payload}\n\n"

        return StreamingResponse(
            stream(), media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache", "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


def session_cursor_expired(exc: SessionCursorExpired) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "cursor_expired", "message": str(exc), "retryable": False,
            "details": exc.details,
        },
    )
