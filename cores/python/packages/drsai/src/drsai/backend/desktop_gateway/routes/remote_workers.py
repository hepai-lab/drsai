"""Remote worker routes: discover remote HepAI/DDF agents and bind one to a Run.

These routes are the server-side home of "official platform agents". The
Desktop does not talk to the DDF worker directly: it asks this gateway which
remote workers exist, then starts a Run against the ``remote-worker`` Agent
Backend. The gateway proxies the worker through ``HepAIWorkerAgent`` and emits
the same OAEP/Runtime stream a local agent would, so the renderer has exactly
one conversation shape to render.

Two things stay server-side on purpose:
  - the DDF/HepAI credential (never returned to the Desktop),
  - the worker routing (``/apiv2/chat/completions``-style worker invocation).

The catalogue is the same surface the legacy Agent Square used
(``/apiv2/agents/list_agents`` + ``/worker/unified_gate``); it is re-exposed here
under the desktop gateway so the Desktop has a single origin to call.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from drsai.backend.runtime.agent import RuntimeExecutionError

from .. import _remote_worker_catalog
from .. import _state

api = APIRouter(tags=["remote-workers"])

# The Desktop forwards its saved HepAI/DDF credential (API key or OIDC access
# token) on remote-worker requests so an adopted or restarted gateway that was
# not spawned with the Desktop environment can still reach the platform.
CREDENTIAL_HEADER = "x-remote-worker-credential"
MAX_CREDENTIAL_HEADER_CHARS = 8192


def _request_credential(request: Request) -> str | None:
    value = request.headers.get(CREDENTIAL_HEADER)
    if not value:
        return None
    value = value.strip()
    if not value or len(value) > MAX_CREDENTIAL_HEADER_CHARS:
        return None
    return value


class RemoteWorkerSelectRequest(BaseModel):
    """Bind a discovered remote worker to the ``remote-worker`` Run backend.

    ``worker`` is the routable worker/model name (the DDF ``model`` the worker
    answers on). Optional ``url``/``model`` override the deployed defaults.
    """

    worker: str = Field(min_length=1, max_length=200)
    url: str | None = Field(default=None, max_length=512)
    model: str | None = Field(default=None, max_length=200)


def _definition_payload(request: RemoteWorkerSelectRequest) -> dict[str, Any]:
    remote_worker: dict[str, Any] = {"name": request.worker}
    if request.url:
        remote_worker["url"] = request.url
    if request.model:
        remote_worker["defult_config_name"] = request.model
    return {
        "id": _state.REMOTE_WORKER_DEFINITION_ID,
        "version": _state.REMOTE_WORKER_DEFINITION_VERSION,
        "backend": "remote-worker",
        "instructions": "Proxy a remote HepAI/DDF worker agent through this Runtime.",
        "permissions": [],
        "remote_worker": remote_worker,
    }


@api.get("/v1/remote-workers", operation_id="listRemoteWorkers")
async def list_remote_workers(refresh: bool = False, force: bool = False, raw_request: Request = None):  # type: ignore[assignment]
    """List the remote workers this Runtime can proxy.

    A worker that cannot be listed leaves the route returning an empty list
    rather than erroring: "no remote workers" is a normal state (offline
    deployment, missing credential), not a failure.

    Successful catalogs are cached for 24 hours; ``force=true`` (the explicit
    Refresh button) bypasses the cache.
    """
    try:
        return await _remote_worker_catalog.list_remote_workers(
            refresh=refresh,
            credential=_request_credential(raw_request) if raw_request is not None else None,
            force=force,
        )
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc


@api.post("/v1/remote-workers/select", operation_id="selectRemoteWorker")
async def select_remote_worker(request: RemoteWorkerSelectRequest):
    """Materialise a Run-ready Agent Definition for the selected remote worker.

    The worker binding is written into the ``remote-worker`` Definition asset on
    disk, so the ``execute`` step reads it from the same immutable store as any
    other Definition. The Desktop then sends the returned ``agent_definition``
    reference when it creates the Run.
    """
    try:
        reference = _state.write_remote_worker_definition(_definition_payload(request))
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc
    return {
        "agent_definition": reference,
        "backend": "remote-worker",
        "worker": request.worker,
    }


@api.get("/v1/remote-workers/status", operation_id="getRemoteWorkerStatus")
async def remote_worker_status(raw_request: Request):
    """Report whether this Runtime can reach the remote worker catalogue."""
    try:
        return await _remote_worker_catalog.remote_worker_status(
            credential=_request_credential(raw_request),
        )
    except RuntimeExecutionError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc


def router() -> APIRouter:
    return api
