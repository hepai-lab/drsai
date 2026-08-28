"""Session lifecycle RPC handlers.

Methods registered:
    session.create        — new thread with optional name + workdir
    session.list          — paginated list of recent threads
    session.resume        — switch UI focus to existing thread; loads agent
    session.delete        — remove from DB
    session.rename        — change Thread.meta['name']
    session.search        — fuzzy search by name + content preview
    session.smart_search   — semantic + keyword hybrid search across sessions
    session.workspace_map  — workdir → sessions mapping with recommendations
    session.quick_access   — priority-sorted session list (workdir > pinned > recent)
    session.tag_add        — add tag(s) to current session
    session.tag_remove     — remove tag(s) from current session
    session.pin            — pin current session
    session.unpin          — unpin current session
    session.archive        — archive a session (hide from default list)
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
from ..transport import current_transport

logger = logging.getLogger(__name__)


def _resolve_workdir() -> str:
    """Resolve the effective workdir for session operations.

    Prefer DRSAI_USER_CWD (set by run_cli.py and ssh_tunnel.py) so that
    the gateway treats the user's project directory as the workdir even
    when the process cwd is different (e.g. the TUI launches the gateway
    with cwd=apps/ui-tui/ locally, or the SSH tunnel starts the gateway
    in the home directory when remote_workdir is not set).
    """
    user_cwd = os.environ.get("DRSAI_USER_CWD", "").strip()
    if user_cwd:
        return str(Path(user_cwd).resolve())
    return str(Path.cwd().resolve())


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
        "tags": getattr(info, 'tags', []),
        "pinned": getattr(info, 'pinned', False),
        "archived": getattr(info, 'archived', False),
        "relevance_score": getattr(info, 'relevance_score', 0.0),
        "match_snippet": getattr(info, 'match_snippet', ""),
    }


def _ensure_agent_session(session_id: str, user_id: str) -> Any:
    """Return (creating if needed) the AgentSession for *session_id*."""
    from ..adapter.agent_runner import AgentSession
    from drsai.backend.cli import config as cli_config

    existing = _sessions.get(session_id)
    if existing and existing.get("agent_session"):
        # Update transport if a new one is bound (e.g. WebSocket reconnect
        # or a different client resumed the same session). This ensures
        # daemon threads spawned by prompt.submit route events to the
        # currently-connected transport, not a stale one.
        cur_t = current_transport()
        if cur_t is not None:
            existing["transport"] = cur_t
        return existing["agent_session"]

    cfg = cli_config.load_config()

    # Daemon model override — if running inside a daemon process that has a
    # specific model configured (via --model at startup or /api/model at
    # runtime), override the config file's default model.
    daemon_model = os.environ.get("DRSAI_DAEMON_MODEL", "")
    if daemon_model:
        cfg["defult_config_name"] = daemon_model

    sess = AgentSession(
        session_id=session_id,
        user_id=user_id,
        cli_cfg=cfg,
        db_manager=_get_db_manager(),
    )
    sess.init()

    # Preserve any transport that was already bound (e.g. via session.subscribe
    # from a WebSocket client) so events are routed to the correct peer.
    # Also capture the transport from the current contextvar (set by dispatch
    # for the lifetime of a request) so that daemon threads spawned by
    # prompt.submit — which do NOT inherit contextvar bindings — can still
    # route events to the WebSocket client via write_json()'s first precedence
    # check: _sessions[sid]["transport"].
    old_transport = existing.get("transport") if existing else None
    cur_transport = current_transport()
    bound_transport = old_transport or cur_transport
    _sessions[session_id] = {
        "agent_session": sess,
        "user_id": user_id,
        "history_lock": __import__("threading").Lock(),
        "running": False,
    }
    if bound_transport is not None:
        _sessions[session_id]["transport"] = bound_transport

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
    workdir = params.get("workdir") or _resolve_workdir()

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
    """Return up to *limit* recent sessions for the resolved user.

    Archived sessions are excluded by default; pass ``include_archived=true``
    to include them.
    """
    limit = int(params.get("limit") or 50)
    include_archived = bool(params.get("include_archived", False))
    user_id = _resolve_user_id()
    try:
        store = _get_store(user_id)
        infos = store.list(limit=limit * 2 if not include_archived else limit)
        if not include_archived:
            infos = [i for i in infos if not getattr(i, 'archived', False)]
        infos = infos[:limit]
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

    # Extract memory summary for the TUI startup banner.
    # Shows file path + entry count — compact, avoids flooding the terminal
    # with full MEMORY.md content on every startup.
    memory_preview = ""
    try:
        agent = getattr(sess, "agent", None)
        if agent and hasattr(agent, "_curated_memory") and agent._curated_memory:
            memory_preview = agent._curated_memory.get_display_summary()
    except Exception:
        pass  # Memory preview is best-effort.

    return _ok(rid, {
        "session": _info_to_dict(info),
        "history": history,
        "info": sess.info(),
        "user_id": user_id,
        "memory_preview": memory_preview,
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

    # Clean up workdir_sessions cache for the deleted session
    try:
        from drsai.backend.cli import config as cli_config
        workdir_sessions = cli_config.get_workdir_sessions()
        deleted_workdir = info.workdir
        if deleted_workdir and workdir_sessions.get(deleted_workdir) == info.thread_id:
            cli_config.remove_workdir_session(deleted_workdir)
            # Try to cache the next most recent session for this workdir
            try:
                remaining = [s for s in store.list(limit=500) if s.workdir == deleted_workdir and s.thread_id != info.thread_id]
                if remaining:
                    cli_config.set_workdir_session(deleted_workdir, remaining[0].thread_id)
            except Exception:
                pass
    except Exception:
        logger.exception("workdir cache cleanup failed")

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


@method("session.smart_search")
def _smart_search(rid, params: dict) -> dict:
    """Semantic + keyword hybrid search across sessions.

    Strategy:
    1. Keyword pre-filter: name + preview + workdir substring (fast)
    2. FTS5 deep search: search message content via session_messages_fts (medium)
    3. Composite scoring: BM25 score + time decay + workdir relevance

    Args:
        query: natural language query string
        limit: max results (default 10)
        workdir: optional, restrict to this workdir
    """
    query = (params.get("query") or "").strip()
    limit = int(params.get("limit") or 10)
    filter_workdir = params.get("workdir") or None
    if not query:
        return _ok(rid, {"sessions": [], "total": 0, "query": query})

    user_id = _resolve_user_id()
    store = _get_store(user_id)

    try:
        hits = store.smart_search(query, limit=limit, workdir=filter_workdir)
        return _ok(rid, {
            "sessions": [_info_to_dict(h) for h in hits],
            "total": len(hits),
            "query": query,
        })
    except Exception as exc:
        logger.exception("session.smart_search failed")
        return _err(rid, 5003, f"smart_search: {type(exc).__name__}: {exc}")


@method("session.workspace_map")
def _workspace_map(rid, params: dict) -> dict:
    """Get the session mapping for a workdir, with recommendations.

    Returns:
        current_workdir: the resolved workdir
        sessions: all sessions for this workdir (sorted by updated_at desc)
        recommended: the recommended session (based on recency + activity)
        nearby_workdirs: sessions in parent/child directories
    """
    user_id = _resolve_user_id()
    workdir = params.get("workdir") or _resolve_workdir()

    store = _get_store(user_id)

    try:
        # Current directory sessions
        all_sessions = store.list(limit=500)
        current_sessions = [s for s in all_sessions if s.workdir == workdir and not getattr(s, 'archived', False)]
        current_sessions.sort(key=lambda s: s.updated_at if isinstance(s.updated_at, str) else str(s.updated_at), reverse=True)

        # Recommend the best session (recency + activity score)
        recommended = None
        if current_sessions:
            from datetime import datetime
            best_score = -1
            for s in current_sessions:
                try:
                    ts = s.updated_at
                    if isinstance(ts, str):
                        ts_val = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                    else:
                        ts_val = ts.timestamp() if hasattr(ts, 'timestamp') else 0
                    recency_hours = max(0.001, (datetime.now().timestamp() - ts_val) / 3600)
                    recency_score = 1.0 / (1 + recency_hours / 24)
                    activity_score = min(1.0, s.message_count / 50)
                    score = recency_score * 0.7 + activity_score * 0.3
                    if getattr(s, 'pinned', False):
                        score += 1.0  # pinned boost
                    if score > best_score:
                        best_score = score
                        recommended = s
                except Exception:
                    continue

        # Nearby directories (parent/child)
        nearby_workdirs: dict[str, list] = {}
        workdir_path = Path(workdir)
        for s in all_sessions:
            if not s.workdir or s.workdir == workdir:
                continue
            try:
                s_path = Path(s.workdir)
                is_nearby = False
                try:
                    s_path.relative_to(workdir_path)
                    is_nearby = True
                except ValueError:
                    pass
                try:
                    workdir_path.relative_to(s_path)
                    is_nearby = True
                except ValueError:
                    pass
                if is_nearby:
                    nearby_workdirs.setdefault(s.workdir, []).append(_info_to_dict(s))
            except Exception:
                continue

        return _ok(rid, {
            "current_workdir": workdir,
            "sessions": [_info_to_dict(s) for s in current_sessions],
            "recommended": _info_to_dict(recommended) if recommended else None,
            "nearby_workdirs": nearby_workdirs,
        })
    except Exception as exc:
        logger.exception("session.workspace_map failed")
        return _err(rid, 5004, f"workspace_map: {type(exc).__name__}: {exc}")


@method("session.quick_access")
def _quick_access(rid, params: dict) -> dict:
    """Priority-sorted session list for quick switching.

    Priority: current workdir sessions → pinned → recent.
    Excludes archived sessions by default.
    """
    user_id = _resolve_user_id()
    workdir = params.get("workdir") or _resolve_workdir()
    limit = int(params.get("limit") or 10)
    include_archived = params.get("include_archived", False)

    store = _get_store(user_id)

    try:
        all_sessions = store.list(limit=500)

        # Filter archived
        if not include_archived:
            all_sessions = [s for s in all_sessions if not getattr(s, 'archived', False)]

        # Categorize
        current_workdir_sessions = [s for s in all_sessions if s.workdir == workdir]
        pinned_sessions = [s for s in all_sessions if getattr(s, 'pinned', False) and s not in current_workdir_sessions]
        recent_sessions = [s for s in all_sessions if s not in current_workdir_sessions and s not in pinned_sessions]

        # Compose prioritized list
        prioritized = current_workdir_sessions[:3] + pinned_sessions[:3] + recent_sessions[:limit]
        prioritized = prioritized[:limit]

        return _ok(rid, {
            "sessions": [_info_to_dict(s) for s in prioritized],
            "current_workdir_count": len(current_workdir_sessions),
            "pinned_count": len(pinned_sessions),
        })
    except Exception as exc:
        logger.exception("session.quick_access failed")
        return _err(rid, 5005, f"quick_access: {type(exc).__name__}: {exc}")


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
    workdir = params.get("workdir") or _resolve_workdir()

    session_id = None
    try:
        from drsai.backend.cli import config as cli_config
        workdir_sessions = cli_config.get_workdir_sessions()
        session_id = workdir_sessions.get(workdir)
    except Exception:
        pass

    store = _get_store(user_id)

    # Verify cached session_id still exists (and is not archived)
    if session_id:
        info = store.resolve(session_id)
        if info is not None and not getattr(info, 'archived', False):
            return _ok(rid, {"session": _info_to_dict(info), "user_id": user_id})

    # Fall back: search Thread.meta.workdir across all sessions, pick newest
    try:
        all_sessions = store.list(limit=500)
        # Exclude archived sessions from automatic resolution
        matches = [s for s in all_sessions if s.workdir == workdir and not getattr(s, 'archived', False)]
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


@method("session.tag_add")
def _tag_add(rid, params: dict) -> dict:
    """Add tag(s) to a session's metadata."""
    session_id = params.get("session_id") or ""
    tags = params.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip().lstrip('#') for t in tags.split() if t.strip()]
    if not session_id or not tags:
        return _err(rid, 4002, "session_id and tags are required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    ok = store.tag_add(session_id, tags)
    if not ok:
        return _err(rid, 4001, "session not found")
    return _ok(rid, {"ok": True, "tags": tags})


@method("session.tag_remove")
def _tag_remove(rid, params: dict) -> dict:
    """Remove tag(s) from a session's metadata."""
    session_id = params.get("session_id") or ""
    tags = params.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip().lstrip('#') for t in tags.split() if t.strip()]
    if not session_id or not tags:
        return _err(rid, 4002, "session_id and tags are required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    ok = store.tag_remove(session_id, tags)
    if not ok:
        return _err(rid, 4001, "session not found")
    return _ok(rid, {"ok": True, "tags": tags})


@method("session.pin")
def _pin(rid, params: dict) -> dict:
    """Pin a session (shows at top of lists)."""
    session_id = params.get("session_id") or ""
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    ok = store.set_meta_flag(session_id, "pinned", True)
    if not ok:
        return _err(rid, 4001, "session not found")
    return _ok(rid, {"ok": True, "pinned": True})


@method("session.unpin")
def _unpin(rid, params: dict) -> dict:
    """Unpin a session."""
    session_id = params.get("session_id") or ""
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    ok = store.set_meta_flag(session_id, "pinned", False)
    if not ok:
        return _err(rid, 4001, "session not found")
    return _ok(rid, {"ok": True, "pinned": False})


@method("session.archive")
def _archive(rid, params: dict) -> dict:
    """Archive a session (hide from default lists, searchable via /find)."""
    session_id = params.get("session_id") or ""
    archived = params.get("archived", True)
    if not session_id:
        return _err(rid, 4002, "session_id is required")

    user_id = _resolve_user_id()
    store = _get_store(user_id)
    ok = store.set_meta_flag(session_id, "archived", bool(archived))
    if not ok:
        return _err(rid, 4001, "session not found")

    # Clean up workdir cache if archiving the cached session
    if archived:
        try:
            from drsai.backend.cli import config as cli_config
            workdir_sessions = cli_config.get_workdir_sessions()
            info = store.resolve(session_id)
            if info and info.workdir and workdir_sessions.get(info.workdir) == session_id:
                cli_config.remove_workdir_session(info.workdir)
        except Exception:
            pass

    return _ok(rid, {"ok": True, "archived": bool(archived)})


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


@method("gateway.shutdown")
def _gateway_shutdown(rid, params: dict) -> dict:
    """Graceful shutdown requested by the TUI (Ctrl+D).

    Steps:
    1. Save state for every active AgentSession.
    2. Emit a ``gateway.exit`` event so the TUI can exit cleanly.
    3. Schedule ``sys.exit(0)`` on the next stdin loop tick via a daemon thread.

    This handler runs on the RPC pool thread, so ``sys.exit`` must be deferred
    to avoid killing the process before the JSON response reaches the TUI.
    """
    import sys
    import threading as _threading

    # Save state for all active sessions.
    for sid, state in list(_sessions.items()):
        sess = state.get("agent_session")
        if sess is None:
            continue
        try:
            sess.save_state()
            logger.info("gateway.shutdown: saved state for session %s", sid)
        except Exception:
            logger.exception("gateway.shutdown: save_state failed for %s", sid)

    # Tell the TUI we're about to exit.
    try:
        _emit("gateway.exit", "", {"reason": "shutdown"})
    except Exception:
        logger.exception("gateway.shutdown: failed to emit gateway.exit")

    # Deferred exit: give the event time to reach the TUI before the process dies.
    def _deferred_exit() -> None:
        import time as _time
        _time.sleep(0.5)
        sys.exit(0)

    _threading.Thread(target=_deferred_exit, daemon=True, name="gateway-shutdown").start()

    return _ok(rid, {"ok": True})
