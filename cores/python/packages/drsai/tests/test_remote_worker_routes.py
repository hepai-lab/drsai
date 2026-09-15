from pathlib import Path

import json

import types

import pytest

from drsai.backend.desktop_gateway import _state
from drsai.backend.desktop_gateway._models import RunCreateRequest, SessionCreateRequest
from drsai.backend.desktop_gateway.routes.remote_workers import (
    RemoteWorkerSelectRequest,
    _definition_payload,
)


def test_remote_worker_selection_payload_has_no_credential() -> None:
    payload = _definition_payload(
        RemoteWorkerSelectRequest(worker="demo-worker", model="demo-model")
    )

    assert payload["id"] == _state.REMOTE_WORKER_DEFINITION_ID
    assert str(payload["version"]) == _state.REMOTE_WORKER_DEFINITION_VERSION
    assert payload["backend"] == "remote-worker"
    assert payload["remote_worker"] == {
        "name": "demo-worker",
        "defult_config_name": "demo-model",
    }
    assert "api_key" not in repr(payload).lower()


def test_run_create_request_accepts_remote_worker_definition() -> None:
    request = RunCreateRequest(agent_definition="remote-worker@1")

    assert request.agent_definition == _state.DEFAULT_REMOTE_WORKER_DEFINITION


def test_session_create_request_requires_exactly_one_owner() -> None:
    with pytest.raises(ValueError):
        SessionCreateRequest()
    with pytest.raises(ValueError):
        SessionCreateRequest(workspace_id="ws-1", remote_worker_id="hepai/worker-a")
    assert SessionCreateRequest(remote_worker_id="hepai/worker-a").remote_worker_id == "hepai/worker-a"


def test_worker_scoped_definition_reference_is_deterministic() -> None:
    reference_a1 = _state.remote_worker_definition_reference("hepai/worker-a")
    reference_a2 = _state.remote_worker_definition_reference("hepai/worker-a")
    reference_b = _state.remote_worker_definition_reference("hepai/worker-b")
    assert reference_a1 == reference_a2
    assert reference_a1 != reference_b
    assert reference_a1.startswith("remote-worker-") and reference_a1.endswith("@1")


@pytest.fixture()
def state_root(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    _state.reset_state()
    yield tmp_path
    _state.reset_state()


def test_two_workers_get_isolated_sessions_and_definitions(state_root: Path) -> None:
    import asyncio

    engine = _state.runtime_engine()

    from drsai.backend.desktop_gateway.routes import sessions as sessions_routes

    session_a = asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        remote_worker_id="hepai/worker-a", title="A", remote_worker_name="Worker A",
    )))
    session_b = asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        remote_worker_id="hepai/worker-b", title="B", remote_worker_name="Worker B",
    )))

    # Worker binding is persisted and stable.
    assert session_a["remote_worker_id"] == "hepai/worker-a"
    assert session_b["remote_worker_id"] == "hepai/worker-b"
    # Each Session pinned its own immutable worker-scoped Definition.
    assert session_a["agent_definition"] != session_b["agent_definition"]
    assert session_a["agent_definition"].startswith("remote-worker-")
    assert session_b["agent_definition"].startswith("remote-worker-")
    # Both run inside the hidden Remote Agents workspace (Runtime compatibility).
    assert session_a["workspace_id"] == session_b["workspace_id"]

    # Worker-scoped listing is isolated.
    listed_a = engine.list_sessions(remote_worker_id="hepai/worker-a")
    listed_b = engine.list_sessions(remote_worker_id="hepai/worker-b")
    assert [item["session_id"] for item in listed_a["data"]] == [session_a["session_id"]]
    assert [item["session_id"] for item in listed_b["data"]] == [session_b["session_id"]]

    # Workspace listing does not leak remote sessions.
    workspace_sessions = engine.list_sessions(session_a["workspace_id"])
    assert [item["session_id"] for item in workspace_sessions["data"]] == []


def test_session_worker_binding_cannot_be_overridden_by_run_create(state_root: Path) -> None:
    import asyncio

    from fastapi.responses import JSONResponse

    from drsai.backend.desktop_gateway.routes import sessions as sessions_routes
    from drsai.backend.desktop_gateway.routes.runs import run_create

    session = asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        remote_worker_id="hepai/worker-a", title="A",
    )))
    authoritative = session["agent_definition"]

    # An idempotent key is required for the happy path.
    attempt_other = asyncio.run(run_create(
        session["session_id"],
        RunCreateRequest(agent_definition="remote-worker-0123456789abcdef012345@1"),
        idempotency_key_header="desktop-test-other",
    ))
    assert isinstance(attempt_other, JSONResponse) and attempt_other.status_code == 422

    # Omitting agent_definition falls back to the Session binding.
    created_response = asyncio.run(run_create(
        session["session_id"],
        RunCreateRequest(),
        idempotency_key_header="desktop-test-authoritative",
    ))
    assert isinstance(created_response, JSONResponse) and created_response.status_code == 201
    run = json.loads(created_response.body)
    assert run["agent_definition"] == authoritative
    assert run["backend_id"] == "remote-worker"


