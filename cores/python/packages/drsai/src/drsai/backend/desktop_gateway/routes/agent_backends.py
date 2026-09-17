"""Agent-backend account & model management routes.

These six endpoints mirror the V1 ``gateway_legacy.py`` routes at lines
4982-5029.  The desktop's ``desktop:get-codex-backend-status`` IPC handler
calls ``client.getCapabilities()`` first, then ``getBackendModels()`` and
``getBackendAccount()`` to check the status of the ``codex`` backend.  Even
when a backend is not registered (e.g. ``codex`` on a V2-only desktop), the
route must exist and return a structured 404/409 rather than a bare 404.

Error mapping follows the V1 ``_backend_account_http_error`` helper:

- ``agent_backend_not_found``            → 404
- retryable or codex-specific errors      → 503
- everything else                         → 409
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from drsai.backend.runtime.agent import RuntimeExecutionError

from .. import _state

api = APIRouter(tags=["agent-backends"])

# ---------------------------------------------------------------------------
# Request models (mirror V1 gateway_legacy.py lines 4159-4164)
# ---------------------------------------------------------------------------

class BackendAccountLoginRequest(BaseModel):
    type: str = Field(default="chatgpt", pattern=r"^(chatgpt|chatgptDeviceCode)$")


class BackendAccountLoginCancelRequest(BaseModel):
    login_id: str = Field(min_length=1, max_length=256)


# ---------------------------------------------------------------------------
# Error helper (mirror V1 _backend_account_http_error, gateway_legacy.py:4975)
# ---------------------------------------------------------------------------

def _backend_account_http_error(exc: RuntimeExecutionError) -> HTTPException:
    """Map a RuntimeExecutionError to an HTTP status code.

    - ``agent_backend_not_found``  → 404
    - retryable or known-codex failures → 503
    - everything else               → 409
    """
    status = (
        404 if exc.code == "agent_backend_not_found"
        else 503 if exc.retryable or exc.code in {
            "codex_backend_unavailable",
            "codex_app_server_start_failed",
            "codex_connection_eof",
        }
        else 409
    )
    return HTTPException(status_code=status, detail=exc.as_dict())


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@api.get("/v1/agent-backends/{backend_id}/account", operation_id="getBackendAccount")
async def get_backend_account(backend_id: str, refresh: bool = False):
    """Return the account status for *backend_id*."""
    try:
        return await _state.agent_service().backend_account_status(backend_id, refresh=refresh)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@api.post("/v1/agent-backends/{backend_id}/account/login", operation_id="startBackendLogin")
async def start_backend_login(backend_id: str, request: BackendAccountLoginRequest):
    """Start an interactive account login flow for *backend_id*."""
    try:
        return await _state.agent_service().backend_account_login_start(backend_id, request.type)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@api.post(
    "/v1/agent-backends/{backend_id}/account/login/cancel",
    operation_id="cancelBackendLogin",
)
async def cancel_backend_login(backend_id: str, request: BackendAccountLoginCancelRequest):
    """Cancel an in-flight login flow for *backend_id*."""
    try:
        await _state.agent_service().backend_account_login_cancel(backend_id, request.login_id)
        return {"cancelled": True}
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@api.post("/v1/agent-backends/{backend_id}/account/logout", operation_id="logoutBackend")
async def logout_backend(backend_id: str):
    """Log out of the account associated with *backend_id*."""
    try:
        await _state.agent_service().backend_account_logout(backend_id)
        return {"logged_out": True}
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@api.get("/v1/agent-backends/{backend_id}/models", operation_id="getBackendModels")
async def get_backend_models(backend_id: str, refresh: bool = False):
    """Return the model catalog for *backend_id*."""
    try:
        return await _state.agent_service().backend_model_catalog(backend_id, refresh=refresh)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


@api.post("/v1/agent-backends/{backend_id}/restart", operation_id="restartBackend")
async def restart_backend(backend_id: str):
    """Restart the agent backend identified by *backend_id*."""
    try:
        return await _state.agent_service().restart_backend(backend_id)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


def router() -> APIRouter:
    return api
