"""The Desktop must hand a remote worker the HepAI *email*, never a bare user_id.

``HepAIWorkerAgent`` forwards ``run_info`` verbatim: it becomes the remote
``lazy_init(run_info=...)`` argument and the ``user`` field of every completion
request.  The worker resolves the caller identity out of that mapping with

    username = user_info.get('email') or user_info.get('name') or "anonymous"

(``drsai/dr_sai.py`` ``handle_input_info``), keys its ``UserInput`` / ``Thread``
rows on the result, and ``drsai/backend/run.py`` reads ``run_info.get("email")``
directly.  A payload that only carried ``user_id`` therefore made every Desktop
Run show up on the worker as the literal user ``anonymous`` -- the Run still
worked, but the worker stored it under the wrong owner.

These tests pin the payload *contract* (which keys, holding whose value) at the
Backend boundary, so a future refactor cannot silently regress to ``user_id``.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from drsai.backend.desktop_gateway import _remote_worker_backend as worker_backend
from drsai.backend.desktop_gateway import _state
from drsai.backend.runtime.agent import AgentDefinition, RuntimeRunContext

LOGIN_EMAIL = "xiongdb@ihep.ac.cn"
# What ``effective_user_id`` returns for a signed-in Desktop: the OIDC subject,
# a UUID the DDF worker knows nothing about.
OIDC_SUBJECT = "3f2a1c4e-0000-4000-8000-0123456789ab"
WORKER_URL = "https://ddf.ihep.ac.cn/apiv2"
WORKER_NAME = "hepai/drsai"


@pytest.fixture()
def state_root(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    _state.reset_state()
    yield tmp_path
    _state.reset_state()


class _EmptyWorkerStream:
    """Async-iterable yielding nothing: the remote agent stream is stubbed out."""

    def __aiter__(self) -> "_EmptyWorkerStream":
        return self

    async def __anext__(self):
        raise StopAsyncIteration


class _CapturingRunner:
    """Records what would have been handed to ``HepAIWorkerAgent``.

    ``RemoteWorkerBackend(runner=...)`` is the documented test seam: production
    leaves it ``None`` and calls ``_run_remote_worker_stream`` instead.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def __call__(self, task, **kwargs):
        self.calls.append({"task": task, **kwargs})
        return _EmptyWorkerStream()


class _Services:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def emit(self, context, event_type: str, payload: dict) -> None:
        self.events.append((event_type, dict(payload)))


def _definition() -> AgentDefinition:
    return AgentDefinition(
        asset_id=WORKER_NAME,
        version="1",
        backend="remote-worker",
        model=None,
        instructions="",
        permissions=frozenset(),
        raw={
            "remote_worker": {
                "url": WORKER_URL,
                "name": WORKER_NAME,
                "api_key": "test-key",
            }
        },
    )


def _context(workspace: Path) -> RuntimeRunContext:
    return RuntimeRunContext(
        runtime_id="runtime-1",
        instance_id="instance-1",
        workspace_id="workspace-1",
        workspace_path=workspace,
        session_id="session-1",
        run_id="run-1",
        agent_definition_id=WORKER_NAME,
        agent_definition_version="1",
        correlation_id="correlation-1",
    )


def _login_as(monkeypatch, email: str | None) -> None:
    """Install the platform auth context the gateway middleware would build."""
    import drsai.platform_auth as platform_auth

    monkeypatch.setattr(
        platform_auth,
        "get_platform_auth",
        lambda: SimpleNamespace(user_email=email),
    )
    monkeypatch.setattr(worker_backend, "effective_user_id", lambda supplied=None: OIDC_SUBJECT)


def _run_capture(monkeypatch, state_root: Path, email: str | None) -> _CapturingRunner:
    _login_as(monkeypatch, email)
    runner = _CapturingRunner()
    asyncio.run(
        worker_backend.RemoteWorkerBackend(runner=runner).execute(
            _context(state_root), _definition(), "hello", _Services()
        )
    )
    assert len(runner.calls) == 1
    return runner


def test_remote_worker_receives_the_login_email(monkeypatch, state_root: Path) -> None:
    runner = _run_capture(monkeypatch, state_root, LOGIN_EMAIL)

    call = runner.calls[0]
    run_info = call["run_info"]

    # The keys the worker actually reads, carrying the human the Run belongs to.
    assert run_info["email"] == LOGIN_EMAIL
    assert run_info["name"] == LOGIN_EMAIL
    # The OIDC subject is the *gateway's* user key; the worker cannot resolve it.
    assert OIDC_SUBJECT not in {run_info["email"], run_info["name"]}
    # ``user_id`` alone is what used to be sent, and the worker ignores it.  The
    # key must not come back: a second copy would hide a regression behind a
    # value that still resolves to "anonymous" downstream.
    assert "user_id" not in run_info

    # Evaluate the worker's own expression (dr_sai.py::handle_input_info) so the
    # assertion fails if the *worker* contract ever changes shape.
    assert (run_info.get("email") or run_info.get("name") or "anonymous") == LOGIN_EMAIL

    # Identity travels next to the run/session the worker keys its rows on.
    assert run_info["run_id"] == "run-1"
    assert run_info["session_id"] == "session-1"
    assert call["chat_id"] == "session-1"


def test_a_bare_user_id_payload_resolves_to_anonymous() -> None:
    """The shape that caused the bug, evaluated exactly as the worker does."""
    legacy_run_info = {"run_id": "run-1", "session_id": "session-1", "user_id": LOGIN_EMAIL}
    assert (legacy_run_info.get("email") or legacy_run_info.get("name") or "anonymous") == "anonymous"


def test_run_info_falls_back_to_the_gateway_user_key(monkeypatch, state_root: Path) -> None:
    # Signed in without an ``email`` claim (or offline): the worker still needs an
    # owner key, so the gateway's own identity is sent as the email.
    runner = _run_capture(monkeypatch, state_root, None)
    run_info = runner.calls[0]["run_info"]
    assert run_info["email"] == OIDC_SUBJECT
    assert run_info["name"] == OIDC_SUBJECT
    assert "user_id" not in run_info


def test_identity_survives_an_unavailable_auth_context(monkeypatch) -> None:
    import drsai.platform_auth as platform_auth

    def _explode():
        raise RuntimeError("no platform auth context")

    monkeypatch.setattr(platform_auth, "get_platform_auth", _explode)
    monkeypatch.setattr(worker_backend, "effective_user_id", lambda supplied=None: "local")

    # Offline Runs must not fail the worker handshake over missing auth.
    assert worker_backend._remote_worker_user_identity() == "local"
