"""Regression tests for the Runtime-owned WeChat channel surface.

The WeChat channel used to live in ``backend/gateway_wechat.py``, which reached
into the legacy monolithic gateway for the Workspace registry, the Runtime
engine and the Agent service.  The port moved it to
``backend/desktop_gateway/routes/channels_wechat.py`` and replaced those three
couplings.  These tests pin the properties the move depends on:

* the surface keeps **exactly** the routes Desktop calls, and is only reachable
  behind the gateway instance token (it is not a public path);
* the external-send feature switch defaults to *off*, is checked before the
  confirmation flag is honoured, and the confirmation flag is checked before
  anything else;
* platform identity reaches the long-lived polling task through the
  process-memory broker rather than a process-global capture;
* a channel Session is owned by a user Workspace, never by the hidden
  remote-agents compatibility Workspace.

Everything here runs against a temporary ``DRSAI_HOME`` and never talks to a
model provider, WeChat, or the network.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import inspect
import json
import time
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from drsai.backend.desktop_gateway import _channel_auth, _state
from drsai.backend.desktop_gateway.routes import channels_wechat
from drsai.backend.wechat.auth_service import WeChatAuthError
from drsai.backend.wechat.channel_identity import ChannelIdentity
from drsai.config.agent_model_policy import AgentModelPolicySnapshot
from drsai.config.model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from drsai.platform_auth import PlatformAuthContext

OUTBOUND_SWITCH = "OPENDRSAI_WECHAT_DESKTOP_OUTBOUND_ENABLED"

STATUS_PATH = "/v1/channels/wechat/status"
REPLY_CAPABILITY_PATH = "/v1/channels/wechat/sessions/{session_id}/reply-capability"
OUTBOUND_PATH = "/v1/channels/wechat/sessions/{session_id}/outbound-messages"

#: The Desktop channel surface, frozen.  Adding a route here is a product
#: decision with a renderer contract behind it, so an accidental addition
#: (or removal) has to fail this test instead of shipping silently.
EXPECTED_ROUTES = (
    ("GET", STATUS_PATH),
    ("POST", "/v1/channels/wechat/login"),
    ("POST", "/v1/channels/wechat/login/{operation_id}/poll"),
    ("DELETE", "/v1/channels/wechat/login/{operation_id}"),
    ("POST", "/v1/channels/wechat/start"),
    ("POST", "/v1/channels/wechat/stop"),
    ("DELETE", "/v1/channels/wechat/credentials"),
    ("GET", "/v1/channels/wechat/sessions"),
    ("GET", REPLY_CAPABILITY_PATH),
    ("POST", OUTBOUND_PATH),
)


@pytest.fixture()
def state_root(tmp_path, monkeypatch):
    """A private state root, so no test reads or writes the real ``~/.drsai``."""
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", raising=False)
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_REVOKED", raising=False)
    monkeypatch.delenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT", raising=False)
    monkeypatch.delenv("OPENDRSAI_MODEL_BASE_URL", raising=False)
    monkeypatch.delenv("OPENDRSAI_DDF_API_BASE_URL", raising=False)
    monkeypatch.delenv("OPENDRSAI_PLATFORM_BASE_URL", raising=False)
    _state.reset_state()
    _channel_auth.reset()
    try:
        yield tmp_path
    finally:
        _state.reset_state()
        _channel_auth.reset()


def _endpoint(path: str, method: str):
    """Return the route callable itself, so a guard can be asserted in isolation."""
    for route in channels_wechat.router().routes:
        if route.path == path and method in route.methods:
            return route.endpoint
    raise AssertionError(f"{method} {path} is not registered")


def _bare_client() -> TestClient:
    """A client over the bare channel router, to exercise FastAPI validation."""
    app = FastAPI()
    app.include_router(channels_wechat.router())
    return TestClient(app)


def _outbound_call(session_id: str = "session-1", *, confirm: bool, key: str = "k" * 16):
    return asyncio.run(
        _endpoint(OUTBOUND_PATH, "POST")(
            session_id,
            channels_wechat.WeChatOutboundRequest(text="hello", confirm_external_send=confirm),
            idempotency_key=key,
        )
    )


# ── Surface ──────────────────────────────────────────────────────────────────

def test_router_exposes_exactly_the_desktop_channel_surface() -> None:
    registered = channels_wechat.router().routes
    assert len(registered) == len(EXPECTED_ROUTES)

    observed: dict[str, set[str]] = {}
    for route in registered:
        # Starlette mirrors HEAD onto GET routes; only the declared verbs matter.
        observed.setdefault(route.path, set()).update(set(route.methods) - {"HEAD"})

    expected: dict[str, set[str]] = {}
    for method, path in EXPECTED_ROUTES:
        expected.setdefault(path, set()).add(method)
    assert observed == expected


def test_gateway_registers_the_channel_router() -> None:
    from drsai.backend.desktop_gateway import app as gateway_app

    assert channels_wechat.router in gateway_app.ROUTERS


def test_channel_surface_requires_the_gateway_instance_token(state_root, monkeypatch) -> None:
    """The channel surface is not a public path: a paired caller is required."""
    monkeypatch.delenv(OUTBOUND_SWITCH, raising=False)
    from drsai.backend.desktop_gateway.app import app as gateway_app

    token = "t" * 64
    token_path = state_root / "runtime" / "instance-token"
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(token, encoding="ascii")

    client = TestClient(gateway_app)
    denied = client.get("/v1/channels/wechat/sessions")
    assert denied.status_code == 401
    assert denied.json()["error"]["code"] == "gateway_unauthorized"

    # The same request paired with the instance token reaches the route, which
    # proves the 401 above came from the middleware and not a missing route.
    allowed = client.get(
        "/v1/channels/wechat/sessions",
        headers={"x-opendrsai-gateway-token": token},
    )
    assert allowed.status_code == 200
    assert allowed.json() == {"count": 0}

    # An offline (unauthenticated) request must never prime the channel broker
    # with a placeholder identity.
    assert _channel_auth.current() is None


def test_authenticated_request_primes_the_channel_auth_broker(state_root, monkeypatch) -> None:
    """The polling task cannot inherit a request scope, so the broker carries it."""
    from drsai.backend.desktop_gateway.app import app as gateway_app

    secret = "unit-test-oidc-secret"
    monkeypatch.setenv("OPENDRSAI_OIDC_HS256_SECRET", secret)
    monkeypatch.delenv("OPENDRSAI_OIDC_AUDIENCE", raising=False)
    subject = str(uuid.uuid4())
    access_token = _hs256_access_token(subject, secret)

    token = "g" * 64
    token_path = state_root / "runtime" / "instance-token"
    token_path.parent.mkdir(parents=True, exist_ok=True)
    token_path.write_text(token, encoding="ascii")

    assert _channel_auth.current() is None
    response = TestClient(gateway_app).get(
        "/v1/channels/wechat/sessions",
        headers={
            "x-opendrsai-gateway-token": token,
            "x-opendrsai-auth-mode": "oidc",
            "authorization": f"Bearer {access_token}",
            "x-opendrsai-principal": subject,
        },
    )
    assert response.status_code == 200

    captured = _channel_auth.current()
    assert captured is not None
    assert captured.subject == subject
    assert captured.access_token == access_token


def test_capture_platform_auth_alias_primes_the_broker(state_root) -> None:
    context = _context()
    channels_wechat.capture_platform_auth(context)
    assert _channel_auth.current() is context

    # A missing context must never overwrite the newest verified one.
    channels_wechat.capture_platform_auth(None)
    assert _channel_auth.current() is context


def test_channel_modules_do_not_import_the_legacy_gateway() -> None:
    """The port's whole point: no ``drsai.backend.gateway`` coupling is left."""
    from drsai.backend.desktop_gateway import _channel_auth as broker

    for module in (channels_wechat, broker):
        source = inspect.getsource(module)
        for forbidden in (
            "gateway_legacy",
            "from drsai.backend import gateway",
            "_runtime_registry()",
            "_runtime_engine()",
            "_runtime_agent_service(",
        ):
            assert forbidden not in source, f"{module.__name__} still references {forbidden}"


