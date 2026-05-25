"""Session lifecycle RPC handlers.

Methods registered:
    session.create        — new thread with optional name + workdir
    session.list          — paginated list of recent threads
    session.resume        — switch UI focus to existing thread; loads agent
    session.delete        — remove from DB
    session.rename        — change Thread.meta['name']
    session.search        — fuzzy search by name + content preview
    session.history       — return stored messages for a thread
    session.interrupt     — pause + resume the running agent (cancels turn)
    session.most_recent   — most recently used session in cwd
    session.info          — push session.info event for active session
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

from drsai.configs.constant import FS_DIR

from .. import server
from ..server import (
    _emit,
    _err,
    _get_db_manager,
    _ok,
    _resolve_user_id,
    _sessions,
    method,
)

logger = logging.getLogger(__name__)


def _get_store(user_id: str):
    """Return a fresh CLISessionStore for *user_id*."""
    from drsai.backend.cli.history import CLISessionStore

    return CLISessionStore(_get_db_manager(), user_id)


def _info_to_dict(info) -> dict:
    return {
        "session_id": info.thread_id,
        "name": info.name,
        "updated_at": info.updated_at,
        "message_count": info.message_count,
        "preview": info.preview,
        "workdir": info.workdir,
    }


def _ensure_agent_session(session_id: str, user_id: str) -> Any:
    """Return (creating if needed) the AgentSession for *session_id*."""
    from ..adapter.agent_runner import AgentSession
    from drsai.backend.cli import config as cli_config

    existing = _sessions.get(session_id)
    if existing and existing.get("agent_session"):
        return existing["agent_session"]

    cfg = cli_config.load_config()
    sess = AgentSession(
        session_id=session_id,
        user_id=user_id,
        cli_cfg=cfg,
        db_manager=_get_db_manager(),
    )
    sess.init()

    _sessions[session_id] = {
        "agent_session": sess,
        "user_id": user_id,
        "history_lock": __import__("threading").Lock(),
        "running": False,
    }

    # Emit session.info so the UI can show model/tools/workdir.
    try:
        _emit("session.info", session_id, sess.info())
    except Exception:
        logger.exception("session.info emit failed")

    return sess


# ── RPC methods ──────────────────────────────────────────────────────


@method("session.create")
def _create(rid, params: dict) -> dict:
    """Create a new session bound to a workdir (defaults to cwd).

    When no name is provided, defaults to the workdir's basename so users
    can recognise sessions at a glance.
    """
    user_id = _resolve_user_id()
    name = (params.get("name") or "").strip() or None
    workdir = params.get("workdir") or str(Path.cwd().resolve())

    if not name:
        # Default to the workdir's basename (e.g. /home/user/drsai → "drsai")
        try:
            base = Path(workdir).name
            name = base or "session"
        except Exception:
            name = "session"

    store = _get_store(user_id)
    session_id = store.create(name=name, workdir=workdir)

    # Persist workdir mapping in cli_config (mirrors run_cli.py behaviour).
    try:
        from drsai.backend.cli import config as cli_config
        cli_config.set_workdir_session(workdir, session_id)
    except Exception:
        logger.exception("set_workdir_session failed")

    # Resolve full info (immediately consistent)
    info = store.resolve(session_id)
    info_dict = _info_to_dict(info) if info else {
        "session_id": session_id,
        "name": name or "session",
        "updated_at": "",
        "message_count": 0,
        "preview": "",
        "workdir": workdir,
    }

    return _ok(rid, {"session_id": session_id, "session": info_dict, "user_id": user_id})


@method("session.list")
def _list(rid, params: dict) -> dict:
    """Return up to *limit* recent sessions for the resolved user."""
    limit = int(params.get("limit") or 50)
    user_id = _resolve_user_id()
    try:
        store = _get_store(user_id)
        infos = store.list(limit=limit)
        return _ok(rid, {
            "sessions": [_info_to_dict(i) for i in infos],
            "user_id": user_id,
        })
    except Exception as exc:
        logger.exception("session.list failed")
        return _err(rid, 5001, f"session.list: {type(exc).__name__}: {exc}")


@method("session.resume")
def _resume(rid, params: dict) -> dict:
    """Resolve a session by id-or-prefix and prepare its agent.

    LONG handler — does ``agent.lazy_init`` + ``load_state``.
    """
    needle = (params.get("session_id_or_prefix") or params.get("session_id") or "").strip()
    if not needle:
        return _err(rid, 4002, "session_id_or_prefix is required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    info = store.resolve(needle)
    if info is None:
        return _err(rid, 4001, f"session not found: {needle}")

    try:
        sess = _ensure_agent_session(info.thread_id, user_id)
    except Exception as exc:
        logger.exception("ensure_agent_session failed")
        return _err(rid, 5032, f"agent init failed: {type(exc).__name__}: {exc}")

    history = store.load(info.thread_id)
    return _ok(rid, {
        "session": _info_to_dict(info),
        "history": history,
        "info": sess.info(),
        "user_id": user_id,
    })


@method("session.delete")
def _delete(rid, params: dict) -> dict:
    session_id = params.get("session_id") or ""
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    info = store.resolve(session_id)
    if info is None:
        return _err(rid, 4001, "session not found")

    # Close any live agent first.
    existing = _sessions.pop(session_id, None)
    if existing and (sess := existing.get("agent_session")):
        try:
            sess.close(save=False)
        except Exception:
            logger.exception("close agent_session failed")

    # CLISessionStore exposes no delete; fall back to DB.
    try:
        from drsai.modules.managers.datamodel.db import Thread
        db = _get_db_manager()
        resp = db.delete(Thread, filters={"user_id": user_id, "thread_id": info.thread_id})
        if not getattr(resp, "status", False):
            return _err(rid, 5002, f"delete failed: {getattr(resp, 'message', '?')}")
    except Exception as exc:
        logger.exception("session.delete failed")
        return _err(rid, 5002, f"delete failed: {type(exc).__name__}: {exc}")

    return _ok(rid, {"ok": True})


@method("session.rename")
def _rename(rid, params: dict) -> dict:
    session_id = params.get("session_id") or ""
    name = (params.get("name") or "").strip()
    if not session_id or not name:
        return _err(rid, 4002, "session_id and name are required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    ok = store.rename(session_id, name)
    if not ok:
        return _err(rid, 4001, "session not found")
    return _ok(rid, {"ok": True, "name": name})


@method("session.search")
def _search(rid, params: dict) -> dict:
    query = (params.get("query") or "").strip()
    limit = int(params.get("limit") or 20)
    if not query:
        return _ok(rid, {"sessions": []})

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    hits = store.search(query, limit=limit)
    return _ok(rid, {"sessions": [_info_to_dict(h) for h in hits]})


@method("session.history")
def _history(rid, params: dict) -> dict:
    session_id = params.get("session_id") or ""
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    messages = store.load(session_id)
    limit = params.get("limit")
    if isinstance(limit, int) and limit > 0:
        messages = messages[-limit:]
    return _ok(rid, {"messages": messages, "count": len(messages)})


@method("session.interrupt")
def _interrupt(rid, params: dict) -> dict:
    session_id = params.get("session_id") or ""
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    state = _sessions.get(session_id)
    if not state:
        return _err(rid, 4001, "session not found (or not active)")

    sess = state.get("agent_session")
    if sess is not None:
        try:
            sess.interrupt()
        except Exception:
            logger.exception("interrupt failed")

    # Release any pending approval/clarify prompts on this session.
    server._clear_pending(sid=session_id)
    return _ok(rid, {"ok": True})


@method("session.most_recent")
def _most_recent(rid, params: dict) -> dict:
    """Resolve the session associated with the current workdir, if any.

    Resolution:
    1. Check cli_config workdir→session mapping (kept in sync by /new, switch, etc.)
    2. If absent, look for any session whose meta.workdir matches cwd
       (this picks up sessions created via the gateway that registered workdir
       directly in Thread.meta).
    3. Of multiple matches, pick the most recently updated.
    """
    user_id = _resolve_user_id()
    workdir = params.get("workdir") or str(Path.cwd().resolve())

    session_id = None
    try:
        from drsai.backend.cli import config as cli_config
        workdir_sessions = cli_config.get_workdir_sessions()
        session_id = workdir_sessions.get(workdir)
    except Exception:
        pass

    store = _get_store(user_id)

    # Verify cached session_id still exists
    if session_id:
        info = store.resolve(session_id)
        if info is not None:
            return _ok(rid, {"session": _info_to_dict(info), "user_id": user_id})

    # Fall back: search Thread.meta.workdir across all sessions, pick newest
    try:
        all_sessions = store.list(limit=500)
        matches = [s for s in all_sessions if s.workdir == workdir]
        if matches:
            # store.list returns sorted by updated_at desc → take first
            picked = matches[0]
            # Cache the mapping so next launch is instant
            try:
                from drsai.backend.cli import config as cli_config
                cli_config.set_workdir_session(workdir, picked.thread_id)
            except Exception:
                pass
            return _ok(rid, {"session": _info_to_dict(picked), "user_id": user_id})
    except Exception:
        logger.exception("session.most_recent fallback search failed")

    return _ok(rid, {"session": None, "user_id": user_id})


@method("session.info")
def _info(rid, params: dict) -> dict:
    """Return current agent metadata for an active session."""
    session_id = params.get("session_id") or ""
    state = _sessions.get(session_id)
    if not state:
        return _err(rid, 4001, "session not active")
    sess = state.get("agent_session")
    if sess is None:
        return _err(rid, 4001, "agent not initialised")
    return _ok(rid, sess.info())
