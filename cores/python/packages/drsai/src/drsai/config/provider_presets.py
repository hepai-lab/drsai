"""User-facing provider presets kept outside the compact user TOML."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Final, Literal

from .defaults import DEFAULT_OPENAI_BASE_URL


@dataclass(frozen=True)
class ProviderPreset:
    id: str
    label: str
    description: str
    base_url: str
    anthropic_base_url: str | None = None
    google_base_url: str | None = None
    default_model: str | None = None
    wire_api: str = "openai"
    requires_api_key: bool = True
    api_key_env: str | None = None
    base_url_editable: bool = False
    supports_model_discovery: bool = True
    recommended_test_mode: str = "basic"
    docs_id: str | None = None
    auth_mode: Literal["oidc", "api_key", "none"] = "api_key"

    def public_dict(self) -> dict[str, object]:
        return {key: value for key, value in asdict(self).items() if value is not None}


PROVIDER_PRESETS: Final[dict[str, ProviderPreset]] = {
    "hepai": ProviderPreset(
        "hepai", "HepAI（高能 AI 平台）", "HepAI hosted model service", DEFAULT_OPENAI_BASE_URL,
        default_model="deepseek-v4-pro", requires_api_key=False, docs_id="hepai", auth_mode="oidc"
    ),
    "openai": ProviderPreset(
        "openai", "OpenAI", "OpenAI API", "https://api.openai.com/v1",
        default_model="gpt-5.4", api_key_env="OPENAI_API_KEY", docs_id="openai"
    ),
    "anthropic": ProviderPreset(
        "anthropic", "Anthropic", "Anthropic Messages API", "https://api.anthropic.com/v1",
        anthropic_base_url="https://api.anthropic.com/v1", default_model="claude-sonnet-4-6", wire_api="anthropic", api_key_env="ANTHROPIC_API_KEY"
    ),
    "deepseek": ProviderPreset(
        "deepseek", "DeepSeek", "DeepSeek OpenAI-compatible API", "https://api.deepseek.com/v1",
        default_model="deepseek-chat", api_key_env="DEEPSEEK_API_KEY", docs_id="deepseek"
    ),
    "gemini": ProviderPreset(
        "gemini", "Gemini", "Google Gemini native API", "https://generativelanguage.googleapis.com/v1beta",
        google_base_url="https://generativelanguage.googleapis.com/v1beta", default_model="gemini-3.6-flash", wire_api="gemini", api_key_env="GEMINI_API_KEY", docs_id="gemini"
    ),
    "openrouter": ProviderPreset(
        "openrouter", "OpenRouter", "OpenRouter multi-model API", "https://openrouter.ai/api/v1",
        default_model="openai/gpt-5.4", api_key_env="OPENROUTER_API_KEY", docs_id="openrouter"
    ),
    "zhizengzeng": ProviderPreset(
        "zhizengzeng", "智增增", "Zhizengzeng OpenAI-compatible API", "https://api.zhizengzeng.com/v1",
        anthropic_base_url="https://api.zhizengzeng.com/anthropic",
        google_base_url="https://api.zhizengzeng.com/google",
        default_model="deepseek-v4-pro", api_key_env="ZHIZENGZENG_API_KEY", docs_id="zhizengzeng"
    ),
    "ollama": ProviderPreset(
        "ollama", "Ollama (local)", "Local Ollama OpenAI-compatible service", "http://127.0.0.1:11434/v1",
        requires_api_key=False, base_url_editable=True, auth_mode="none"
    ),
    "custom-openai": ProviderPreset(
        "custom-openai", "Custom OpenAI-compatible", "Custom service using the OpenAI wire protocol", "http://127.0.0.1:8000/v1",
        requires_api_key=False, base_url_editable=True, auth_mode="none"
    ),
    "custom-anthropic": ProviderPreset(
        "custom-anthropic", "Custom Anthropic-compatible", "Custom service using the Anthropic wire protocol", "http://127.0.0.1:8000/v1",
        anthropic_base_url="http://127.0.0.1:8000/v1", wire_api="anthropic", requires_api_key=False, base_url_editable=True, auth_mode="none"
    ),
}


def list_provider_presets() -> list[dict[str, object]]:
    return [PROVIDER_PRESETS[name].public_dict() for name in PROVIDER_PRESETS]


def get_provider_preset(name: str) -> ProviderPreset | None:
    return PROVIDER_PRESETS.get(name)
