"""Non-destructive migration from legacy model configuration files."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import yaml

from drsai.configs.constant import CONFIG_DIR, FS_DIR

from .defaults import DEFAULT_OPENAI_BASE_URL
from .loader import ConfigError, load_user_config
from .writer import update_model_selection, upsert_provider


@dataclass(frozen=True)
class MigrationResult:
    migrated: bool
    model: str | None = None
    provider: str | None = None
    sources: tuple[str, ...] = ()
    reason: str | None = None


def migrate_legacy_model_config(
    *,
    config_path: str | Path | None = None,
    legacy_yaml_path: str | Path | None = None,
    cli_config_path: str | Path | None = None,
    llm_catalog_path: str | Path | None = None,
    environ: Mapping[str, str] | None = None,
) -> MigrationResult:
    """Migrate legacy selections while preserving all legacy files.

    The operation is idempotent. Existing compact TOML model fields always
    win, and secret values are never copied from legacy files.
    """

    env = environ if environ is not None else os.environ
    target = Path(config_path) if config_path is not None else Path(FS_DIR) / "config.toml"
    existing = load_user_config(target)
    if existing.model or existing.model_provider or existing.providers:
        return MigrationResult(migrated=False, reason="compact model configuration already exists")
    if str(env.get("DRSAI_CONFIG_AUTO_MIGRATE", "true")).strip().lower() in {"0", "false", "no", "off"}:
        return MigrationResult(migrated=False, reason="automatic migration disabled")

    yaml_path = Path(legacy_yaml_path) if legacy_yaml_path is not None else Path(FS_DIR) / "config.yaml"
    cli_path = Path(cli_config_path) if cli_config_path is not None else Path(CONFIG_DIR) / "cli_config.json"
    catalog_path = (
        Path(llm_catalog_path)
        if llm_catalog_path is not None
        else Path(CONFIG_DIR) / "llm_mode_config.yaml"
    )
    yaml_config = _read_yaml(yaml_path)
    cli_config = _read_json(cli_path)
    catalog = _read_yaml(catalog_path)

    sources: list[str] = []
    model_table = yaml_config.get("model") if isinstance(yaml_config.get("model"), Mapping) else {}
    model = _first_string(
        env.get("LLM_DEFAULT_ALIAS"),
        cli_config.get("defult_config_name"),
        model_table.get("default"),
        catalog.get("_default_alias"),
    )
    if not model:
        return MigrationResult(migrated=False, reason="no legacy model selection found")

    legacy_provider = _first_string(model_table.get("provider")) or ""
    wire_api = "anthropic" if legacy_provider.lower() == "anthropic" else "openai"
    base_url = _first_string(
        env.get("ANTHROPIC_BASE_URL") if wire_api == "anthropic" else env.get("OPENAI_BASE_URL"),
        cli_config.get("anthropic_base_url") if wire_api == "anthropic" else cli_config.get("openai_base_url"),
        model_table.get("base_url"),
    )

    original = target.read_bytes() if target.exists() else None
    try:
        if base_url and base_url.rstrip("/") != DEFAULT_OPENAI_BASE_URL.rstrip("/"):
            provider = "legacy-anthropic" if wire_api == "anthropic" else "legacy-openai"
            env_key = "ANTHROPIC_API_KEY" if wire_api == "anthropic" else "OPENAI_API_KEY"
            upsert_provider(
                provider,
                {
                    "base_url": base_url,
                    "wire_api": wire_api,
                    "api_key_env": env_key,
                },
                path=target,
            )
        else:
            provider = "hepai-anthropic" if wire_api == "anthropic" else "hepai"

        update_model_selection(model=model, model_provider=provider, path=target)
    except Exception:
        _restore_original(target, original)
        raise
    if original is not None:
        _replace_bytes(target.with_suffix(target.suffix + ".bak"), original)
    for path in (yaml_path, cli_path, catalog_path):
        if path.exists():
            sources.append(str(path))
    return MigrationResult(
        migrated=True,
        model=model,
        provider=provider,
        sources=tuple(sources),
    )


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Cannot migrate invalid YAML {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigError(f"Cannot migrate {path}: root must be an object")
    return value


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Cannot migrate invalid JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigError(f"Cannot migrate {path}: root must be an object")
    return value


def _first_string(*values: object) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _restore_original(target: Path, original: bytes | None) -> None:
    if original is None:
        target.unlink(missing_ok=True)
        return
    _replace_bytes(target, original)


def _replace_bytes(target: Path, content: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        try:
            target.chmod(0o600)
        except OSError:
            pass
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
