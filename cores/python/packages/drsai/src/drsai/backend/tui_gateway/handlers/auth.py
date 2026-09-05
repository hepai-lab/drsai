"""OIDC authentication RPC handlers for TUI.

Implements Device Code Flow login for the TUI, backed by
:mod:`drsai.backend.auth.oidc_client` and
:mod:`drsai.backend.auth.token_store`.

RPC methods:
    auth.status          — check current auth state
    auth.oidc.start      — start device code flow, return user_code + URL
    auth.oidc.poll       — poll for token (single-shot, called by UI timer)
    auth.oidc.cancel     — cancel an in-flight device flow
    auth.session.refresh — refresh access_token via refresh_token
    auth.logout         — revoke token + clear local session

Reference: desktop ``apps/desktop/shared/main/auth.ts``.
"""

from __future__ import annotations

import logging
import os

from ..server import _err, _ok, method
from drsai.backend.cli import config as cli_config

logger = logging.getLogger(__name__)

# ── OIDC provider config ─────────────────────────────────────────────

_OIDC_ISSUER = os.environ.get(
    "OPENDRSAI_OIDC_ISSUER",
    os.environ.get("HAI_OIDC_ISSUER", "https://ai-dev.ihep.ac.cn/api"),
)
_OIDC_CLIENT_ID = os.environ.get(
    "OPENDRSAI_OIDC_CLIENT_ID",
    "opendrsai-tui",
)
_OIDC_SCOPES = os.environ.get(
    "OPENDRSAI_OIDC_SCOPES",
    "openid email profile roles groups hai_api offline_access",
)

# In-flight device code sessions (device_code → dict), process-local
_device_sessions: dict[str, dict] = {}


def _get_oidc_client():
    """Lazily create an OidcClient instance."""
    from drsai.backend.auth.oidc_client import OidcClient
    return OidcClient(
        issuer=_OIDC_ISSUER,
        client_id=_OIDC_CLIENT_ID,
        scopes=_OIDC_SCOPES,
    )


# ── RPC: auth.status ─────────────────────────────────────────────────

@method("auth.status")
def _auth_status(rid, params: dict) -> dict:
    """Check the current authentication state.

    Returns:
        auth_mode: "oidc" | "apikey" | "none"
        authenticated: bool
        user: dict | None (user_id, email, name, roles)
        token_expires_at: str | None (ISO timestamp)
        setup_required: bool — true if neither OIDC session nor API key
    """
    from drsai.backend.auth.token_store import load_auth_session, is_token_expired

    # Check OIDC session first
    session = load_auth_session()
    if session and not is_token_expired(session):
        user = session.get("user", {})
        return _ok(rid, {
            "auth_mode": "oidc",
            "authenticated": True,
            "user": {
                "user_id": user.get("user_id", ""),
                "email": user.get("email", ""),
                "name": user.get("name", ""),
                "roles": user.get("roles", []),
            },
            "issuer": session.get("issuer", ""),
            "token_expired": False,
            "setup_required": False,
        })

    # OIDC session exists but token expired — check if refreshable
    if session and session.get("refresh_token"):
        return _ok(rid, {
            "auth_mode": "oidc",
            "authenticated": False,
            "user": session.get("user", {}),
            "token_expired": True,
            "can_refresh": True,
            "setup_required": False,
        })

    # No OIDC — check if API key exists (fallback mode)
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else {}
    has_api_key = any([
        cfg.get("api_key"),
        cfg.get("anthropic_api_key"),
        cfg.get("openai_api_key"),
        os.environ.get("HEPAI_API_KEY"),
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
    ])

    if has_api_key:
        return _ok(rid, {
            "auth_mode": "apikey",
            "authenticated": True,
            "user": None,
            "token_expired": False,
            "setup_required": False,
        })

    # Neither OIDC nor API key — setup required
    return _ok(rid, {
        "auth_mode": "none",
        "authenticated": False,
        "user": None,
        "token_expired": False,
        "setup_required": True,
    })


# ── RPC: auth.oidc.start ─────────────────────────────────────────────

@method("auth.oidc.start")
def _auth_oidc_start(rid, params: dict) -> dict:
    """Start the Device Code Flow.

    Returns:
        device_code: str (internal, used for polling)
        user_code: str (short code to display)
        verification_uri: str (URL the user visits)
        verification_uri_complete: str (URL with user_code pre-filled)
        expires_in: int (seconds)
        interval: int (polling interval in seconds)
    """
    client = _get_oidc_client()
    try:
        result = client.request_device_code()
    except Exception as exc:
        logger.exception("Device code request failed")
        return _err(rid, 5001, f"OIDC device code request failed: {exc}")

    device_code = result["device_code"]

    # Store session for polling
    _device_sessions[device_code] = {
        "device_code": device_code,
        "client": client,
        "started_at": __import__("time").time(),
        "expires_in": result.get("expires_in", 300),
    }

    # Build the display info — return everything the UI needs
    return _ok(rid, {
        "device_code": device_code,
        "user_code": result.get("user_code", ""),
        "verification_uri": result.get("verification_uri", ""),
        "verification_uri_complete": result.get("verification_uri_complete", ""),
        "expires_in": result.get("expires_in", 300),
        "interval": result.get("interval", 5),
    })


# ── RPC: auth.oidc.poll ──────────────────────────────────────────────

