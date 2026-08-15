from __future__ import annotations

import asyncio
import inspect
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from drsai.backend.wechat.auth_service import WeChatAuthError, WeChatAuthService
from drsai.backend.wechat.channel_controller import WeChatChannelController
from drsai.backend.wechat.wechat_bot import WeChatCredentialsExpired
from drsai.backend import gateway_wechat


def test_channel_status_discloses_safe_current_model_policy(monkeypatch) -> None:
    def selection(provider_id: str, model_id: str):
        return SimpleNamespace(ref=SimpleNamespace(provider_id=provider_id, model_id=model_id))

    policy = SimpleNamespace(
        primary_model=selection("hepai", "deepseek-v4-flash"),
        image_understanding_model=selection("hepai", "gpt-5.6-luna"),
        image_generation_model=selection("hepai", "gemini-3.1-flash-lite-image"),
        image_model=None,
        text_to_speech_model=selection("hepai", "tts-1"),
        realtime_voice_model=None,
        speech_to_text_model=selection("hepai", "whisper-1"),
    )
    monkeypatch.setattr(
        "drsai.config.agent_model_policy.load_agent_model_policy",
        lambda _agent: SimpleNamespace(policy=policy),
    )
    monkeypatch.setattr("drsai.config.agent_model_policy.current_agent_name", lambda: "opendrsai")

    status = gateway_wechat._model_policy_status({"runtime_state": "running"})

    assert status["model_policy"]["primary"] == {
        "provider_id": "hepai", "model_id": "deepseek-v4-flash",
    }
    assert status["model_policy"]["image_understanding"]["model_id"] == "gpt-5.6-luna"
    assert status["model_policy"]["image_generation"]["model_id"] == "gemini-3.1-flash-lite-image"
    assert status["media_capabilities"] == {
        "image_understanding": True, "image_generation": True,
    }
    assert "api_key" not in repr(status) and "credential" not in repr(status)


class Clock:
    def __init__(self, value: float = 1_800_000_000.0):
        self.value = value

    def __call__(self) -> float:
        return self.value


def test_qr_login_status_credentials_and_logout_are_secret_safe(tmp_path) -> None:
    clock = Clock()
    responses = [
        {"ret": 0, "qrcode_img_content": "https://qr.example/secret", "qrcode": "qr-secret"},
        {"status": "scaned"},
        {
            "status": "confirmed",
            "bot_token": "bot-super-secret",
            "ilink_bot_id": "bot-account-123456",
            "ilink_user_id": "wechat-user-secret",
        },
    ]
    urls: list[str] = []

    async def transport(url: str):
        urls.append(url)
        return responses.pop(0)

    credentials_path = tmp_path / "credentials.json"
    service = WeChatAuthService(credentials_path, transport=transport, now=clock, credential_root=tmp_path / "secure")
    started = asyncio.run(service.start_login())
    assert started["status"] == "waiting"
    assert started["qr_content"] == "https://qr.example/secret"
    assert "qr-secret" not in repr(started)

    scanned = asyncio.run(service.poll_login(started["operation_id"]))
    assert scanned["status"] == "scanned"
    clock.value += 3
    confirmed = asyncio.run(service.poll_login(started["operation_id"]))
    assert confirmed == {
        "status": "confirmed",
        "operation_id": started["operation_id"],
        "account_label": "bot…456",
    }
    assert "bot-super-secret" not in repr(confirmed)
    assert "wechat-user-secret" not in repr(confirmed)

    persisted = json.loads(credentials_path.read_text(encoding="utf-8"))
    assert persisted["schema_version"] == 2
    assert persisted["credential_ref"].startswith("drsai-credential:")
    assert "bot-super-secret" not in credentials_path.read_text(encoding="utf-8")
    assert "wechat-user-secret" not in credentials_path.read_text(encoding="utf-8")
    assert service.load_runtime_credentials()["bot_token"] == "bot-super-secret"
    status = asyncio.run(service.status())
    assert status["credential_state"] == "valid"
    assert status["account_label"] == "bot…456"
    assert "bot-super-secret" not in repr(status)

    logged_out = asyncio.run(service.logout())
    assert logged_out["status"] == "logged_out"
    assert not credentials_path.exists()
    assert len(urls) == 3


