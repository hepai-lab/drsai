"""Diagnostic logging helper - writes to a file to bypass stdout/stderr issues with pythonw."""
import os
import time
import threading

_DIAG_FILE = os.path.join(
    os.environ.get("DRSAI_HOME", os.path.expanduser("~/.drsai-dev")),
    "logs", "diag-trace.log"
)
_lock = threading.Lock()

def diag_log(msg: str) -> None:
    """Write a diagnostic message to the diag-trace.log file."""
    try:
        with _lock:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            line = f"[{ts}] {msg}\n"
            with open(_DIAG_FILE, "a", encoding="utf-8") as f:
                f.write(line)
    except Exception:
        pass
