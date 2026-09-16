"""The two session-scoped Agent Backend routes the Desktop hydrates through.

``POST /v1/sessions/{id}/agent-backend/history/sync`` and
``GET /v1/sessions/{id}/agent-backend/binding`` used to exist only in the legacy
monolith (``gateway_legacy.py`` 5059-5082).  The V2 Runtime answered both with a
bare 404, and because the Desktop calls the sync route *before every thread
snapshot* (``shared/main/threadRuntimeSubscription.ts``) and the binding route
before continuing an existing task (``shared/main/chat.ts``), a V2-only Runtime
made thread hydration retry forever instead of loading.

These tests pin the ported contract:

* the surface exists on the V2 gateway router and is reachable behind the
  instance token -- a *route* 404 must not come back;
* a Session on a backend that does not own its history (``opendrsai``,
  ``remote-worker``) answers with an idempotent empty page -- the no-op the
  Desktop treats as "nothing to import", not an error;
* an unknown Session is ``404 Session not found`` on the sync route (matching
  V1) and ``state: backend-missing`` on the binding route (so the UI can explain
  the state instead of showing a transport failure);
* the query aliases the Desktop sends (``repair`` → ``force_reproject``,
  ``cursor``, ``limit`` 1..500) keep their V1 meaning;
* Runtime failures map onto HTTP statuses exactly like the sibling account
  routes, so the Desktop's existing error handling keeps working.

Everything runs against a temporary ``DRSAI_HOME`` and never calls a model.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from drsai.backend.desktop_gateway import _state
from drsai.backend.desktop_gateway._models import SessionCreateRequest, WorkspaceOpenRequest
from drsai.backend.desktop_gateway.routes import agent_backends
from drsai.backend.desktop_gateway.routes import sessions as sessions_routes
from drsai.backend.desktop_gateway.routes import workspaces as workspaces_routes
from drsai.backend.runtime.agent import RuntimeExecutionError

SYNC_PATH = "/v1/sessions/{session_id}/agent-backend/history/sync"
BINDING_PATH = "/v1/sessions/{session_id}/agent-backend/binding"

#: The Desktop hydration surface, frozen.  A missing route is not a graceful
#: degradation here -- it makes every thread snapshot fail -- so an accidental
#: removal has to fail this test instead of shipping silently.
EXPECTED_ROUTES = (
    ("POST", SYNC_PATH),
    ("GET", BINDING_PATH),
)


@pytest.fixture()
def state_root(tmp_path: Path, monkeypatch) -> Path:
    """A private state root, so no test reads or writes the real ``~/.drsai``."""
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    # The instance token is resolved from the environment *before* the paired
    # file, so a developer shell that exports one would otherwise decide the
    # outcome of the token test instead of the token this test writes.
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", raising=False)
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_REVOKED", raising=False)
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT", raising=False)
    _state.reset_state()
    yield tmp_path
    _state.reset_state()


def _local_session(state_root: Path) -> dict:
    """A Workspace Session bound to the built-in local (``opendrsai``) backend."""
    (state_root / "ws").mkdir(parents=True, exist_ok=True)
    workspace = asyncio.run(workspaces_routes.workspace_open(
        WorkspaceOpenRequest(path=str(state_root / "ws"), display_name="Hydration"),
    ))
    return asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        workspace_id=workspace["workspace_id"], title="Hydration",
    )))


def _endpoint(path: str, method: str):
    """Return the route callable itself, so the contract can be asserted alone."""
    for route in agent_backends.router().routes:
        if route.path == path and method in route.methods:
            return route.endpoint
    raise AssertionError(f"{method} {path} is not registered")


def _bare_client() -> TestClient:
    """A client over the bare router, to exercise FastAPI's query validation."""
    app = FastAPI()
    app.include_router(agent_backends.router())
    return TestClient(app)


def _paired_gateway_client(state_root: Path) -> tuple[TestClient, dict[str, str]]:
    """A client for the real gateway app plus the instance-token header."""
    from drsai.backend.desktop_gateway.app import app as gateway_app

    token = "t" * 64
    token_path = state_root / "runtime" / "instance-token"
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(token, encoding="ascii")
    return TestClient(gateway_app), {"x-opendrsai-gateway-token": token}


