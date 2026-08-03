"""Read and validate the compact ``~/.drsai/config.toml`` file."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any, Mapping

from drsai.configs.constant import FS_DIR

from .schema import DrSaiConfig, ProviderInput, WireApi


class ConfigError(ValueError):
    """A user-actionable configuration error."""


def default_config_path() -> Path:
    return Path(FS_DIR) / "config.toml"


def load_user_config(path: str | Path | None = None) -> DrSaiConfig:
    config_path = Path(path).expanduser() if path is not None else default_config_path()
    if not config_path.exists():
        return DrSaiConfig(source_path=str(config_path))
    try:
        with config_path.open("rb") as stream:
            raw = tomllib.load(stream)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"Invalid TOML in {config_path}: {exc}") from exc
    except OSError as exc:
        raise ConfigError(f"Cannot read {config_path}: {exc}") from exc
    return parse_user_config(raw, source_path=str(config_path))


def parse_user_config(raw: Mapping[str, Any], *, source_path: str | None = None) -> DrSaiConfig:
    model = _optional_nonempty_string(raw, "model")
    provider_name = _optional_nonempty_string(raw, "model_provider")
    config_version = raw.get("config_version")
    if config_version is not None and (isinstance(config_version, bool) or not isinstance(config_version, int)):
        raise ConfigError("config_version must be an integer")

    provider_table = raw.get("model_providers", {})
    if not isinstance(provider_table, Mapping):
        raise ConfigError("model_providers must be a TOML table")
    providers: dict[str, ProviderInput] = {}
    for name, value in provider_table.items():
        if not isinstance(name, str) or not name.strip():
            raise ConfigError("model provider names must be non-empty strings")
        if not isinstance(value, Mapping):
            raise ConfigError(f"model_providers.{name} must be a TOML table")
        providers[name] = _parse_provider(name, value)

    return DrSaiConfig(
        model=model,
        model_provider=provider_name,
        config_version=config_version,
        providers=providers,
        source_path=source_path,
    )


def _parse_provider(name: str, raw: Mapping[str, Any]) -> ProviderInput:
    base_url = _optional_nonempty_string(raw, "base_url", prefix=f"model_providers.{name}.")
    wire_api_value = _optional_nonempty_string(raw, "wire_api", prefix=f"model_providers.{name}.")
    if wire_api_value not in {None, "openai", "anthropic"}:
        raise ConfigError(f"model_providers.{name}.wire_api must be 'openai' or 'anthropic'")
    requires_api_key = raw.get("requires_api_key")
    if requires_api_key is not None and not isinstance(requires_api_key, bool):
        raise ConfigError(f"model_providers.{name}.requires_api_key must be a boolean")

    api_key = _optional_nonempty_string(raw, "api_key", prefix=f"model_providers.{name}.")
    api_key_env = _optional_nonempty_string(raw, "api_key_env", prefix=f"model_providers.{name}.")
    api_key_credential = _optional_nonempty_string(
        raw, "api_key_credential", prefix=f"model_providers.{name}."
    )
    configured_sources = [value for value in (api_key, api_key_env, api_key_credential) if value is not None]
    if len(configured_sources) > 1:
        raise ConfigError(
            f"model_providers.{name} must set only one of api_key, api_key_env, or api_key_credential"
        )
    return ProviderInput(
        name=name,
        base_url=base_url,
        wire_api=wire_api_value,  # type: ignore[arg-type]
        requires_api_key=requires_api_key,
        api_key=api_key,
        api_key_env=api_key_env,
        api_key_credential=api_key_credential,
    )


def _optional_nonempty_string(
    raw: Mapping[str, Any], key: str, *, prefix: str = ""
) -> str | None:
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{prefix}{key} must be a non-empty string")
    return value.strip()
