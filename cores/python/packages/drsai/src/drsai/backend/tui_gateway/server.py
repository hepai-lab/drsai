"""OpenDrSai TUI Gateway — JSON-RPC dispatcher and session manager.

This is the Phase 0 scaffold. It provides:
- ``_methods`` registry with ``@method("name")`` decorator
- ``dispatch(req)`` for short-handler-inline / long-handler-pool routing
- ``_emit(event, sid, payload)`` for pushing events to the UI
- ``_block(event, sid, payload)`` framework for approval-style blocking RPC
- ``write_json`` with peer-gone detection
- Panic hook + thread excepthook for crash-log forensics
- One example method ``session.list`` that calls into existing CLISessionStore

Phase 1 will add: session.create / session.resume / prompt.submit / approval.respond
+ the asyncio bridge wrapping ``DrSaiCLIAssistant.run_stream``.

Ported from hermes-agent/tui_gateway/server.py with drsai-specific paths.
"""

from __future__ import annotations

import atexit
import concurrent.futures
import contextvars
import json
import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from drsai.configs.constant import FS_DIR, WORKSPACE_DIR

from .transport import (
    StdioTransport,
    Transport,
    bind_transport,
    current_transport,
    reset_transport,
)

logger = logging.getLogger(__name__)


# ── Panic logger ─────────────────────────────────────────────────────
# Gateway crashes leave no forensics: stdout is the JSON-RPC pipe (Ink side
# parses it, doesn't log raw), and the subprocess exits before stderr flushes
# through the gateway.stderr event pump. This hook appends every unhandled
# exception to ~/.drsai/logs/tui_gateway_crash.log AND re-emits a one-line
# summary to stderr so the UI can surface it in the Activity panel.
_CRASH_LOG = os.path.join(FS_DIR, "logs", "tui_gateway_crash.log")


def _panic_hook(exc_type, exc_value, exc_tb):
    import traceback

    trace = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    try:
        os.makedirs(os.path.dirname(_CRASH_LOG), exist_ok=True)
        with open(_CRASH_LOG, "a", encoding="utf-8") as f:
            f.write(
                f"\n=== unhandled exception · {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n"
            )
            f.write(trace)
    except Exception:
        pass
    first = (
        str(exc_value).strip().splitlines()[0]
        if str(exc_value).strip()
        else exc_type.__name__
    )
    print(f"[gateway-crash] {exc_type.__name__}: {first}", file=sys.stderr, flush=True)
    sys.__excepthook__(exc_type, exc_value, exc_tb)


sys.excepthook = _panic_hook


def _thread_panic_hook(args):
    import traceback

    trace = "".join(
        traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)
    )
    try:
        os.makedirs(os.path.dirname(_CRASH_LOG), exist_ok=True)
        with open(_CRASH_LOG, "a", encoding="utf-8") as f:
            f.write(
                f"\n=== thread exception · {time.strftime('%Y-%m-%d %H:%M:%S')} "
                f"· thread={args.thread.name} ===\n"
            )
            f.write(trace)
    except Exception:
        pass
    first_line = (
        str(args.exc_value).strip().splitlines()[0]
        if str(args.exc_value).strip()
        else args.exc_type.__name__
    )
    print(
        f"[gateway-crash] thread {args.thread.name} raised "
        f"{args.exc_type.__name__}: {first_line}",
        file=sys.stderr,
        flush=True,
    )


threading.excepthook = _thread_panic_hook


# ── Module state ─────────────────────────────────────────────────────
_sessions: dict[str, dict] = {}
_methods: dict[str, callable] = {}
_pending: dict[str, tuple[str, threading.Event]] = {}
_answers: dict[str, str] = {}
_stdout_lock = threading.Lock()

# Long-running RPC handlers go through the worker pool so inbound RPCs
# (notably approval.respond and session.interrupt) don't sit unread in the
# stdin pipe while a single handler blocks for seconds. Short handlers run
# inline on the main thread so ordering stays sane for the fast path.
_LONG_HANDLERS = frozenset({
    "prompt.submit",
    "session.resume",
    "slash.exec",
    "skills.manage",
    "gateway.shutdown",
    "gfs.test",
    "remote.connect",
    "remote.test",
    "remote.exec",
    "remote.browse_dirs",
})

