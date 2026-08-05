from __future__ import annotations

import asyncio
import pytest
from types import SimpleNamespace

from drsai.backend import gateway
from drsai.config.loader import parse_user_config


class _Manager:
    async def evict_user(self, _user_id: str) -> int:
        return 2

    async def mark_user_config_stale(self, _user_id: str) -> int:
        return 7

    async def model_config_state(self, _user_id: str):
        return {"configured_revision": "a" * 64, "runtime_revisions": [], "runtime_status": "not_started", "active_runtime_count": 0}


def _custom_config(*, with_key: bool = True):
    provider = {
        "base_url": "https://provider.example/v1",
        "wire_api": "openai",
    }
    if with_key:
        provider["api_key"] = "gateway-secret"
    return parse_user_config(
        {
            "model": "custom-model",
            "model_provider": "custom",
            "model_providers": {"custom": provider},
        },
        source_path="/test/config.toml",
    )


def test_get_active_model_config_is_redacted(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    payload = asyncio.run(gateway.get_active_model_config())

    assert payload["model"] == "custom-model"
    assert payload["provider"]["has_api_key"] is True
    assert "gateway-secret" not in repr(payload)


def test_model_state_and_doctor_are_redacted(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway, "default_model_config_path", lambda: tmp_path / "config.toml")
    monkeypatch.setattr(gateway, "model_config_revision", lambda *_args: "a" * 64)
    monkeypatch.setattr(gateway, "last_known_good_path", lambda _path: tmp_path / "missing")
    state = asyncio.run(gateway.get_model_config_state())
    assert state["effective"]["provider"]["has_api_key"] is True
    assert "gateway-secret" not in repr(state)
    assert state["runtime"]["runtime_status"] == "not_started"

    monkeypatch.setattr(gateway, "diagnose_model_config", lambda **_kwargs: {"ok": True, "checks": []})
    assert asyncio.run(gateway.doctor_model_config()) == {"ok": True, "checks": []}


def test_restore_model_config_marks_runtime_stale(monkeypatch) -> None:
    config = _custom_config(with_key=False)
    resolved = gateway.resolve_model_config(config, environ={}, require_credentials=False)
    monkeypatch.setattr(
        gateway,
        "restore_last_known_good",
        lambda **_kwargs: SimpleNamespace(resolved=resolved, revision="b" * 64),
    )
    monkeypatch.setattr(gateway, "manager", _Manager())
    payload = asyncio.run(gateway.restore_model_config(gateway.ModelConfigRestoreRequest()))
    assert payload["ok"] is True
    assert payload["config_revision"] == 7
    assert "gateway-secret" not in repr(payload)


def test_gateway_lists_presets_and_discovers_models(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(
        gateway,
        "discover_provider_models",
        lambda _resolved, refresh=False: _async_value({"ok": True, "models": ["custom-model"], "cached": False}),
    )
    presets = asyncio.run(gateway.get_model_provider_presets())
    assert any(item["id"] == "openai" for item in presets["presets"])
    result = asyncio.run(
        gateway.discover_model_provider_models(gateway.ModelDiscoveryRequest(provider="custom"))
    )
    assert result["models"] == ["custom-model"]


async def _async_value(value):
    return value


def test_agent_manager_reports_pending_applied_and_mixed_revisions(monkeypatch) -> None:
    manager = gateway.AgentManager()
    monkeypatch.setattr(gateway, "model_config_revision", lambda *_args: "b" * 64)
    assert asyncio.run(manager.model_config_state("user"))["runtime_status"] == "not_started"

    manager._agent_model_config_revisions["user:old"] = "a" * 64
    pending = asyncio.run(manager.model_config_state("user"))
    assert pending["runtime_status"] == "pending_next_turn"
    assert pending["active_runtime_count"] == 1

    manager._agent_model_config_revisions["user:new"] = "b" * 64
    assert asyncio.run(manager.model_config_state("user"))["runtime_status"] == "partially_applied"
    manager._agent_model_config_revisions.pop("user:old")
    assert asyncio.run(manager.model_config_state("user"))["runtime_status"] == "applied"


def test_agent_manager_keeps_old_runtime_when_new_client_creation_fails(monkeypatch) -> None:
    manager = gateway.AgentManager()
    old_agent = SimpleNamespace()
    manager._agents["user:thread"] = old_agent
    manager._agent_config_revisions["user:thread"] = 0
    manager._config_revisions["user"] = 1
    manager._agent_config_stamps["user:thread"] = None

    async def fail_create(**_kwargs):
        raise RuntimeError("new client failed")

    async def no_remote_tools(*_args, **_kwargs):
        return [], []

    monkeypatch.setattr(gateway, "create_agent", fail_create)
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", no_remote_tools)
    monkeypatch.setattr(gateway, "_get_db", lambda: object())
    with pytest.raises(RuntimeError, match="new client failed"):
        asyncio.run(manager.get_or_create("thread", user_id="user"))
    assert manager._agents["user:thread"] is old_agent
    assert manager._agent_config_revisions["user:thread"] == 0


def test_put_provider_never_returns_submitted_key(monkeypatch) -> None:
    captured = {}

    def commit(request, **_kwargs):
        captured["request"] = request
        config = _custom_config()
        return SimpleNamespace(
            config=config,
            resolved=gateway.resolve_model_config(config, environ={}, require_credentials=False),
            revision="b" * 64,
            warnings=(),
        )

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway, "manager", _Manager())
    request = gateway.ModelProviderConfigRequest(
        base_url="https://provider.example/v1",
        api_key="gateway-secret",
    )
    payload = asyncio.run(gateway.put_model_provider_config("custom", request))

    assert "api_key" not in captured["request"].provider_values
    assert captured["request"].provider_secret == "gateway-secret"
    assert payload["provider"]["has_api_key"] is True
    assert payload["evicted_sessions"] == 0
    assert payload["config_revision"] == 7
    assert "gateway-secret" not in repr(payload)


def test_active_model_and_provider_commit_in_one_transaction(monkeypatch) -> None:
    captured = []

    def commit(request, **_kwargs):
        captured.append(request)
        config = _custom_config()
        return SimpleNamespace(
            config=config,
            resolved=gateway.resolve_model_config(config, environ={}, require_credentials=False),
            revision="b" * 64,
            warnings=(),
        )

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "manager", _Manager())
    payload = asyncio.run(gateway.set_active_model_config(gateway.ActiveModelConfigRequest(
        model="custom-model",
        model_provider="custom",
        base_url="https://provider.example/v1",
        api_key="one-transaction-secret",
    )))
    assert len(captured) == 1
    assert captured[0].provider_name == "custom"
    assert captured[0].model == "custom-model"
    assert captured[0].provider_secret == "one-transaction-secret"
    assert "one-transaction-secret" not in repr(payload)


