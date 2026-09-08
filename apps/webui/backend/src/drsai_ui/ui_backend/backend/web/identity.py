"""Resolve the request user: OIDC first, then HepAI API key."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

from .native_auth import NativeIdentity, try_get_native_identity

logger = logging.getLogger(__name__)


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("Authorization") or ""
    if not (auth.startswith("Bearer ") or auth.startswith("bearer ")):
        return None
    token = auth.split(" ", 1)[1].strip()
    return token or None


def _looks_like_jwt(token: str) -> bool:
    return token.count(".") == 2


def _bind_user(request: Request, user_id: str, db: Any = None) -> str:
    request.state.user_id = user_id
    if db is not None:
        request.state.skill_role = None
    return user_id


def _oidc_session_user_id(request: Request) -> str | None:
    from ....drsai_adapter.sso.hepai_oidc import get_session_user, session_user_id

    return session_user_id(get_session_user(request))


def _native_skill_user_id(identity: NativeIdentity) -> str:
    if identity.email:
        return identity.email
    return identity.user_id


def _webui_jwt_user_id(token: str) -> str | None:
    from ....drsai_adapter.sso.jwt import decode_jwt_token

    try:
        data = decode_jwt_token(token)
    except HTTPException:
        return None
    except Exception:
        return None
    return data.user_id or None


async def _verify_api_key(api_key: str) -> str:
    verify_url = os.getenv("DRSAI_UI_API_KEY_VERIFY_URL", "http://localhost:42551/apiv2/user")
    admin_api_key = os.getenv("HEPAI_APP_ADMIN_API_KEY", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{verify_url}/get_user_info_by_key",
                params={"api_key": api_key},
                headers={"Authorization": f"Bearer {admin_api_key}"} if admin_api_key else {},
            )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid API key")

        body = resp.json()
        user_id = None
        if isinstance(body, dict):
            user_id = body.get("email") or body.get("user_id") or body.get("userId")
        if not user_id:
            raise HTTPException(status_code=401, detail="Cannot resolve user from API key")
        return str(user_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("API key verification failed: %s", exc)
        raise HTTPException(status_code=502, detail="API key verification service unavailable") from exc


async def resolve_request_user(
    request: Request,
    db: Any = None,
) -> str | None:
    """Resolve user_id: OIDC session / OIDC access token / WebUI JWT, then API key.

    Returns None when no credential is present. Invalid API keys still raise 401.
    """
    session_uid = _oidc_session_user_id(request)
    if session_uid:
        return _bind_user(request, session_uid, db)

    token = _extract_bearer(request)
    if token and _looks_like_jwt(token):
        identity = await try_get_native_identity(f"Bearer {token}")
        if identity is not None:
            return _bind_user(request, _native_skill_user_id(identity), db)
        jwt_uid = _webui_jwt_user_id(token)
        if jwt_uid:
            return _bind_user(request, jwt_uid, db)

    if not token:
        return None

    return _bind_user(request, await _verify_api_key(token), db)
