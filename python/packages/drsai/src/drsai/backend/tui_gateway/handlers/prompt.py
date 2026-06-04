"""Prompt RPC handlers.

Methods registered:
    prompt.submit  — start one conversation turn; stream events asynchronously.
    prompt.cancel  — interrupt the running turn (alias for session.interrupt).

``prompt.submit`` returns immediately with ``{status: "streaming"}``. The
actual turn runs on a background thread and emits events
(``message.start``/``message.delta``/``tool.start``/``tool.complete``/
``message.complete``) over the lifetime of the turn. The client tracks
``message.complete`` to know when the turn is done — there is no long-running
RPC response to wait on.

This avoids the 120 s RPC timeout the client used to apply to ``prompt.submit``
when a turn ran long (multi-tool, sub-agents, big LLM call).
"""

from __future__ import annotations

import logging
import threading

from .. import server
from ..adapter import callbacks as _callbacks
from ..server import _emit, _err, _ok, _resolve_user_id, _sessions, method

logger = logging.getLogger(__name__)


def _run_turn_in_background(
    sess,
    session_id: str,
    text: str,
    state: dict,
    callback_token,
    *,
    images: list[dict] | None = None,
) -> None:
    """Run a single turn end-to-end on a background thread.

    Responsible for clearing ``running`` state and resetting callback context
    in all exit paths so the session can accept the next prompt.

    The ``running`` flag is cleared as soon as ``message.complete`` is emitted
    (i.e. the moment the user-visible turn finishes). Post-turn cleanup like
    state persistence in ``run_turn``'s ``finally`` block continues in the
    background but does NOT block the next prompt — otherwise users hitting
    Enter immediately after a reply finishes would race the save and get a
    spurious "session busy" error.
    """
    running_cleared = False

    def _clear_running_once() -> None:
        nonlocal running_cleared
        if running_cleared:
            return
        with state["history_lock"]:
            state["running"] = False
        # reset_session(token) crashes with "Token was created in a different
        # Context" when this runs in a background thread whose context was
        # copied from the pool worker (ContextVar tokens are tied to the
        # specific Context they were created in).  Use the ContextVar directly
        # instead — set(None) is cross-context safe.
        try:
            _callbacks.reset_session(callback_token)
        except ValueError:
            # Fallback: clear the ContextVar directly (cross-context safe)
            import contextvars as _cv
            _current_sid: _cv.ContextVar = getattr(_callbacks, '_current_session_id', None)
            if _current_sid is not None:
                try:
                    _current_sid.set(None)
                except Exception:
                    pass
        running_cleared = True

    try:
        def _on_event(event_type: str, payload: dict) -> None:
            _emit(event_type, session_id, payload)
            # Clear the busy flag the instant the turn is user-visibly done.
            # Subsequent post-turn work (state persistence, etc.) keeps running
            # in this thread but won't block the next prompt.
            if event_type == "message.complete" and not running_cleared:
                _clear_running_once()

        try:
            sess.run_turn(text, _on_event, images=images)
        except Exception as exc:
            logger.exception("run_turn raised")
            _emit("error", session_id, {"message": f"{type(exc).__name__}: {exc}"})
    finally:
        # Belt and suspenders: ensure running is cleared even if no
        # message.complete event was emitted (e.g. agent crashed early).
        _clear_running_once()


@method("prompt.submit")
def _submit(rid, params: dict) -> dict:
    session_id = params.get("session_id") or ""
    text = params.get("text") or ""
    images = params.get("images") or None  # list[{path, base64, mime_type}]

    if not session_id:
        return _err(rid, 4002, "session_id is required")
    if not isinstance(text, str) or not text.strip():
        return _err(rid, 4002, "text is required (non-empty string)")
    if images is not None:
        if not isinstance(images, list):
            return _err(rid, 4002, "images must be a list of {path, base64, mime_type} dicts")
        for img in images:
            if not isinstance(img, dict) or "base64" not in img or "mime_type" not in img:
                return _err(rid, 4002, "each image must contain base64 and mime_type")

    # Ensure agent is ready (also creates session state entry if missing).
    try:
        from .session import _ensure_agent_session
        user_id = _resolve_user_id()
        sess = _ensure_agent_session(session_id, user_id)
    except Exception as exc:
        logger.exception("agent init failed")
        return _err(rid, 5032, f"agent init failed: {type(exc).__name__}: {exc}")

    state = _sessions[session_id]
    with state["history_lock"]:
        if state.get("running"):
            return _err(rid, 4009, "session busy")
        state["running"] = True

    # Bind callbacks context *before* the worker starts so approval/clarify
    # prompts emitted from within the agent's coroutine resolve to this session.
    callback_token = _callbacks.bind_session(session_id)

    # Kick off the turn in a daemon thread; respond immediately so the client
    # doesn't have to keep an RPC future alive for the entire turn (which could
    # be minutes).
    worker = threading.Thread(
        target=_run_turn_in_background,
        args=(sess, session_id, text, state, callback_token),
        kwargs={"images": images},
        name=f"drsai-turn-{session_id[:8]}",
        daemon=True,
    )
    worker.start()

    return _ok(rid, {"status": "streaming"})


@method("prompt.cancel")
def _cancel(rid, params: dict) -> dict:
    session_id = params.get("session_id") or ""
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    state = _sessions.get(session_id)
    if not state:
        return _err(rid, 4001, "session not active")

    sess = state.get("agent_session")
    if sess is not None:
        try:
            sess.interrupt()
        except Exception:
            logger.exception("interrupt failed")

    server._clear_pending(sid=session_id)
    return _ok(rid, {"ok": True})
