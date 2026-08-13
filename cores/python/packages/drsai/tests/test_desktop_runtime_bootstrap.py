from __future__ import annotations

from pathlib import Path

from drsai.config.agent_model_policy import load_agent_model_policy
from drsai.config.desktop_bootstrap import ensure_desktop_runtime_config
from drsai.config.loader import load_user_config
from drsai.config.model_catalog import ModelRef
from drsai.config.defaults import hepai_anthropic_base_url, hepai_openai_base_url


def test_hepai_upstream_follows_desktop_platform() -> None:
    production = {
        "OPENDRSAI_ACTIVE_PLATFORM": "production",
        "OPENDRSAI_OIDC_ISSUER": "https://ai.ihep.ac.cn/api",
    }
    development = {
        "OPENDRSAI_ACTIVE_PLATFORM": "development",
        "OPENDRSAI_OIDC_ISSUER": "https://ai-dev.ihep.ac.cn/api",
    }
    assert hepai_openai_base_url(production) == "https://ai-dev.ihep.ac.cn/apiv2/v1"
    assert hepai_anthropic_base_url(production) == "https://ai-dev.ihep.ac.cn/apiv2/anthropic"
    assert hepai_openai_base_url(development) == "https://ai-dev.ihep.ac.cn/apiv2/v1"
    assert hepai_anthropic_base_url(development) == "https://ai-dev.ihep.ac.cn/apiv2/anthropic"


def test_production_slot_keeps_development_hepai_provider(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_ACTIVE_PLATFORM", "production")
    monkeypatch.setenv("OPENDRSAI_OIDC_ISSUER", "https://ai.ihep.ac.cn/api")
    monkeypatch.setenv("OPENDRSAI_MODEL_BASE_URL", "https://ai-dev.ihep.ac.cn/apiv2/v1")
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        'model = "deepseek-v4-flash"\nmodel_provider = "hepai"\n\n'
        '[model_providers.hepai]\n'
        'base_url = "https://ai-dev.ihep.ac.cn/apiv2/v1"\n'
        'anthropic_base_url = "https://ai-dev.ihep.ac.cn/apiv2/anthropic"\n'
        'google_base_url = "https://ai-dev.ihep.ac.cn/apiv2/v1"\n'
        'requires_api_key = false\n',
        encoding="utf-8",
    )

    result = ensure_desktop_runtime_config(config_path)

    assert "sync_hepai_product_models" in result.actions
    provider = load_user_config(config_path).providers["hepai"]
    assert provider.base_url == "https://ai-dev.ihep.ac.cn/apiv2/v1"
    assert provider.anthropic_base_url == "https://ai-dev.ihep.ac.cn/apiv2/anthropic"
    assert provider.google_base_url == "https://ai-dev.ihep.ac.cn/apiv2/v1"


