"""User-facing provider presets kept outside the compact user TOML."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Final

from .defaults import DEFAULT_OPENAI_BASE_URL


@dataclass(frozen=True)
class ProviderPreset:
    id: str
    label: str
    description: str
    base_url: str
    wire_api: str = "openai"
    requires_api_key: bool = True
    api_key_env: str | None = None
    base_url_editable: bool = False
    supports_model_discovery: bool = True
    recommended_test_mode: str = "basic"
    docs_id: str | None = None

    def public_dict(self) -> dict[str, object]:
        return {key: value for key, value in asdict(self).items() if value is not None}


PROVIDER_PRESETS: Final[dict[str, ProviderPreset]] = {
    "hepai": ProviderPreset(
        "hepai", "HepAI", "HepAI hosted model service", DEFAULT_OPENAI_BASE_URL, api_key_env="HEPAI_API_KEY", docs_id="hepai"
    ),
    "openai": ProviderPreset(
        "openai", "OpenAI", "OpenAI API", "https://api.openai.com/v1", api_key_env="OPENAI_API_KEY", docs_id="openai"
    ),
    "anthropic": ProviderPreset(
        "anthropic", "Anthropic", "Anthropic Messages API", "https://api.anthropic.com/v1",
        wire_api="anthropic", api_key_env="ANTHROPIC_API_KEY"
    ),
    "deepseek": ProviderPreset(
        "deepseek", "DeepSeek", "DeepSeek OpenAI-compatible API", "https://api.deepseek.com/v1",
        api_key_env="DEEPSEEK_API_KEY", docs_id="deepseek"
    ),
    "ollama": ProviderPreset(
        "ollama", "Ollama (local)", "Local Ollama OpenAI-compatible service", "http://127.0.0.1:11434/v1",
        requires_api_key=False, base_url_editable=True
    ),
    "custom-openai": ProviderPreset(
        "custom-openai", "Custom OpenAI-compatible", "Custom service using the OpenAI wire protocol", "http://127.0.0.1:8000/v1",
        requires_api_key=False, base_url_editable=True
    ),
    "custom-anthropic": ProviderPreset(
        "custom-anthropic", "Custom Anthropic-compatible", "Custom service using the Anthropic wire protocol", "http://127.0.0.1:8000/v1",
        wire_api="anthropic", requires_api_key=False, base_url_editable=True
    ),
}


def list_provider_presets() -> list[dict[str, object]]:
    return [PROVIDER_PRESETS[name].public_dict() for name in PROVIDER_PRESETS]


def get_provider_preset(name: str) -> ProviderPreset | None:
    return PROVIDER_PRESETS.get(name)
