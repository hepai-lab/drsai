"""Read and validate the compact ``~/.drsai/config.toml`` file."""

from __future__ import annotations

import tomllib
import os
from pathlib import Path
from typing import Any, Mapping

from drsai.configs.constant import FS_DIR

from .schema import DrSaiConfig, ProviderInput, ProviderModelConfig, WireApi


class ConfigError(ValueError):
    """A user-actionable configuration error."""


def default_config_path() -> Path:
    return Path(os.environ.get("DRSAI_HOME", FS_DIR)).expanduser() / "config.toml"


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
    current_agent = _optional_nonempty_string(raw, "current_agent")
    agent_config_file = _optional_nonempty_string(raw, "agent_config_file")
    if (current_agent is None) != (agent_config_file is None):
        raise ConfigError("current_agent and agent_config_file must be configured together")
    if current_agent is not None:
        import re
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", current_agent):
            raise ConfigError("current_agent is invalid")
        normalized_agent_file = agent_config_file.replace("\\", "/") if agent_config_file else ""
        expected_agent_file = f"configs/agents/agent_{current_agent}.toml"
        if normalized_agent_file != expected_agent_file:
            raise ConfigError(f"agent_config_file must be '{expected_agent_file}'")
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
        providers[name] = _parse_provider(name, value, source_path=source_path)

    return DrSaiConfig(
        current_agent=current_agent,
        agent_config_file=agent_config_file,
        model=model,
        model_provider=provider_name,
        config_version=config_version,
        providers=providers,
        source_path=source_path,
    )


def _parse_provider(name: str, raw: Mapping[str, Any], *, source_path: str | None) -> ProviderInput:
    base_url = _optional_nonempty_string(raw, "base_url", prefix=f"model_providers.{name}.")
    wire_api_value = _optional_nonempty_string(raw, "wire_api", prefix=f"model_providers.{name}.")
    if wire_api_value not in {None, "openai", "anthropic", "gemini"}:
        raise ConfigError(f"model_providers.{name}.wire_api must be 'openai', 'anthropic', or 'gemini'")
    requires_api_key = raw.get("requires_api_key")
    if requires_api_key is not None and not isinstance(requires_api_key, bool):
        raise ConfigError(f"model_providers.{name}.requires_api_key must be a boolean")

    anthropic_base_url = _optional_nonempty_string(raw, "anthropic_base_url", prefix=f"model_providers.{name}.")
    google_base_url = _optional_nonempty_string(raw, "google_base_url", prefix=f"model_providers.{name}.")
    legacy_gemini_base_url = _optional_nonempty_string(raw, "gemini_base_url", prefix=f"model_providers.{name}.")
    if google_base_url and legacy_gemini_base_url:
        raise ConfigError(f"model_providers.{name} must not set both google_base_url and gemini_base_url")
    google_base_url = google_base_url or legacy_gemini_base_url
    if wire_api_value == "anthropic" and anthropic_base_url is None:
        anthropic_base_url = base_url
    if wire_api_value == "gemini" and google_base_url is None:
        google_base_url = base_url
    api_key = _optional_nonempty_string(raw, "api_key", prefix=f"model_providers.{name}.")
    api_key_env = _optional_nonempty_string(raw, "api_key_env", prefix=f"model_providers.{name}.")
    api_key_credential = _optional_nonempty_string(
        raw, "api_key_credential", prefix=f"model_providers.{name}."
    )
    models_file = _optional_nonempty_string(raw, "models_file", prefix=f"model_providers.{name}.")
    models_value = raw.get("models")
    if models_file is not None:
        if models_value is not None:
            raise ConfigError(f"model_providers.{name} must not set both models and models_file")
        models_value = _load_models_file(models_file, source_path=source_path, provider_name=name)
    structured_models = isinstance(models_value, Mapping)
    model_configs = _optional_model_configs(models_value, default_protocol=wire_api_value or "openai", prefix=f"model_providers.{name}.models") if structured_models else {}
    models = tuple(model_configs) if structured_models else _optional_string_list(raw, "models", prefix=f"model_providers.{name}.")
    model_aliases = _optional_string_map(raw, "model_aliases", prefix=f"model_providers.{name}.")
    model_upstream_ids = _optional_string_map(raw, "model_upstream_ids", prefix=f"model_providers.{name}.")
    model_operations = _optional_model_operations(raw, "model_operations", prefix=f"model_providers.{name}.")
    if any(model_id not in models for model_id in model_aliases):
        raise ConfigError(f"model_providers.{name}.model_aliases keys must exist in models")
    if any(model_id not in models for model_id in model_upstream_ids):
        raise ConfigError(f"model_providers.{name}.model_upstream_ids keys must exist in models")
    if any(model_id not in models for model_id in model_operations):
        raise ConfigError(f"model_providers.{name}.model_operations keys must exist in models")
    if model_operations and wire_api_value not in {None, "openai"}:
        raise ConfigError(
            f"model_providers.{name}.model_operations requires wire_api = 'openai'"
        )
    configured_sources = [value for value in (api_key, api_key_env, api_key_credential) if value is not None]
    if len(configured_sources) > 1:
        raise ConfigError(
            f"model_providers.{name} must set only one of api_key, api_key_env, or api_key_credential"
        )
    return ProviderInput(
        name=name,
        base_url=base_url,
        anthropic_base_url=anthropic_base_url,
        google_base_url=google_base_url,
        wire_api=wire_api_value,  # type: ignore[arg-type]
        requires_api_key=requires_api_key,
        api_key=api_key,
        api_key_env=api_key_env,
        api_key_credential=api_key_credential,
        models_file=models_file,
        models=models,
        model_aliases=model_aliases,
        model_upstream_ids=model_upstream_ids,
        model_operations=model_operations,
        model_configs=model_configs,
    )