# ── Outbound capability gate ─────────────────────────────────────────────────

def test_reply_capability_is_feature_disabled_by_default(state_root, monkeypatch) -> None:
    monkeypatch.delenv(OUTBOUND_SWITCH, raising=False)
    monkeypatch.setattr(channels_wechat, "_active_bot", None)

    result = asyncio.run(_endpoint(REPLY_CAPABILITY_PATH, "GET")("session-1"))
    assert result == {"available": False, "reason": "feature_disabled"}


def test_reply_capability_requires_a_running_channel(state_root, monkeypatch) -> None:
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    monkeypatch.setattr(channels_wechat, "_active_bot", None)

    result = asyncio.run(_endpoint(REPLY_CAPABILITY_PATH, "GET")("session-1"))
    assert result == {"available": False, "reason": "channel_not_running"}


def test_reply_capability_rejects_a_non_channel_session_id(state_root, monkeypatch) -> None:
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")

    with pytest.raises(HTTPException) as error:
        asyncio.run(_endpoint(REPLY_CAPABILITY_PATH, "GET")("run-not-a-session"))
    assert error.value.status_code == 404
    assert error.value.detail == {"code": "session_not_found"}


def test_reply_capability_delegates_to_the_live_bot(state_root, monkeypatch) -> None:
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    monkeypatch.setattr(channels_wechat, "_active_bot", _StubBot(capability={
        "available": True, "reason": None, "session_id": "session-1",
    }))

    result = asyncio.run(_endpoint(REPLY_CAPABILITY_PATH, "GET")("session-1"))
    assert result == {"available": True, "reason": None, "session_id": "session-1"}


