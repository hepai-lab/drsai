from __future__ import annotations

from pathlib import Path

import pytest

from drsai.config import ConfigError, SecretValue, load_user_config, resolve_model_config, resolve_model_ref
from drsai.config.loader import parse_user_config
from drsai.config.model_registry import find_model_capabilities


def test_builtin_gpt_5_4_declares_image_input_capability() -> None:
    capabilities, known = find_model_capabilities("openai/gpt-5.4")

    assert known is True
    assert capabilities.vision is True


def test_builtin_gemini_3_flash_declares_image_input_capability() -> None:
    capabilities, known = find_model_capabilities("google/gemini-3-flash-preview")

    assert known is True
    assert capabilities.vision is True


def test_missing_config_uses_builtin_hepai(tmp_path: Path) -> None:
    config = load_user_config(tmp_path / "missing.toml")
    resolved = resolve_model_config(config, environ={"HEPAI_API_KEY": "secret-hepai"})

    assert resolved.model == "deepseek-v4-pro"
    assert resolved.provider.name == "hepai"
    assert resolved.provider.base_url == "https://aiapi.ihep.ac.cn/apiv2"
    assert resolved.provider.api_key is not None
    assert resolved.provider.api_key.reveal() == "secret-hepai"
    assert resolved.known_model is True


def test_minimal_custom_openai_provider(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        '''model = "deepseek-chat"
model_provider = "custom"

[model_providers.custom]
base_url = "https://api.deepseek.com/v1/"
api_key_env = "DEEPSEEK_API_KEY"
''',
        encoding="utf-8",
    )
    resolved = resolve_model_config(
        load_user_config(path), environ={"DEEPSEEK_API_KEY": "secret-deepseek"}
    )

    assert resolved.model == "deepseek-chat"
    assert resolved.provider.base_url == "https://api.deepseek.com/v1"
    assert resolved.provider.wire_api == "openai"
    assert resolved.provider.api_key_source == "env:DEEPSEEK_API_KEY"
    assert resolved.known_model is False
    assert resolved.capabilities.token_limit == 128_000


def test_custom_provider_model_list_is_validated_and_public() -> None:
    config = parse_user_config({
        "model": "model-a",
        "model_provider": "custom",
        "model_providers": {"custom": {
            "base_url": "https://example.test/v1",
            "requires_api_key": False,
            "models": ["model-a", "model-b", "MODEL-A"],
            "model_aliases": {"model-a": "Fast model", "model-b": "Vision model"},
            "model_upstream_ids": {"model-a": "vendor/model-a-v2"},
        }},
    })
    resolved = resolve_model_config(config, environ={})
    assert resolved.provider.models == ("model-a", "model-b")
    assert resolved.provider.public_dict()["models"] == ["model-a", "model-b"]
    assert resolved.provider.model_aliases == {"model-a": "Fast model", "model-b": "Vision model"}
    assert resolved.provider.public_dict()["model_aliases"] == {"model-a": "Fast model", "model-b": "Vision model"}
    assert resolved.provider.model_upstream_ids == {"model-a": "vendor/model-a-v2"}


def test_provider_uses_protocol_specific_base_url_for_each_model() -> None:
    config = parse_user_config({
        "model": "openai-model",
        "model_provider": "multi",
        "model_providers": {"multi": {
            "base_url": "https://example.test/v1",
            "anthropic_base_url": "https://example.test/anthropic/",
            "google_base_url": "https://example.test/google/",
            "wire_api": "openai",
            "requires_api_key": False,
            "models": {
                "openai-model": {"modalities": ["text"], "api_protocol": "openai", "capabilities": ["chat"]},
                "claude-model": {"modalities": ["text"], "api_protocol": "anthropic", "capabilities": ["chat"]},
                "gemini-model": {"modalities": ["text"], "api_protocol": "gemini", "capabilities": ["chat"]},
            },
        }},
    })

    openai = resolve_model_ref(config, provider_id="multi", model_id="openai-model", environ={})
    anthropic = resolve_model_ref(config, provider_id="multi", model_id="claude-model", environ={})
    gemini = resolve_model_ref(config, provider_id="multi", model_id="gemini-model", environ={})

    assert openai.provider.base_url == "https://example.test/v1"
    assert anthropic.provider.base_url == "https://example.test/anthropic"
    assert anthropic.provider.wire_api == "anthropic"
    assert gemini.provider.base_url == "https://example.test/google"
    assert gemini.provider.wire_api == "gemini"


