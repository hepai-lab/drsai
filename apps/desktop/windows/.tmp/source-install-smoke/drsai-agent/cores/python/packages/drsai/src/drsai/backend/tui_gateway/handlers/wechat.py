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
    result = {
        "configured": os.path.exists(CREDS_FILE),
        "credentials_valid": False,
        "login_time": None,
        "expires_at": None,
        "bot_token": None,
        "account_id": None,
        "active_daemons": [],
    }

    if os.path.exists(CREDS_FILE):
        try:
            with open(CREDS_FILE, encoding="utf-8") as f:
                creds = json.load(f)
            result["credentials_valid"] = _check_creds_valid(creds)
            login_time = creds.get("login_time")
            if login_time:
                result["login_time"] = datetime.fromtimestamp(login_time).isoformat()
                expiry_ts = login_time + 7 * 24 * 3600
                result["expires_at"] = datetime.fromtimestamp(expiry_ts).isoformat()
            # Mask bot token
            token = creds.get("bot_token", "")
            if len(token) > 12:
                result["bot_token"] = f"{token[:8]}...{token[-4:]}"
            elif token:
                result["bot_token"] = "***"
            result["account_id"] = creds.get("account_id")
        except Exception:
            logger.exception("wechat.status parse error")

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
        import asyncio
        from drsai.backend.wechat.wechat_login import get_qrcode

        async def _get_qr():
            return await get_qrcode()

        qrcode_url, qrcode_id = asyncio.get_event_loop().run_until_complete(_get_qr())
        return _ok(rid, {
            "qr_url": qrcode_url,
            "qr_id": qrcode_id,
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
        import httpx
        import asyncio

        async def _check():
            url = f"https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode={qr_id}"
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.json()

        data = asyncio.get_event_loop().run_until_complete(_check())
        status = data.get("status", "unknown")

        if status == "confirmed":
            # Save credentials
            from drsai.backend.wechat.wechat_login import save_credentials
            save_credentials(data)
            return _ok(rid, {
                "status": "confirmed",
                "account_id": data.get("ilink_bot_id"),
            })

        return _ok(rid, {"status": status})
    except Exception as e:
        logger.exception("wechat.login_status failed")
        return _err(rid, -32603, str(e))


@method("wechat.logout")
def _wechat_logout(rid, params: dict) -> dict:
    """Logout WeChat and delete credentials."""
    try:
        if os.path.exists(CREDS_FILE):
            os.unlink(CREDS_FILE)
        return _ok(rid, {"status": "logged_out"})
    except Exception as e:
        return _err(rid, -32603, str(e))


# ── Helpers ───────────────────────────────────────────────────────────────


def _check_creds_valid(creds: dict) -> bool:
    """Check if credentials are still valid (7-day expiry)."""
    login_time = creds.get("login_time")
    if not login_time:
        return False
    return (time.time() - login_time) < 7 * 24 * 3600