def test_poll_rate_limit_expiry_cancel_and_unknown_operation(tmp_path) -> None:
    clock = Clock()

    async def transport(url: str):
        if "get_bot_qrcode" in url:
            return {"ret": 0, "qrcode_img_content": "qr-content", "qrcode": "qr-id"}
        return {"status": "wait"}

    service = WeChatAuthService(tmp_path / "credentials.json", transport=transport, now=clock, credential_root=tmp_path / "secure")
    started = asyncio.run(service.start_login())
    first = asyncio.run(service.poll_login(started["operation_id"]))
    assert first["status"] == "waiting"
    limited = asyncio.run(service.poll_login(started["operation_id"]))
    assert limited["retry_after_seconds"] == 3
    cancelled = asyncio.run(service.cancel_login(started["operation_id"]))
    assert cancelled["cancelled"] is True
    with pytest.raises(WeChatAuthError, match="not found"):
        asyncio.run(service.poll_login(started["operation_id"]))

    started = asyncio.run(service.start_login())
    clock.value += 121
    assert asyncio.run(service.poll_login(started["operation_id"]))["status"] == "expired"


def test_invalid_provider_response_does_not_persist_partial_credentials(tmp_path) -> None:
    responses = [
        {"ret": 0, "qrcode_img_content": "qr-content", "qrcode": "qr-id"},
        {"status": "confirmed", "bot_token": "secret", "ilink_bot_id": "account"},
    ]

    async def transport(_url: str):
        return responses.pop(0)

    service = WeChatAuthService(tmp_path / "credentials.json", transport=transport, credential_root=tmp_path / "secure")
    started = asyncio.run(service.start_login())
    with pytest.raises(WeChatAuthError) as error:
        asyncio.run(service.poll_login(started["operation_id"]))
    assert error.value.code == "invalid_provider_response"
    assert not service.credentials_path.exists()


def test_poll_keeps_qr_operation_after_transient_provider_failure(tmp_path) -> None:
    clock = Clock()
    responses = [
        {"ret": 0, "qrcode_img_content": "qr-content", "qrcode": "qr-id"},
        WeChatAuthError("provider_unavailable", "Unable to contact WeChat."),
        {"status": "wait"},
    ]

    async def transport(_url: str):
        value = responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    service = WeChatAuthService(tmp_path / "credentials.json", transport=transport, now=clock, credential_root=tmp_path / "secure")
    started = asyncio.run(service.start_login())
    transient = asyncio.run(service.poll_login(started["operation_id"]))
    assert transient["status"] == "waiting"
    assert transient["transient_error_code"] == "provider_unavailable"
    assert transient["retry_after_seconds"] == 3
    clock.value += 3
    recovered = asyncio.run(service.poll_login(started["operation_id"]))
    assert recovered["status"] == "waiting"
    assert "transient_error_code" not in recovered


def test_controller_start_stop_are_idempotent_and_logout_stops_first(tmp_path) -> None:
    credentials = tmp_path / "credentials.json"
    credentials.write_text(json.dumps({
        "bot_token": "secret",
        "account_id": "account-123456",
        "user_id": "user",
        "login_time": 1_800_000_000.0,
    }), encoding="utf-8")
    auth = WeChatAuthService(credentials, now=lambda: 1_800_000_001.0, credential_root=tmp_path / "secure")
    started = asyncio.Event()
    cancelled = asyncio.Event()
    calls = 0

    async def runner(runtime_credentials):
        nonlocal calls
        calls += 1
        assert runtime_credentials["bot_token"] == "secret"
        started.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    async def scenario():
        controller = WeChatChannelController(auth, runner)
        assert (await controller.start())["runtime_state"] == "running"
        await started.wait()
        assert (await controller.start())["runtime_state"] == "running"
        assert calls == 1
        assert (await controller.stop())["runtime_state"] == "stopped"
        assert cancelled.is_set()
        await controller.start()
        result = await controller.logout()
        assert result["configured"] is False
        assert result["runtime_state"] == "stopped"

    asyncio.run(scenario())
    assert not credentials.exists()


