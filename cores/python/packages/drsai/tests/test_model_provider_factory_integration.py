from __future__ import annotations

from drsai.backend import run_drsai_agent_factory as factory
from drsai.backend.runtime.agent_kernel import AgentRunConfig, agent_kernel_identity, normalize_kernel_host_port
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
    assert client.kwargs["use_responses_api"] is True
    assert result["system_message"].startswith(AgentRunConfig().authoritative_prompt())
    identity = agent_kernel_identity()
    host_port = normalize_kernel_host_port({
        "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": "desktop",
        "capabilities": [
            {"id": value, "version": 1, "required": value == "chat"}
            for value in [
                "chat", "streaming", "local_memory", "project_files", "shell", "approvals", "artifacts",
                "web_search", "web_fetch", "network.public_https",
            ]
        ],
    }, surface="desktop")
    assert result["metadata"] == {
        "agent_kernel_id": identity["kernel_id"],
        "agent_kernel_version": identity["kernel_version"],
        "agent_prompt_version": identity["prompt_version"],
        "agent_base_prompt_sha256": identity["base_prompt_sha256"],
        "agent_kernel_sha256": identity["kernel_sha256"],
        "agent_capability_manifest_version": identity["capability_manifest_version"],
        "agent_capability_manifest_sha256": identity["capability_manifest_sha256"],
        "agent_tool_manifest_version": identity["tool_manifest_version"],
        "agent_model_tool_snapshot_version": identity["model_tool_snapshot_version"],
        "kernel_host_port_protocol_version": host_port["protocol_version"],
        "kernel_host_port_sha256": host_port["sha256"],
    }
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


def test_factory_uses_responses_api_for_zhizengzeng(monkeypatch, tmp_path) -> None:
    config = parse_user_config({
        "model": "deepseek-v4-flash",
        "model_provider": "zhizengzeng",
        "model_providers": {
            "zhizengzeng": {
                "base_url": "https://api.zhizengzeng.com/v1",
                "api_key": "factory-secret",
            },
        },
    })
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", _Client)

    result = factory.create_agent(
        cli_cfg={"workspace_enabled": True},
        assistant_cls=_assistant,
        work_dir=str(tmp_path),
    )

    client = result["model_client"]
    assert client.kwargs["base_url"] == "https://api.zhizengzeng.com/v1"
    assert client.kwargs["use_responses_api"] is True
    assert client.kwargs["allow_deferred_oidc"] is False
    assert client.kwargs["model"] == "deepseek-v4-flash"


def test_factory_uses_responses_api_for_hepai_oidc_models(monkeypatch, tmp_path) -> None:
    config = parse_user_config({
        "model": "deepseek-v4-flash",
        "model_provider": "hepai",
        "model_providers": {
            "hepai": {
                "base_url": "https://ai-dev.example/apiv2/v1",
                "requires_api_key": False,
                "models": {"deepseek-v4-flash": {
                    "input_modalities": ["text"],
                    "output_modalities": ["text"],
                    "api_protocol": "openai",
                    "capabilities": ["chat", "tool_calling", "reasoning"],
                }},
            },
        },
    })
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "get_platform_auth", lambda: object())
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", _Client)

    result = factory.create_agent(
        cli_cfg={"workspace_enabled": True},
        assistant_cls=_assistant,
        work_dir=str(tmp_path),
    )

    client = result["model_client"]
    assert client.kwargs["model"] == "deepseek-v4-flash"
    assert client.kwargs["base_url"] == "https://ai-dev.example/apiv2/v1"
    assert client.kwargs["use_responses_api"] is True
    assert client.kwargs["allow_deferred_oidc"] is True


def test_oidc_login_does_not_make_env_selected_external_provider_key_optional(
    monkeypatch, tmp_path,
) -> None:
    config = parse_user_config({
        "model_providers": {
            "zhizengzeng": {
                "base_url": "https://api.zhizengzeng.com/v1",
                "api_key": "external-provider-secret",
            },
        },
    })
    real_resolve = factory.resolve_model_config
    credential_requirements: list[bool] = []

    def tracked_resolve(*args, **kwargs):
        credential_requirements.append(kwargs["require_credentials"])
        return real_resolve(*args, **kwargs)

    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "resolve_model_config", tracked_resolve)
    monkeypatch.setattr(factory, "get_platform_auth", lambda: object())
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", _Client)
    monkeypatch.setenv("DRSAI_MODEL_PROVIDER", "zhizengzeng")
    monkeypatch.setenv("DRSAI_MODEL", "deepseek-v4-flash")

    result = factory.create_agent(
        cli_cfg={"workspace_enabled": True},
        assistant_cls=_assistant,
        work_dir=str(tmp_path),
    )

    assert credential_requirements and all(credential_requirements)
    assert result["model_client"].kwargs["api_key"] == "external-provider-secret"
    assert result["model_client"].kwargs["allow_deferred_oidc"] is False


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


def test_factory_routes_structured_model_to_gemini_native_client(monkeypatch, tmp_path) -> None:
    config = parse_user_config({
        "model": "gemini-2.5-pro", "model_provider": "google",
        "model_providers": {"google": {
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "google_base_url": "https://generativelanguage.googleapis.com/v1beta",
            "api_key": "gemini-secret",
            "models": {"gemini-2.5-pro": {"input_modalities": ["text", "image"], "output_modalities": ["text"], "api_protocol": "gemini", "enabled": True, "capabilities": ["chat", "tool_calling"]}},
        }},
    })
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "GeminiNativeChatCompletionClient", _Client)
    result = factory.create_agent(cli_cfg={"workspace_enabled": True}, assistant_cls=_assistant, work_dir=str(tmp_path))
    client = result["model_client"]
    assert client.kwargs["model"] == "gemini-2.5-pro"
    assert client.kwargs["base_url"] == "https://generativelanguage.googleapis.com/v1beta"
    assert client.kwargs["api_key"] == "gemini-secret"
    assert client.kwargs["vision"] is True


def test_factory_routes_explicit_model_ref_to_non_default_provider(monkeypatch, tmp_path) -> None:
    config = parse_user_config({
        "model": "deepseek-v4-pro", "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["deepseek-v4-pro"],
            },
            "provider-b": {
                "base_url": "https://b.example/v1", "requires_api_key": False,
                "models": ["deepseek-v4-pro"],
                "model_upstream_ids": {"deepseek-v4-pro": "provider-b/upstream"},
            },
        },
    })
    monkeypatch.setattr(factory, "load_user_config", lambda: config)
    monkeypatch.setattr(factory, "HepAIChatCompletionClient", _Client)
    result = factory.create_agent(
        cli_cfg={"workspace_enabled": True}, assistant_cls=_assistant,
        work_dir=str(tmp_path), model_provider="provider-b", model_id="deepseek-v4-pro",
        defult_config_name="provider-b/upstream",
    )
    client = result["model_client"]
    assert client.kwargs["model"] == "provider-b/upstream"
    assert client.kwargs["base_url"] == "https://b.example/v1"
