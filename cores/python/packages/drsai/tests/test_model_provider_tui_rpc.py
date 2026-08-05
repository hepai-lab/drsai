from __future__ import annotations

from drsai.backend.tui_gateway.handlers import slash
from drsai.backend.tui_gateway.adapter.agent_runner import AgentSession
import drsai.config as model_config
from types import SimpleNamespace
from drsai.config.loader import parse_user_config
from drsai.backend.tui_gateway.adapter import agent_runner


def _config():
    return parse_user_config(
        {
            "model": "custom-model",
            "model_provider": "custom",
            "model_providers": {
                "custom": {
                    "base_url": "https://provider.example/v1",
                    "api_key": "tui-secret",
                }
            },
        },
        source_path="/test/config.toml",
    )


def test_tui_config_get_is_redacted(monkeypatch) -> None:
    monkeypatch.setattr(slash, "load_user_config", _config)
    result = slash._model_provider_config_get(1, {})

    assert result["result"]["model"] == "custom-model"
    assert result["result"]["provider"]["has_api_key"] is True
    assert "tui-secret" not in repr(result)


def test_tui_model_options_includes_compact_model(monkeypatch) -> None:
    monkeypatch.setattr(slash, "load_user_config", _config)
    monkeypatch.setattr(slash, "load_config", lambda: {})
    monkeypatch.setattr(slash, "load_llm_mode_config", lambda _path: {})
    result = slash._model_options(2, {})

    assert result["result"]["current"] == "custom-model"
    assert result["result"]["models"][0]["provider"] == "custom"


def test_tui_config_save_writes_provider_and_selection(monkeypatch) -> None:
    calls = []
    def commit(request, **_kwargs):
        calls.append(request)
        resolved = model_config.resolve_model_config(_config(), environ={}, require_credentials=False)
        return SimpleNamespace(resolved=resolved, revision="b" * 64)

    monkeypatch.setattr(slash, "commit_update", commit)
    monkeypatch.setattr(slash, "load_user_config", _config)
    result = slash._model_provider_config_save(
        3,
        {
            "provider": "custom",
            "model": "custom-model",
            "base_url": "https://provider.example/v1",
            "api_key_env": "CUSTOM_KEY",
            "wire_api": "openai",
            "requires_api_key": True,
        },
    )

    assert "error" not in result
    assert calls[0].provider_name == "custom"
    assert calls[0].provider_values["api_key_env"] == "CUSTOM_KEY"
    assert calls[0].model == "custom-model"
    assert calls[0].model_provider == "custom"


def test_tui_connection_test_returns_only_redacted_result(monkeypatch) -> None:
    monkeypatch.setattr(slash, "load_user_config", _config)

    async def probe(resolved):
        assert resolved.provider.api_key.reveal() == "tui-secret"
        return {"ok": False, "error": "authentication_failed", "status_code": 401}

    monkeypatch.setattr(slash, "test_provider_connection", probe)
    result = slash._model_provider_config_test(4, {"provider": "custom", "model": "custom-model"})

    assert result["result"] == {
        "ok": False,
        "error": "authentication_failed",
        "status_code": 401,
    }
    assert "tui-secret" not in repr(result)


def test_tui_draft_test_does_not_commit(monkeypatch) -> None:
    captured = {}

    async def probe(draft, **kwargs):
        captured["draft"] = draft
        captured["kwargs"] = kwargs
        return {"ok": True, "persisted": False, "mode": "basic"}

    monkeypatch.setattr(slash, "probe_provider_draft", probe)
    monkeypatch.setattr(slash, "commit_update", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("must not commit")))
    result = slash._model_provider_config_test_draft(6, {
        "provider": "draft",
        "model": "draft-model",
        "base_url": "https://draft.example/v1",
        "api_key": "draft-secret",
    })

    assert result["result"]["persisted"] is False
    assert captured["draft"].name == "draft"
    assert "draft-secret" not in repr(result)


def test_tui_presets_are_available(monkeypatch) -> None:
    result = slash._model_provider_presets(7, {})
    assert any(item["id"] == "ollama" for item in result["result"]["presets"])


def test_tui_manual_toml_edit_refreshes_model_before_next_turn(monkeypatch) -> None:
    session = AgentSession.__new__(AgentSession)
    session.agent = type("Agent", (), {"_defult_config_name": "old-model"})()
    session._model_config_stamp = (1, 10)
    switched = []
    monkeypatch.setattr(AgentSession, "_read_model_config_stamp", staticmethod(lambda: (2, 20)))
    monkeypatch.setattr(model_config, "load_user_config", _config)
    session.switch_model = lambda alias: switched.append(alias) or True

    session._refresh_model_config_if_changed()

    assert switched == ["custom-model"]
    assert session._model_config_stamp == (2, 20)


def test_tui_failed_hot_reload_keeps_old_model_and_retries(monkeypatch) -> None:
    session = AgentSession.__new__(AgentSession)
    session.agent = type("Agent", (), {"_defult_config_name": "old-model"})()
    session._model_config_stamp = (1, 10)
    monkeypatch.setattr(AgentSession, "_read_model_config_stamp", staticmethod(lambda: (2, 20)))
    monkeypatch.setattr(model_config, "load_user_config", _config)
    session.switch_model = lambda _alias: False

    session._refresh_model_config_if_changed()

    assert session.agent._defult_config_name == "old-model"
    assert session._model_config_stamp == (1, 10)


def test_tui_client_swap_telemetry_classifies_success_failure_and_unavailable(monkeypatch) -> None:
    model_config.clear_telemetry()
    session = AgentSession.__new__(AgentSession)
    session._loop = object()
    session._model_config_stamp = None
    monkeypatch.setattr(AgentSession, "_read_model_config_stamp", staticmethod(lambda: (2, 20)))
    def finish_coro(_loop, coro, **_kwargs):
        coro.close()
    monkeypatch.setattr(agent_runner, "_run_coro", finish_coro)

    class Agent:
        _defult_config_name = "old"
        _set_model_client = staticmethod(lambda alias: {"alias": alias})

        async def switch_model(self, _client):
            return None

    session.agent = Agent()
    assert session.switch_model("new") is True
    session.agent._set_model_client = lambda _alias: (_ for _ in ()).throw(RuntimeError("synthetic"))
    assert session.switch_model("broken") is False
    session.agent = None
    assert session.switch_model("unavailable") is False

    snapshot = model_config.telemetry_snapshot()
    assert snapshot["client_swap_succeeded"] == 1
    assert snapshot["client_swap_failed"] == 1
    assert snapshot["client_swap_unavailable"] == 1


def test_tui_save_reports_when_current_session_keeps_old_model(monkeypatch) -> None:
    resolved = model_config.resolve_model_config(_config(), environ={}, require_credentials=False)
    monkeypatch.setattr(
        slash,
        "commit_update",
        lambda _request, **_kwargs: SimpleNamespace(resolved=resolved, revision="c" * 64),
    )
    monkeypatch.setattr(slash.session_module, "_resolve_user_id", lambda: "user")
    session = SimpleNamespace(switch_model=lambda _model: False, info=lambda: {})
    monkeypatch.setattr(slash.session_module, "_ensure_agent_session", lambda *_args: session)
    monkeypatch.setattr(slash, "_emit", lambda *_args: None)

    result = slash._model_provider_config_save(
        5,
        {"provider": "custom", "model": "custom-model", "session_id": "session"},
    )

    assert result["result"]["ok"] is True
    assert result["result"]["runtime_applied"] is False
    assert "previous model" in result["result"]["warning"]