def test_gateway_router_exposes_only_bounded_wechat_management_operations() -> None:
    routes = {(route.path, next(iter(route.methods))) for route in gateway_wechat.router().routes}
    paths = {path for path, _method in routes}
    assert paths == {
        "/v1/channels/wechat/status",
        "/v1/channels/wechat/login",
        "/v1/channels/wechat/login/{operation_id}/poll",
        "/v1/channels/wechat/login/{operation_id}",
        "/v1/channels/wechat/start",
        "/v1/channels/wechat/stop",
        "/v1/channels/wechat/credentials",
        "/v1/channels/wechat/sessions",
        "/v1/channels/wechat/sessions/{session_id}/reply-capability",
        "/v1/channels/wechat/sessions/{session_id}/outbound-messages",
    }
    assert all("bot_token" not in repr(route.response_model) for route in gateway_wechat.router().routes)
    source = inspect.getsource(gateway_wechat)
    assert "AgentSessionAdapter" not in source
    assert "SessionManager" not in source


def test_legacy_mapping_is_only_recorded_as_safe_non_correlatable_evidence(tmp_path, monkeypatch) -> None:
    legacy = tmp_path / "daemons" / "desktop" / "wechat_sessions.json"
    legacy.parent.mkdir(parents=True)
    legacy.write_text(json.dumps({
        "schema_version": 2,
        "sessions": {"wechat_session_1": {"owner": "wechat-user:opaque"}},
        "current": {"wechat-user:opaque": "wechat_session_1"},
    }), encoding="utf-8")
    monkeypatch.setattr(gateway_wechat, "WORKSPACE_DIR", str(tmp_path))

    class Recorder:
        def __init__(self): self.values = []
        def record_channel_migration(self, **values): self.values.append(values)

    recorder = Recorder()
    gateway_wechat._audit_legacy_mapping(recorder)
    assert len(recorder.values) == 1
    assert recorder.values[0]["record_count"] == 1
    assert recorder.values[0]["status"] == "unable_to_correlate"
    assert "wechat-user:opaque" not in repr(recorder.values)


