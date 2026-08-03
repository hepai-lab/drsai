from __future__ import annotations

from pathlib import Path

import pytest

from drsai.config import ConfigError, SecretValue, load_user_config, resolve_model_config
from drsai.config.loader import parse_user_config


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
