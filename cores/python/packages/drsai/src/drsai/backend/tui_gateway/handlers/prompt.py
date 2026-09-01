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
from ..server import _emit, _err, _get_db_manager, _ok, _resolve_user_id, _sessions, method

logger = logging.getLogger(__name__)


def _load_platform_auth_context():
    """Load the OIDC platform auth context from the stored session.

    Returns a :class:`PlatformAuthContext` if the user authenticated via
    OIDC and the token is still valid, or ``None`` if:
      - No OIDC session exists (user is using API key mode)
      - The token is expired and cannot be refreshed
      - An error occurs during loading

    This is called from the daemon thread in ``_run_turn_in_background``
    because ContextVars do NOT propagate across ``threading.Thread``
    boundaries — the binding must happen inside the worker thread.
    """
    try:
        from drsai.backend.auth.token_store import load_auth_session, is_token_expired
        from drsai.backend.cli import config as cli_config

        cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else {}
        if cfg.get("auth_mode") != "oidc":
            return None

        session = load_auth_session()
        if not session:
            return None

        # If token is expired, try to refresh it
        if is_token_expired(session):
            refresh_token = session.get("refresh_token")
            if not refresh_token:
                logger.warning("OIDC token expired, no refresh_token — re-login required")
                return None
            try:
                from drsai.backend.auth.oidc_client import OidcClient
                import os
                client = OidcClient(
                    issuer=session.get("issuer", os.environ.get(
                        "OPENDRSAI_OIDC_ISSUER",
                        os.environ.get("HAI_OIDC_ISSUER", "https://ai-dev.ihep.ac.cn/api"),
                    )),
                    client_id=session.get("client_id", os.environ.get(
                        "OPENDRSAI_OIDC_CLIENT_ID", "opendrsai-tui",
                    )),
                    scopes=os.environ.get(
                        "OPENDRSAI_OIDC_SCOPES",
                        "openid email profile roles groups hai_api offline_access",
                    ),
                )
                tokens = client.refresh_access_token(refresh_token)
                # Re-save the refreshed session
                from drsai.backend.auth.token_store import save_auth_session
                user_info = session.get("user", {})
                if tokens.get("id_token"):
                    try:
                        user_info = client.validate_id_token(tokens["id_token"])
                    except Exception:
                        pass
                session = save_auth_session(
                    tokens=tokens,
                    user_info=user_info,
                    issuer=session.get("issuer", ""),
                    client_id=session.get("client_id", ""),
                )
            except Exception as exc:
                logger.warning("OIDC token refresh failed: %s", exc)
                return None

        access_token = session.get("access_token")
        if not access_token:
            return None

        # Build PlatformAuthContext from the JWT claims
        from drsai.platform_auth import context_from_bearer
        try:
            return context_from_bearer(f"Bearer {access_token}", expected_subject="")
        except Exception as exc:
            logger.warning("Failed to build PlatformAuthContext from stored token: %s", exc)
            return None

    except ImportError:
        # auth module not available (e.g. development without OIDC)
        return None
    except Exception:
        logger.exception("Unexpected error loading platform auth context")
        return None


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
    # ── Bind session context INSIDE the daemon thread ────────────────
    #
    # The caller (handle_prompt_submit) already called
    # _callbacks.bind_session(session_id), but ContextVars do NOT
    # propagate across raw ``threading.Thread`` boundaries — only via
    # ``contextvars.copy_context().run(...)``. Without re-binding here,
    # any approval_callback invoked from a tool would see ``_resolve_sid``
    # return "" and silently auto-deny.
    #
    # We also register the per-thread fallback map so synchronous code
    # paths that don't go through ``asyncio.to_thread`` (which DOES
    # copy_context) can still resolve the sid.
    _callbacks.bind_session(session_id)
    _callbacks.bind_thread_session(session_id)

    # ── Bind OIDC platform auth context INSIDE the daemon thread ─────
    #
    # When the user authenticated via OIDC (auth_mode == "oidc"), the
    # access_token is stored encrypted in ~/.drsai/auth/auth.json.
    # We load it here and bind it to the _platform_auth ContextVar so
    # that LLMClient._bind_platform_auth() can pick it up when
    # constructing API calls.  ContextVars do NOT propagate across
    # raw threading.Thread boundaries, so this MUST be done inside the
    # daemon thread, not in the caller.
    _platform_auth_ctx = _load_platform_auth_context()

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

        # Run the turn with platform_auth_scope bound so the LLM client
        # can access the OIDC token. If no OIDC session exists, this is
        # a no-op (context is None → platform_auth_scope not entered).
        if _platform_auth_ctx is not None:
            from drsai.platform_auth import platform_auth_scope
            with platform_auth_scope(_platform_auth_ctx):
                sess.run_turn(text, _on_event, images=images)
        else:
            sess.run_turn(text, _on_event, images=images)
    except Exception as exc:
        logger.exception("run_turn raised")
        _emit("error", session_id, {"message": f"{type(exc).__name__}: {exc}"})
    finally:
        # Belt and suspenders: ensure running is cleared even if no
        # message.complete event was emitted (e.g. agent crashed early).
        _clear_running_once()
        # Drop the per-thread session binding we registered up top so the
        # daemon thread doesn't leak it into a future turn (daemon threads
        # are short-lived but the thread-id can be reused by Python).
        _callbacks.unbind_thread_session()


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

    # Touch the Thread's updated_at immediately so the current session
    # appears as "most recent" when the user runs /list mid-stream.
    # Without this, updated_at is stale until save_state runs after the
    # turn completes, so /list might not show the current session at top.
    try:
        from datetime import datetime
        from drsai.modules.managers.datamodel.db import Thread
        db = _get_db_manager()
        resp = db.get(Thread, filters={"thread_id": session_id}, return_json=False)
        if resp.status and resp.data:
            thread = resp.data[0]
            thread.updated_at = datetime.now()
            db.upsert(thread)
    except Exception:
        logger.debug("touch updated_at failed (non-critical)", exc_info=True)

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