def test_explicit_desktop_outbound_requires_confirmation_capability_and_idempotency(monkeypatch) -> None:
    class ActiveBot:
        def __init__(self):
            self.calls = []

        def desktop_outbound_capability(self, session_id):
            return {"available": session_id == "session-12345678901234567890", "reason": None if session_id == "session-12345678901234567890" else "waiting_for_inbound"}

        async def send_desktop_outbound(self, session_id, *, text, idempotency_key):
            self.calls.append((session_id, text, idempotency_key))
            return {"delivery_id": "delivery-one", "session_id": session_id, "status": "sent", "attempt_count": 1, "error_code": None}

    bot = ActiveBot()
    monkeypatch.setattr(gateway_wechat, "_active_bot", bot)
    monkeypatch.setenv("OPENDRSAI_WECHAT_DESKTOP_OUTBOUND_ENABLED", "1")
    app = FastAPI()
    app.include_router(gateway_wechat.router())
    client = TestClient(app)
    session_id = "session-12345678901234567890"

    capability = client.get(f"/v1/channels/wechat/sessions/{session_id}/reply-capability")
    assert capability.status_code == 200 and capability.json() == {"available": True, "reason": None}
    rejected = client.post(
        f"/v1/channels/wechat/sessions/{session_id}/outbound-messages",
        headers={"Idempotency-Key": "desktop-outbound-0001"},
        json={"text": "reply", "confirm_external_send": False},
    )
    assert rejected.status_code == 400 and bot.calls == []
    accepted = client.post(
        f"/v1/channels/wechat/sessions/{session_id}/outbound-messages",
        headers={"Idempotency-Key": "desktop-outbound-0001"},
        json={"text": "reply", "confirm_external_send": True},
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "sent"
    assert bot.calls == [(session_id, "reply", "desktop-outbound-0001")]


def test_desktop_outbound_fails_closed_without_leaking_session_existence(monkeypatch) -> None:
    class GuardedBot:
        def __init__(self):
            self.calls = []

        def desktop_outbound_capability(self, _session_id):
            # Unknown sessions and known sessions whose reply context expired
            # deliberately have the same outward response.
            return {"available": False, "reason": "waiting_for_inbound"}

        async def send_desktop_outbound(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            raise AssertionError("unavailable sessions must never reach provider send")

    bot = GuardedBot()
    monkeypatch.setattr(gateway_wechat, "_active_bot", bot)
    monkeypatch.setenv("OPENDRSAI_WECHAT_DESKTOP_OUTBOUND_ENABLED", "1")
    app = FastAPI(); app.include_router(gateway_wechat.router())
    client = TestClient(app)
    headers = {"Idempotency-Key": "desktop-outbound-guard-0001"}

    for session_id in ("session-known-looking-123456", "session-attacker-selected-999999"):
        capability = client.get(f"/v1/channels/wechat/sessions/{session_id}/reply-capability")
        assert capability.status_code == 200
        assert capability.json() == {"available": False, "reason": "waiting_for_inbound"}
        response = client.post(
            f"/v1/channels/wechat/sessions/{session_id}/outbound-messages",
            headers=headers,
            json={"text": "must not leave Desktop", "confirm_external_send": True},
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "waiting_for_inbound"

    assert bot.calls == []


def test_desktop_outbound_feature_flag_and_channel_state_are_fail_closed(monkeypatch) -> None:
    class ActiveBot:
        def __init__(self): self.calls = []
        def desktop_outbound_capability(self, _session_id):
            return {"available": True, "reason": None}
        async def send_desktop_outbound(self, *args, **kwargs):
            self.calls.append((args, kwargs))
            raise AssertionError("disabled outbound must not call the Bot")

    bot = ActiveBot()
    monkeypatch.setattr(gateway_wechat, "_active_bot", bot)
    monkeypatch.setenv("OPENDRSAI_WECHAT_DESKTOP_OUTBOUND_ENABLED", "0")
    app = FastAPI(); app.include_router(gateway_wechat.router())
    client = TestClient(app)
    session_id = "session-12345678901234567890"
    body = {"text": "blocked", "confirm_external_send": True}
    headers = {"Idempotency-Key": "desktop-outbound-disabled-0001"}

    assert client.get(f"/v1/channels/wechat/sessions/{session_id}/reply-capability").json() == {
        "available": False,
        "reason": "feature_disabled",
    }
    disabled = client.post(
        f"/v1/channels/wechat/sessions/{session_id}/outbound-messages",
        headers=headers,
        json=body,
    )
    assert disabled.status_code == 409
    assert disabled.json()["detail"]["code"] == "wechat_outbound_disabled"

    monkeypatch.setenv("OPENDRSAI_WECHAT_DESKTOP_OUTBOUND_ENABLED", "1")
    monkeypatch.setattr(gateway_wechat, "_active_bot", None)
    stopped = client.post(
        f"/v1/channels/wechat/sessions/{session_id}/outbound-messages",
        headers=headers,
        json=body,
    )
    assert stopped.status_code == 409
    assert stopped.json()["detail"]["code"] == "channel_not_running"
    assert bot.calls == []


def test_controller_restores_enabled_channel_after_runtime_restart(tmp_path) -> None:
    credentials = tmp_path / "credentials.json"
    credentials.write_text(json.dumps({
        "bot_token": "legacy-secret",
        "account_id": "account-123456",
        "user_id": "user",
        "login_time": 1_800_000_000.0,
    }), encoding="utf-8")
    secure_root = tmp_path / "secure"
    auth = WeChatAuthService(credentials, now=lambda: 1_800_000_001.0, credential_root=secure_root)

    async def runner(_credentials):
        await asyncio.Future()

    async def scenario():
        first = WeChatChannelController(auth, runner)
        await first.start()
        await first.stop(persist=False)
        assert json.loads((tmp_path / "channel.json").read_text())["enabled"] is True
        second = WeChatChannelController(auth, runner)
        assert (await second.restore())["runtime_state"] == "running"
        await second.stop()

    asyncio.run(scenario())


def test_controller_maps_expired_runtime_credentials_to_reconnect_state(tmp_path) -> None:
    credentials = tmp_path / "credentials.json"
    credentials.write_text(json.dumps({
        "bot_token": "legacy-secret",
        "account_id": "account-123456",
        "user_id": "user",
        "login_time": 1_800_000_000.0,
    }), encoding="utf-8")
    auth = WeChatAuthService(credentials, now=lambda: 1_800_000_001.0, credential_root=tmp_path / "secure")

    async def runner(_credentials):
        raise WeChatCredentialsExpired("wechat_credentials_expired")

    async def scenario():
        controller = WeChatChannelController(auth, runner)
        await controller.start()
        await asyncio.sleep(0)
        status = await controller.status()
        assert status["runtime_state"] == "failed"
        assert status["credential_state"] == "expired"
        assert status["error_code"] == "wechat_credentials_expired"

    asyncio.run(scenario())


def test_gateway_http_contract_never_returns_runtime_credentials(tmp_path, monkeypatch) -> None:
    clock = Clock()
    responses = [
        {"ret": 0, "qrcode_img_content": "qr-visible-content", "qrcode": "qr-provider-secret"},
        {
            "status": "confirmed",
            "bot_token": "bot-runtime-secret",
            "ilink_bot_id": "account-123456",
            "ilink_user_id": "provider-user-secret",
        },
    ]

    async def transport(_url):
        return responses.pop(0)

    auth = WeChatAuthService(tmp_path / "credentials.json", transport=transport, now=clock, credential_root=tmp_path / "secure")

    async def runner(_credentials):
        await asyncio.Future()

    controller = WeChatChannelController(auth, runner)
    monkeypatch.setattr(gateway_wechat, "_auth", auth)
    monkeypatch.setattr(gateway_wechat, "controller", controller)
    app = FastAPI(); app.include_router(gateway_wechat.router())
    client = TestClient(app)

    assert client.get("/v1/channels/wechat/status").json()["credential_state"] == "missing"
    started = client.post("/v1/channels/wechat/login").json()
    assert started["qr_content"] == "qr-visible-content"
    confirmed = client.post(f"/v1/channels/wechat/login/{started['operation_id']}/poll").json()
    assert confirmed["status"] == "confirmed"
    serialized = json.dumps([started, confirmed, client.get("/v1/channels/wechat/status").json()])
    assert "bot-runtime-secret" not in serialized
    assert "provider-user-secret" not in serialized
    assert "qr-provider-secret" not in serialized
    assert client.post("/v1/channels/wechat/start").json()["runtime_state"] == "running"
    assert client.post("/v1/channels/wechat/stop").json()["runtime_state"] == "stopped"
    assert client.delete("/v1/channels/wechat/credentials").json()["configured"] is False
    missing = client.post("/v1/channels/wechat/login/not-valid/poll")
    assert missing.status_code == 404
    assert "secret" not in missing.text.lower()
