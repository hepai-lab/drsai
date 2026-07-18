"""Desktop device-code authentication bridge.

The IHEP SSO callback is fixed to the web host, so Windows desktop clients
cannot receive the OAuth redirect directly. This module stores a short-lived
server-side ticket that the desktop app polls after browser SSO returns to the
web callback.
"""

from __future__ import annotations

import secrets
import os
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, select

from .....drsai_adapter.sso.jwt import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_jwt_token,
    decode_jwt_token,
)
from ...database import DatabaseManager
from ...datamodel.db import DesktopAuthTicket
from ..deps import get_db

router = APIRouter()

DESKTOP_AUTH_TTL_SECONDS = 10 * 60
DESKTOP_AUTH_POLL_INTERVAL_SECONDS = 2
STATE_PREFIX = "desktop:"
WECHAT_STATE_PREFIX = "wechat:"
VALID_TICKET_STATES = {"pending", "authorized", "expired", "cancelled"}
WECHAT_QRCONNECT_URL = "https://open.weixin.qq.com/connect/qrconnect"
WECHAT_ACCESS_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"


class DesktopRefreshRequest(BaseModel):
    refresh_token: str


@router.post("/start")
async def start_desktop_auth(request: Request, db: DatabaseManager = Depends(get_db)) -> dict:
    _ensure_ihep_desktop_login_available()
    ticket = _create_ticket(db, "ihep")
    login_url = str(request.url_for("desktop_auth_login")) + f"?device_code={ticket.device_code}"
    return {
        "status": True,
        "data": {
            "device_code": ticket.device_code,
            "login_url": login_url,
            "expires_at": int(ticket.expires_at.timestamp()),
            "interval": DESKTOP_AUTH_POLL_INTERVAL_SECONDS,
        },
    }


@router.post("/wechat/start")
async def start_wechat_desktop_auth(request: Request, db: DatabaseManager = Depends(get_db)) -> dict:
    app_id, _app_secret = _get_wechat_config()
    ticket = _create_ticket(db, "wechat")
    redirect_uri = os.getenv("WECHAT_LOGIN_REDIRECT_URI") or str(
        request.url_for("wechat_desktop_auth_callback")
    )
    state = f"{WECHAT_STATE_PREFIX}{ticket.device_code}:{ticket.state_nonce}"
    params = {
        "appid": app_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": os.getenv("WECHAT_LOGIN_SCOPE", "snsapi_login"),
        "state": state,
    }
    login_url = f"{WECHAT_QRCONNECT_URL}?{urlencode(params)}#wechat_redirect"
    return {
        "status": True,
        "data": {
            "device_code": ticket.device_code,
            "login_url": login_url,
            "expires_at": int(ticket.expires_at.timestamp()),
            "interval": DESKTOP_AUTH_POLL_INTERVAL_SECONDS,
        },
    }


@router.get("/poll/{device_code}")
async def poll_desktop_auth(device_code: str, db: DatabaseManager = Depends(get_db)) -> dict:
    ticket = _get_ticket(db, device_code)
    if _is_expired(ticket):
        ticket.status = "expired"
        _save_ticket(db, ticket)
        return {"status": True, "data": {"state": "expired"}}
    if ticket.status != "authorized":
        state = ticket.status if ticket.status in VALID_TICKET_STATES else "expired"
        return {"status": True, "data": {"state": state}}
    if ticket.claimed:
        return {"status": True, "data": {"state": "expired"}}

    ticket.claimed = True
    _save_ticket(db, ticket)
    return {
        "status": True,
        "data": {
            "state": "authorized",
            "user_id": ticket.user_id,
            "user_name": ticket.user_name,
            "avatar_url": ticket.avatar_url,
            "auth_provider": ticket.auth_provider,
            "access_token": ticket.access_token,
            "refresh_token": ticket.refresh_token,
        },
    }


@router.post("/cancel/{device_code}")
async def cancel_desktop_auth(device_code: str, db: DatabaseManager = Depends(get_db)) -> dict:
    ticket = _find_ticket(db, device_code)
    if ticket and ticket.status == "pending":
        ticket.status = "cancelled"
        _save_ticket(db, ticket)
    return {"status": True}


@router.post("/refresh")
async def refresh_desktop_auth(payload: DesktopRefreshRequest) -> dict:
    token_data = decode_jwt_token(payload.refresh_token)
    user_id = token_data.user_id
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    access_token, refresh_token = _issue_tokens(user_id)
    return {
        "status": True,
        "data": {
            "user_id": user_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
        },
    }