def test_model_protocol_requires_its_provider_host() -> None:
    config = parse_user_config({
        "model": "claude-model",
        "model_provider": "multi",
        "model_providers": {"multi": {
            "base_url": "https://example.test/v1",
            "wire_api": "openai",
            "requires_api_key": False,
            "models": {
                "claude-model": {"modalities": ["text"], "api_protocol": "anthropic", "capabilities": ["chat"]},
            },
        }},
    })

    with pytest.raises(ConfigError, match="anthropic_base_url is not configured"):
        resolve_model_ref(config, provider_id="multi", model_id="claude-model", environ={})


def test_image_operations_are_explicit_model_scoped_capabilities() -> None:
    config = parse_user_config({
        "model": "chat-model", "model_provider": "custom",
        "model_providers": {"custom": {
            "base_url": "https://example.test/v1", "wire_api": "openai",
            "requires_api_key": False, "models": ["chat-model", "image-model"],
            "model_operations": {"image-model": ["image_generation", "image_edit"]},
        }},
    })

    provider_input = config.providers["custom"]
    provider = resolve_model_config(config, environ={}).provider
    assert provider_input.model_operations == {
        "image-model": ("image_generation", "image_edit"),
    }
    assert provider.public_dict()["model_operations"] == {
        "image-model": ["image_generation", "image_edit"],
    }


@pytest.mark.parametrize("operations", [
    {"outside": ["image_generation"]},
    {"image-model": ["image_generation", "image_generation"]},
    {"image-model": ["chat"]},
])
def test_image_operations_fail_closed_for_invalid_declarations(operations) -> None:
    with pytest.raises(ConfigError):
        parse_user_config({
            "model": "image-model", "model_provider": "custom",
            "model_providers": {"custom": {
                "base_url": "https://example.test/v1", "wire_api": "openai",
                "requires_api_key": False, "models": ["image-model"],
                "model_operations": operations,
            }},
        })


def test_image_operations_reject_unimplemented_wire_protocol() -> None:
    with pytest.raises(ConfigError, match="requires wire_api = 'openai'"):
        parse_user_config({
            "model": "image-model", "model_provider": "custom",
            "model_providers": {"custom": {
                "base_url": "https://example.test/v1", "wire_api": "anthropic",
                "requires_api_key": False, "models": ["image-model"],
                "model_operations": {"image-model": ["image_generation"]},
            }},
        })


def test_model_ref_enforces_provider_membership_and_upstream_routing() -> None:
    config = parse_user_config({
        "model": "shared-model",
        "model_provider": "provider-a",
        "model_providers": {
            "provider-a": {
                "base_url": "https://a.example/v1", "requires_api_key": False,
                "models": ["shared-model"],
                "model_aliases": {"shared-model": "Friendly display only"},
                "model_upstream_ids": {"shared-model": "vendor-a/upstream-model"},
            },
            "provider-b": {
                "base_url": "https://b.example/v1", "requires_api_key": False,
                "models": ["shared-model"],
                "model_upstream_ids": {"shared-model": "vendor-b/upstream-model"},
            },
        },
    })
    selected_a = resolve_model_ref(config, provider_id="provider-a", model_id="shared-model", environ={})
    selected_b = resolve_model_ref(config, provider_id="provider-b", model_id="shared-model", environ={})
    assert selected_a.model_id == selected_b.model_id == "shared-model"
    assert selected_a.model == "vendor-a/upstream-model"
    assert selected_b.model == "vendor-b/upstream-model"
    assert selected_a.provider.base_url != selected_b.provider.base_url
    assert "Friendly display only" not in {selected_a.model, selected_b.model}
    with pytest.raises(ConfigError, match="is not configured"):
        resolve_model_ref(config, provider_id="provider-a", model_id="outside-catalog", environ={})


def test_model_ref_does_not_fallback_when_provider_has_no_catalog() -> None:
    config = parse_user_config({
        "model": "active-model", "model_provider": "active",
        "model_providers": {
            "active": {"base_url": "https://active.example/v1", "requires_api_key": False},
            "empty": {"base_url": "https://empty.example/v1", "requires_api_key": False},
        },
    })
    assert resolve_model_ref(config, provider_id="active", model_id="active-model", environ={}).model == "active-model"
    with pytest.raises(ConfigError, match="has no selectable models"):
        resolve_model_ref(config, provider_id="empty", model_id="active-model", environ={})