try:
    _rpc_pool_workers = max(2, int(os.environ.get("DRSAI_TUI_RPC_POOL_WORKERS") or "4"))
except (ValueError, TypeError):
    _rpc_pool_workers = 4

_pool = concurrent.futures.ThreadPoolExecutor(
    max_workers=_rpc_pool_workers,
    thread_name_prefix="drsai-rpc",
)
atexit.register(lambda: _pool.shutdown(wait=False, cancel_futures=True))

# Reserve real stdout for JSON-RPC only; redirect Python's stdout to stderr
# so stray print() from libraries/tools becomes harmless gateway.stderr
# instead of corrupting the JSON protocol.
_real_stdout = sys.stdout
sys.stdout = sys.stderr

# Module-level stdio transport — fallback sink when no transport is bound via
# contextvar. Stream resolved through a lambda so runtime monkey-patches of
# ``_real_stdout`` (used by tests) still land correctly.
_stdio_transport = StdioTransport(lambda: _real_stdout, _stdout_lock)


# ── Frame writers ────────────────────────────────────────────────────


def write_json(obj: dict) -> bool:
    """Emit one JSON frame. Routes via the most-specific transport available.

    Precedence:
    1. Event frames with a session id → the transport stored on that session,
       so async events land with the client that owns the session even if the
       emitting thread has no contextvar binding.
    2. Otherwise the transport bound on the current context (set by
       :func:`dispatch` for the lifetime of a request).
    3. Otherwise the module-level stdio transport.
    """
    if obj.get("method") == "event":
        sid = ((obj.get("params") or {}).get("session_id")) or ""
        if sid and (t := (_sessions.get(sid) or {}).get("transport")) is not None:
            return t.write(obj)

    return (current_transport() or _stdio_transport).write(obj)


def _emit(event: str, sid: str, payload: dict | None = None) -> None:
    """Push an event frame to the UI."""
    params = {"type": event, "session_id": sid}
    if payload is not None:
        params["payload"] = payload
    write_json({"jsonrpc": "2.0", "method": "event", "params": params})


def _block(event: str, sid: str, payload: dict, timeout: int = 300) -> str:
    """Emit *event* and block until UI sends a corresponding ``*.respond`` RPC.

    Used for approval/clarify/secret/sudo flows. The handler thread waits on a
    ``threading.Event`` until ``approval.respond`` (or sibling) populates
    ``_answers[rid]`` and sets the event. Default timeout 5 min — long enough
    for a user to read and decide, short enough to recover from a dead UI.
    """
    rid = uuid.uuid4().hex[:8]
    ev = threading.Event()
    _pending[rid] = (sid, ev)
    payload["request_id"] = rid
    _emit(event, sid, payload)
    ev.wait(timeout=timeout)
    _pending.pop(rid, None)
    return _answers.pop(rid, "")


def _clear_pending(sid: str | None = None) -> None:
    """Release pending prompts with an empty answer.

    When *sid* is provided, only prompts owned by that session are released —
    used by ``session.interrupt`` to avoid collaterally cancelling prompts on
    unrelated sessions sharing the same gateway. When None, every pending
    prompt is released (used during shutdown).
    """
    for rid, (owner_sid, ev) in list(_pending.items()):
        if sid is None or owner_sid == sid:
            _answers[rid] = ""
            ev.set()