@router.get("/login", name="desktop_auth_login")
async def desktop_auth_login(device_code: str, db: DatabaseManager = Depends(get_db)):
    _ensure_ihep_desktop_login_available()
    ticket = _get_ticket(db, device_code)
    if _is_expired(ticket):
        ticket.status = "expired"
        _save_ticket(db, ticket)
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Desktop login expired")
    return RedirectResponse(url=f"/umt/login?desktop_device_code={device_code}")


@router.get("/wechat/callback", name="wechat_desktop_auth_callback")
async def wechat_desktop_auth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: DatabaseManager = Depends(get_db),
):
    if not code:
        error = request.query_params.get("errmsg") or request.query_params.get("error_description")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error or "Missing WeChat code")

    ticket = _get_ticket_from_wechat_state(state, db)
    if _is_expired(ticket):
        ticket.status = "expired"
        _save_ticket(db, ticket)
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="WeChat desktop login expired")

    app_id, app_secret = _get_wechat_config()
    async with httpx.AsyncClient(timeout=10) as client:
        token_response = await client.get(
            WECHAT_ACCESS_TOKEN_URL,
            params={
                "appid": app_id,
                "secret": app_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        token_response.raise_for_status()
        token_payload = token_response.json()
        _raise_for_wechat_error(token_payload, "WeChat token exchange failed")
        wechat_access_token = token_payload.get("access_token")
        openid = token_payload.get("openid")
        if not wechat_access_token or not openid:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="WeChat token response is incomplete")

        user_response = await client.get(
            WECHAT_USERINFO_URL,
            params={
                "access_token": wechat_access_token,
                "openid": openid,
                "lang": "zh_CN",
            },
        )
        user_response.raise_for_status()
        user_payload = user_response.json()
        _raise_for_wechat_error(user_payload, "WeChat user profile failed")

    unionid = user_payload.get("unionid")
    user_id = f"wechat:{unionid or openid}"
    user_name = user_payload.get("nickname") or "WeChat User"
    avatar_url = user_payload.get("headimgurl")
    _authorize_ticket(db, ticket, user_id, user_name=user_name, avatar_url=avatar_url)
    _ensure_default_agents(db, user_id)
    return RedirectResponse(url=str(request.url_for("desktop_auth_success")))


@router.get("/success", response_class=HTMLResponse, name="desktop_auth_success")
async def desktop_auth_success():
    return """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenDrSai Desktop signed in</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f1fb;
        --ink: #29212f;
        --muted: #74677d;
        --accent: #8e6cc3;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: var(--bg);
        color: var(--ink);
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 48px));
        text-align: center;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        font-weight: 650;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: var(--muted);
      }
      .mark {
        width: 48px;
        height: 48px;
        margin: 0 auto 22px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: #fff;
        color: var(--accent);
        box-shadow: 0 18px 45px rgba(76, 49, 107, 0.12);
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">OK</div>
      <h1>Signed in</h1>
      <p>You can return to OpenDrSai Desktop.</p>
    </main>
  </body>
</html>"""


def make_desktop_sso_state(device_code: str, db: DatabaseManager) -> str:
    ticket = _get_ticket(db, device_code)
    if _is_expired(ticket) or ticket.status != "pending":
        ticket.status = "expired"
        _save_ticket(db, ticket)
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Desktop login expired")
    return f"{STATE_PREFIX}{device_code}:{ticket.state_nonce}"


def authorize_desktop_state(state: str | None, user_id: str, db: DatabaseManager) -> bool:
    if not state or not state.startswith(STATE_PREFIX):
        return False
    body = state[len(STATE_PREFIX) :]
    device_code, sep, nonce = body.partition(":")
    if not sep:
        return False

    ticket = _find_ticket(db, device_code)
    if not ticket or ticket.state_nonce != nonce or ticket.status != "pending":
        return False
    if _is_expired(ticket):
        ticket.status = "expired"
        _save_ticket(db, ticket)
        return False

    access_token, refresh_token = _issue_tokens(user_id)
    _authorize_ticket(db, ticket, user_id, access_token=access_token, refresh_token=refresh_token)
    return True


def _create_ticket(db: DatabaseManager, auth_provider: str) -> DesktopAuthTicket:
    _cleanup_expired(db)
    expires_at = _utc_now() + timedelta(seconds=DESKTOP_AUTH_TTL_SECONDS)
    ticket = DesktopAuthTicket(
        device_code=secrets.token_urlsafe(32),
        state_nonce=secrets.token_urlsafe(24),
        status="pending",
        auth_provider=auth_provider,
        expires_at=expires_at,
    )
    _save_ticket(db, ticket)
    return ticket


def _authorize_ticket(
    db: DatabaseManager,
    ticket: DesktopAuthTicket,
    user_id: str,
    *,
    user_name: str | None = None,
    avatar_url: str | None = None,
    access_token: str | None = None,
    refresh_token: str | None = None,
) -> None:
    issued_access_token, issued_refresh_token = (
        (access_token, refresh_token)
        if access_token and refresh_token
        else _issue_tokens(user_id)
    )
    ticket.user_id = user_id
    ticket.user_name = user_name or user_id
    ticket.avatar_url = avatar_url
    ticket.access_token = issued_access_token
    ticket.refresh_token = issued_refresh_token
    ticket.status = "authorized"
    _save_ticket(db, ticket)


def _get_ticket_from_wechat_state(state: str | None, db: DatabaseManager) -> DesktopAuthTicket:
    if not state or not state.startswith(WECHAT_STATE_PREFIX):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid WeChat state")
    body = state[len(WECHAT_STATE_PREFIX) :]
    device_code, sep, nonce = body.partition(":")
    if not sep:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid WeChat state")
    ticket = _get_ticket(db, device_code)
    if ticket.state_nonce != nonce or ticket.status != "pending" or ticket.auth_provider != "wechat":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid WeChat login ticket")
    return ticket


def _get_ticket(db: DatabaseManager, device_code: str) -> DesktopAuthTicket:
    ticket = _find_ticket(db, device_code)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Desktop login not found")
    return ticket


def _find_ticket(db: DatabaseManager, device_code: str) -> DesktopAuthTicket | None:
    response = db.get(DesktopAuthTicket, filters={"device_code": device_code})
    if not response.status or not response.data:
        return None
    return response.data[0]


def _save_ticket(db: DatabaseManager, ticket: DesktopAuthTicket) -> None:
    response = db.upsert(ticket)
    if not response.status:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not save desktop login")


def _is_expired(ticket: DesktopAuthTicket) -> bool:
    expires_at = ticket.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    return datetime.now(UTC) >= expires_at


def _cleanup_expired(db: DatabaseManager) -> None:
    now = _utc_now()
    with Session(db.engine) as session:
        rows = session.exec(
            select(DesktopAuthTicket).where(
                or_(
                    DesktopAuthTicket.expires_at <= now,
                    (DesktopAuthTicket.status == "authorized") & (DesktopAuthTicket.claimed == True),  # noqa: E712
                )
            )
        ).all()
        for row in rows:
            session.delete(row)
        session.commit()


def _issue_tokens(user_id: str) -> tuple[str, str]:
    access_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    return access_token.access_token, refresh_token.access_token


def _get_wechat_config() -> tuple[str, str]:
    app_id = os.getenv("WECHAT_LOGIN_APP_ID") or os.getenv("WECHAT_OPEN_APP_ID")
    app_secret = os.getenv("WECHAT_LOGIN_APP_SECRET") or os.getenv("WECHAT_OPEN_APP_SECRET")
    if not app_id or not app_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WeChat login is not configured. Set WECHAT_LOGIN_APP_ID and WECHAT_LOGIN_APP_SECRET.",
        )
    return app_id, app_secret