# ── Outbound send guards ─────────────────────────────────────────────────────

def test_outbound_requires_explicit_confirmation(state_root, monkeypatch) -> None:
    # The switch is on, so the 400 proves the confirmation flag is checked first.
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    monkeypatch.setattr(channels_wechat, "_active_bot", _StubBot())

    with pytest.raises(HTTPException) as error:
        _outbound_call(confirm=False)
    assert error.value.status_code == 400
    assert error.value.detail["code"] == "external_send_confirmation_required"


def test_outbound_is_off_unless_explicitly_enabled(state_root, monkeypatch) -> None:
    monkeypatch.delenv(OUTBOUND_SWITCH, raising=False)
    monkeypatch.setattr(channels_wechat, "_active_bot", _StubBot())

    with pytest.raises(HTTPException) as error:
        _outbound_call(confirm=True)
    assert error.value.status_code == 409
    assert error.value.detail == {"code": "wechat_outbound_disabled"}


def test_outbound_requires_a_running_channel(state_root, monkeypatch) -> None:
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    monkeypatch.setattr(channels_wechat, "_active_bot", None)

    with pytest.raises(HTTPException) as error:
        _outbound_call(confirm=True)
    assert error.value.status_code == 409
    assert error.value.detail == {"code": "channel_not_running"}


def test_outbound_refuses_an_unavailable_capability(state_root, monkeypatch) -> None:
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    bot = _StubBot(capability={"available": False, "reason": "waiting_for_inbound"})
    monkeypatch.setattr(channels_wechat, "_active_bot", bot)

    with pytest.raises(HTTPException) as error:
        _outbound_call(confirm=True)
    assert error.value.status_code == 409
    assert error.value.detail == {"code": "waiting_for_inbound"}
    assert bot.sent == []


def test_outbound_sends_once_the_capability_is_live(state_root, monkeypatch) -> None:
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    bot = _StubBot(capability={"available": True, "reason": None})
    monkeypatch.setattr(channels_wechat, "_active_bot", bot)

    result = _outbound_call(confirm=True, key="idem-key-0123456")
    assert result == {
        "delivery_id": "delivery-1",
        "session_id": "session-1",
        "status": "sent",
        "attempt_count": 1,
    }
    assert bot.sent == [("session-1", "hello", "idem-key-0123456")]


def test_outbound_requires_an_idempotency_key_through_the_http_surface(state_root, monkeypatch) -> None:
    """The key is a FastAPI header contract, not a body field."""
    monkeypatch.setenv(OUTBOUND_SWITCH, "1")
    client = _bare_client()

    missing = client.post(OUTBOUND_PATH.format(session_id="session-1"), json={
        "text": "hello", "confirm_external_send": True,
    })
    assert missing.status_code == 422

    too_short = client.post(
        OUTBOUND_PATH.format(session_id="session-1"),
        json={"text": "hello", "confirm_external_send": True},
        headers={"Idempotency-Key": "k" * 15},
    )
    assert too_short.status_code == 422

    # With a valid key the request reaches the endpoint and hits the switch,
    # which is still off: the guard order survives the real ASGI path.
    monkeypatch.delenv(OUTBOUND_SWITCH, raising=False)
    disabled = client.post(
        OUTBOUND_PATH.format(session_id="session-1"),
        json={"text": "hello", "confirm_external_send": True},
        headers={"Idempotency-Key": "k" * 16},
    )
    assert disabled.status_code == 409
    assert disabled.json()["detail"] == {"code": "wechat_outbound_disabled"}