def _ok(rid, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def _err(rid, code: int, msg: str) -> dict:
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": msg}}


def method(name: str):
    """Decorator: register a function as the handler for RPC method *name*."""
    def dec(fn):
        _methods[name] = fn
        return fn
    return dec


# ── Request normalisation + dispatch ─────────────────────────────────


def _normalize_request(req: Any) -> tuple[Any, str, dict] | dict:
    """Validate a JSON-RPC request enough for safe local dispatch."""
    if not isinstance(req, dict):
        return _err(None, -32600, "invalid request: expected an object")

    rid = req.get("id")
    method_name = req.get("method")
    if not isinstance(method_name, str) or not method_name:
        return _err(rid, -32600, "invalid request: method must be a non-empty string")

    params = req.get("params", {})
    if params is None:
        params = {}
    elif not isinstance(params, dict):
        return _err(rid, -32602, "invalid params: expected an object")

    return rid, method_name, params


def handle_request(req: dict) -> dict | None:
    normalized = _normalize_request(req)
    if isinstance(normalized, dict):
        return normalized

    rid, method_name, params = normalized
    fn = _methods.get(method_name)
    if not fn:
        return _err(rid, -32601, f"unknown method: {method_name}")
    return fn(rid, params)


def dispatch(req: dict, transport: Optional[Transport] = None) -> dict | None:
    """Route inbound RPCs — long handlers to the pool, everything else inline.

    Returns a response dict when handled inline. Returns None when the handler
    was scheduled on the pool; the worker writes its own response via the bound
    transport when done.

    *transport* (optional): pins every write produced by this request —
    including any events emitted by the handler — to the given transport.
    Omitting it falls back to the module-level stdio transport.
    """
    t = transport or _stdio_transport
    token = bind_transport(t)
    try:
        normalized = _normalize_request(req)
        if isinstance(normalized, dict):
            return normalized

        _rid, method_name, _params = normalized
        if method_name not in _LONG_HANDLERS:
            return handle_request(req)

        # Snapshot the context so the pool worker sees the bound transport.
        ctx = contextvars.copy_context()

        def run():
            try:
                resp = handle_request(req)
            except Exception as exc:
                logger.exception("dispatch worker handler raised")
                resp = _err(req.get("id"), -32000, f"handler error: {exc}")
            if resp is not None:
                ok = t.write(resp)
                if not ok:
                    logger.warning("dispatch: write returned False for %s", req.get("method"))

        _pool.submit(lambda: ctx.run(run))
        return None
    finally:
        reset_transport(token)


# ── Default user / DB helpers ────────────────────────────────────────
# Phase 0 stub: defer full session/agent management to Phase 1.

_db_manager_singleton: Any = None
_db_manager_lock = threading.Lock()


def _get_db_manager():
    """Lazy-init a DatabaseManager (mirrors run_cli.py setup)."""
    global _db_manager_singleton
    if _db_manager_singleton is not None:
        return _db_manager_singleton
    with _db_manager_lock:
        if _db_manager_singleton is not None:
            return _db_manager_singleton
        from drsai.modules.managers.database import DatabaseManager

        workspace = Path(WORKSPACE_DIR)
        dataset = workspace / "drsai"
        dataset.mkdir(parents=True, exist_ok=True)
        engine_uri = f"sqlite:///{dataset}/drsai.db"
        db = DatabaseManager(engine_uri=engine_uri, base_dir=str(dataset))
        init_resp = db.initialize_database()
        if not init_resp.status:
            raise RuntimeError(f"DB init failed: {init_resp.message}")
        _db_manager_singleton = db
        return db


def _resolve_user_id() -> str:
    """Resolve user_id for session DB queries.

    Priority: DRSAI_USER_ID env (propagated by ssh_tunnel.py in WS mode)
    → cli_config.json (local mode) → "anonymous".

    In WebSocket (SSH tunnel) mode, ssh_tunnel.py sets DRSAI_USER_ID to
    the *local* machine's user_id so the remote gateway queries the same
    user's sessions.  Without this, the remote gateway would use the
    remote machine's cli_config, which may have a different user_id.
    """
    env_uid = os.environ.get("DRSAI_USER_ID")
    if env_uid:
        return env_uid
    try:
        from drsai.backend.cli import config as cli_config
        cfg = cli_config.load_config()
        return cfg.get("user_id") or "anonymous"
    except Exception:
        return "anonymous"


# ── Smoke-test / health methods ──────────────────────────────────────


@method("ping")
def _ping(rid, params: dict) -> dict:
    """Smoke-test method: echo back params with a server-side timestamp."""
    return _ok(rid, {"echo": params, "ts": time.time()})


def resolve_skin() -> dict:
    """Return UI theming hints. Phase 0 stub — Phase 2 will read from config."""
    return {
        "branding": {"name": "OpenDrSai"},
        "colors": {
            "primary": "#FFD700",
            "accent": "#FFBF00",
            "border": "#CD7F32",
        },
    }
