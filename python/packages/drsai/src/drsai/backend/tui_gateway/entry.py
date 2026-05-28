"""DrSai TUI Gateway — process entry point.

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


def _setup_status() -> dict:
    """Inspect config + env to see whether the user has done first-run setup.

    Returns a dict shipped in ``gateway.ready`` so the UI can show an
    "unconfigured" banner / refuse to run prompts when nothing is ready.
    """
    has_api_key = False
    config_path_exists = False
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
    except Exception:
        logger.exception("setup status probe failed")
    return {
        "config_exists": config_path_exists,
        "has_api_key": has_api_key,
        "setup_required": (not config_path_exists) or (not has_api_key),
    }


def main() -> None:
    # Optionally start WebSocket server for attach mode
    ws_url = None
    if os.environ.get("DRSAI_TUI_ENABLE_WS") == "1":
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

    setup = _setup_status()

    if not write_json({
        "jsonrpc": "2.0",
        "method": "event",
        "params": {
            "type": "gateway.ready",
            "payload": {"skin": skin, "setup": setup},
        },
    }):
        _log_exit("startup write failed (broken stdout pipe before first event)")
        sys.exit(0)

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
        resp = dispatch(req)
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
