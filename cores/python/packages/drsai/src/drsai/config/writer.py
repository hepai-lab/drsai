"""Comment-preserving updates for the compact TOML configuration.

Only the top-level model selection and ``model_providers.<name>`` tables are
owned by this module. All unrelated tables, comments and unknown fields are
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


def upsert_provider(
    name: str,
    values: Mapping[str, object],
    *,
    path: str | Path | None = None,
) -> None:
    _validate_provider_name(name)
    allowed = {
        "base_url",
        "api_key",
        "api_key_env",
        "api_key_credential",
        "wire_api",
        "requires_api_key",
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
    if (
        effective_values.get("requires_api_key") is not False
        and not any(effective_values.get(key) for key in ("api_key", "api_key_env", "api_key_credential"))
    ):
        existing = _existing_provider_values(lines, name)
        for key in ("api_key", "api_key_env", "api_key_credential"):
            if existing.get(key):
                effective_values[key] = existing[key]
                break
    start, end = _find_provider_table(lines, name)
    rendered = [f"[model_providers.{name}]\n"]
    for key in (
        "base_url",
        "api_key",
        "api_key_env",
        "api_key_credential",
        "wire_api",
        "requires_api_key",
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

    if start is None:
        if lines and lines[-1].strip():
            lines.append("\n")
        lines.extend(rendered)
    else:
        lines[start:end] = rendered
    lines = _set_top_level(lines, "config_version", str(CURRENT_CONFIG_VERSION))
    _atomic_write(config_path, lines)


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
