"""HttpOnly refresh-token cookie helpers (SSO production sessions)."""

from __future__ import annotations

import os

from ....drsai_adapter.sso.jwt import REFRESH_TOKEN_EXPIRE_DAYS

REFRESH_COOKIE_NAME = "refresh-token"
SECONDS_OF_ONE_DAY = 24 * 60 * 60


def _cookie_secure() -> bool:
    return os.getenv("SERVICE_MODE") == "PROD"


def refresh_cookie_max_age() -> int:
    return REFRESH_TOKEN_EXPIRE_DAYS * SECONDS_OF_ONE_DAY


def set_refresh_cookie(response, token: str) -> None:
    # iframe 嵌入（CSNS 等第三方站点）需要 SameSite=None; Secure，否则 refresh cookie 写不进去
    secure = _cookie_secure()
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        path="/",
        samesite="none" if secure else "lax",
        secure=secure,
        max_age=refresh_cookie_max_age(),
    )


def clear_refresh_cookie(response) -> None:
    secure = _cookie_secure()
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/",
        secure=secure,
        samesite="none" if secure else "lax",
    )