def _load_models_file(models_file: str, *, source_path: str | None, provider_name: str) -> object:
    if source_path is None:
        raise ConfigError(f"model_providers.{provider_name}.models_file requires a config source path")
    relative = Path(models_file)
    if relative.is_absolute() or relative.suffix.lower() != ".toml":
        raise ConfigError(f"model_providers.{provider_name}.models_file must be a relative TOML path")
    config_root = Path(source_path).expanduser().resolve().parent
    target = (config_root / relative).resolve()
    try:
        target.relative_to(config_root)
    except ValueError as exc:
        raise ConfigError(f"model_providers.{provider_name}.models_file must stay inside the config directory") from exc
    try:
        with target.open("rb") as stream:
            document = tomllib.load(stream)
    except FileNotFoundError as exc:
        raise ConfigError(f"Model configuration file not found: {target}") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"Invalid TOML in {target}: {exc}") from exc
    except OSError as exc:
        raise ConfigError(f"Cannot read {target}: {exc}") from exc
    models = document.get("models")
    if not isinstance(models, Mapping):
        raise ConfigError(f"{target} must contain a [models] table")
    return models


def _optional_model_configs(value: object, *, default_protocol: str, prefix: str) -> dict[str, ProviderModelConfig]:
    if not isinstance(value, Mapping) or len(value) > 500:
        raise ConfigError(f"{prefix} must be a model configuration map")
    modalities_allowed = {"text", "image", "audio", "video"}
    capabilities_allowed = {"chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"}
    result: dict[str, ProviderModelConfig] = {}
    for raw_model_id, raw_config in value.items():
        if not isinstance(raw_model_id, str) or not raw_model_id.strip() or len(raw_model_id) > 256 or any(char in raw_model_id for char in "\r\n\0") or not isinstance(raw_config, Mapping):
            raise ConfigError(f"{prefix} contains an invalid model entry")
        model_id = raw_model_id.strip()
        alias = raw_config.get("alias")
        if alias is not None and (not isinstance(alias, str) or not alias.strip() or len(alias) > 256 or any(char in alias for char in "\r\n\0")):
            raise ConfigError(f"{prefix}.{model_id}.alias is invalid")
        capabilities = raw_config.get("capabilities", ["chat"])
        legacy_modalities = raw_config.get("modalities")
        input_modalities = raw_config.get("input_modalities")
        output_modalities = raw_config.get("output_modalities")
        if input_modalities is None and output_modalities is None:
            legacy = legacy_modalities if isinstance(legacy_modalities, list) else ["text"]
            input_modalities = list(legacy)
            capability_values = set(capabilities) if isinstance(capabilities, list) else set()
            output_modalities = ["text"] if ({"chat", "tool_calling", "reasoning", "speech_to_text"} & capability_values) or not capability_values else []
            if {"image_generation", "image_edit"} & capability_values:
                output_modalities.append("image")
            if "text_to_speech" in capability_values:
                output_modalities.append("audio")
            if "video_generation" in capability_values:
                output_modalities.append("video")
        protocol = raw_config.get("api_protocol", default_protocol)
        enabled = raw_config.get("enabled", True)
        upstream_id = raw_config.get("upstream_id")
        if legacy_modalities is not None and ("input_modalities" in raw_config or "output_modalities" in raw_config):
            raise ConfigError(f"{prefix}.{model_id} cannot mix modalities with input/output modalities")
        if not isinstance(input_modalities, list) or not input_modalities or len(set(input_modalities)) != len(input_modalities) or not set(input_modalities) <= modalities_allowed:
            raise ConfigError(f"{prefix}.{model_id}.input_modalities is invalid")
        if not isinstance(output_modalities, list) or not output_modalities or len(set(output_modalities)) != len(output_modalities) or not set(output_modalities) <= modalities_allowed:
            raise ConfigError(f"{prefix}.{model_id}.output_modalities is invalid")
        if not isinstance(capabilities, list) or len(set(capabilities)) != len(capabilities) or not set(capabilities) <= capabilities_allowed:
            raise ConfigError(f"{prefix}.{model_id}.capabilities is invalid")
        capability_set = set(capabilities)
        input_set, output_set = set(input_modalities), set(output_modalities)
        if ({"tool_calling", "reasoning"} & capability_set) and "chat" not in capability_set:
            raise ConfigError(f"{prefix}.{model_id}.capabilities requires chat")
        if "image_generation" in capability_set and "image" not in output_set:
            raise ConfigError(f"{prefix}.{model_id}.image_generation requires image output")
        if "image_edit" in capability_set and not ({"image"} <= input_set and {"image"} <= output_set):
            raise ConfigError(f"{prefix}.{model_id}.image_edit requires image input and output")
        if "speech_to_text" in capability_set and not ({"audio"} <= input_set and {"text"} <= output_set):
            raise ConfigError(f"{prefix}.{model_id}.speech_to_text requires audio input and text output")
        if "text_to_speech" in capability_set and not ({"text"} <= input_set and {"audio"} <= output_set):
            raise ConfigError(f"{prefix}.{model_id}.text_to_speech requires text input and audio output")
        if "video_generation" in capability_set and "video" not in output_set:
            raise ConfigError(f"{prefix}.{model_id}.video_generation requires video output")
        if protocol not in {"openai", "anthropic", "gemini"}:
            raise ConfigError(f"{prefix}.{model_id}.api_protocol is invalid")
        if not isinstance(enabled, bool):
            raise ConfigError(f"{prefix}.{model_id}.enabled must be a boolean")
        if upstream_id is not None and (not isinstance(upstream_id, str) or not upstream_id.strip() or len(upstream_id) > 256):
            raise ConfigError(f"{prefix}.{model_id}.upstream_id is invalid")
        result[model_id] = ProviderModelConfig(alias=alias.strip() if isinstance(alias, str) else None, input_modalities=tuple(input_modalities), output_modalities=tuple(output_modalities), api_protocol=protocol, enabled=enabled, capabilities=tuple(capabilities), upstream_id=upstream_id.strip() if isinstance(upstream_id, str) else None)  # type: ignore[arg-type]
    return result


