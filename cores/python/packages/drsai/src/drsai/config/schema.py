"""Typed, immutable configuration objects.

Secrets deliberately do not participate in normal stringification or
serialization. Code that needs the actual value must call ``reveal()`` at the
last possible moment, immediately before constructing an API client.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Mapping

WireApi = Literal["openai", "anthropic", "gemini"]
ImageModelOperation = Literal["image_generation", "image_edit"]
ModelModality = Literal["text", "image", "audio", "video"]
ModelCapability = Literal["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"]


@dataclass(frozen=True)
class ProviderModelConfig:
    alias: str | None = None
    input_modalities: tuple[ModelModality, ...] = ("text",)
    output_modalities: tuple[ModelModality, ...] = ("text",)
    api_protocol: WireApi = "openai"
    enabled: bool = True
    capabilities: tuple[ModelCapability, ...] = ("chat",)
    upstream_id: str | None = None

    def public_dict(self) -> dict[str, object]:
        return {
            **({"alias": self.alias} if self.alias else {}),
            "input_modalities": list(self.input_modalities),
            "output_modalities": list(self.output_modalities),
            "api_protocol": self.api_protocol,
            "enabled": self.enabled,
            "capabilities": list(self.capabilities),
            **({"upstream_id": self.upstream_id} if self.upstream_id else {}),
        }


class SecretValue:
    """A small redacting wrapper around sensitive text."""

    __slots__ = ("__value",)

    def __init__(self, value: str) -> None:
        if not isinstance(value, str) or not value:
            raise ValueError("SecretValue requires a non-empty string")
        self.__value = value

    def reveal(self) -> str:
        return self.__value

    def __str__(self) -> str:
        return "********"

    def __repr__(self) -> str:
        return "SecretValue('********')"

    def __bool__(self) -> bool:
        return bool(self.__value)


@dataclass(frozen=True)
class ReasoningCapabilities:
    supported: bool = False
    effort_levels: tuple[str, ...] = ()
    param_type: str = "none"


@dataclass(frozen=True)
class ModelCapabilities:
    token_limit: int = 128_000
    max_tokens: int = 8_192
    # Unknown models are fail-closed. Registry/provider metadata may opt into
    # capabilities, but a model name alone must never imply support.
    vision: bool = False
    function_calling: bool = False
    json_output: bool = False
    structured_output: bool = False
    token_model: str = "gpt-4o-2024-11-20"
    reasoning: ReasoningCapabilities = field(default_factory=ReasoningCapabilities)


@dataclass(frozen=True)
class ProviderConfig:
    name: str
    base_url: str
    anthropic_base_url: str | None = None
    google_base_url: str | None = None
    wire_api: WireApi = "openai"
    requires_api_key: bool = True
    api_key: SecretValue | None = field(default=None, repr=False)
    api_key_source: str | None = None
    models_file: str | None = None
    models: tuple[str, ...] = ()
    model_aliases: Mapping[str, str] = field(default_factory=dict)
    model_upstream_ids: Mapping[str, str] = field(default_factory=dict)
    model_operations: Mapping[str, tuple[ImageModelOperation, ...]] = field(default_factory=dict)
    model_configs: Mapping[str, ProviderModelConfig] = field(default_factory=dict)

    @property
    def has_api_key(self) -> bool:
        return self.api_key is not None

    def public_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "base_url": self.base_url,
            "anthropic_base_url": self.anthropic_base_url,
            "google_base_url": self.google_base_url,
            "wire_api": self.wire_api,
            "requires_api_key": self.requires_api_key,
            "has_api_key": self.has_api_key,
            "api_key_source": self.api_key_source,
            "models_file": self.models_file,
            "models": list(self.models),
            "model_configs": {model_id: config.public_dict() for model_id, config in self.model_configs.items()},
            "model_aliases": dict(self.model_aliases),
            "model_upstream_ids": dict(self.model_upstream_ids),
            "model_operations": {key: list(value) for key, value in self.model_operations.items()},
        }


@dataclass(frozen=True)
class ProviderInput:
    name: str
    base_url: str | None = None
    anthropic_base_url: str | None = None
    google_base_url: str | None = None
    wire_api: WireApi | None = None
    requires_api_key: bool | None = None
    api_key: str | None = field(default=None, repr=False)
    api_key_env: str | None = None
    api_key_credential: str | None = None
    models_file: str | None = None
    models: tuple[str, ...] = ()
    model_aliases: Mapping[str, str] = field(default_factory=dict)
    model_upstream_ids: Mapping[str, str] = field(default_factory=dict)
    model_operations: Mapping[str, tuple[ImageModelOperation, ...]] = field(default_factory=dict)
    model_configs: Mapping[str, ProviderModelConfig] = field(default_factory=dict)


@dataclass(frozen=True)
class DrSaiConfig:
    model: str | None = None
    model_provider: str | None = None
    config_version: int | None = None
    providers: Mapping[str, ProviderInput] = field(default_factory=dict)
    source_path: str | None = None


@dataclass(frozen=True)
class ResolvedModelConfig:
    # `model` is the exact upstream request ID. `model_id` is the canonical
    # Provider-local identity selected by the user.
    model: str
    provider: ProviderConfig
    capabilities: ModelCapabilities
    known_model: bool
    metadata_source: str
    model_id: str | None = None

    def public_dict(self) -> dict[str, object]:
        return {
            "model": self.model_id or self.model,
            "upstream_model_id": self.model,
            "model_provider": self.provider.name,
            "provider": self.provider.public_dict(),
            "metadata": {
                "known_model": self.known_model,
                "metadata_source": self.metadata_source,
                "token_limit": self.capabilities.token_limit,
                "max_tokens": self.capabilities.max_tokens,
                "vision": self.capabilities.vision,
                "reasoning": {
                    "supported": self.capabilities.reasoning.supported,
                    "effort_levels": list(self.capabilities.reasoning.effort_levels),
                    "param_type": self.capabilities.reasoning.param_type,
                },
            },
        }