# ── Login error mapping ──────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("code", "status_code"),
    (("operation_not_found", 404), ("credentials_missing", 409), ("provider_unavailable", 502)),
)
def test_auth_errors_map_to_the_desktop_error_contract(code: str, status_code: int) -> None:
    async def failing():
        raise WeChatAuthError(code, "legacy message")

    with pytest.raises(HTTPException) as error:
        asyncio.run(channels_wechat._call(failing()))
    assert error.value.status_code == status_code
    assert error.value.detail == {"code": code, "message": "legacy message"}


# ── Status decoration ────────────────────────────────────────────────────────

def test_status_reports_only_configured_model_roles(state_root, monkeypatch) -> None:
    policy = AgentModelPolicy(
        agent_id="opendrsai",
        primary_model=AgentModelSelection("explicit", ModelRef("hepai", "deepseek-v4-pro")),
        image_understanding_model=AgentModelSelection("explicit", ModelRef("hepai", "gpt-5.6-luna")),
    )
    _stub_model_policy(monkeypatch, AgentModelPolicySnapshot(policy, "sha256:" + "0" * 64))

    status = channels_wechat._model_policy_status({"enabled": True})
    assert status["enabled"] is True
    assert status["model_policy"] == {
        "primary": {"provider_id": "hepai", "model_id": "deepseek-v4-pro"},
        "image_understanding": {"provider_id": "hepai", "model_id": "gpt-5.6-luna"},
    }
    assert status["media_capabilities"] == {"image_understanding": True, "image_generation": False}


def test_status_honours_the_legacy_image_model_role(state_root, monkeypatch) -> None:
    policy = AgentModelPolicy(
        agent_id="opendrsai",
        image_model=AgentModelSelection("explicit", ModelRef("hepai", "image-luna")),
    )
    _stub_model_policy(monkeypatch, AgentModelPolicySnapshot(policy, "sha256:" + "1" * 64))

    status = channels_wechat._model_policy_status({"enabled": False})
    assert status["model_policy"] == {
        "image_generation": {"provider_id": "hepai", "model_id": "image-luna"},
    }
    assert status["media_capabilities"] == {"image_understanding": False, "image_generation": True}


def test_status_degrades_to_no_media_capabilities_on_a_broken_policy(state_root, monkeypatch) -> None:
    """Channel lifecycle stays readable when model configuration is invalid."""
    def exploding(*args, **kwargs):
        raise RuntimeError("agent configuration identity does not match its file")

    monkeypatch.setattr("drsai.config.agent_model_policy.load_agent_model_policy", exploding)
    monkeypatch.setattr("drsai.config.agent_model_policy.current_agent_name", lambda: "opendrsai")

    status = channels_wechat._model_policy_status({"enabled": True})
    assert status["model_policy"] == {}
    assert status["media_capabilities"] == {"image_understanding": False, "image_generation": False}


def test_status_route_wraps_the_controller_status(state_root, monkeypatch) -> None:
    _stub_model_policy(monkeypatch, AgentModelPolicySnapshot(
        AgentModelPolicy(agent_id="opendrsai"), "sha256:" + "2" * 64,
    ))

    async def fixed_status() -> dict[str, Any]:
        return {"enabled": True, "running": False, "credential_state": "missing"}

    monkeypatch.setattr(channels_wechat.controller, "status", fixed_status)

    status = asyncio.run(_endpoint(STATUS_PATH, "GET")())
    assert status["enabled"] is True
    assert status["credential_state"] == "missing"
    assert status["model_policy"] == {}
    assert status["media_capabilities"] == {"image_understanding": False, "image_generation": False}


# ── Channel Agent service ────────────────────────────────────────────────────