def test_gateway_preview_is_redacted_and_does_not_commit(monkeypatch) -> None:
    config = _custom_config()
    resolved = gateway.resolve_model_config(config, environ={}, require_credentials=False)
    monkeypatch.setattr(
        gateway,
        "preview_model_config_update",
        lambda _request, **_kwargs: SimpleNamespace(
            resolved=resolved,
            base_revision="a" * 64,
        ),
    )
    monkeypatch.setattr(gateway, "commit_model_config_update", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not commit")))
    payload = asyncio.run(gateway.preview_active_model_config(gateway.ActiveModelConfigRequest(
        model="custom-model", model_provider="custom", base_url="https://provider.example/v1", api_key="preview-secret"
    )))
    assert payload["persisted"] is False
    assert payload["base_revision"] == "a" * 64
    assert "preview-secret" not in repr(payload)


def test_delete_active_provider_falls_back_to_hepai(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    def commit(request, **_kwargs):
        calls.append(request)
        config = _custom_config()
        return SimpleNamespace(config=config, resolved=None, revision="b" * 64, warnings=())

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "manager", _Manager())
    payload = asyncio.run(gateway.remove_model_provider_config("custom"))

    assert calls[0].delete_provider_name == "custom"
    assert calls[0].model == "custom-model"
    assert calls[0].delete_provider_credential is True
    assert calls[0].model_provider == "hepai"
    assert payload["active"] == "hepai"


def test_delete_provider_can_keep_credential(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway, "commit_model_config_update", lambda request, **_kwargs: calls.append(request) or SimpleNamespace(revision="b" * 64))
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "manager", _Manager())
    payload = asyncio.run(gateway.remove_model_provider_config("custom", delete_credential=False))
    assert calls[0].delete_provider_credential is False
    assert calls[0].model_provider == "hepai"
    assert payload["active"] == "hepai"


