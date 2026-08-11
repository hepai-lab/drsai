"""Comment-preserving updates for the compact TOML configuration.

Only legacy top-level model selection fields and ``model_providers.<name>``
tables are owned by this module. All unrelated tables, comments and unknown fields are
kept byte-for-byte apart from normalized line endings around edited fields.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import tomllib
from pathlib import Path
from typing import Mapping

from .defaults import CURRENT_CONFIG_VERSION
from .loader import ConfigError, default_config_path

_TABLE_RE = re.compile(r"^\s*\[([^\]]+)]\s*(?:#.*)?$")
_KEY_RE = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=")
_PROVIDER_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def update_model_selection(
    *,
    model: str,
    model_provider: str,
    path: str | Path | None = None,
) -> None:
    if not model.strip():
        raise ConfigError("model must be a non-empty string")
    _validate_provider_name(model_provider)
    config_path = Path(path) if path is not None else default_config_path()
    lines = _read_lines(config_path)
    lines = _set_top_level(lines, "config_version", str(CURRENT_CONFIG_VERSION))
    lines = _set_top_level(lines, "model", _toml_string(model.strip()))
    lines = _set_top_level(lines, "model_provider", _toml_string(model_provider))
    _atomic_write(config_path, lines)


def remove_legacy_model_selection(*, path: str | Path | None = None) -> None:
    """Remove the retired process-wide model fields after Agent-policy migration."""
    config_path = Path(path) if path is not None else default_config_path()
    lines = _read_lines(config_path)
    first_table = next((index for index, line in enumerate(lines) if _TABLE_RE.match(line)), len(lines))
    retired = {"model", "model_provider"}
    lines = [
        line for index, line in enumerate(lines)
        if not (
            index < first_table
            and (match := _KEY_RE.match(line)) is not None
            and match.group(1) in retired
        )
    ]
    _atomic_write(config_path, lines)


def upsert_provider(
    name: str,
    values: Mapping[str, object],
    *,
    path: str | Path | None = None,
) -> None:
    _validate_provider_name(name)
    normalized_values = dict(values)
    legacy_wire_api = normalized_values.pop("wire_api", None)
    legacy_google_url = normalized_values.pop("gemini_base_url", None)
    if legacy_google_url and not normalized_values.get("google_base_url"):
        normalized_values["google_base_url"] = legacy_google_url
    if legacy_wire_api == "anthropic" and not normalized_values.get("anthropic_base_url") and normalized_values.get("base_url"):
        normalized_values["anthropic_base_url"] = normalized_values["base_url"]
    if legacy_wire_api == "gemini" and not normalized_values.get("google_base_url") and normalized_values.get("base_url"):
        normalized_values["google_base_url"] = normalized_values["base_url"]
    model_values = normalized_values.pop("models", None)
    legacy_aliases = normalized_values.pop("model_aliases", {})
    legacy_upstream_ids = normalized_values.pop("model_upstream_ids", {})
    legacy_operations = normalized_values.pop("model_operations", {})
    if model_values is not None:
        normalized_values["models_file"] = normalized_values.get("models_file") or f"configs/models/provider_{name}.toml"
        model_values = _normalize_model_configs(
            model_values,
            aliases=legacy_aliases,
            upstream_ids=legacy_upstream_ids,
            operations=legacy_operations,
            default_protocol=str(legacy_wire_api or "openai"),
        )
    values = normalized_values
    allowed = {
        "base_url",
        "anthropic_base_url",
        "google_base_url",
        "api_key",
        "api_key_env",
        "api_key_credential",
        "requires_api_key",
        "models_file",
    }
    unknown = set(values) - allowed
    if unknown:
        raise ConfigError(f"Unsupported provider fields: {', '.join(sorted(unknown))}")
    key_sources = [key for key in ("api_key", "api_key_env", "api_key_credential") if values.get(key)]
    if len(key_sources) > 1:
        raise ConfigError("Set only one of api_key, api_key_env, or api_key_credential")

    config_path = Path(path) if path is not None else default_config_path()
    lines = _read_lines(config_path)
    effective_values = dict(values)
    existing = _existing_provider_values(lines, name)
    if model_values is None and not effective_values.get("models_file") and isinstance(existing.get("models_file"), str):
        effective_values["models_file"] = existing["models_file"]
    if (
        effective_values.get("requires_api_key") is not False
        and not any(effective_values.get(key) for key in ("api_key", "api_key_env", "api_key_credential"))
    ):
        for key in ("api_key", "api_key_env", "api_key_credential"):
            if existing.get(key):
                effective_values[key] = existing[key]
                break
    start, end = _find_provider_table(lines, name)
    rendered = [f"[model_providers.{name}]\n"]
    for key in (
        "base_url",
        "anthropic_base_url",
        "google_base_url",
        "api_key",
        "api_key_env",
        "api_key_credential",
        "requires_api_key",
        "models_file",
    ):
        value = effective_values.get(key)
        if value is None:
            continue
        if isinstance(value, bool):
            encoded = "true" if value else "false"
        elif isinstance(value, str) and value.strip():
            encoded = _toml_string(value.strip())
        else:
            raise ConfigError(f"model_providers.{name}.{key} has an invalid value")
        rendered.append(f"{key} = {encoded}\n")
    rendered.append("\n")

    if model_values is not None:
        models_path = _resolve_models_file(config_path, str(effective_values["models_file"]), provider_name=name)
        _atomic_write(models_path, _render_model_configs(model_values))

    if start is None:
        if lines and lines[-1].strip():
            lines.append("\n")
        lines.extend(rendered)
    else:
        lines[start:end] = rendered
    lines = _set_top_level(lines, "config_version", str(CURRENT_CONFIG_VERSION))
    _atomic_write(config_path, lines)


def _normalize_model_configs(
    value: object,
    *,
    aliases: object,
    upstream_ids: object,
    operations: object,
    default_protocol: str,
) -> Mapping[str, object]:
    if isinstance(value, Mapping):
        return value
    if not isinstance(value, (list, tuple)) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ConfigError("models has an invalid value")
    alias_map = aliases if isinstance(aliases, Mapping) else {}
    upstream_map = upstream_ids if isinstance(upstream_ids, Mapping) else {}
    operation_map = operations if isinstance(operations, Mapping) else {}
    result: dict[str, object] = {}
    for raw_model_id in value:
        model_id = raw_model_id.strip()
        model_operations = operation_map.get(model_id, [])
        capabilities = ["chat", *list(model_operations)] if isinstance(model_operations, (list, tuple)) else ["chat"]
        input_modalities = ["text", "image"] if "image_edit" in capabilities else ["text"]
        output_modalities = ["text", "image"] if any(item in capabilities for item in ("image_generation", "image_edit")) else ["text"]
        result[model_id] = {
            **({"alias": alias_map[model_id]} if model_id in alias_map else {}),
            "input_modalities": input_modalities,
            "output_modalities": output_modalities,
            "api_protocol": default_protocol,
            "enabled": True,
            "capabilities": capabilities,
            **({"upstream_id": upstream_map[model_id]} if model_id in upstream_map else {}),
        }
    return result


def _render_model_configs(value: Mapping[str, object]) -> list[str]:
    if len(value) > 500:
        raise ConfigError("models contains too many entries")
    allowed_modalities = {"text", "image", "audio", "video"}
    allowed_protocols = {"openai", "anthropic", "gemini"}
    allowed_capabilities = {"chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"}
    rendered: list[str] = ["# Model catalog for this Provider. Managed by OpenDrSai.\n"]
    for model_id, raw in value.items():
        if not isinstance(model_id, str) or not model_id.strip() or not isinstance(raw, Mapping):
            raise ConfigError("models contains an invalid entry")
        alias = raw.get("alias")
        legacy_modalities = raw.get("modalities")
        input_modalities = raw.get("input_modalities", legacy_modalities if legacy_modalities is not None else ["text"])
        output_modalities = raw.get("output_modalities", legacy_modalities if legacy_modalities is not None else ["text"])
        protocol = raw.get("api_protocol", "openai")
        enabled = raw.get("enabled", True)
        capabilities = raw.get("capabilities", ["chat"])
        upstream_id = raw.get("upstream_id")
        if alias is not None and (not isinstance(alias, str) or not alias.strip()):
            raise ConfigError(f"models.{model_id}.alias is invalid")
        if legacy_modalities is not None and ("input_modalities" in raw or "output_modalities" in raw):
            raise ConfigError(f"models.{model_id} cannot mix modalities with input/output modalities")
        if not isinstance(input_modalities, (list, tuple)) or not input_modalities or len(set(input_modalities)) != len(input_modalities) or not set(input_modalities) <= allowed_modalities:
            raise ConfigError(f"models.{model_id}.input_modalities is invalid")
        if not isinstance(output_modalities, (list, tuple)) or not output_modalities or len(set(output_modalities)) != len(output_modalities) or not set(output_modalities) <= allowed_modalities:
            raise ConfigError(f"models.{model_id}.output_modalities is invalid")
        if protocol not in allowed_protocols or not isinstance(enabled, bool):
            raise ConfigError(f"models.{model_id} protocol or enabled state is invalid")
        if not isinstance(capabilities, (list, tuple)) or len(set(capabilities)) != len(capabilities) or not set(capabilities) <= allowed_capabilities:
            raise ConfigError(f"models.{model_id}.capabilities is invalid")
        capability_set = set(capabilities)
        input_set, output_set = set(input_modalities), set(output_modalities)
        if "image_generation" in capability_set and "image" not in output_set:
            raise ConfigError(f"models.{model_id}.image_generation requires image output")
        if "image_edit" in capability_set and not ("image" in input_set and "image" in output_set):
            raise ConfigError(f"models.{model_id}.image_edit requires image input and output")
        if "speech_to_text" in capability_set and not ("audio" in input_set and "text" in output_set):
            raise ConfigError(f"models.{model_id}.speech_to_text requires audio input and text output")
        if "text_to_speech" in capability_set and not ("text" in input_set and "audio" in output_set):
            raise ConfigError(f"models.{model_id}.text_to_speech requires text input and audio output")
        if "video_generation" in capability_set and "video" not in output_set:
            raise ConfigError(f"models.{model_id}.video_generation requires video output")
        rendered.extend([
            "\n",
            f"[models.{_toml_string(model_id.strip())}]\n",
            *([f"alias = {_toml_string(alias.strip())}\n"] if isinstance(alias, str) else []),
            "input_modalities = [" + ", ".join(_toml_string(str(item)) for item in input_modalities) + "]\n",
            "output_modalities = [" + ", ".join(_toml_string(str(item)) for item in output_modalities) + "]\n",
            f"api_protocol = {_toml_string(str(protocol))}\n",
            f"enabled = {'true' if enabled else 'false'}\n",
            "capabilities = [" + ", ".join(_toml_string(str(item)) for item in capabilities) + "]\n",
            *([f"upstream_id = {_toml_string(upstream_id.strip())}\n"] if isinstance(upstream_id, str) and upstream_id.strip() else []),
        ])
    return rendered


def _resolve_models_file(config_path: Path, value: str, *, provider_name: str) -> Path:
    relative = Path(value)
    if relative.is_absolute() or relative.suffix.lower() != ".toml":
        raise ConfigError(f"model_providers.{provider_name}.models_file must be a relative TOML path")
    root = config_path.resolve().parent
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ConfigError(f"model_providers.{provider_name}.models_file must stay inside the config directory") from exc
    return target


def delete_provider(name: str, *, path: str | Path | None = None) -> bool:
    _validate_provider_name(name)
    config_path = Path(path) if path is not None else default_config_path()
    lines = _read_lines(config_path)
    start, end = _find_provider_table(lines, name)
    if start is None:
        return False
    del lines[start:end]
    while start < len(lines) and start > 0 and not lines[start].strip() and not lines[start - 1].strip():
        del lines[start]
    _atomic_write(config_path, lines)
    return True


def replace_config_text(text: str, *, path: str | Path | None = None) -> None:
    """Atomically commit an already assembled TOML document."""
    config_path = Path(path) if path is not None else default_config_path()
    _atomic_write(config_path, text.splitlines(keepends=True))


def replace_models_file_text(
    models_file: str,
    text: str,
    *,
    path: str | Path | None = None,
    provider_name: str = "provider",
) -> None:
    """Atomically commit one Provider model catalog below the config root."""
    config_path = Path(path) if path is not None else default_config_path()
    target = _resolve_models_file(config_path, models_file, provider_name=provider_name)
    _atomic_write(target, text.splitlines(keepends=True))


def _read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        return path.read_text(encoding="utf-8").splitlines(keepends=True)
    except OSError as exc:
        raise ConfigError(f"Cannot read {path}: {exc}") from exc


def _set_top_level(lines: list[str], key: str, encoded_value: str) -> list[str]:
    first_table = next((index for index, line in enumerate(lines) if _TABLE_RE.match(line)), len(lines))
    for index in range(first_table):
        match = _KEY_RE.match(lines[index])
        if match and match.group(1) == key:
            suffix = "\n" if lines[index].endswith(("\n", "\r")) else ""
            lines[index] = f"{key} = {encoded_value}{suffix}"
            return lines
    insertion = first_table
    lines.insert(insertion, f"{key} = {encoded_value}\n")
    return lines


def _find_provider_table(lines: list[str], name: str) -> tuple[int | None, int | None]:
    expected = f"model_providers.{name}"
    for index, line in enumerate(lines):
        match = _TABLE_RE.match(line)
        if not match or match.group(1).strip() != expected:
            continue
        end = index + 1
        while end < len(lines) and not _TABLE_RE.match(lines[end]):
            end += 1
        return index, end
    return None, None


def _existing_provider_values(lines: list[str], name: str) -> dict[str, object]:
    if not lines:
        return {}
    try:
        document = tomllib.loads("".join(lines))
    except tomllib.TOMLDecodeError:
        return {}
    providers = document.get("model_providers")
    if not isinstance(providers, dict):
        return {}
    provider = providers.get(name)
    return dict(provider) if isinstance(provider, dict) else {}


def _atomic_write(path: Path, lines: list[str]) -> None:
    text = "".join(lines)
    try:
        tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"Refusing to write invalid TOML: {exc}") from exc
    path.parent.mkdir(parents=True, exist_ok=True)
    existed = path.exists()
    backup: Path | None = None
    if existed:
        backup = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup)
        try:
            backup.chmod(0o600)
        except OSError:
            pass
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    replaced = False
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
        replaced = True
        path.chmod(0o600)
        _sync_directory(path.parent)
    except Exception as exc:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        if replaced:
            try:
                if existed and backup is not None and backup.is_file():
                    rollback = path.with_name(f".{path.name}.rollback.tmp")
                    shutil.copy2(backup, rollback)
                    os.replace(rollback, path)
                else:
                    path.unlink(missing_ok=True)
            except OSError as rollback_exc:
                raise ConfigError(
                    f"Configuration commit failed and rollback also failed: {rollback_exc}"
                ) from exc
        raise ConfigError(f"Configuration commit failed: {exc}") from exc


def _sync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _validate_provider_name(name: str) -> None:
    if not isinstance(name, str) or not _PROVIDER_NAME_RE.fullmatch(name):
        raise ConfigError("provider name may contain only letters, numbers, '_' and '-'")


def _toml_string(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
    return f'"{escaped}"'
