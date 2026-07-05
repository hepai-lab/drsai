"""python -m drsai.backend.daemon — Daemon 进程入口。"""

import logging
import os
import secrets
import sys

# ── Windows: redirect stdout/stderr to log file early ─────────────────
# On Windows, Python opens files with O_NOINHERIT so file handles cannot
# be passed cross-process via subprocess.Popen(stdout=...).  The parent
# (pid_manager.py) passes the log path via DRSAI_DAEMON_LOG_FILE and the
# child redirects itself here — before any logging / output starts.
if sys.platform == "win32" and os.environ.get("DRSAI_DAEMON_LOG_FILE"):
    _log_path = os.environ["DRSAI_DAEMON_LOG_FILE"]
    os.makedirs(os.path.dirname(_log_path), exist_ok=True)

    # 1. Redirect OS-level fds so C extensions / subprocess in daemon
    #    also write to the log file.
    _log_fd = open(_log_path, "a", buffering=1)  # line-buffered
    os.dup2(_log_fd.fileno(), 1)   # stdout → log
    os.dup2(_log_fd.fileno(), 2)   # stderr → log
    _log_fd.close()

    # 2. Re-open Python-level wrappers.  After DETACHED_PROCESS startup
    #    sys.stdout / sys.stderr may carry stale internal state (e.g.
    #    cached error flags for an invalid console handle).  Fresh
    #    wrappers guarantee that every `print()` / `logging` call works.
    sys.stdout = open(1, "w", buffering=1, closefd=False, encoding="utf-8")
    sys.stderr = open(2, "w", buffering=1, closefd=False, encoding="utf-8")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)

from .config import DaemonConfig
from .daemon_server import run_daemon

# 注册所有 RPC handlers（与 tui_gateway 共享 _methods 注册表）
from drsai.backend.tui_gateway import handlers  # noqa: F401
from drsai.backend.tui_gateway.handlers import daemon as _daemon_handlers  # noqa: F401

config = DaemonConfig.from_env()

if not config.api_token:
    config.api_token = f"dsk_{secrets.token_hex(16)}"

run_daemon(config)