def _ensure_ihep_desktop_login_available() -> None:
    service_mode = os.getenv("SERVICE_MODE")
    if service_mode != "PROD":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "IHEP SSO is only mounted when SERVICE_MODE=PROD. "
                f"Current SERVICE_MODE={service_mode or '<unset>'}. "
                "Use WeChat login/API key in development, or set SERVICE_MODE=PROD and configure IHEP SSO."
            ),
        )

    missing = [
        name
        for name in ("IHEP_SSO_APP_KEY", "IHEP_SSO_APP_SECRET", "IHEP_SSO_REDIRECT_URI")
        if not os.getenv(name)
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"IHEP SSO is not configured. Missing: {', '.join(missing)}.",
        )


def _raise_for_wechat_error(payload: dict, fallback: str) -> None:
    errcode = payload.get("errcode")
    if errcode in (None, 0, "0"):
        return
    errmsg = payload.get("errmsg") or fallback
    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"{fallback}: {errcode} {errmsg}",
    )


def _ensure_default_agents(db: DatabaseManager, user_id: str) -> None:
    from drsai_ui.agent_factory.agent_mode_cofigs import get_default_agent_mode_config
    from drsai_ui.ui_backend.backend.datamodel.db import AgentModeSettings, UserAgents

    response_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if response_agent.status and response_agent.data:
        return
    agents_list = get_default_agent_mode_config(user_id)
    db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
    db.upsert(UserAgents(user_id=user_id, agents=agents_list))


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
