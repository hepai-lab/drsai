"""Per-request identity for the Desktop gateway.

Feature 1 (OIDC login) needs **zero routes**.  The login flow lives entirely in
the Electron main process (``apps/desktop/shared/main/auth.ts``), which stores
the HepAI token in the OS credential store.  The gateway's whole part in it is
this middleware, which checks four headers on every request::

    x-opendrsai-gateway-token   proves the caller is the paired local main process
                                (issued by Desktop into ``$DRSAI_HOME/runtime/
                                instance-token`` -- note DRSAI_HOME, not
                                DRSAI_DESKTOP_GATEWAY_HOME: it is a pairing handoff, not
                                Runtime state, and both surfaces honour one token)
    x-opendrsai-auth-mode       "oidc" or "offline"
    authorization               Bearer <hepai access token>
    x-opendrsai-principal       the subject the caller claims to be

The bearer token is verified (signature, issuer, audience, scope, expiry) and
cross-checked against ``x-opendrsai-principal``, so a caller cannot present a
valid token for one account while claiming another.  The verified context is
installed into a task-local scope for the duration of the request, which is how
model adapters deep in the Agent obtain HepAI credentials without any of them
taking an auth argument.

Offline mode exists for tests and for a desktop that has not signed in: there is
no HepAI identity, model calls fall back to static provider credentials, and the
user key is a local profile name rather than an OIDC subject.
"""

from __future__ import annotations

import re
import uuid
from contextlib import nullcontext

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from drsai.platform_auth import (
    PlatformAuthContext,
    context_from_bearer,
    get_platform_auth,
    platform_auth_scope,
    verify_gateway_instance,
)

_CORRELATION = re.compile(r"[A-Za-z0-9._:-]{1,128}")
DEFAULT_OFFLINE_USER_ID = "local"

# The handshake and health probe are the only things a caller may reach before
# proving itself: the desktop has to be able to ask "which Runtime are you, and
# are you alive?" before it has a paired token.  ``/v1/capabilities`` is part of
# the same handshake: ``LocalRuntimeClient.connect()`` calls it to discover
# protocol version and feature flags before any authenticated request.
PUBLIC_PATHS = frozenset({"/v1/runtime", "/v1/capabilities", "/health"})


def install(app) -> None:
    """Attach the single middleware to ``app``."""

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        supplied = request.headers.get("x-correlation-id", "")
        correlation_id = supplied if _CORRELATION.fullmatch(supplied) else uuid.uuid4().hex
        request.state.correlation_id = correlation_id
        request.state.auth_context = None

        if request.url.path in PUBLIC_PATHS:
            response = await call_next(request)
            response.headers["X-Correlation-ID"] = correlation_id
            return response

        if not verify_gateway_instance(request.headers.get("x-opendrsai-gateway-token")):
            return _error(401, "gateway_unauthorized", "Gateway caller is not authorized.", correlation_id)

        auth_context = None
        if request.headers.get("x-opendrsai-auth-mode") == "oidc":
            try:
                auth_context = context_from_bearer(
                    request.headers.get("authorization"),
                    request.headers.get("x-opendrsai-principal", ""),
                )
            except ValueError as exc:
                code = str(exc)
                return _error(
                    403 if code == "subject_mismatch" else 401,
                    code,
                    "The HepAI authentication context is not valid.",
                    correlation_id,
                    retryable=code == "token_expired",
                )

        request.state.auth_context = auth_context
        with platform_auth_scope(auth_context) if auth_context else nullcontext():
            response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response


def _error(status: int, code: str, message: str, correlation_id: str, *, retryable: bool = False):
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
                "correlation_id": correlation_id,
            }
        },
        headers={"X-Correlation-ID": correlation_id},
    )


def auth_context(request: Request) -> PlatformAuthContext | None:
    """Return the verified HepAI context for this request, if signed in."""
    return getattr(request.state, "auth_context", None)


def correlation_id(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None) or None


def effective_user_id(supplied: str | None = None) -> str:
    """Resolve the user key that owns history, config and storage.

    Signed-in requests are keyed exclusively by the verified OIDC subject, never
    by a value the desktop supplied.  This is what makes feature 1 ("登录身份决定
    历史归属") true rather than advisory: a renderer cannot ask for another
    account's sessions by changing a field in the request body.
    """
    auth = get_platform_auth()
    if auth is not None:
        if supplied and supplied != auth.subject:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "subject_mismatch",
                    "message": "The requested user does not match the authenticated HepAI account.",
                    "retryable": False,
                },
            )
        return auth.subject
    return supplied or DEFAULT_OFFLINE_USER_ID
