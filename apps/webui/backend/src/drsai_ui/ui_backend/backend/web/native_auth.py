"""OIDC authentication used by native OpenDrSai clients."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

from drsai_ui.platform_config import get_active_platform

OIDC_AUDIENCE = os.getenv("OPENDRSAI_NATIVE_OIDC_AUDIENCE", "hai-api")
OIDC_CACHE_TTL_SECONDS = 15 * 60


@dataclass(frozen=True)
class NativeIdentity:
    user_id: str
    issuer: str


_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}


async def get_native_identity(
    authorization: str | None = Header(default=None),
) -> NativeIdentity:
    token = _bearer_token(authorization)
    unverified = _unverified_claims(token)
    issuer = unverified.get("iss")
    if not isinstance(issuer, str) or issuer not in _allowed_issuers():
        raise _unauthorized("unsupported_issuer")

    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid:
        raise _unauthorized("invalid_token")
    jwks = await _get_jwks(issuer)
    key = next(
        (candidate for candidate in jwks.get("keys", []) if candidate.get("kid") == kid),
        None,
    )
    if not key:
        _jwks_cache.pop(issuer, None)
        jwks = await _get_jwks(issuer)
        key = next(
            (candidate for candidate in jwks.get("keys", []) if candidate.get("kid") == kid),
            None,
        )
    if not key:
        raise _unauthorized("signing_key_not_found")

    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=OIDC_AUDIENCE,
            issuer=issuer,
            options={"require_exp": True, "require_sub": True},
        )
    except JWTError as exc:
        raise _unauthorized("invalid_token") from exc

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise _unauthorized("invalid_token")
    return NativeIdentity(user_id=subject, issuer=issuer)


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized("missing_token")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise _unauthorized("missing_token")
    return token


def _unverified_claims(token: str) -> dict[str, Any]:
    try:
        claims = jwt.get_unverified_claims(token)
    except JWTError as exc:
        raise _unauthorized("invalid_token") from exc
    if not isinstance(claims, dict):
        raise _unauthorized("invalid_token")
    return claims


def _allowed_issuers() -> set[str]:
    configured = os.getenv("OPENDRSAI_NATIVE_OIDC_ISSUERS", "")
    if not configured.strip():
        return {get_active_platform().oidc_issuer}
    return {item.strip().rstrip("/") for item in configured.split(",") if item.strip()}


async def _get_jwks(issuer: str) -> dict[str, Any]:
    cached = _jwks_cache.get(issuer)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    timeout = float(os.getenv("OPENDRSAI_NATIVE_OIDC_TIMEOUT", "8"))
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        discovery_response = await client.get(f"{issuer}/.well-known/openid-configuration")
        discovery_response.raise_for_status()
        discovery = discovery_response.json()
        jwks_uri = discovery.get("jwks_uri")
        if not isinstance(jwks_uri, str) or not jwks_uri.startswith(f"{issuer}/"):
            raise _unauthorized("invalid_discovery")
        jwks_response = await client.get(jwks_uri)
        jwks_response.raise_for_status()
        jwks = jwks_response.json()
    if not isinstance(jwks, dict) or not isinstance(jwks.get("keys"), list):
        raise _unauthorized("invalid_jwks")
    _jwks_cache[issuer] = (time.monotonic() + OIDC_CACHE_TTL_SECONDS, jwks)
    return jwks


def _unauthorized(code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": code, "message": "The HepAI authentication context is not valid."},
        headers={"WWW-Authenticate": "Bearer"},
    )
