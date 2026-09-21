"""Agent-backend account & model management routes.

These six endpoints mirror the V1 ``gateway_legacy.py`` routes at lines
4982-5029.  The desktop's ``desktop:get-codex-backend-status`` IPC handler
calls ``client.getCapabilities()`` first, then ``getBackendModels()`` and
``getBackendAccount()`` to check the status of the ``codex`` backend.  Even
when a backend is not registered (e.g. ``codex`` on a V2-only desktop), the
route must exist and return a structured 404/409 rather than a bare 404.

Two session-scoped endpoints from the same V1 block are implemented here as
well (``gateway_legacy.py`` 5059-5082), because the Desktop calls them on the
thread-hydration path: ``shared/main/threadRuntimeSubscription.ts`` syncs the
bound backend's history before every Runtime thread snapshot, and
``shared/main/chat.ts`` reads the binding status before continuing an existing
task.  A Runtime that does not serve them fails hydration with a bare 404 --
exactly what the V2-only gateway did before these routes existed.

Error mapping follows the V1 ``_backend_account_http_error`` helper:

- ``agent_backend_not_found``            → 404
- retryable or codex-specific errors      → 503
- everything else                         → 409
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from drsai.backend.runtime.agent import RuntimeExecutionError

from .. import _state

logger = logging.getLogger(__name__)

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


@api.post(
    "/v1/sessions/{session_id}/agent-backend/history/sync",
    operation_id="syncBackendSessionHistory",
)
async def sync_backend_session_history(
    session_id: str,
    repair: bool = False,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    """Import the bound Agent Backend's own history for *session_id*.

    The Desktop calls this before every thread snapshot, so the route must
    exist on every Runtime.  A backend that does not own its history -- the V2
    ``opendrsai`` and ``remote-worker`` backends -- answers with an idempotent
    empty page, which is what the Desktop expects from a non-import backend.
    A Session imported from a backend that does own its history (``codex``) is
    served by that backend's adapter when the Runtime registers it.
    """
    try:
        return await _state.agent_service().sync_backend_session_history(
            session_id, force_reproject=repair, cursor=cursor, limit=limit,
        )
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc
    except KeyError as exc:
        # Mirrors V1 (``gateway_legacy.py`` 5070): an unknown Session is a
        # client error, not an empty history page.
        raise HTTPException(status_code=404, detail="Session not found") from exc
    except Exception:
        logger.exception("Backend session history sync failed for %s", session_id)
        raise


@api.get(
    "/v1/sessions/{session_id}/agent-backend/binding",
    operation_id="getBackendSessionBinding",
)
async def get_backend_session_binding(session_id: str):
    """Report whether *session_id* is still bound to its Agent Backend.

    The Desktop reads ``state`` to decide whether a task may continue, must
    recover its binding, or needs a new task.  An unknown Session reports
    ``backend-missing`` instead of 404 so the UI can explain the state.
    """
    try:
        return await _state.agent_service().backend_session_binding_status(session_id)
    except RuntimeExecutionError as exc:
        raise _backend_account_http_error(exc) from exc


def router() -> APIRouter:
    return api
