"""Resolve user choices, built-ins and environment into runtime config."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
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
    capabilities, known = find_model_capabilities(model_name)
    return ResolvedModelConfig(
        model=model_name,
        provider=provider_config,
        capabilities=capabilities,
        known_model=known,
        metadata_source="builtin" if known else "generic-default",
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
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfigError(f"model_providers.{name}.base_url must be an absolute http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ConfigError(
            f"model_providers.{name}.base_url must not contain credentials, query parameters, or fragments"
        )

    wire_api = user.wire_api if user and user.wire_api else _string_value(builtin.get("wire_api")) or "openai"
    if wire_api not in {"openai", "anthropic"}:
        raise ConfigError(f"model_providers.{name}.wire_api must be 'openai' or 'anthropic'")
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
        base_url=base_url.rstrip("/"),
        wire_api=wire_api,  # type: ignore[arg-type]
        requires_api_key=requires_key,
        api_key=secret,
        api_key_source=source,
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