def test_fresh_desktop_home_gets_oidc_hepai_and_default_agent(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"

    first = ensure_desktop_runtime_config(config_path)
    second = ensure_desktop_runtime_config(config_path)

    assert first.changed is True
    assert set(first.actions) == {
        "seed_hepai_oidc_provider", "sync_hepai_product_models",
        "bind_default_agent", "create_default_agent",
    }
    assert second.changed is False
    config = load_user_config(config_path)
    assert config.current_agent == "opendrsai"
    assert config.model_provider == "hepai"
    assert config.model == "deepseek-v4-flash"
    assert config.providers["hepai"].requires_api_key is False
    assert set(config.providers["hepai"].model_configs) == {
        "deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-luna",
        "gemini-3.1-flash-lite-image", "tts-1", "whisper-1",
    }
    policy = load_agent_model_policy(
        "opendrsai", path=tmp_path / "configs" / "agents" / "agent_opendrsai.toml",
    ).policy
    assert policy.primary_model.ref == ModelRef("hepai", "deepseek-v4-flash")
    assert policy.image_understanding_model.ref == ModelRef("hepai", "gpt-5.6-luna")
    assert policy.image_generation_model.ref == ModelRef("hepai", "gemini-3.1-flash-lite-image")
    assert policy.text_to_speech_model.ref == ModelRef("hepai", "tts-1")
    assert policy.speech_to_text_model.ref == ModelRef("hepai", "whisper-1")


def test_repairs_packaged_v157_legacy_hepai_without_api_key(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        'config_version = 3\nmodel = "hepai/minimax-m2.7-highspeed"\n'
        'model_provider = "legacy-anthropic"\n\n'
        '[model_providers.legacy-anthropic]\n'
        'base_url = "https://aiapi.ihep.ac.cn/apiv2/anthropic"\n'
        'api_key_env = "ANTHROPIC_API_KEY"\n',
        encoding="utf-8",
    )

    result = ensure_desktop_runtime_config(config_path)

    assert "repair_packaged_legacy_hepai_provider" in result.actions
    config = load_user_config(config_path)
    assert config.model_provider == "hepai"
    assert config.providers["hepai"].requires_api_key is False
    assert config.current_agent == "opendrsai"
    policy = load_agent_model_policy(
        "opendrsai", path=tmp_path / "configs" / "agents" / "agent_opendrsai.toml",
    ).policy
    assert policy.primary_model.ref == ModelRef("hepai", "hepai/minimax-m2.7-highspeed")


def test_preserves_custom_provider_and_uses_it_for_missing_default_agent(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        'config_version = 3\nmodel = "private-model"\nmodel_provider = "private"\n\n'
        '[model_providers.private]\nbase_url = "https://models.example.test/v1"\n'
        'requires_api_key = false\n',
        encoding="utf-8",
    )

    ensure_desktop_runtime_config(config_path)

    text = config_path.read_text(encoding="utf-8")
    assert '[model_providers.private]' in text
    assert 'base_url = "https://models.example.test/v1"' in text
    assert '[model_providers.hepai]' in text
    assert set(load_user_config(config_path).providers["hepai"].model_configs) == {
        "deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-luna",
        "gemini-3.1-flash-lite-image", "tts-1", "whisper-1",
    }
    policy = load_agent_model_policy(
        "opendrsai", path=tmp_path / "configs" / "agents" / "agent_opendrsai.toml",
    ).policy
    assert policy.primary_model.ref == ModelRef("private", "private-model")


def test_does_not_replace_missing_custom_agent(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        'config_version = 3\ncurrent_agent = "research"\n'
        'agent_config_file = "configs/agents/agent_research.toml"\n'
        'model = "private-model"\nmodel_provider = "private"\n\n'
        '[model_providers.private]\nbase_url = "https://models.example.test/v1"\n'
        'requires_api_key = false\n',
        encoding="utf-8",
    )

    result = ensure_desktop_runtime_config(config_path)

    assert result.actions == ("sync_hepai_product_models",)
    assert not (tmp_path / "configs" / "agents" / "agent_opendrsai.toml").exists()
    assert load_user_config(config_path).current_agent == "research"


def test_preserves_existing_zhizengzeng_agent_model_policy(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        'config_version = 3\ncurrent_agent = "opendrsai"\n'
        'agent_config_file = "configs/agents/agent_opendrsai.toml"\n\n'
        '[model_providers.zhizengzeng]\nbase_url = "https://api.zhizengzeng.com/v1"\n'
        'requires_api_key = false\n',
        encoding="utf-8",
    )
    agent_path = tmp_path / "configs" / "agents" / "agent_opendrsai.toml"
    agent_path.parent.mkdir(parents=True)
    roles = {
        "primary": "deepseek-v4-flash",
        "image_understanding": "gpt-5.6-luna",
        "image_generation": "gemini-3.1-flash-lite-image",
        "text_to_speech": "tts-1",
        "speech_to_text": "whisper-1",
    }
    agent_path.write_text(
        'schema_version = 2\nagent_name = "opendrsai"\nenabled = true\n\n'
        + "\n".join(
            f'[models.{role}]\nmode = "explicit"\nprovider_id = "zhizengzeng"\nmodel_id = "{model}"\n'
            for role, model in roles.items()
        ),
        encoding="utf-8",
    )

    result = ensure_desktop_runtime_config(config_path)

    assert "migrate_default_agent_to_hepai_flash" not in result.actions
    policy = load_agent_model_policy("opendrsai", path=agent_path).policy
    assert policy.primary_model.ref == ModelRef("zhizengzeng", "deepseek-v4-flash")
    assert policy.image_understanding_model.ref == ModelRef("zhizengzeng", "gpt-5.6-luna")
    assert policy.image_generation_model.ref == ModelRef("zhizengzeng", "gemini-3.1-flash-lite-image")
    assert policy.text_to_speech_model.ref == ModelRef("zhizengzeng", "tts-1")
    assert policy.speech_to_text_model.ref == ModelRef("zhizengzeng", "whisper-1")