def test_channel_run_appends_the_external_response_contract(state_root) -> None:
    base = _RecordingAgentService()
    service = _configured_service(base, run={"run_id": "run-1", "input_resources": []})

    asyncio.run(service.execute("run-1", "ping"))

    assert len(base.calls) == 1
    call = base.calls[0]
    assert call["run_id"] == "run-1"
    assert "[External WeChat response contract]" in call["prompt"]
    assert "input_resources_override" not in call
    assert "model_evidence" not in call


def test_image_turn_injects_trusted_evidence_and_drops_the_raw_image(state_root, monkeypatch, tmp_path) -> None:
    image = {"kind": "file", "mime": "image/png", "size_bytes": 4, "resource_id": "wechat-image-1"}
    base = _RecordingAgentService()
    service = _configured_service(base, run={"run_id": "run-1", "input_resources": [image]})
    _stub_vision(monkeypatch, tmp_path, summary="A white cat.", evidence={"operation": "image_understanding"})

    asyncio.run(service.execute("run-1", "what is this"))

    call = base.calls[0]
    assert "[Trusted OpenDrSai image-understanding output" in call["prompt"]
    assert "A white cat." in call["prompt"]
    override = call["input_resources_override"]
    assert isinstance(override, tuple) and len(override) == 1
    assert override[0]["resource_id"] == "trusted-image-understanding"
    assert override[0]["kind"] == "selection"
    assert override[0]["name"] == "OpenDrSai trusted evidence"
    assert override[0]["protocol"] == "oaep.input/1"
    assert all(item.get("kind") != "file" for item in override)
    assert call["model_evidence"]["multimodal_input"] == {
        "image_count": 1,
        "total_bytes": 4,
        "mime_types": ["image/png"],
    }
    assert call["model_evidence"]["image_understanding"] == {"operation": "image_understanding"}


def test_image_turn_without_a_summary_still_records_the_evidence(state_root, monkeypatch, tmp_path) -> None:
    image = {"kind": "file", "mime": "image/jpeg", "size_bytes": 8, "resource_id": "wechat-image-2"}
    base = _RecordingAgentService()
    service = _configured_service(base, run={"run_id": "run-1", "input_resources": [image]})
    _stub_vision(monkeypatch, tmp_path, summary="", evidence={"operation": "image_understanding"})

    asyncio.run(service.execute("run-1", "describe"))

    call = base.calls[0]
    assert "[Trusted OpenDrSai image-understanding output" not in call["prompt"]
    assert call["input_resources_override"] == ()
    assert call["model_evidence"]["multimodal_input"]["image_count"] == 1


def test_image_turn_falls_back_to_the_primary_model_without_a_vision_role(
    state_root, monkeypatch, tmp_path,
) -> None:
    """A missing image-understanding role must not fail the WeChat turn."""
    from drsai.backend.runtime.agent import RuntimeExecutionError

    image = {"kind": "file", "mime": "image/png", "size_bytes": 4, "resource_id": "wechat-image-3"}
    base = _RecordingAgentService()
    service = _configured_service(base, run={"run_id": "run-1", "input_resources": [image]})
    _stub_vision(monkeypatch, tmp_path, error=RuntimeExecutionError(
        "image_understanding_model_unavailable", "No image understanding model is configured.",
    ))

    asyncio.run(service.execute("run-1", "look"))

    call = base.calls[0]
    assert "[External WeChat response contract]" in call["prompt"]
    assert "input_resources_override" not in call
    assert "model_evidence" not in call


def test_image_turn_propagates_other_vision_failures(state_root, monkeypatch, tmp_path) -> None:
    from drsai.backend.runtime.agent import RuntimeExecutionError

    image = {"kind": "file", "mime": "image/png", "size_bytes": 4, "resource_id": "wechat-image-4"}
    base = _RecordingAgentService()
    service = _configured_service(base, run={"run_id": "run-1", "input_resources": [image]})
    _stub_vision(monkeypatch, tmp_path, error=RuntimeExecutionError(
        "image_understanding_failed", "Upstream refused the request.",
    ))

    with pytest.raises(RuntimeExecutionError) as error:
        asyncio.run(service.execute("run-1", "look"))
    assert error.value.code == "image_understanding_failed"
    assert base.calls == []