def test_model_alias_must_reference_a_configured_model() -> None:
    with pytest.raises(ConfigError, match="model_aliases keys must exist in models"):
        parse_user_config({
            "model": "model-a",
            "model_provider": "custom",
            "model_providers": {"custom": {
                "base_url": "https://example.test/v1",
                "requires_api_key": False,
                "models": ["model-a"],
                "model_aliases": {"unknown-model": "Unknown"},
            }},
        })

    with pytest.raises(ConfigError, match="model_upstream_ids keys must exist in models"):
        parse_user_config({
            "model_providers": {"custom": {
                "base_url": "https://example.test/v1", "models": ["model-a"],
                "model_upstream_ids": {"unknown-model": "vendor/unknown"},
            }},
        })


def test_local_provider_does_not_require_key() -> None:
    config = parse_user_config(
        {
            "model": "qwen3:32b",
            "model_provider": "ollama",
            "model_providers": {
                "ollama": {
                    "base_url": "http://127.0.0.1:11434/v1",
                    "requires_api_key": False,
                }
            },
        }
    )
    resolved = resolve_model_config(config, environ={})
    assert resolved.provider.has_api_key is False


def test_anthropic_wire_api() -> None:
    config = parse_user_config(
        {
            "model": "claude-sonnet-4-6",
            "model_provider": "claude",
            "model_providers": {
                "claude": {
                    "base_url": "https://example.test/anthropic",
                    "api_key": "secret-claude",
                    "wire_api": "anthropic",
                }
            },
        }
    )
    resolved = resolve_model_config(config, environ={})
    assert resolved.provider.wire_api == "anthropic"
    assert resolved.capabilities.reasoning.supported is True


def test_legacy_anthropic_hepai_model_falls_back_to_hepai_provider() -> None:
    config = parse_user_config(
        {
            "model": "hepai/deepseek-v4-pro",
            "model_provider": "legacy-anthropic",
            "model_providers": {
                "legacy-anthropic": {
                    "base_url": "https://aiapi.ihep.ac.cn/apiv2/anthropic",
                    "api_key_env": "ANTHROPIC_API_KEY",
                    "wire_api": "anthropic",
                }
            },
        }
    )
    resolved = resolve_model_config(config, environ={"HEPAI_API_KEY": "secret-hepai"})
    assert resolved.model == "hepai/deepseek-v4-pro"
    assert resolved.provider.name == "hepai"
    assert resolved.provider.wire_api == "openai"


def test_legacy_anthropic_still_handles_claude_models() -> None:
    config = parse_user_config(
        {
            "model": "claude-sonnet-4-6",
            "model_provider": "legacy-anthropic",
            "model_providers": {
                "legacy-anthropic": {
                    "base_url": "https://aiapi.ihep.ac.cn/apiv2/anthropic",
                    "api_key": "secret-claude",
                    "wire_api": "anthropic",
                }
            },
        }
    )
    resolved = resolve_model_config(config, environ={})
    assert resolved.provider.name == "legacy-anthropic"
    assert resolved.provider.wire_api == "anthropic"


def test_secret_never_appears_in_repr_or_public_response() -> None:
    secret = SecretValue("highly-sensitive")
    assert "highly-sensitive" not in str(secret)
    assert "highly-sensitive" not in repr(secret)

    config = parse_user_config(
        {
            "model_provider": "custom",
            "model_providers": {
                "custom": {"base_url": "https://example.test/v1", "api_key": "do-not-leak"}
            },
        }
    )
    resolved = resolve_model_config(config, environ={})
    assert "do-not-leak" not in repr(resolved)
    assert "do-not-leak" not in repr(resolved.public_dict())
    assert resolved.public_dict()["provider"]["has_api_key"] is True  # type: ignore[index]


@pytest.mark.parametrize("field", ["api_key", "api_key_env", "api_key_credential"])
def test_each_key_source_requires_a_value(field: str) -> None:
    with pytest.raises(ConfigError, match=field):
        parse_user_config(
            {
                "model_providers": {
                    "custom": {"base_url": "https://example.test", field: ""}
                }
            }
        )


def test_key_sources_are_mutually_exclusive() -> None:
    with pytest.raises(ConfigError, match="only one"):
        parse_user_config(
            {
                "model_providers": {
                    "custom": {
                        "base_url": "https://example.test",
                        "api_key": "secret",
                        "api_key_env": "CUSTOM_KEY",
                    }
                }
            }
        )


def test_custom_provider_never_inherits_hepai_key() -> None:
    config = parse_user_config(
        {
            "model_provider": "custom",
            "model_providers": {"custom": {"base_url": "https://example.test/v1"}},
        }
    )
    with pytest.raises(ConfigError, match="requires an API key"):
        resolve_model_config(config, environ={"HEPAI_API_KEY": "must-not-cross-provider"})