@method("auth.oidc.poll")
def _auth_oidc_poll(rid, params: dict) -> dict:
    """Poll the token endpoint once for a pending device flow.

    Params:
        device_code: str (from auth.oidc.start)

    Returns:
        status: "pending" | "success" | "expired" | "error"
        (on success) user: dict, token_expires_at: str
        (on error) error: str
    """
    from drsai.backend.auth.token_store import save_auth_session, is_token_expired

    device_code = params.get("device_code", "")
    if not device_code:
        return _err(rid, 4001, "device_code is required")

    dsess = _device_sessions.get(device_code)
    if not dsess:
        return _err(rid, 4004, "device session not found (expired or cancelled)")

    client = dsess["client"]
    result = client.poll_device_token(device_code)

    status = result.get("status", "error")

    if status == "pending":
        return _ok(rid, {"status": "pending"})

    if status == "expired":
        _device_sessions.pop(device_code, None)
        return _ok(rid, {"status": "expired"})

    if status == "error":
        _device_sessions.pop(device_code, None)
        return _ok(rid, {"status": "error", "error": result.get("error", "unknown")})

    # status == "success"
    _device_sessions.pop(device_code, None)

    tokens = {
        "access_token": result.get("access_token", ""),
        "refresh_token": result.get("refresh_token", ""),
        "id_token": result.get("id_token", ""),
    }

    # Validate ID token and extract user info
    try:
        user_info = client.validate_id_token(tokens["id_token"])
    except Exception as exc:
        logger.exception("ID token validation failed")
        return _err(rid, 5002, f"ID token validation failed: {exc}")

    # Persist the session (encrypted)
    session = save_auth_session(
        tokens=tokens,
        user_info=user_info,
        issuer=_OIDC_ISSUER,
        client_id=_OIDC_CLIENT_ID,
    )

    # Update cli_config with auth_mode and user_id
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)
    cfg["auth_mode"] = "oidc"
    cfg["user_id"] = user_info.get("user_id", cfg.get("user_id", "anonymous"))
    try:
        cli_config.save_config(cfg)
    except Exception as exc:
        logger.warning("save_config for auth_mode failed: %s", exc)

    # Check if token is already expired (edge case)
    token_expired = is_token_expired(session)

    return _ok(rid, {
        "status": "success",
        "user": {
            "user_id": user_info.get("user_id", ""),
            "email": user_info.get("email", ""),
            "name": user_info.get("name", ""),
            "roles": user_info.get("roles", []),
        },
        "token_expired": token_expired,
    })


# ── RPC: auth.oidc.cancel ────────────────────────────────────────────

@method("auth.oidc.cancel")
def _auth_oidc_cancel(rid, params: dict) -> dict:
    """Cancel an in-flight device code flow.

    Params:
        device_code: str
    """
    device_code = params.get("device_code", "")
    if device_code:
        _device_sessions.pop(device_code, None)
    return _ok(rid, {"cancelled": True})


# ── RPC: auth.session.refresh ───────────────────────────────────────

@method("auth.session.refresh")
def _auth_session_refresh(rid, params: dict) -> dict:
    """Refresh the access_token using the stored refresh_token.

    Returns:
        refreshed: bool
        user: dict | None
        token_expired: bool
    """
    from drsai.backend.auth.token_store import (
        load_auth_session,
        save_auth_session,
        is_token_expired,
    )

    session = load_auth_session()
    if not session:
        return _err(rid, 4004, "no auth session found")

    refresh_token = session.get("refresh_token")
    if not refresh_token:
        return _err(rid, 4003, "no refresh_token available — re-login required")

    client = _get_oidc_client()
    try:
        tokens = client.refresh_access_token(refresh_token)
    except Exception as exc:
        logger.exception("Token refresh failed")
        return _err(rid, 5003, f"Token refresh failed: {exc}")

    # Validate new ID token if present
    user_info = session.get("user", {})
    if tokens.get("id_token"):
        try:
            user_info = client.validate_id_token(tokens["id_token"])
        except Exception:
            logger.warning("ID token validation during refresh failed, using cached user info")

    # Persist the refreshed session
    new_session = save_auth_session(
        tokens=tokens,
        user_info=user_info,
        issuer=_OIDC_ISSUER,
        client_id=_OIDC_CLIENT_ID,
    )

    token_expired = is_token_expired(new_session)

    return _ok(rid, {
        "refreshed": True,
        "user": {
            "user_id": user_info.get("user_id", ""),
            "email": user_info.get("email", ""),
            "name": user_info.get("name", ""),
            "roles": user_info.get("roles", []),
        },
        "token_expired": token_expired,
    })


# ── RPC: auth.logout ─────────────────────────────────────────────────

@method("auth.logout")
def _auth_logout(rid, params: dict) -> dict:
    """Revoke tokens and clear the local auth session.

    Params:
        revoke: bool (default True) — whether to call the revocation endpoint
    """
    from drsai.backend.auth.token_store import load_auth_session, clear_auth_session

    session = load_auth_session()
    revoke = params.get("revoke", True)

    if session and revoke and session.get("refresh_token"):
        client = _get_oidc_client()
        try:
            client.revoke_token(session["refresh_token"])
        except Exception as exc:
            logger.warning("Token revocation failed: %s", exc)

    clear_auth_session()

    # Reset auth_mode in cli_config
    cfg = cli_config.load_config() if cli_config.CLI_CONFIG_PATH.exists() else dict(cli_config.DEFAULT_CONFIG)
    cfg["auth_mode"] = "none"
    try:
        cli_config.save_config(cfg)
    except Exception as exc:
        logger.warning("save_config for logout failed: %s", exc)

    return _ok(rid, {"logged_out": True})
