"""Resolve the request user: OIDC first, then HepAI API key."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request

from .native_auth import NativeIdentity, fetch_native_userinfo_email, try_get_native_identity

logger = logging.getLogger(__name__)

_OIDC_AUTH_MODE = "oidc"


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("Authorization") or ""
    if not (auth.startswith("Bearer ") or auth.startswith("bearer ")):
        return None
    token = auth.split(" ", 1)[1].strip()
    return token or None


def _looks_like_jwt(token: str) -> bool:
    return token.count(".") == 2


def _header(request: Request, name: str) -> str:
    return (request.headers.get(name) or "").strip()


def _is_oidc_auth_mode(request: Request) -> bool:
    return _header(request, "X-OpenDrSai-Auth-Mode").lower() == _OIDC_AUTH_MODE


def _normalize_email(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    email = value.strip().lower()
    if not email or "@" not in email or any(ch.isspace() for ch in email):
        return None
    return email


def _bind_user(request: Request, user_id: str, db: Any = None) -> str:
    request.state.user_id = user_id
    if db is not None:
        request.state.skill_role = None
    return user_id


def _oidc_session_user_id(request: Request) -> str | None:
    from ....drsai_adapter.sso.hepai_oidc import get_session_user, session_user_id

    return session_user_id(get_session_user(request))


async def _skill_email_from_native(
    request: Request,
    token: str,
    identity: NativeIdentity,
) -> str:
    """Skills plaza persists account email, never the OIDC subject UUID.

    Email comes from the verified access token or HepAI userinfo. The
    ``X-OpenDrSai-Principal`` header is not an identity source; if it looks
    like an email it must match the token-bound address.
    """
    email = _normalize_email(identity.email)
    if not email:
        email = _normalize_email(
            await fetch_native_userinfo_email(token, identity.issuer, identity.user_id)
        )
    if not email:
        raise HTTPException(
            status_code=401,
            detail="OIDC user is missing a verified email",
        )

    principal = _normalize_email(_header(request, "X-OpenDrSai-Principal"))
    if principal and principal != email:
        raise HTTPException(
            status_code=401,
            detail="OIDC principal does not match token email",
        )
    return email


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

    Native OIDC callers (Desktop) are identified by account email. When
    ``X-OpenDrSai-Auth-Mode`` is ``oidc``, a broken JWT is not treated as an
    API key.

    Returns None when no credential is present. Invalid API keys still raise 401.
    """
    session_uid = _oidc_session_user_id(request)
    if session_uid:
        return _bind_user(request, _normalize_email(session_uid) or session_uid, db)

    token = _extract_bearer(request)
    oidc_mode = _is_oidc_auth_mode(request)

    if oidc_mode and (not token or not _looks_like_jwt(token)):
        raise HTTPException(status_code=401, detail="OIDC access token required")

    if token and _looks_like_jwt(token):
        identity = await try_get_native_identity(f"Bearer {token}")
        if identity is not None:
            return _bind_user(request, await _skill_email_from_native(request, token, identity), db)
        if oidc_mode:
            raise HTTPException(status_code=401, detail="Invalid OIDC access token")
        jwt_uid = _webui_jwt_user_id(token)
        if jwt_uid:
            return _bind_user(request, jwt_uid, db)

    if not token:
        return None

    return _bind_user(request, await _verify_api_key(token), db)