def test_command_and_environment_override_user_selection() -> None:
    config = parse_user_config({"model": "from-file", "model_provider": "hepai"})
    resolved = resolve_model_config(
        config,
        environ={
            "DRSAI_MODEL": "from-environment",
            "DRSAI_MODEL_PROVIDER": "hepai",
            "HEPAI_API_KEY": "secret",
        },
        model="from-command",
    )
    assert resolved.model == "from-command"


def test_invalid_provider_url_is_actionable() -> None:
    config = parse_user_config(
        {
            "model_provider": "custom",
            "model_providers": {
                "custom": {"base_url": "not-a-url", "requires_api_key": False}
            },
        }
    )
    with pytest.raises(ConfigError, match="absolute http"):
        resolve_model_config(config, environ={})


def test_credential_resolver() -> None:
    config = parse_user_config(
        {
            "model_provider": "custom",
            "model_providers": {
                "custom": {
                    "base_url": "https://example.test/v1",
                    "api_key_credential": "drsai/provider/custom",
                }
            },
        }
    )
    resolved = resolve_model_config(
        config,
        environ={},
        credential_resolver=lambda name: "credential-secret" if name == "drsai/provider/custom" else None,
    )
    assert resolved.provider.api_key_source == "credential"
    assert resolved.provider.api_key is not None
    assert resolved.provider.api_key.reveal() == "credential-secret"


@pytest.mark.parametrize(
    "base_url",
    [
        "https://user:password@example.test/v1",
        "https://example.test/v1?api_key=secret",
        "https://example.test/v1#secret",
    ],
)
def test_base_url_rejects_embedded_sensitive_components(base_url: str) -> None:
    config = parse_user_config({
        "model_provider": "custom",
        "model_providers": {
            "custom": {"base_url": base_url, "requires_api_key": False}
        },
    })

    with pytest.raises(ConfigError, match="must not contain"):
        resolve_model_config(config)


def test_structured_model_config_controls_protocol_capabilities_and_enabled_state() -> None:
    config = parse_user_config({
        "model": "gemini-2.5-pro",
        "model_provider": "google",
        "model_providers": {"google": {
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
            "google_base_url": "https://generativelanguage.googleapis.com/v1beta",
            "wire_api": "openai",
            "requires_api_key": False,
            "models": {
                "gemini-2.5-pro": {
                    "alias": "Gemini Pro",
                    "input_modalities": ["text", "image"],
                    "output_modalities": ["text"],
                    "api_protocol": "gemini",
                    "enabled": True,
                    "capabilities": ["chat", "tool_calling", "reasoning"],
                }
            },
        }},
    })
    resolved = resolve_model_config(config, require_credentials=False)
    assert resolved.provider.wire_api == "gemini"
    assert resolved.provider.model_configs["gemini-2.5-pro"].alias == "Gemini Pro"
    assert resolved.capabilities.vision is True
    assert resolved.capabilities.function_calling is True

    disabled = parse_user_config({
        "model": "off", "model_provider": "custom",
        "model_providers": {"custom": {"base_url": "https://example.test", "requires_api_key": False, "models": {"off": {"input_modalities": ["text"], "output_modalities": ["text"], "api_protocol": "openai", "enabled": False, "capabilities": ["chat"]}}}},
    })
    with pytest.raises(ConfigError, match="disabled"):
        resolve_model_config(disabled, require_credentials=False)


def test_structured_speech_models_validate_directional_modalities() -> None:
    config = parse_user_config({
        "model": "whisper-1", "model_provider": "speech",
        "model_providers": {"speech": {
            "base_url": "https://example.test/v1", "requires_api_key": False,
            "models": {"whisper-1": {
                "input_modalities": ["audio"], "output_modalities": ["text"],
                "api_protocol": "openai", "enabled": True, "capabilities": ["speech_to_text"],
            }},
        }},
    })
    model = config.providers["speech"].model_configs["whisper-1"]
    assert model.input_modalities == ("audio",)
    assert model.output_modalities == ("text",)

    with pytest.raises(ConfigError, match="audio input and text output"):
        parse_user_config({
            "model_providers": {"speech": {
                "base_url": "https://example.test/v1", "requires_api_key": False,
                "models": {"whisper-1": {
                    "input_modalities": ["text"], "output_modalities": ["audio"],
                    "api_protocol": "openai", "enabled": True, "capabilities": ["speech_to_text"],
                }},
            }},
        })
