from __future__ import annotations

from drsai.backend import run_drsai_agent_factory as factory
from drsai.config.loader import parse_user_config


class _Client:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


def _assistant(**kwargs):
    return kwargs


def test_factory_uses_custom_openai_provider_for_initial_and_switched_model(monkeypatch, tmp_path) -> None:
    config = parse_user_config(
        {
            "model": "custom-model",
            "model_provider": "custom",
            "model_providers": {
                "custom": {
                    "base_url": "https://provider.example/v1",
                    "api_key": "factory-secret",
                }
            },
        }
    )
    current = {"config": config}
    monkeypatch.setattr(factory, "load_user_config", lambda: current["config"])
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", _Client)
    result = factory.create_agent(
        cli_cfg={"workspace_enabled": True},
        assistant_cls=_assistant,
        work_dir=str(tmp_path),
    )

    client = result["model_client"]
    assert client.kwargs["model"] == "custom-model"
    assert client.kwargs["base_url"] == "https://provider.example/v1"
    assert client.kwargs["api_key"] == "factory-secret"
    current["config"] = parse_user_config(
        {
            "model": "custom-model",
            "model_provider": "custom",
            "model_providers": {
                "custom": {
                    "base_url": "https://new-provider.example/v1",
                    "api_key": "new-factory-secret",
                }
            },
        }
    )
    switched = result["set_model_client"]("another-model")
    assert switched.kwargs["model"] == "another-model"
    assert switched.kwargs["base_url"] == "https://new-provider.example/v1"
    assert switched.kwargs["api_key"] == "new-factory-secret"


def test_factory_honors_anthropic_protocol_over_model_name_heuristics(monkeypatch, tmp_path) -> None:
    config = parse_user_config(
        {
            "model": "not-a-claude-name",
            "model_provider": "custom-anthropic",
            "model_providers": {
                "custom-anthropic": {
                    "base_url": "https://provider.example/anthropic",
                    "api_key": "anthropic-secret",
                    "wire_api": "anthropic",
                }
            },
        }
    )
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "HepAIAnthropicChatCompletionClient", _Client)
    result = factory.create_agent(
        cli_cfg={"workspace_enabled": True},
        assistant_cls=_assistant,
        work_dir=str(tmp_path),
    )

    client = result["model_client"]
    assert client.kwargs["model"] == "not-a-claude-name"
    assert client.kwargs["base_url"] == "https://provider.example/anthropic"
    assert client.kwargs["api_key"] == "anthropic-secret"