# ── Workspace ownership ──────────────────────────────────────────────────────

def test_channel_workspace_falls_back_to_the_runtime_workspace(state_root, monkeypatch, tmp_path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(channels_wechat, "WORKSPACE_DIR", str(workspace))

    record = channels_wechat._workspace_record()
    assert record.display_name == "OpenDrSai Workspace"
    assert Path(record.path) == workspace.resolve()
    assert record.open is True

    # Idempotent: the opened Workspace is reused, not re-registered.
    assert channels_wechat._workspace_id() == record.workspace_id
    assert channels_wechat._workspace_path() == workspace.resolve()
    # The root is remembered, so a Run can resolve the Workspace without disk IO.
    assert _state.workspace_root(record.workspace_id) == workspace.resolve()


def test_channel_workspace_never_uses_the_hidden_remote_agents_workspace(
    state_root, monkeypatch, tmp_path,
) -> None:
    registry = _state.runtime_registry()
    hidden = tmp_path / "runtime" / "remote-agents-workspace"
    hidden.mkdir(parents=True)
    registry.open_workspace(str(hidden), display_name="Remote Agents")

    user = tmp_path / "workspace"
    user.mkdir()
    monkeypatch.setattr(channels_wechat, "WORKSPACE_DIR", str(user))
    user_record = registry.open_workspace(str(user), display_name="My Project")
    # The hidden Workspace is the newest by the time a remote worker dispatches.
    registry.open_workspace(str(hidden), display_name="Remote Agents")

    record = channels_wechat._workspace_record()
    assert record.workspace_id == user_record.workspace_id
    assert Path(record.path).resolve() != hidden.resolve()


def test_channel_identity_secret_is_created_once_per_state_root(state_root) -> None:
    first = channels_wechat._channel_identity_secret()
    assert len(first) == 32
    path = state_root / "runtime" / "wechat-channel.key"
    assert path.read_bytes() == first
    assert channels_wechat._channel_identity_secret() == first


def test_channel_identity_secret_rejects_a_truncated_file(state_root) -> None:
    path = state_root / "runtime" / "wechat-channel.key"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"short")

    with pytest.raises(RuntimeError, match="wechat_channel_identity_secret_invalid"):
        channels_wechat._channel_identity_secret()


def test_runtime_bridge_is_wired_to_gateway_state_and_the_auth_broker(state_root, monkeypatch) -> None:
    engine = object()
    service = object()
    monkeypatch.setattr(_state, "runtime_engine", lambda: engine)
    monkeypatch.setattr(_state, "agent_service", lambda: service)

    bridge = channels_wechat._runtime_bridge({"account_id": "acct-1"})

    assert bridge.engine is engine
    assert isinstance(bridge.agent_service, channels_wechat.ConfiguredModelAgentService)
    assert bridge.agent_service.base is service
    assert bridge.workspace_id is channels_wechat._workspace_id
    assert bridge.workspace_path is channels_wechat._workspace_path
    assert bridge.auth_context_provider is _channel_auth.current
    identity = ChannelIdentity(channels_wechat._channel_identity_secret())
    assert bridge.account_fingerprint == identity.account_fingerprint("acct-1")
    assert bridge.account_fingerprint not in {"acct-1", ""}


def test_legacy_session_mapping_is_recorded_as_unable_to_correlate(state_root, monkeypatch, tmp_path) -> None:
    legacy = tmp_path / "daemons" / "desktop" / "wechat_sessions.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text(json.dumps({"schema_version": 2, "sessions": {"hash": {}}}), encoding="utf-8")
    monkeypatch.setattr(channels_wechat, "WORKSPACE_DIR", str(tmp_path))

    engine = _RecordingEngine()
    channels_wechat._audit_legacy_mapping(engine)

    assert engine.migrations == [{
        "provider": "wechat",
        "source_version": "wechat_sessions_v2",
        "source_digest": hashlib.sha256(legacy.read_bytes()).hexdigest(),
        "record_count": 1,
        "status": "unable_to_correlate",
    }]


