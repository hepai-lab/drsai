"""python -m drsai.backend.daemon — Daemon 进程入口。"""

import logging
import os
import secrets

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
