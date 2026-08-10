"""Stable-ID tool registry with one-time TOOLS_CONFIG.json migration."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import tomllib
from typing import Mapping

from .loader import ConfigError
from .credentials import delete_credential, resolve_credential, store_credential

_TOOL_ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,127}$")
_CREDENTIAL_PREFIX = "drsai-credential:"
_SECRET_FIELD_RE = re.compile(r"(?:^|[_-])(api[_-]?key|token|password|secret|authorization|credential)(?:$|[_-])", re.I)
TOOL_SECRET_PLACEHOLDER = "***configured***"


@dataclass(frozen=True)
class ToolResource:
    tool_id: str
    type: str
    config: dict[str, object]
    name: str | None = None
    enabled: bool = True
    source: str = "user"


@dataclass(frozen=True)
class ResolvedToolSet:
    enabled_ids: tuple[str, ...]
    missing_ids: tuple[str, ...]
    disabled_ids: tuple[str, ...]
    registry_revision: str


def resolve_tool_set(
    *, mode: str, enabled: tuple[str, ...], disabled: tuple[str, ...],
    resources: tuple[ToolResource, ...], builtin_ids: tuple[str, ...] = (),
) -> ResolvedToolSet:
    available = {resource.tool_id: resource.enabled for resource in resources}
    available.update({tool_id: True for tool_id in builtin_ids})
    disabled_set = set(disabled)
    if mode in {"inherit", "all_enabled"}:
        selected = [tool_id for tool_id, usable in available.items() if usable and tool_id not in disabled_set]
        missing: list[str] = []
    elif mode == "explicit":
        # Keep declared IDs in the resolved selection even when the static
        # registry cannot satisfy them: dynamic providers (for example HepAI
        # Worker discovery) may resolve them during Agent construction. They
        # remain listed in missing_ids until an execution provider claims them.
        selected = [tool_id for tool_id in enabled if available.get(tool_id, True) and tool_id not in disabled_set]
        missing = [tool_id for tool_id in enabled if tool_id not in available]
    else:
        raise ConfigError("Agent tools mode is invalid")
    revision_payload = [_stored_tool_resource_payload(resource) for resource in resources]
    revision = "sha256:" + hashlib.sha256(
        json.dumps(revision_payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return ResolvedToolSet(tuple(selected), tuple(missing), tuple(sorted(disabled_set)), revision)


def canonical_tool_id(value: str) -> str:
    candidate = value.strip().lower().replace("_", "-")
    candidate = re.sub(r"[^a-z0-9_.-]+", "-", candidate).strip(".-")
    if not candidate or not candidate[0].isalpha():
        candidate = "tool-" + candidate
    if not _TOOL_ID_RE.fullmatch(candidate):
        raise ConfigError("Tool ID is invalid")
    return candidate


def legacy_tool_id(entry: Mapping[str, object]) -> str:
    name = str(entry.get("name") or "").strip()
    kind = str(entry.get("type") or "tool").strip()
    config = entry.get("config") if isinstance(entry.get("config"), dict) else {}
    hint = name or str(config.get("name") or config.get("command") or config.get("url") or kind)
    base = canonical_tool_id(hint)
    digest = hashlib.sha256(
        json.dumps({"type": kind, "config": config}, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:8]
    return f"{base}.{digest}"


def tool_registry_dir(config_dir: str | Path) -> Path:
    return Path(config_dir) / "tools"


def list_tool_resources(config_dir: str | Path, *, migrate_legacy: bool = True) -> tuple[ToolResource, ...]:
    root = tool_registry_dir(config_dir)
    if migrate_legacy:
        _migrate_legacy(Path(config_dir), root)
    resources = []
    for path in sorted(root.glob("tool_*.toml")) if root.is_dir() else ():
        resource = _read_resource(path)
        protected = protect_tool_config(resource.config, config_dir)
        if protected != resource.config:
            resource = ToolResource(
                resource.tool_id, resource.type, protected, resource.name, resource.enabled, resource.source,
            )
            _atomic_write(path, _render_resource(resource))
        resources.append(resource)
    ids = [resource.tool_id for resource in resources]
    if len(ids) != len(set(ids)):
        raise ConfigError("Tool registry contains duplicate Tool IDs")
    return tuple(resources)


def get_tool_resource(config_dir: str | Path, tool_id: str) -> ToolResource:
    wanted = canonical_tool_id(tool_id)
    for resource in list_tool_resources(config_dir):
        if resource.tool_id == wanted:
            return resource
    raise ConfigError(f"Tool '{wanted}' was not found")


def put_tool_resource(config_dir: str | Path, resource: ToolResource) -> ToolResource:
    tool_id = canonical_tool_id(resource.tool_id)
    normalized = ToolResource(
        tool_id=tool_id,
        type=_required_text(resource.type, "Tool type"),
        config=protect_tool_config(resource.config, config_dir),
        name=resource.name.strip() if resource.name and resource.name.strip() else None,
        enabled=bool(resource.enabled),
        source=resource.source,
    )
    path = tool_registry_dir(config_dir) / f"tool_{tool_id}.toml"
    previous_refs: set[str] = set()
    if path.is_file():
        previous_refs = _credential_references(_read_resource(path).config)
    _atomic_write(path, _render_resource(normalized))
    for reference in previous_refs - _credential_references(normalized.config):
        delete_credential(reference, root=_credential_root(config_dir))
    return normalized


def delete_tool_resource(config_dir: str | Path, tool_id: str) -> ToolResource:
    resource = get_tool_resource(config_dir, tool_id)
    path = tool_registry_dir(config_dir) / f"tool_{resource.tool_id}.toml"
    path.unlink()
    for reference in _credential_references(resource.config):
        delete_credential(reference, root=_credential_root(config_dir))
    return resource


def tool_resource_payload(resource: ToolResource) -> dict[str, object]:
    """Public representation: credential references and plaintext secrets never leave the backend."""
    return {
        "tool_id": resource.tool_id,
        "type": resource.type,
        "config": public_tool_config(resource.config),
        "name": resource.name,
        "enabled": resource.enabled,
        "source": resource.source,
    }


def _stored_tool_resource_payload(resource: ToolResource) -> dict[str, object]:
    return {
        "tool_id": resource.tool_id, "type": resource.type, "config": dict(resource.config),
        "name": resource.name, "enabled": resource.enabled, "source": resource.source,
    }


def _credential_root(config_dir: str | Path) -> Path:
    return Path(config_dir) / "credentials"


def _credential_references(value: object) -> set[str]:
    if isinstance(value, Mapping):
        references: set[str] = set()
        for child in value.values():
            references.update(_credential_references(child))
        return references
    if isinstance(value, list):
        references = set()
        for child in value:
            references.update(_credential_references(child))
        return references
    return {value} if isinstance(value, str) and value.startswith(_CREDENTIAL_PREFIX) else set()


def _is_secret_field(key: str) -> bool:
    normalized = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key).lower()
    return bool(_SECRET_FIELD_RE.search(normalized)) or normalized in {"authorization", "proxy-authorization"}


def protect_tool_config(config: Mapping[str, object], config_dir: str | Path) -> dict[str, object]:
    """Replace secret-like values recursively with platform-protected references."""
    def walk(value: object, key: str = "") -> object:
        if isinstance(value, Mapping):
            return {str(child_key): walk(child, str(child_key)) for child_key, child in value.items()}
        if isinstance(value, list):
            return [walk(child, key) for child in value]
        if _is_secret_field(key) and value not in (None, ""):
            text = str(value)
            if text == TOOL_SECRET_PLACEHOLDER:
                raise ConfigError("A configured Tool secret cannot be saved without its existing credential reference")
            if text.startswith(_CREDENTIAL_PREFIX):
                return text
            return store_credential(text, root=_credential_root(config_dir))
        return value
    return dict(walk(config))


def resolve_tool_config(config: Mapping[str, object], config_dir: str | Path) -> dict[str, object]:
    """Hydrate protected references only at the Tool runtime boundary."""
    def walk(value: object) -> object:
        if isinstance(value, Mapping):
            return {str(key): walk(child) for key, child in value.items()}
        if isinstance(value, list):
            return [walk(child) for child in value]
        if isinstance(value, str) and value.startswith(_CREDENTIAL_PREFIX):
            secret = resolve_credential(value, root=_credential_root(config_dir))
            if secret is None:
                raise ConfigError("Tool credential is unavailable")
            return secret
        return value
    return dict(walk(config))


def public_tool_config(config: Mapping[str, object]) -> dict[str, object]:
    def walk(value: object) -> object:
        if isinstance(value, Mapping):
            return {str(key): walk(child) for key, child in value.items()}
        if isinstance(value, list):
            return [walk(child) for child in value]
        if isinstance(value, str) and value.startswith(_CREDENTIAL_PREFIX):
            return TOOL_SECRET_PLACEHOLDER
        return value
    return dict(walk(config))


def merge_tool_secret_placeholders(new_config: Mapping[str, object], stored_config: Mapping[str, object]) -> dict[str, object]:
    """Preserve existing protected values when an API client returns the public placeholder."""
    def walk(new: object, old: object) -> object:
        if new == TOOL_SECRET_PLACEHOLDER:
            if isinstance(old, str) and old.startswith(_CREDENTIAL_PREFIX):
                return old
            raise ConfigError("Tool secret placeholder has no existing credential")
        if isinstance(new, Mapping):
            previous = old if isinstance(old, Mapping) else {}
            return {str(key): walk(value, previous.get(key)) for key, value in new.items()}
        if isinstance(new, list):
            previous = old if isinstance(old, list) else []
            return [walk(value, previous[index] if index < len(previous) else None) for index, value in enumerate(new)]
        return new
    return dict(walk(new_config, stored_config))


def _migrate_legacy(config_dir: Path, registry: Path) -> None:
    legacy = config_dir / "TOOLS_CONFIG.json"
    if not legacy.is_file():
        return
    if registry.is_dir() and any(registry.glob("tool_*.toml")):
        return
    try:
        raw = json.loads(legacy.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ConfigError("Legacy tool configuration is corrupted") from exc
    if not isinstance(raw, list):
        raise ConfigError("Legacy tool configuration must be a list")
    registry.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ConfigError("Legacy tool entry is invalid")
        tool_id = canonical_tool_id(str(item.get("tool_id") or legacy_tool_id(item)))
        if tool_id in seen:
            raise ConfigError("Legacy tool configuration contains duplicate Tool IDs")
        seen.add(tool_id)
        put_tool_resource(config_dir, ToolResource(
            tool_id=tool_id,
            type=str(item.get("type") or "local"),
            config=dict(item.get("config") or {}),
            name=str(item["name"]) if item.get("name") else None,
            enabled=bool(item.get("enabled", True)),
        ))
    backup = legacy.with_suffix(legacy.suffix + ".migrated.bak")
    sanitized = [tool_resource_payload(resource) for resource in list_tool_resources(config_dir, migrate_legacy=False)]
    _atomic_write(backup, json.dumps(sanitized, ensure_ascii=False, indent=2) + "\n")
    legacy.unlink(missing_ok=True)


def _read_resource(path: Path) -> ToolResource:
    try:
        with path.open("rb") as stream:
            raw = tomllib.load(stream)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"Tool resource '{path.name}' is unavailable or corrupted") from exc
    try:
        schema = raw["schema_version"]
        tool_id = canonical_tool_id(str(raw["tool_id"]))
        config = json.loads(str(raw.get("config_json") or "{}"))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Tool resource '{path.name}' is invalid") from exc
    if schema != 1 or not isinstance(config, dict) or path.name != f"tool_{tool_id}.toml":
        raise ConfigError(f"Tool resource '{path.name}' is invalid")
    return ToolResource(
        tool_id=tool_id,
        type=_required_text(raw.get("type"), "Tool type"),
        config=config,
        name=str(raw["name"]) if raw.get("name") else None,
        enabled=bool(raw.get("enabled", True)),
        source=str(raw.get("source") or "user"),
    )


def _render_resource(resource: ToolResource) -> str:
    fields = [
        "schema_version = 1\n",
        f"tool_id = {json.dumps(resource.tool_id, ensure_ascii=False)}\n",
        f"type = {json.dumps(resource.type, ensure_ascii=False)}\n",
        f"enabled = {'true' if resource.enabled else 'false'}\n",
        f"source = {json.dumps(resource.source, ensure_ascii=False)}\n",
    ]
    if resource.name:
        fields.append(f"name = {json.dumps(resource.name, ensure_ascii=False)}\n")
    fields.append(f"config_json = {json.dumps(json.dumps(resource.config, ensure_ascii=False, sort_keys=True), ensure_ascii=False)}\n")
    return "".join(fields)


def _required_text(value: object, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ConfigError(f"{label} is required")
    return text


def _atomic_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink(missing_ok=True)
