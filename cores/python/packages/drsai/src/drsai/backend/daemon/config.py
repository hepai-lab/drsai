# drsai/backend/daemon/config.py

from __future__ import annotations
import os
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DaemonConfig:
    """Daemon 进程配置（从环境变量读取）。"""
    name: str = field(default_factory=lambda: os.environ.get("DRSAI_DAEMON_NAME", "default"))
    ws_port: int = field(default_factory=lambda: int(os.environ.get("DRSAI_DAEMON_WS_PORT", "8765")))
    wechat_enabled: bool = field(
        default_factory=lambda: os.environ.get("DRSAI_DAEMON_WECHAT_ENABLED", "0") == "1"
    )
    wechat_port: Optional[int] = field(
        default_factory=lambda: (
            int(os.environ["DRSAI_DAEMON_WECHAT_PORT"])
            if os.environ.get("DRSAI_DAEMON_WECHAT_PORT")
            else None
        )
    )
    api_token: str = field(
        default_factory=lambda: os.environ.get("DRSAI_DAEMON_API_TOKEN", "")
    )
    model: str = field(
        default_factory=lambda: os.environ.get("DRSAI_DAEMON_MODEL", "")
    )
    started_at: float = field(
        default_factory=lambda: float(os.environ.get("DRSAI_DAEMON_STARTED_AT", str(time.time())))
    )

    @classmethod
    def from_env(cls) -> "DaemonConfig":
        return cls()
