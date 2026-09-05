"""HepAI OIDC routes: login start + GET /auth/oidc/callback.

Login entry is also served at /umt/oidc-login so reverse proxies that already
forward /umt (and /api) reach FastAPI without extra Caddy rules. The HAI
redirect_uri stays /auth/oidc/callback.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from loguru import logger

from .hepai_oidc import (
    OidcError,
    SESSION_TOKEN_SID_KEY,
    SESSION_USER_KEY,
    authorize_extra_params,
    callback_redirect_uri,
    clear_oidc_session,
    get_oauth,
    idp_logout_html,
    idp_logout_url,
    load_oidc_config,
    oidc_configured,
    pop_server_tokens,
    post_logout_redirect_url,
    resolve_upstream_login_url,
    revoke_server_tokens,
    save_server_tokens,
    session_user_id,
    session_user_payload,
)
from drsai_ui.ui_backend.backend.web.deps import get_db
from drsai_ui.ui_backend.backend.web.auth_cookies import clear_refresh_cookie
from drsai_ui.ui_backend.backend.web.auth_source import (
    record_auth_source,
    record_display_name,
)
from drsai_ui.ui_backend.backend.datamodel.db import AgentModeSettings, UserAgents
from drsai_ui.agent_factory.agent_mode_cofigs import get_default_agent_mode_config

router = APIRouter()
logger = logger.bind(name="HepAI-OIDC")


@router.get("/auth/login")
@router.get("/umt/oidc-login")
async def login(request: Request) -> RedirectResponse:
    if not oidc_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="HepAI OIDC is not configured. Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET.",
        )
    try:
        config = load_oidc_config()
        redirect_uri = callback_redirect_uri(request, config.allowed_redirect_uris)
        client = get_oauth().hai
        extras = authorize_extra_params()
        rv = await client.create_authorization_url(redirect_uri, **extras)
        await client.save_authorize_data(request, redirect_uri=redirect_uri, **rv)
        dest = await resolve_upstream_login_url(rv["url"])
        logger.info(
            "OIDC login → HAI upstream IHEP; redirect_uri={} dest={}",
            redirect_uri,
            dest,
        )
        return RedirectResponse(url=dest, status_code=status.HTTP_302_FOUND)
    except OidcError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/auth/oidc/logout")
@router.get("/umt/oidc-logout")
async def oidc_logout(request: Request) -> HTMLResponse:
    """Clear the local OIDC session, then send the browser to IHEP logout.

    Return HTML+JS (not 302). Gatsby develop's history fallback can swallow a
    302 to /auth/oidc/logout and never open newlogin.ihep.ac.cn.
    """
    sid = clear_oidc_session(request)
    if sid:
        await revoke_server_tokens(sid)
    dest = idp_logout_url(post_logout_redirect_url(request))
    logger.info("OIDC logout → IHEP SSO logout; return {}", dest)
    response = HTMLResponse(content=idp_logout_html(dest), headers={"Cache-Control": "no-store"})
    clear_refresh_cookie(response)
    return response


@router.get("/auth/oidc/callback", name="oidc_callback")
async def oidc_callback(request: Request, db=Depends(get_db)) -> RedirectResponse:
    if not oidc_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="HepAI OIDC is not configured.",
        )
    error = request.query_params.get("error")
    if error:
        description = request.query_params.get("error_description") or error
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=description)

    try:
        config = load_oidc_config()
        client = get_oauth().hai
        token = await client.authorize_access_token(request)
        user = token.get("userinfo")
        if not user:
            response = await client.get(config.userinfo_url, token=token)
            response.raise_for_status()
            user = response.json()
        if not isinstance(user, dict):
            raise OidcError("OIDC userinfo is invalid")
        session_user = session_user_payload(config.issuer, user)
    except OidcError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("OIDC callback failed")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="OIDC token exchange failed",
        ) from exc

    user_id = session_user_id(session_user)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC user is missing")

    previous_sid = request.session.get(SESSION_TOKEN_SID_KEY)
    if isinstance(previous_sid, str) and previous_sid:
        pop_server_tokens(previous_sid)

    sid = secrets.token_urlsafe(32)
    request.session[SESSION_USER_KEY] = session_user
    request.session[SESSION_TOKEN_SID_KEY] = sid
    save_server_tokens(sid, token)

    logger.info("OIDC authed user: {} ({})", user_id, session_user.get("sub"))
    record_auth_source(db, user_id, "sso", user_source="hepai_oidc")
    record_display_name(db, user_id, str(session_user.get("name") or user_id))

    response_agent = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not response_agent.status or not response_agent.data:
        agents_list = get_default_agent_mode_config(user_id)
        db.upsert(AgentModeSettings(user_id=user_id, agents_mode=agents_list))
        db.upsert(UserAgents(user_id=user_id, agents=agents_list))

    return RedirectResponse(url="/?menu=current_session&view=chat")