def test_legacy_session_mapping_is_silent_without_a_file(state_root, monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(channels_wechat, "WORKSPACE_DIR", str(tmp_path))

    engine = _RecordingEngine()
    channels_wechat._audit_legacy_mapping(engine)
    assert engine.migrations == []


# ── Helpers ──────────────────────────────────────────────────────────────────

def _context() -> PlatformAuthContext:
    return PlatformAuthContext(
        access_token="token-value",
        subject=str(uuid.uuid4()),
        issuer="https://oidc.test.invalid",
        expires_at=int(time.time()) + 600,
        model_base_url="https://models.test.invalid/apiv2",
    )


def _hs256_access_token(subject: str, secret: str) -> str:
    def segment(payload: dict[str, Any]) -> str:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(encoded).rstrip(b"=").decode("ascii")

    header = segment({"alg": "HS256", "typ": "JWT"})
    claims = segment({
        "sub": subject,
        "iss": "https://oidc.test.invalid",
        "exp": int(time.time()) + 600,
        "aud": "hai-api",
        "typ": "access_token",
        "scope": "hai_api",
    })
    signing_input = f"{header}.{claims}".encode("ascii")
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    return f"{header}.{claims}.{signature}"


def _stub_model_policy(monkeypatch, snapshot: AgentModelPolicySnapshot) -> None:
    monkeypatch.setattr("drsai.config.agent_model_policy.load_agent_model_policy", lambda *a, **k: snapshot)
    monkeypatch.setattr("drsai.config.agent_model_policy.current_agent_name", lambda: snapshot.policy.agent_id)


def _configured_service(base: Any, *, run: dict[str, Any]) -> channels_wechat.ConfiguredModelAgentService:
    """Build the wrapper without its lazy ``_state`` singletons."""
    service = channels_wechat.ConfiguredModelAgentService.__new__(channels_wechat.ConfiguredModelAgentService)
    service.base = base
    service.engine = _RunEngine(run)
    return service


def _stub_vision(monkeypatch, workspace: Path, *, summary: str = "", evidence: Any = None, error=None) -> None:
    """Replace the model-backed vision call and the config reads it needs."""
    async def understand(*args, **kwargs):
        if error is not None:
            raise error
        return summary, evidence

    monkeypatch.setattr(channels_wechat, "understand_runtime_images", understand)
    monkeypatch.setattr(channels_wechat, "_workspace_path", lambda: workspace)
    monkeypatch.setattr("drsai.config.loader.load_user_config", lambda *a, **k: None)
    monkeypatch.setattr(
        "drsai.config.agent_model_policy.load_agent_model_policy",
        lambda *a, **k: AgentModelPolicySnapshot(AgentModelPolicy(agent_id="opendrsai"), "sha256:" + "3" * 64),
    )
    monkeypatch.setattr("drsai.config.agent_model_policy.current_agent_name", lambda: "opendrsai")


class _RunEngine:
    """The single ``get_run`` read the channel Agent service performs."""

    def __init__(self, run: dict[str, Any]) -> None:
        self._run = run

    def get_run(self, run_id: str) -> dict[str, Any]:
        assert run_id == self._run["run_id"]
        return self._run


class _RecordingEngine(_RunEngine):
    def __init__(self) -> None:
        super().__init__({"run_id": "run-1"})
        self.migrations: list[dict[str, Any]] = []

    def get_run(self, run_id: str) -> dict[str, Any]:
        return self._run

    def record_channel_migration(self, **kwargs: Any) -> None:
        self.migrations.append(kwargs)


class _RecordingAgentService:
    """A stand-in for ``RuntimeAgentService`` that records each Run it serves."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def execute(self, run_id: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append({"run_id": run_id, "prompt": prompt, **kwargs})
        return {"status": "completed"}


class _StubBot:
    """The two WeChatBot members the channel routes call."""

    def __init__(self, *, capability: dict[str, Any] | None = None) -> None:
        self._capability = capability or {"available": False, "reason": "channel_not_running"}
        self.sent: list[tuple[str, str, str]] = []

    def desktop_outbound_capability(self, session_id: str) -> dict[str, Any]:
        return dict(self._capability)

    async def send_desktop_outbound(self, session_id: str, *, text: str, idempotency_key: str) -> dict[str, Any]:
        self.sent.append((session_id, text, idempotency_key))
        return {
            "delivery_id": "delivery-1",
            "session_id": session_id,
            "status": "sent",
            "attempt_count": 1,
        }