def test_provider_edit_without_new_key_preserves_stored_credential(monkeypatch) -> None:
    config = parse_user_config({
        "model": "custom-model",
        "model_provider": "custom",
        "model_providers": {
            "custom": {
                "base_url": "https://provider.example/v1",
                "api_key_credential": "drsai-credential:00000000-0000-0000-0000-000000000001",
            }
        },
    })
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: config)
    def commit(request, **_kwargs):
        return SimpleNamespace(
            config=config,
            resolved=gateway.resolve_model_config(config, environ={}, require_credentials=False),
            revision="b" * 64,
            warnings=(),
        )

    monkeypatch.setattr(gateway, "commit_model_config_update", commit)
    monkeypatch.setattr(gateway, "model_config_revision", lambda: "a" * 64)
    monkeypatch.setattr(gateway, "manager", _Manager())

    payload = asyncio.run(gateway.put_model_provider_config(
        "custom",
        gateway.ModelProviderConfigRequest(base_url="https://new.example/v1"),
    ))

    assert payload["ok"] is True


class _Response:
    status_code = 401


class _FakeHttpClient:
    def __init__(self, *, timeout: float):
        self.timeout = timeout
        self.seen_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, _url, *, headers):
        self.seen_headers = headers
        return _Response()


def test_connection_test_classifies_authentication_without_leaking_key(monkeypatch) -> None:
    monkeypatch.setattr(gateway, "load_model_provider_config", lambda: _custom_config())
    monkeypatch.setattr(gateway.httpx, "AsyncClient", _FakeHttpClient)
    payload = asyncio.run(
        gateway.test_model_provider_config(
            "custom", gateway.ModelProviderTestRequest(model="custom-model")
        )
    )

    assert payload["ok"] is False
    assert payload["error"] == "authentication_failed"
    assert payload["status_code"] == 401
    assert payload["guidance"]["code"] == "authentication_failed"
    assert "gateway-secret" not in repr(payload)


def test_marking_model_config_stale_does_not_interrupt_active_agent() -> None:
    class ActiveAgent:
        closed = False

        async def close(self):
            self.closed = True

    manager = gateway.AgentManager()
    agent = ActiveAgent()
    manager._agents["user:thread"] = agent

    revision = asyncio.run(manager.mark_user_config_stale("user"))

    assert revision == 1
    assert manager._agents["user:thread"] is agent
    assert agent.closed is False


def test_failed_config_refresh_keeps_previous_agent_available(monkeypatch) -> None:
    class ActiveAgent:
        closed = False

        async def close(self):
            self.closed = True

    async def no_remote_tools():
        return [], None

    def fail_create(**_kwargs):
        raise RuntimeError("invalid replacement config")

    manager = gateway.AgentManager()
    agent = ActiveAgent()
    manager._agents["user:thread"] = agent
    manager._agent_config_revisions["user:thread"] = 0
    manager._config_revisions["user"] = 0
    manager._agent_config_stamps["user:thread"] = (1, 10)
    monkeypatch.setattr(gateway, "_model_config_stamp", lambda: (2, 20))
    monkeypatch.setattr(gateway, "_load_remote_hepai_tools", no_remote_tools)
    monkeypatch.setattr(gateway, "_get_db", lambda: object())
    monkeypatch.setattr(gateway, "_get_default_model_alias", lambda: "default-model")
    monkeypatch.setattr(gateway, "create_agent", fail_create)

    with pytest.raises(RuntimeError, match="invalid replacement"):
        asyncio.run(manager.get_or_create("thread", "user"))

    assert manager._agents["user:thread"] is agent
    assert agent.closed is False


def test_gateway_draft_probe_does_not_persist_or_return_key(monkeypatch) -> None:
    captured = {}

    async def probe(draft, **kwargs):
        captured["draft"] = draft
        captured["mode"] = kwargs["mode"]
        return {"ok": True, "persisted": False, "mode": kwargs["mode"]}

    monkeypatch.setattr(gateway, "probe_provider_draft", probe)
    request = gateway.ModelProviderDraftTestRequest(
        name="draft",
        base_url="https://provider.example/v1",
        model="draft-model",
        api_key="one-time-secret",
        mode="basic",
    )

    payload = asyncio.run(gateway.test_model_provider_draft(request))

    assert payload == {"ok": True, "persisted": False, "mode": "basic"}
    assert captured["draft"].api_key == "one-time-secret"
    assert "one-time-secret" not in repr(payload)