def test_remote_worker_credential_auth_session_fallback(monkeypatch):
    """Expired-but-refreshable OIDC sessions are renewed and used as credential."""
    import sys

    import drsai.backend.desktop_gateway._remote_worker_catalog as catalog

    monkeypatch.delenv("HEPAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DRSAI_REMOTE_WORKER_API_KEY", raising=False)
    monkeypatch.setattr(catalog.os, "environ", {k: v for k, v in catalog.os.environ.items()})

    fake_store = types.ModuleType("drsai.backend.auth.token_store")

    def load_auth_session():
        return {
            "access_token": "expired-token",
            "refresh_token": "refresh-token",
            "user": {"user_id": "u1"},
            "accessTokenExpiresAt": "2000-01-01T00:00:00Z",
        }

    def is_token_expired(session, refresh_window_s=300):
        return True

    def save_auth_session(tokens, user_info, issuer, client_id):
        return {"access_token": tokens.get("access_token", "")}

    fake_store.load_auth_session = load_auth_session
    fake_store.is_token_expired = is_token_expired
    fake_store.save_auth_session = save_auth_session

    fake_client_mod = types.ModuleType("drsai.backend.auth.oidc_client")

    class FakeOidcClient:
        def __init__(self, **_kwargs):
            pass

        def refresh_access_token(self, refresh_token):
            assert refresh_token == "refresh-token"
            return {"access_token": "renewed-token", "refresh_token": "r2"}

    fake_client_mod.OidcClient = FakeOidcClient

    monkeypatch.setitem(
        sys.modules,
        "drsai.backend.auth.token_store",
        fake_store,
    )
    monkeypatch.setitem(
        sys.modules,
        "drsai.backend.auth.oidc_client",
        fake_client_mod,
    )

    assert catalog._api_key() == "renewed-token"


def test_remote_worker_credential_fallbacks(monkeypatch):
    """Without env keys, the catalog falls back to platform auth and an explicit
    request credential, so a restarted/adopted gateway can still list workers."""
    from drsai.backend.desktop_gateway import _remote_worker_catalog

    for name in ("HEPAI_API_KEY", "OPENAI_API_KEY", "DRSAI_REMOTE_WORKER_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    # No credential anywhere -> requires_login.
    import asyncio
    status = asyncio.run(_remote_worker_catalog.remote_worker_status())
    assert status["state"] == "requires_login"

    # An explicit Desktop-forwarded credential wins.
    status = asyncio.run(_remote_worker_catalog.remote_worker_status(credential="desk-key"))
    assert status["state"] == "ready"
    assert status["credential_present"] is True


def _build_catalog(monkeypatch, rows, infos):
    """Run the catalog fetch with stubbed DDF HTTP responses."""
    import asyncio

    from drsai.backend.desktop_gateway import _remote_worker_catalog as catalog

    async def fake_list(_root, _api_key):
        return rows

    async def fake_info(_root, _api_key, worker):
        return infos.get(worker)

    monkeypatch.setattr(catalog, "_list_agent_rows", fake_list)
    monkeypatch.setattr(catalog, "_fetch_worker_info", fake_info)

    async def run():
        return await catalog._fetch_remote_worker_catalog("https://ddf.example", credential="k")

    return asyncio.run(run())


def test_catalog_reads_agent_config_model_aliases(monkeypatch):
    """DrSai workers expose switchable model aliases via ``agent_config``."""
    payload = _build_catalog(
        monkeypatch,
        rows=[{"name": "DrSai iPanda"}],
        infos={"DrSai iPanda": {
            "name": "DrSai iPanda",
            "description": "Assistant",
            "defult_config_name": "hepai/deepseek-v4-flash",
            "agent_config": {
                "hepai/deepseek-v4-pro": "deepseek-ai/deepseek-v4-pro",
                "hepai/deepseek-v4-flash": "deepseek-ai/deepseek-v4-flash",
            },
        }},
    )
    assert payload["state"] == "ready"
    worker = payload["workers"][0]
    names = [item["name"] for item in worker["model_configs"]]
    assert names == ["hepai/deepseek-v4-pro", "hepai/deepseek-v4-flash"]
    assert worker["defult_config_name"] == "hepai/deepseek-v4-flash"


def test_catalog_falls_back_to_default_model_only(monkeypatch):
    """A worker that only declares a default still shows it as a model option."""
    payload = _build_catalog(
        monkeypatch,
        rows=[{"name": "plain-worker"}],
        infos={"plain-worker": {"name": "plain-worker", "defult_config_name": "hepai/solo"}},
    )
    worker = payload["workers"][0]
    assert [item["name"] for item in worker["model_configs"]] == ["hepai/solo"]


def test_catalog_merges_default_into_agent_config_list(monkeypatch):
    """The default alias appears in the menu even when agent_config omits it."""
    payload = _build_catalog(
        monkeypatch,
        rows=[{"name": "w"}],
        infos={"w": {
            "name": "w",
            "defult_config_name": "hepai/default-alias",
            "agent_config": {"hepai/other": "deepseek-ai/other"},
        }},
    )
    worker = payload["workers"][0]
    names = [item["name"] for item in worker["model_configs"]]
    assert "hepai/other" in names
    assert "hepai/default-alias" in names
