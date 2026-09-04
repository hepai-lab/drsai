"""Session auth: verify access JWT and refresh via httpOnly cookie."""

from __future__ import annotations

from datetime import timedelta
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse

from .....drsai_adapter.sso.jwt import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_jwt_token,
    decode_jwt_token,
    oauth2_scheme,
)
from .....drsai_adapter.sso.hepai_oidc import (
    clear_oidc_session,
    get_session_user,
    revoke_server_tokens,
)
from ..auth_cookies import REFRESH_COOKIE_NAME, clear_refresh_cookie, set_refresh_cookie
from ..auth_source import get_cooper_info, get_display_name
from ..deps import get_db

router = APIRouter()


@router.get("/me")
async def auth_me(
    request: Request,
    db=Depends(get_db),
    token: str | None = Depends(oauth2_scheme),
) -> Dict:
    """Return the OIDC session user, or the JWT-authenticated WebUI user."""
    session_user = get_session_user(request)
    if session_user:
        user_id = session_user.get("email") or session_user.get("sub")
        return {
            **session_user,
            "status": True,
            "data": {
                "user_id": user_id,
                "cooper_info": get_cooper_info(db, str(user_id or "")),
                "display_name": session_user.get("name") or "",
            },
        }

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token_data = decode_jwt_token(token)
    user_id = token_data.user_id
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    cooper_info = get_cooper_info(db, user_id)
    display_name = get_display_name(db, user_id)
    return {
        "status": True,
        "data": {
            "user_id": user_id,
            "cooper_info": cooper_info,
            "display_name": display_name,
        },
    }


@router.post("/refresh")
async def refresh_access_token(request: Request):
    """Issue a new access token from the httpOnly refresh-token cookie (SSO login)."""
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    token_data = decode_jwt_token(refresh_token)
    user_id = token_data.user_id
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    access_token = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    rotated_refresh = create_jwt_token(
        data={"sub": user_id},
        expires_delta=timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )

    response = JSONResponse(
        content={
            "status": True,
            "data": {
                "user_id": user_id,
                "access_token": access_token.access_token,
            },
        }
    )
    set_refresh_cookie(response, rotated_refresh.access_token)
    return response


@router.post("/logout")
async def logout(request: Request):
    """Clear OIDC session and the httpOnly refresh-token cookie."""
    sid = clear_oidc_session(request)
    if sid:
        await revoke_server_tokens(sid)
    response = JSONResponse(content={"status": True, "data": {}})
    clear_refresh_cookie(response)
    return response