# -- Surface -----------------------------------------------------------------

def test_router_exposes_the_thread_hydration_endpoints() -> None:
    observed: dict[str, set[str]] = {}
    for route in agent_backends.router().routes:
        if route.path in {SYNC_PATH, BINDING_PATH}:
            # Starlette mirrors HEAD onto GET routes; only the declared verbs matter.
            observed.setdefault(route.path, set()).update(set(route.methods) - {"HEAD"})

    expected: dict[str, set[str]] = {}
    for method, path in EXPECTED_ROUTES:
        expected.setdefault(path, set()).add(method)
    assert observed == expected


def test_gateway_registers_the_agent_backend_router() -> None:
    from drsai.backend.desktop_gateway import app as gateway_app

    assert agent_backends.router in gateway_app.ROUTERS


def test_gateway_serves_the_hydration_endpoints_behind_the_instance_token(state_root: Path) -> None:
    """The regression that mattered: a *served* 200, not a route 404."""
    session = _local_session(state_root)
    client, headers = _paired_gateway_client(state_root)

    # Without a paired caller the middleware answers first: these paths are not
    # public, and a 401 is not a 404.
    assert client.post(f"/v1/sessions/{session['session_id']}/agent-backend/history/sync").status_code == 401
    assert client.get(f"/v1/sessions/{session['session_id']}/agent-backend/binding").status_code == 401

    sync = client.post(
        f"/v1/sessions/{session['session_id']}/agent-backend/history/sync", headers=headers,
    )
    assert sync.status_code == 200
    assert sync.json() == {
        "session_id": session["session_id"], "backend_id": "opendrsai",
        "imported": 0, "total": 0,
    }

    binding = client.get(f"/v1/sessions/{session['session_id']}/agent-backend/binding", headers=headers)
    assert binding.status_code == 200
    assert binding.json()["state"] == "unbound"

    # An unknown Session is still a *client* error from the route itself, which
    # is what proves the 404 above/here comes from a served route and not from
    # the router having no such path at all.
    missing = client.post("/v1/sessions/does-not-exist/agent-backend/history/sync", headers=headers)
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Session not found"


# -- History sync semantics --------------------------------------------------

def test_history_sync_is_an_idempotent_noop_for_a_local_session(state_root: Path) -> None:
    session = _local_session(state_root)

    result = asyncio.run(_endpoint(SYNC_PATH, "POST")(
        session["session_id"], repair=False, cursor=None, limit=100,
    ))

    # The Desktop's hydration path treats this as "nothing to import" and keeps
    # the Runtime-owned conversation it already has.
    assert result == {
        "session_id": session["session_id"], "backend_id": "opendrsai",
        "imported": 0, "total": 0,
    }
    # Repeatable: hydration runs before *every* snapshot.
    assert asyncio.run(_endpoint(SYNC_PATH, "POST")(
        session["session_id"], repair=False, cursor=None, limit=100,
    )) == result
    # A follow-up page request is equally inert for a backend with no history.
    assert asyncio.run(_endpoint(SYNC_PATH, "POST")(
        session["session_id"], repair=True, cursor="page-2", limit=25,
    )) == result


def test_history_sync_keeps_the_v1_query_contract(state_root: Path) -> None:
    session = _local_session(state_root)
    client = _bare_client()
    path = f"/v1/sessions/{session['session_id']}/agent-backend/history/sync"

    # ``limit`` is bounded 1..500, as in the V1 signature.
    assert client.post(f"{path}?limit=0").status_code == 422
    assert client.post(f"{path}?limit=501").status_code == 422

    # The full query set the Desktop sends (``repair`` == V1's spelling of the
    # service-level ``force_reproject``) is accepted and still inert.
    response = client.post(f"{path}?repair=true&cursor=page-1&limit=500")
    assert response.status_code == 200
    assert response.json()["imported"] == 0


