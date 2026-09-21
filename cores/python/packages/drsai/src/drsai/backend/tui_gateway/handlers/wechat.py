"""WeChat management RPC handlers for TUI gateway.

Provides status queries, session management, and login management
for the WeChat (ilink Bot) integration.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path

from ..server import _err, _ok, method

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────

try:
    from drsai.configs.constant import WECHAT_DIR
except ImportError:
    WECHAT_DIR = Path.home() / ".drsai" / "workspace" / "wechat"

CREDS_FILE = os.path.join(str(WECHAT_DIR), "credentials.json")

from drsai.backend.wechat.auth_service import WeChatAuthError, WeChatAuthService

_wechat_auth = WeChatAuthService(CREDS_FILE)


# ── RPC methods ───────────────────────────────────────────────────────────


@method("wechat.status")
def _wechat_status(rid, params: dict) -> dict:
    """View WeChat integration status.

    Returns:
        {
            configured: bool,
            credentials_valid: bool,
            login_time: str | None,
            expires_at: str | None,
            bot_token: str (masked),
            account_id: str | None,
            active_daemons: list,
        }
    """
    shared = _run(_wechat_auth.status())
    result = {
        "configured": shared["configured"],
        "credentials_valid": shared["credential_state"] == "valid",
        "login_time": shared.get("login_time"),
        "expires_at": shared.get("expires_at"),
        "bot_token": None,
        "account_id": shared.get("account_label"),
        "active_daemons": [],
    }

    # Check running daemons with wechat enabled
    try:
        from drsai.backend.daemon.pid_manager import list_daemons, is_running
        for d in list_daemons():
            if d.get("wechat_enabled") and is_running(d.get("name", "")):
                result["active_daemons"].append({
                    "name": d.get("name"),
                    "port": d.get("ws_port"),
                })
    except Exception:
        pass

    return _ok(rid, result)


@method("wechat.sessions")
def _wechat_sessions(rid, params: dict) -> dict:
    """View WeChat user sessions.

    Params:
        daemon_name: Associated daemon name (optional)
    """
    # Read from wechat_sessions.json if it exists
    daemon_name = params.get("daemon_name", "")
    sessions: list[dict] = []

    try:
        from drsai.backend.daemon.pid_manager import read_state
        if daemon_name:
            state = read_state(daemon_name)
            if state:
                sessions_file = os.path.join(
                    os.path.dirname(state.get("log_file", "")),
                    "wechat_sessions.json",
                )
                if os.path.exists(sessions_file):
                    with open(sessions_file, encoding="utf-8") as f:
                        data = json.load(f)
                    sessions = data if isinstance(data, list) else []
    except Exception:
        pass

    return _ok(rid, {"sessions": sessions})


@method("wechat.login")
def _wechat_login(rid, params: dict) -> dict:
    """Initiate WeChat QR login flow.

    Returns the QR code URL for the frontend to display.
    The frontend should then poll wechat.login_status.
    """
    try:
        started = _run(_wechat_auth.start_login())
        return _ok(rid, {
            "qr_url": started["qr_content"],
            "qr_id": started["operation_id"],
            "status": "pending",
        })
    except Exception as e:
        logger.exception("wechat.login failed")
        return _err(rid, -32603, str(e))


@method("wechat.login_status")
def _wechat_login_status(rid, params: dict) -> dict:
    """Check QR login status.

    Params:
        qr_id: QR code ID from wechat.login
    """
    qr_id = params.get("qr_id", "")
    if not qr_id:
        return _err(rid, -32602, "qr_id is required")

    try:
        result = _run(_wechat_auth.poll_login(qr_id))
        status = {"waiting": "wait", "scanned": "scaned"}.get(result["status"], result["status"])
        return _ok(rid, {"status": status, "account_id": result.get("account_label")})
    except Exception as e:
        logger.exception("wechat.login_status failed")
        return _err(rid, -32603, str(e))


@method("wechat.logout")
def _wechat_logout(rid, params: dict) -> dict:
    """Logout WeChat and delete credentials."""
    try:
        return _ok(rid, _run(_wechat_auth.logout()))
    except Exception as e:
        return _err(rid, -32603, str(e))


# ── Helpers ───────────────────────────────────────────────────────────────


def _check_creds_valid(creds: dict) -> bool:
    """Check if credentials are still valid (7-day expiry)."""
    login_time = creds.get("login_time")
    if not login_time:
        return False
    return (time.time() - login_time) < 7 * 24 * 3600


def _run(awaitable):
    """Run shared async service calls from the TUI gateway's sync handlers."""
    import asyncio
    try:
        return asyncio.run(awaitable)
    except WeChatAuthError:
        raise
