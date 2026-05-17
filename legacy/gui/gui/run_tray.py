"""DrSai Desktop Tray Application — thin entry point.

All business logic has been refactored into collaborating components:

    app_context.py      — AppContext: shared state container
    desktop_app.py      — DrSaiDesktopApp: orchestrator (lifecycle, chat, setup)
    commands/            — CommandDispatcher + 6 category modules
    lazy_imports.py      — centralized lazy import cache
    ui_formatter.py      — UIFormatter: standardized output API
    crash_logging.py     — crash log, excepthook, tkinter checks
    setup_dialog.py      — DrSaiSetupDialog: first-time setup UI

This file is now just the ``__main__`` entry point: crash-safe
pre-flight checks → import the orchestrator → run.

Architecture:
    ┌─ Main thread (tkinter.mainloop) ──────────────────────┐
    │  DrSaiChatWindow (tkinter.Tk)                         │
    │  - Displays conversation                              │
    │  - Accepts user input (text + /commands)              │
    │  - root.after() for thread-safe GUI updates           │
    └────────────────────────────────────────────────────────│
    ┌─ Tray thread (pystray.Icon) ──────────────────────────│
    │  System tray icon                                     │
    │  - Double-click → show_window → root.after()          │
    │  - Menu "打开对话" → show_window                       │
    │  - Menu "退出" → quit_fn → os._exit()                │
    └────────────────────────────────────────────────────────│
    ┌─ Asyncio loop thread ─────────────────────────────────│
    │  DrSaiCLIAssistant (resident in memory)               │
    │  - create_agent() initialization                      │
    │  - agent.run_stream(task=user_input)                  │
    │  - GUIRenderer.render(stream) → append_fn → root.after│
    └────────────────────────────────────────────────────────┘

Usage:
    python -m drsai.backend.gui.run_tray
    or:  drsai-tray  (if registered as entry point)

Requirements:
    pip install drsai[tray]  (pystray + Pillow)
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

# ── Pre-flight: crash-safe checks before importing heavy deps ──────────────
from drsai.backend.gui.crash_logging import (
    setup_logging,
    setup_excepthook,
    setup_windowed_stderr,
    check_tkinter,
    check_essential_imports,
    check_pystray,
    write_crash_entry,
)


def _preflight() -> None:
    """Run crash-safe pre-flight checks before starting the app.

    Each check function returns None on success, or an error string on failure.
    """
    # 1. Setup logging and excepthook (always safe to do)
    setup_logging()
    setup_excepthook()

    # 2. If PyInstaller windowed mode, redirect stderr to crash log
    if getattr(sys, 'frozen', False) and not sys.stderr:
        setup_windowed_stderr()

    # 3. Check tkinter availability (critical — app can't run without it)
    tk_error = check_tkinter()
    if tk_error:
        write_crash_entry(f"tkinter check failed: {tk_error}")
        try:
            print(f"ERROR: tkinter not available: {tk_error}", file=sys.stderr or sys.__stderr__)
        except Exception:
            pass
        sys.exit(1)

    # 4. Check essential imports (loguru, etc.)
    import_errors = check_essential_imports()
    if import_errors:
        write_crash_entry(f"Essential import checks failed: {import_errors}")
        try:
            print(f"ERROR: Essential imports failed: {import_errors}", file=sys.stderr or sys.__stderr__)
        except Exception:
            pass

    # 5. Check pystray (non-critical — app can run without tray)
    pystray_error = check_pystray()
    if pystray_error:
        write_crash_entry(f"pystray check (non-critical): {pystray_error}")


def main() -> None:
    """Main entry point for DrSai desktop tray application.

    Startup sequence (mirrors original run_tray.py's main()):
    1. Pre-flight checks (tkinter, essential imports, pystray)
    2. Create DrSaiDesktopApp (heavy imports deferred — lazy import)
    3. Call app.run() (single Tk root, non-blocking init)
    """
    _preflight()

    # ── Import orchestrator (heavy deps loaded lazily inside) ──────────
    from drsai.backend.gui.desktop_app import DrSaiDesktopApp

    # ── Create app (may fail on missing deps) ──────────────────────────
    try:
        app = DrSaiDesktopApp()
    except Exception as e:
        from loguru import logger
        logger.error(f"DrSaiDesktopApp creation failed: {e}", exc_info=True)
        write_crash_entry(f"DrSaiDesktopApp creation failed: {e}\n{traceback.format_exc()}")
        sys.exit(1)

    # ── Run app ────────────────────────────────────────────────────────
    try:
        app.run()
    except Exception as e:
        from loguru import logger
        logger.error(f"app.run() failed: {e}", exc_info=True)
        write_crash_entry(f"app.run() failed: {e}\n{traceback.format_exc()}")
        sys.exit(1)


if __name__ == "__main__":
    # ── Crash-logging shim for windowed PyInstaller exe ────────────────
    # In windowed mode sys.stdout / sys.stderr are None and any unhandled
    # exception just kills the process silently.  Capture EVERYTHING to a
    # crash log before invoking main().
    import datetime as _dt

    _crash_dir = Path.home() / ".drsai" / "logs"
    try:
        _crash_dir.mkdir(parents=True, exist_ok=True)
        _crash_log = _crash_dir / "drsai-tray-crash.log"
    except Exception:
        _crash_log = Path.home() / "drsai-tray-crash.log"

    _crash_fp = open(_crash_log, "a", encoding="utf-8", buffering=1)
    _crash_fp.write(f"\n=== {_dt.datetime.now().isoformat()} drsai-tray launching ===\n")
    _crash_fp.flush()

    # Redirect dead std streams so print() and tracebacks aren't lost
    if sys.stdout is None:
        sys.stdout = _crash_fp
    if sys.stderr is None:
        sys.stderr = _crash_fp

    def _excepthook(etype, evalue, etb):
        _crash_fp.write("\n=== Unhandled exception ===\n")
        traceback.print_exception(etype, evalue, etb, file=_crash_fp)
        _crash_fp.flush()

    sys.excepthook = _excepthook

    try:
        main()
    except SystemExit as _e:
        _crash_fp.write(f"\n=== sys.exit({_e.code}) called ===\n")
        traceback.print_stack(file=_crash_fp)
        _crash_fp.flush()
        raise
    except BaseException:
        _crash_fp.write("\n=== Top-level exception ===\n")
        traceback.print_exc(file=_crash_fp)
        _crash_fp.flush()
        raise