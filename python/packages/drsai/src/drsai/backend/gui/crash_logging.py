"""Crash logging utilities for DrSai desktop tray application.

In PyInstaller windowed mode (console=False), sys.stdout and sys.stderr
are None.  Any unhandled exception silently kills the process.  This module
provides crash-logging infrastructure that captures everything to a log file
before the app starts, so failures are never invisible.

Extracted from the original run_tray.py's main() + __main__ block.
"""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

from loguru import logger

from drsai.configs.constant import FS_DIR

# ── Crash log path ────────────────────────────────────────────────────────

CRASH_LOG_DIR = Path(FS_DIR) / "logs"
CRASH_LOG_FILE = CRASH_LOG_DIR / "drsai-tray-crash.log"


def ensure_crash_log_dir() -> Path:
    """Create crash log directory if it doesn't exist, return the file path."""
    try:
        CRASH_LOG_DIR.mkdir(parents=True, exist_ok=True)
        return CRASH_LOG_FILE
    except Exception:
        # Fallback to home directory
        fallback = Path.home() / ".drsai" / "logs" / "drsai-tray-crash.log"
        try:
            fallback.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return fallback


def write_crash_entry(message: str) -> None:
    """Append a crash log entry to the crash log file."""
    crash_log = ensure_crash_log_dir()
    try:
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(message)
            f.flush()
    except Exception:
        pass  # never let crash logging itself crash the app


def setup_logging() -> None:
    """Configure loguru logging for the tray application.

    Writes WARNING+ to stderr (if available) and to a rotating log file.
    """
    logger.remove()
    if sys.stderr is not None:
        logger.add(sys.stderr, level="WARNING")
    try:
        log_file = Path(FS_DIR) / "logs" / "drsai-tray.log"
        log_file.parent.mkdir(parents=True, exist_ok=True)
        logger.add(str(log_file), level="WARNING", rotation="5 MB", retention=3)
    except Exception:
        pass


def setup_excepthook(crash_fp=None) -> None:
    """Install sys.excepthook to capture unhandled exceptions to crash log.

    If crash_fp is provided (an open file), tracebacks go there.
    Otherwise they go to the default crash log file.
    """
    def _excepthook(etype, evalue, etb):
        msg = "\n=== Unhandled exception ===\n"
        if crash_fp is not None:
            crash_fp.write(msg)
            traceback.print_exception(etype, evalue, etb, file=crash_fp)
            crash_fp.flush()
        else:
            write_crash_entry(msg)
            try:
                with open(CRASH_LOG_FILE, "a", encoding="utf-8") as f:
                    traceback.print_exception(etype, evalue, etb, file=f)
                    f.flush()
            except Exception:
                pass

    sys.excepthook = _excepthook


def check_tkinter() -> str | None:
    """Verify tkinter is importable. Return None if OK, error string if not."""
    try:
        import tkinter  # noqa: F401
        return None
    except ImportError as e:
        write_crash_entry(f"\n=== tkinter not available: {e} ===\n")
        return str(e)


def check_essential_imports() -> str | None:
    """Verify lightweight essential imports. Return None if OK, error string if not."""
    try:
        import drsai.configs.constant   # noqa: F401
        import drsai.backend.cli.config  # noqa: F401
        return None
    except ImportError as e:
        write_crash_entry(f"\n=== Essential import failed: {e} ===\n")
        try:
            with open(CRASH_LOG_FILE, "a", encoding="utf-8") as f:
                traceback.print_exc(file=f)
                f.flush()
        except Exception:
            pass
        return str(e)


def check_pystray() -> str | None:
    """Verify pystray is importable. Return None if OK, warning string if not."""
    try:
        import pystray  # noqa: F401
        return None
    except ImportError as e:
        logger.warning("pystray not installed. Tray icon unavailable.")
        return str(e)


def setup_windowed_stderr() -> object:
    """For PyInstaller windowed mode: redirect dead std streams to crash log.

    Returns the open crash log file handle. Caller should keep it alive
    until process exit.
    """
    import datetime as _dt

    crash_log = ensure_crash_log_dir()
    crash_fp = open(crash_log, "a", encoding="utf-8", buffering=1)
    crash_fp.write(f"\n=== {_dt.datetime.now().isoformat()} drsai-tray launching ===\n")
    crash_fp.flush()

    if sys.stdout is None:
        sys.stdout = crash_fp
    if sys.stderr is None:
        sys.stderr = crash_fp

    return crash_fp