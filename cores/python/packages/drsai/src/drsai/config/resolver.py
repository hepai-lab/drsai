"""Resolve user choices, built-ins and environment into runtime config."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from dataclasses import replace
from urllib.parse import urlparse

from .defaults import DEFAULT_MODEL, DEFAULT_PROVIDER
from .credentials import resolve_credential
from .loader import ConfigError
from .model_registry import find_model_capabilities
from .provider_registry import BUILTIN_PROVIDERS
from .schema import DrSaiConfig, ProviderConfig, ProviderInput, ResolvedModelConfig, SecretValue


def resolve_model_config(
    config: DrSaiConfig,
    *,
    environ: Mapping[str, str] | None = None,
    model: str | None = None,
    provider: str | None = None,
    credential_resolver: Any | None = None,
    require_credentials: bool = True,
) -> ResolvedModelConfig:
    env = environ or {}
    model_name = _first_nonempty(model, env.get("DRSAI_MODEL"), config.model, DEFAULT_MODEL)
    provider_name = _first_nonempty(
        provider, env.get("DRSAI_MODEL_PROVIDER"), config.model_provider, DEFAULT_PROVIDER
    )
    provider_name = _normalize_legacy_provider_for_model(provider_name, model_name)
    provider_config = _resolve_provider(
        provider_name,
        config.providers.get(provider_name),
        env,
        credential_resolver,
        require_credentials,
    )
    model_config = provider_config.model_configs.get(model_name)
    if model_config is not None:
        if not model_config.enabled:
            raise ConfigError(f"Model '{model_name}' is disabled for provider '{provider_name}'")
        provider_config = _provider_for_protocol(
            provider_config, provider_id=provider_name, model_id=model_name, protocol=model_config.api_protocol,
        )
    capabilities, known = find_model_capabilities(model_name)
    if model_config is not None:
        capabilities = replace(
            capabilities,
            vision="image" in model_config.input_modalities,
            function_calling="tool_calling" in model_config.capabilities,
            # Built-in capabilities describe what a known model can do. A
            # persisted catalog may add reasoning for an unknown model, but it
            # must not accidentally erase known DeepSeek reasoning support.
            reasoning=replace(
                capabilities.reasoning,
                supported=capabilities.reasoning.supported or "reasoning" in model_config.capabilities,
            ),
        )
    return ResolvedModelConfig(
        model=model_config.upstream_id if model_config and model_config.upstream_id else model_name,
        provider=provider_config,
        capabilities=capabilities,
        known_model=known,
        metadata_source="builtin" if known else "generic-default",
        model_id=model_name,
    )


def _resolve_provider(
    name: str,
    user: ProviderInput | None,
    environ: Mapping[str, str],
    credential_resolver: Any | None,
    require_credentials: bool,
) -> ProviderConfig:
    builtin = BUILTIN_PROVIDERS.get(name, {})
    if user is None and not builtin:
        raise ConfigError(f"Unknown model provider '{name}'; define [model_providers.{name}]")

    base_url = user.base_url if user and user.base_url else _string_value(builtin.get("base_url"))
    if not base_url:
        raise ConfigError(f"model_providers.{name}.base_url is required")
    def validated_url(field: str, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ConfigError(f"model_providers.{name}.{field} must be an absolute http(s) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ConfigError(
                f"model_providers.{name}.{field} must not contain credentials, query parameters, or fragments"
            )
        return value.rstrip("/")

    base_url = validated_url("base_url", base_url)
    assert base_url is not None
    anthropic_base_url = validated_url(
        "anthropic_base_url", user.anthropic_base_url if user else _string_value(builtin.get("anthropic_base_url"))
    )
    google_base_url = validated_url(
        "google_base_url", user.google_base_url if user else _string_value(builtin.get("google_base_url"))
    )

    wire_api = user.wire_api if user and user.wire_api else _string_value(builtin.get("wire_api")) or "openai"
    if wire_api not in {"openai", "anthropic", "gemini"}:
        raise ConfigError(f"model_providers.{name}.wire_api must be 'openai', 'anthropic', or 'gemini'")
    requires_key = (
        user.requires_api_key
        if user and user.requires_api_key is not None
        else bool(builtin.get("requires_api_key", True))
    )

    secret: SecretValue | None = None
    source: str | None = None
    if user and user.api_key:
        secret, source = SecretValue(user.api_key), "config"
    elif user and user.api_key_env:
        value = environ.get(user.api_key_env)
        if value:
            secret, source = SecretValue(value), f"env:{user.api_key_env}"
    elif user and user.api_key_credential:
        resolver = credential_resolver or resolve_credential
        value = resolver(user.api_key_credential)
        if value:
            secret, source = SecretValue(value), "credential"
        elif require_credentials and requires_key:
            raise ConfigError(
                f"Model provider '{name}' has an unavailable saved API credential; enter the API Key again"
            )
    else:
        builtin_env = _string_value(builtin.get("api_key_env"))
        if builtin_env and environ.get(builtin_env):
            secret, source = SecretValue(environ[builtin_env]), f"env:{builtin_env}"

    if require_credentials and requires_key and secret is None:
        declared_env = user.api_key_env if user else _string_value(builtin.get("api_key_env"))
        hint = f"; set environment variable {declared_env}" if declared_env else ""
        raise ConfigError(f"Model provider '{name}' requires an API key{hint}")

    return ProviderConfig(
        name=name,
        base_url=base_url,
        anthropic_base_url=anthropic_base_url,
        google_base_url=google_base_url,
        wire_api=wire_api,  # type: ignore[arg-type]
        requires_api_key=requires_key,
        api_key=secret,
        api_key_source=source,
        models_file=user.models_file if user else None,
        models=user.models if user else (),
        model_aliases=user.model_aliases if user else {},
        model_upstream_ids=user.model_upstream_ids if user else {},
        model_operations=user.model_operations if user else {},
        model_configs=user.model_configs if user else {},
    )


def _provider_for_protocol(
    provider: ProviderConfig, *, provider_id: str, model_id: str, protocol: str,
) -> ProviderConfig:
    protocol_url = (
        provider.anthropic_base_url if protocol == "anthropic"
        else provider.google_base_url if protocol == "gemini"
        else provider.base_url if protocol == "openai"
        else None
    )
    if protocol_url is None:
        if protocol == provider.wire_api:
            protocol_url = provider.base_url
        else:
            field = "anthropic_base_url" if protocol == "anthropic" else "google_base_url" if protocol == "gemini" else "base_url"
            raise ConfigError(
                f"Model '{model_id}' uses {protocol}, but model_providers.{provider_id}.{field} is not configured"
            )
    return replace(provider, wire_api=protocol, base_url=protocol_url)  # type: ignore[arg-type]


def resolve_model_ref(
    config: DrSaiConfig,
    *,
    provider_id: str,
    model_id: str,
    environ: Mapping[str, str] | None = None,
    credential_resolver: Any | None = None,
    require_credentials: bool = True,
) -> ResolvedModelConfig:
    """Resolve a canonical ModelRef without fallback or cross-Provider guessing."""

    env = environ or {}
    provider_config = _resolve_provider(
        provider_id,
        config.providers.get(provider_id),
        env,
        credential_resolver,
        require_credentials,
    )
    configured_models = provider_config.models
    if not configured_models and config.model_provider == provider_id and config.model:
        configured_models = (config.model,)
    if not configured_models:
        raise ConfigError(f"Model provider '{provider_id}' has no selectable models")
    if model_id not in configured_models:
        raise ConfigError(f"Model '{model_id}' is not configured for provider '{provider_id}'")
    model_config = provider_config.model_configs.get(model_id)
    if model_config is not None and not model_config.enabled:
        raise ConfigError(f"Model '{model_id}' is disabled for provider '{provider_id}'")
    if model_config is not None:
        provider_config = _provider_for_protocol(
            provider_config, provider_id=provider_id, model_id=model_id, protocol=model_config.api_protocol,
        )
    upstream_model_id = model_config.upstream_id if model_config and model_config.upstream_id else provider_config.model_upstream_ids.get(model_id, model_id)
    capabilities, known = find_model_capabilities(model_id)
    if not known and upstream_model_id != model_id:
        capabilities, known = find_model_capabilities(upstream_model_id)
    if model_config is not None:
        capabilities = replace(
            capabilities,
            vision="image" in model_config.input_modalities,
            function_calling="tool_calling" in model_config.capabilities,
            reasoning=replace(
                capabilities.reasoning,
                supported=capabilities.reasoning.supported or "reasoning" in model_config.capabilities,
            ),
        )
    return ResolvedModelConfig(
        model=upstream_model_id,
        model_id=model_id,
        provider=provider_config,
        capabilities=capabilities,
        known_model=known,
        metadata_source="builtin" if known else "unknown",
    )


def _first_nonempty(*values: str | None) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise AssertionError("at least one non-empty default is required")


def _normalize_legacy_provider_for_model(provider_name: str, model_name: str) -> str:
    if provider_name != "legacy-anthropic":
        return provider_name
    normalized = model_name.strip().lower()
    if normalized.startswith(("claude-", "anthropic/", "claude/")):
        return provider_name
    return "hepai"


def _string_value(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
