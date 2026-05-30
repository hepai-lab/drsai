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
    get_current_user_id,
)
from ..auth_cookies import REFRESH_COOKIE_NAME, set_refresh_cookie

router = APIRouter()


@router.get("/me")
async def auth_me(user_id: str = Depends(get_current_user_id)) -> Dict:
    """Verify Bearer access token and return the authenticated user id."""
    return {
        "status": True,
        "data": {
            "user_id": user_id,
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
