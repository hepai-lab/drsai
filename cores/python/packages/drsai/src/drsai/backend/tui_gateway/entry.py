"""OpenDrSai TUI Gateway — process entry point.

Run via ``python -m drsai.backend.tui_gateway``. Reads JSON-RPC frames from
stdin, dispatches to handlers in :mod:`drsai.backend.tui_gateway.server`, and
writes responses + events to stdout.

Phase 0 scaffold ports the relevant pieces of hermes-agent/tui_gateway/entry.py:
- Panic hook + signal handlers + crash log
- ``gateway.ready`` startup event
- stdin loop that delegates to ``server.dispatch``
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
import traceback

logger = logging.getLogger(__name__)

# ── Force UTF-8 on stdin/stdout/stderr (Windows fix) ────────────────────────
# On Windows the default console code page is GBK (cp936) on Chinese systems.
# JSON-RPC frames containing Chinese characters get mangled when Python encodes
# them with the system locale instead of UTF-8. Force UTF-8 on all three
# streams *before* any logging / handler import — once a TextIOWrapper has been
# used you can't reconfigure it.
def _force_utf8_io() -> None:
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            # errors="replace" handles lone surrogates (e.g. token boundaries
            # mid-multibyte sequence from the LLM stream) without crashing
            # json.dumps. We accept that one or two characters may render as
            # "?" rather than letting the whole frame fail.
            reconfigure(encoding="utf-8", errors="replace", newline="\n")
        except Exception:
            pass

_force_utf8_io()

# Strip '' and '.' from sys.path so a local utils/ in CWD can't shadow
# installed drsai modules. Mirrors hermes-agent's hardening.
sys.path = [p for p in sys.path if p not in {"", "."}]

from . import server
from .server import _CRASH_LOG, dispatch, resolve_skin, write_json

# Side-effect import: registers @method handlers for session.* / prompt.* /
# *.respond against the global _methods registry. Must happen before the
# stdin loop starts, otherwise the first inbound RPC will see "unknown method".
from . import handlers  # noqa: F401


# ── Shutdown grace ───────────────────────────────────────────────────
# How long to wait for orderly shutdown (atexit + finalisers) before falling
# back to ``os._exit(0)`` so a wedged worker mid-flush can't strand the
# process. 1s covers the gateway's own shutdown work on every machine we've
# tested; override via ``DRSAI_TUI_GATEWAY_SHUTDOWN_GRACE_S`` for slower envs.
_DEFAULT_SHUTDOWN_GRACE_S = 1.0


def _shutdown_grace_seconds() -> float:
    raw = (os.environ.get("DRSAI_TUI_GATEWAY_SHUTDOWN_GRACE_S") or "").strip()
    if not raw:
        return _DEFAULT_SHUTDOWN_GRACE_S
    try:
        value = float(raw)
    except ValueError:
        return _DEFAULT_SHUTDOWN_GRACE_S
    return value if value > 0 else _DEFAULT_SHUTDOWN_GRACE_S


# ── Signal handlers ──────────────────────────────────────────────────


def _log_signal(signum: int, frame) -> None:
    """Capture WHICH thread and WHERE a termination signal hit us.

    SIG_DFL for SIGPIPE kills the process silently when a background thread
    writes to a stdout the UI has stopped reading. Without this handler the
    "gateway exited" banner has no trace.
    """
    _signal_names: dict[int, str] = {}
    for _attr in ("SIGPIPE", "SIGTERM", "SIGHUP", "SIGINT", "SIGBREAK"):
        _sig = getattr(signal, _attr, None)
        if _sig is not None:
            _signal_names[int(_sig)] = _attr
    name = _signal_names.get(signum, f"signal {signum}")
    try:
        os.makedirs(os.path.dirname(_CRASH_LOG), exist_ok=True)
        with open(_CRASH_LOG, "a", encoding="utf-8") as f:
            f.write(
                f"\n=== {name} received · {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n"
            )
            if frame is not None:
                f.write("main-thread stack at signal delivery:\n")
                traceback.print_stack(frame, file=f)
            import threading as _threading
            for tid, th in _threading._active.items():
                f.write(f"\n--- thread {th.name} (id={tid}) ---\n")
                f.write("".join(traceback.format_stack(sys._current_frames().get(tid))))
    except Exception:
        pass
    print(f"[gateway-signal] {name}", file=sys.stderr, flush=True)

    import threading as _threading

    def _hard_exit() -> None:
        # If a worker thread is mid-flush on a half-closed pipe, sys.exit(0)
        # waits forever. os._exit skips atexit but breaks the deadlock.
        os._exit(0)

    timer = _threading.Timer(_shutdown_grace_seconds(), _hard_exit)
    timer.daemon = True
    timer.start()

    try:
        sys.exit(0)
    except SystemExit:
        raise


# SIGPIPE: ignore — let Python raise BrokenPipeError on the offending write
# (which write_json handles cleanly) instead of killing the process silently.
# SIGINT: ignore — Ctrl+C in the parent terminal must not kill the gateway;
# the UI sends session.interrupt RPCs for cancellation.
if hasattr(signal, "SIGPIPE"):
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)
if hasattr(signal, "SIGTERM"):
    signal.signal(signal.SIGTERM, _log_signal)
if hasattr(signal, "SIGHUP"):
    signal.signal(signal.SIGHUP, _log_signal)
elif hasattr(signal, "SIGBREAK"):
    signal.signal(signal.SIGBREAK, _log_signal)
if hasattr(signal, "SIGINT"):
    signal.signal(signal.SIGINT, signal.SIG_IGN)


def _log_exit(reason: str) -> None:
    """Record why the gateway subprocess is shutting down."""
    try:
        os.makedirs(os.path.dirname(_CRASH_LOG), exist_ok=True)
        with open(_CRASH_LOG, "a", encoding="utf-8") as f:
            f.write(
                f"\n=== gateway exit · {time.strftime('%Y-%m-%d %H:%M:%S')} "
                f"· reason={reason} ===\n"
            )
    except Exception:
        pass
    print(f"[gateway-exit] {reason}", file=sys.stderr, flush=True)


# ── Main loop ────────────────────────────────────────────────────────


def setup_status() -> dict:
    """Inspect config + env to see whether the user has done first-run setup.

    Returns a dict shipped in ``gateway.ready`` so the UI can show an
    "unconfigured" banner / refuse to run prompts when nothing is ready.

    Fields:
        config_exists:      cli_config.json exists
        has_api_key:        any static API key configured (env or config)
        setup_required:     True if neither OIDC session nor API key
        auth_mode:          "oidc" | "apikey" | "none"
        auth_authenticated: True if OIDC session is valid (not expired)
        skills_selected:    True if user completed skills selection step
    """
    has_api_key = False
    config_path_exists = False
    auth_mode = "none"
    auth_authenticated = False
    skills_selected = False

    try:
        from drsai.backend.cli import config as cli_config
        config_path_exists = cli_config.CLI_CONFIG_PATH.exists()
        cfg = cli_config.load_config() if config_path_exists else {}
        has_api_key = any([
            cfg.get("api_key"),
            cfg.get("anthropic_api_key"),
            cfg.get("openai_api_key"),
            os.environ.get("HEPAI_API_KEY"),
            os.environ.get("ANTHROPIC_API_KEY"),
            os.environ.get("OPENAI_API_KEY"),
        ])
        auth_mode = cfg.get("auth_mode", "none")
        skills_selected = bool(cfg.get("skills_selected", False))
    except Exception:
        logger.exception("setup status probe failed")

    # Check OIDC session validity
    if auth_mode == "oidc":
        try:
            from drsai.backend.auth.token_store import load_auth_session, is_token_expired
            session = load_auth_session()
            if session and not is_token_expired(session):
                auth_authenticated = True
        except Exception:
            logger.warning("OIDC session check failed", exc_info=True)

    # setup_required: no valid OIDC session AND no API key
    setup_required = (not auth_authenticated) and (not has_api_key)

    return {
        "config_exists": config_path_exists,
        "has_api_key": has_api_key,
        "auth_mode": auth_mode,
        "auth_authenticated": auth_authenticated,
        "skills_selected": skills_selected,
        "setup_required": setup_required,
    }


def main() -> None:
    # Optionally start WebSocket server for attach mode
    ws_url = None
    ws_mode = os.environ.get("DRSAI_TUI_ENABLE_WS") == "1"
    if ws_mode:
        try:
            from . import ws as ws_module
            port = int(os.environ.get("DRSAI_TUI_WS_PORT", "0"))
            bound_port = ws_module.start_ws_server(port=port)
            ws_url = f"ws://127.0.0.1:{bound_port}/attach"
            logger.info("WebSocket attach enabled: %s", ws_url)
        except Exception:
            logger.exception("Failed to start WebSocket server")

    skin = resolve_skin()
    if ws_url:
        skin["ws_attach_url"] = ws_url

    setup = setup_status()

    if not write_json({
        "jsonrpc": "2.0",
        "method": "event",
        "params": {
            "type": "gateway.ready",
            "payload": {"skin": skin, "setup": setup},
        },
    }):
        if ws_mode:
            # In WS mode stdout may be a log file or closed; the ready event
            # is not critical since the SSH tunnel detects readiness via port
            # probing.  Log and continue.
            logger.warning("gateway.ready write failed in WS mode; continuing")
        else:
            _log_exit("startup write failed (broken stdout pipe before first event)")
            sys.exit(0)

    # ── stdin JSON-RPC loop ──────────────────────────────────────────
    # In local mode the TUI drives the gateway through stdin/stdout pipes.
    # In WebSocket (remote) mode the WS server is the communication channel;
    # stdin may be /dev/null (nohup) and will immediately EOF.  We must keep
    # the main thread alive so the WS daemon thread stays alive too.
    if ws_mode:
        # Process stdin lines if any arrive (hybrid mode), but never exit on EOF.
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                continue
            try:
                resp = dispatch(req)
            except Exception as exc:
                logger.exception("dispatch raised for method=%r", req.get("method"))
                resp = {
                    "jsonrpc": "2.0",
                    "id": req.get("id") if isinstance(req, dict) else None,
                    "error": {"code": -32000, "message": f"handler error: {exc}"},
                }
            if resp is not None:
                write_json(resp)
        # stdin EOF in WS mode — keep the process alive for the WS server.
        logger.info("stdin EOF in WebSocket mode; keeping gateway alive for WS clients")
        try:
            import threading as _t
            _t.Event().wait()  # block forever until signal kills the process
        except (KeyboardInterrupt, SystemExit):
            _log_exit("signal received in WS mode")
    else:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue

            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                if not write_json({
                    "jsonrpc": "2.0",
                    "error": {"code": -32700, "message": "parse error"},
                    "id": None,
                }):
                    _log_exit("parse-error-response write failed (broken stdout pipe)")
                    sys.exit(0)
                continue

            method_name = req.get("method") if isinstance(req, dict) else None
            try:
                resp = dispatch(req)
            except Exception as exc:
                # A single bad RPC (e.g. a provider returning an invalid model id)
                # must never kill the gateway process — that surfaces to the TUI as
                # "gateway not running" and takes down the whole session.  Log it
                # for forensics and return a structured JSON-RPC error instead.
                logger.exception("dispatch raised for method=%r", method_name)
                resp = {
                    "jsonrpc": "2.0",
                    "id": req.get("id") if isinstance(req, dict) else None,
                    "error": {"code": -32000, "message": f"handler error: {exc}"},
                }
            if resp is not None:
                if not write_json(resp):
                    _log_exit(
                        f"response write failed for method={method_name!r} "
                        "(broken stdout pipe)"
                    )
                    sys.exit(0)

        _log_exit("stdin EOF (UI closed the command pipe)")


if __name__ == "__main__":
    main()
