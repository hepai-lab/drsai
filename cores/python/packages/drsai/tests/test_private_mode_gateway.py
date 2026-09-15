"""Private Mode is a Gateway-authoritative, per-turn model override.

The renderer only sends ``private_mode: true``; it deliberately withholds any
model identity, because a client must never be able to pin (or fake) the model a
private Run uses.  These tests therefore assert the *server* contract:

* a local (``opendrsai``) Run ignores ``model`` / ``model_alias`` /
  ``model_selection`` and executes against ``PRIVATE_MODEL_NAME``,
* the override is alias-only (``model_provider`` / ``model_id`` cleared) because
  ``PRIVATE_MODEL_NAME`` is a catalog alias and is not registered in any
  provider's model list -- the structured path fails closed in
  ``resolve_model_ref``,
* reasoning is pinned to ``"none"`` (the private model's ``effort_levels`` has no
  "low"/"medium", so an unlisted effort would silently fall back to the provider
  default and still think),
* a remote-worker Run is untouched: Private Mode is a local-only switch.

The Agent backend itself is stubbed: these tests pin the *decision* the Gateway
makes, not the model call.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from drsai.backend.desktop_gateway import _state
from drsai.backend.desktop_gateway._models import (
    RunCreateRequest,
    RunExecuteRequest,
    SessionCreateRequest,
    WorkspaceOpenRequest,
)
from drsai.backend.desktop_gateway.routes import runs as runs_routes
from drsai.backend.desktop_gateway.routes import sessions as sessions_routes
from drsai.backend.desktop_gateway.routes import workspaces as workspaces_routes
from drsai.config.model_defaults import PRIVATE_MODEL_NAME


@pytest.fixture()
def state_root(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    _state.reset_state()
    yield tmp_path
    _state.reset_state()


class _CapturingAgentService:
    """Records the arguments ``run_execute`` would hand to the Agent."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def execute(self, run_id, prompt, correlation_id, **kwargs):
        self.calls.append({"run_id": run_id, "prompt": prompt, **kwargs})
        return {"run_id": run_id, "status": "completed"}


def _install_capture(monkeypatch) -> _CapturingAgentService:
    service = _CapturingAgentService()
    monkeypatch.setattr(_state, "agent_service", lambda: service)
    # The request object is only used to read auth/correlation headers.
    monkeypatch.setattr(runs_routes._auth, "auth_context", lambda _request: None)
    monkeypatch.setattr(
        runs_routes._auth, "correlation_id", lambda _request: "test-correlation",
    )
    return service


def _local_session(state_root: Path) -> dict:
    (state_root / "ws").mkdir(parents=True, exist_ok=True)
    workspace = asyncio.run(workspaces_routes.workspace_open(
        WorkspaceOpenRequest(path=str(state_root / "ws"), display_name="Private Mode"),
    ))
    return asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        workspace_id=workspace["workspace_id"], title="Private Mode",
    )))


def _create_run(session_id: str, key: str) -> dict:
    response = asyncio.run(runs_routes.run_create(
        session_id, RunCreateRequest(), idempotency_key_header=key,
    ))
    return json.loads(response.body)


def _execute(run_id: str, request: RunExecuteRequest) -> dict:
    return asyncio.run(runs_routes.run_execute(run_id, request, None, wait=True))


def test_private_mode_pins_a_local_run_to_the_private_alias(monkeypatch, state_root: Path) -> None:
    service = _install_capture(monkeypatch)
    session = _local_session(state_root)
    run = _create_run(session["session_id"], "private-mode-local")
    assert run["backend_id"] == "opendrsai"

    # A client that (wrongly) supplies a model must still lose: the alias, the
    # legacy ``model`` spelling and the structured selection are all overridden.
    _execute(run["run_id"], RunExecuteRequest(
        prompt="hello",
        private_mode=True,
        model_alias="hepai/deepseek-v4-flash",
        model_selection={"provider_id": "hepai", "model_id": "deepseek-v4-flash"},
        reasoning_effort="high",
    ))

    assert len(service.calls) == 1
    call = service.calls[0]
    assert call["model_override"] == PRIVATE_MODEL_NAME
    # Alias-only: the structured reference would fail closed in resolve_model_ref
    # because PRIVATE_MODEL_NAME is not in provider_hepai's model list.
    assert call["model_provider"] is None
    assert call["model_id"] is None
    # effort_levels is ["none", "high", "max"]; "high" was requested but a
    # private Run must not think at all.
    assert call["reasoning_effort"] == "none"

    # The Session records the effective model, so the next turn and the UI agree.
    persisted = _state.runtime_engine().get_session(session["session_id"])
    assert persisted["model"] == PRIVATE_MODEL_NAME


def test_private_mode_pins_the_legacy_model_spelling_too(monkeypatch, state_root: Path) -> None:
    service = _install_capture(monkeypatch)
    session = _local_session(state_root)
    run = _create_run(session["session_id"], "private-mode-legacy-model")

    _execute(run["run_id"], RunExecuteRequest(
        prompt="hello", private_mode=True, model="hepai/gpt-5.6-luna",
    ))

    call = service.calls[0]
    assert call["model_override"] == PRIVATE_MODEL_NAME
    assert call["model_provider"] is None and call["model_id"] is None


def test_private_mode_leaves_a_remote_worker_run_alone(monkeypatch, state_root: Path) -> None:
    service = _install_capture(monkeypatch)
    session = asyncio.run(sessions_routes.session_create(SessionCreateRequest(
        remote_worker_id="hepai/worker-a", title="Remote",
    )))
    run = _create_run(session["session_id"], "private-mode-remote")
    assert run["backend_id"] == "remote-worker"

    _execute(run["run_id"], RunExecuteRequest(
        prompt="hello", private_mode=True, model_alias="hepai/worker-selected",
    ))

    call = service.calls[0]
    # The remote worker owns its own model catalog; the local private alias is
    # meaningless there, so the requested model passes through untouched.
    assert call["model_override"] == "hepai/worker-selected"
    assert call["model_override"] != PRIVATE_MODEL_NAME


def test_private_mode_defaults_off_and_rejects_unknown_fields() -> None:
    # Absent field: existing clients keep their model (default off).
    assert RunExecuteRequest(prompt="hello").private_mode is False
    # ``extra="forbid"`` keeps the Desktop/Gateway contract fail-closed: a typo
    # is a 422 instead of a silent fall back to DEFAULT_CONFIG_NAME.
    with pytest.raises(ValidationError):
        RunExecuteRequest(prompt="hello", private_mod=True)