def _optional_model_operations(raw: Mapping[str, Any], key: str, *, prefix: str = "") -> dict[str, tuple[str, ...]]:
    value = raw.get(key)
    if value is None:
        return {}
    if not isinstance(value, Mapping) or len(value) > 500:
        raise ConfigError(f"{prefix}{key} must map model IDs to operation arrays")
    allowed = {"image_generation", "image_edit"}
    result: dict[str, tuple[str, ...]] = {}
    for model_id, operations in value.items():
        if not isinstance(model_id, str) or not model_id.strip() or not isinstance(operations, list):
            raise ConfigError(f"{prefix}{key} has an invalid entry")
        normalized = tuple(str(item) for item in operations)
        if not normalized or len(set(normalized)) != len(normalized) or not set(normalized) <= allowed:
            raise ConfigError(f"{prefix}{key}.{model_id} has unsupported or duplicate operations")
        result[model_id] = normalized
    return result


def _optional_string_map(raw: Mapping[str, Any], key: str, *, prefix: str = "") -> dict[str, str]:
    value = raw.get(key)
    if value is None:
        return {}
    if not isinstance(value, Mapping) or len(value) > 500:
        raise ConfigError(f"{prefix}{key} must be a string map")
    result: dict[str, str] = {}
    for raw_key, raw_value in value.items():
        if (
            not isinstance(raw_key, str)
            or not raw_key.strip()
            or len(raw_key) > 256
            or any(char in raw_key for char in "\r\n\0")
            or not isinstance(raw_value, str)
            or not raw_value.strip()
            or len(raw_value) > 256
            or any(char in raw_value for char in "\r\n\0")
        ):
            raise ConfigError(f"{prefix}{key} must contain valid model IDs and aliases")
        result[raw_key.strip()] = raw_value.strip()
    return result


def _optional_string_list(raw: Mapping[str, Any], key: str, *, prefix: str = "") -> tuple[str, ...]:
    value = raw.get(key)
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > 500:
        raise ConfigError(f"{prefix}{key} must be a list of strings")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str) or not item.strip() or len(item) > 256 or any(char in item for char in "\r\n\0"):
            raise ConfigError(f"{prefix}{key} must contain valid model IDs")
        model = item.strip()
        if model.lower() not in seen:
            seen.add(model.lower())
            result.append(model)
    return tuple(result)


def _optional_nonempty_string(
    raw: Mapping[str, Any], key: str, *, prefix: str = ""
) -> str | None:
    value = raw.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{prefix}{key} must be a non-empty string")
    return value.strip()