def test_history_sync_hands_the_query_to_the_service_with_v1_meaning(
    state_root: Path, monkeypatch,
) -> None:
    """``repair`` must reach the service as ``force_reproject``; the rest verbatim."""
    captured: dict[str, object] = {}

    class _CapturingService:
        async def sync_backend_session_history(self, session_id, *, force_reproject, cursor, limit):
            captured.update(
                session_id=session_id, force_reproject=force_reproject, cursor=cursor, limit=limit,
            )
            return {"session_id": session_id, "backend_id": "opendrsai", "imported": 0, "total": 0}

    # ``monkeypatch`` (not a bare assignment): the route resolves the *function*
    # ``_state.agent_service`` per call, and only monkeypatch restores it.
    monkeypatch.setattr(_state, "agent_service", lambda: _CapturingService())

    asyncio.run(_endpoint(SYNC_PATH, "POST")("session-1", repair=True, cursor="page-1", limit=7))

    assert captured == {
        "session_id": "session-1", "force_reproject": True, "cursor": "page-1", "limit": 7,
    }


# -- Binding semantics -------------------------------------------------------

def test_binding_reports_backend_missing_for_an_unknown_session(state_root: Path) -> None:
    """An unknown Session is a state the UI can explain, not a transport error."""
    result = asyncio.run(_endpoint(BINDING_PATH, "GET")("does-not-exist"))

    assert result == {
        "session_id": "does-not-exist", "state": "backend-missing",
        "reason": "session_not_found",
    }


def test_binding_reports_unbound_for_a_backend_without_binding_support(state_root: Path) -> None:
    session = _local_session(state_root)

    result = asyncio.run(_endpoint(BINDING_PATH, "GET")(session["session_id"]))

    # ``opendrsai`` owns its Sessions outright: there is no external binding to
    # recover or conflict with, and the Desktop reads that as "continue".
    assert result == {
        "session_id": session["session_id"], "backend_id": "opendrsai", "state": "unbound",
    }


# -- Error mapping -----------------------------------------------------------

@pytest.mark.parametrize(
    ("code", "retryable", "expected_status"),
    [
        ("agent_backend_not_found", False, 404),
        ("backend_history_budget_exhausted", True, 503),
        ("codex_backend_unavailable", False, 503),
        ("agent_backend_conflict", False, 409),
    ],
)
def test_runtime_failures_map_like_the_account_routes(
    state_root: Path, monkeypatch, code: str, retryable: bool, expected_status: int,
) -> None:
    class _FailingService:
        async def sync_backend_session_history(self, session_id, **_kwargs):
            raise RuntimeExecutionError(code, "boom", retryable=retryable)

        async def backend_session_binding_status(self, session_id):
            raise RuntimeExecutionError(code, "boom", retryable=retryable)

    monkeypatch.setattr(_state, "agent_service", lambda: _FailingService())

    with pytest.raises(HTTPException) as sync_error:
        asyncio.run(_endpoint(SYNC_PATH, "POST")("session-1", repair=False, cursor=None, limit=100))
    assert sync_error.value.status_code == expected_status
    assert sync_error.value.detail["code"] == code

    with pytest.raises(HTTPException) as binding_error:
        asyncio.run(_endpoint(BINDING_PATH, "GET")("session-1"))
    assert binding_error.value.status_code == expected_status
    assert binding_error.value.detail["code"] == code


def test_history_sync_maps_an_unknown_session_keyerror_to_404(state_root: Path, monkeypatch) -> None:
    """A service that surfaces the engine's ``KeyError`` keeps V1's 404."""

    class _KeyErrorService:
        async def sync_backend_session_history(self, session_id, **_kwargs):
            raise KeyError(session_id)

    monkeypatch.setattr(_state, "agent_service", lambda: _KeyErrorService())

    with pytest.raises(HTTPException) as error:
        asyncio.run(_endpoint(SYNC_PATH, "POST")("session-1", repair=False, cursor=None, limit=100))
    assert error.value.status_code == 404
    assert error.value.detail == "Session not found"
