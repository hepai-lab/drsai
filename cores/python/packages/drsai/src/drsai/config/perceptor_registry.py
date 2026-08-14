"""Stable perceptor resources with protected credential references."""

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

from .credentials import delete_credential, resolve_credential, store_credential
from .loader import ConfigError

_ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,127}$")
_CREDENTIAL_PREFIX = "drsai-credential:"
PERCEPTOR_SECRET_PLACEHOLDER = "***configured***"


@dataclass(frozen=True)
class PerceptorResource:
    perceptor_id: str
    kind: str
    adapter: str
    capabilities: tuple[str, ...]
    config: dict[str, object]
    name: str | None = None
    enabled: bool = True


def canonical_perceptor_id(value: str) -> str:
    candidate = value.strip().lower().replace("_", "-")
    candidate = re.sub(r"[^a-z0-9_.-]+", "-", candidate).strip(".-")
    if not candidate or not candidate[0].isalpha() or not _ID_RE.fullmatch(candidate):
        raise ConfigError("Perceptor ID is invalid")
    return candidate


def perceptor_registry_dir(config_dir: str | Path) -> Path:
    return Path(config_dir) / "perceptors"


def _credential_root(config_dir: str | Path) -> Path:
    return Path(config_dir) / "credentials"


def list_perceptor_resources(config_dir: str | Path) -> tuple[PerceptorResource, ...]:
    root = perceptor_registry_dir(config_dir)
    resources = tuple(_read_resource(path) for path in sorted(root.glob("perceptor_*.toml"))) if root.is_dir() else ()
    if len({item.perceptor_id for item in resources}) != len(resources):
        raise ConfigError("Perceptor registry contains duplicate IDs")
    return resources


def get_perceptor_resource(config_dir: str | Path, perceptor_id: str) -> PerceptorResource:
    wanted = canonical_perceptor_id(perceptor_id)
    for resource in list_perceptor_resources(config_dir):
        if resource.perceptor_id == wanted:
            return resource
    raise ConfigError(f"Perceptor '{wanted}' was not found")


def put_perceptor_resource(config_dir: str | Path, resource: PerceptorResource) -> PerceptorResource:
    perceptor_id = canonical_perceptor_id(resource.perceptor_id)
    config = _protect_config(resource.config, config_dir)
    normalized = PerceptorResource(
        perceptor_id=perceptor_id,
        kind=_required(resource.kind, "Perceptor kind"),
        adapter=_required(resource.adapter, "Perceptor adapter"),
        capabilities=tuple(dict.fromkeys(_required(value, "Capability") for value in resource.capabilities)),
        config=config,
        name=resource.name.strip() if resource.name and resource.name.strip() else None,
        enabled=bool(resource.enabled),
    )
    path = perceptor_registry_dir(config_dir) / f"perceptor_{perceptor_id}.toml"
    old_refs = _references(_read_resource(path).config) if path.is_file() else set()
    _atomic_write(path, _render_resource(normalized))
    for reference in old_refs - _references(config):
        delete_credential(reference, root=_credential_root(config_dir))
    return normalized


def delete_perceptor_resource(config_dir: str | Path, perceptor_id: str) -> PerceptorResource:
    resource = get_perceptor_resource(config_dir, perceptor_id)
    (perceptor_registry_dir(config_dir) / f"perceptor_{resource.perceptor_id}.toml").unlink()
    for reference in _references(resource.config):
        delete_credential(reference, root=_credential_root(config_dir))
    return resource


def resolve_perceptor_config(resource: PerceptorResource, config_dir: str | Path) -> dict[str, object]:
    def walk(value: object) -> object:
        if isinstance(value, Mapping):
            return {str(key): walk(child) for key, child in value.items()}
        if isinstance(value, list):
            return [walk(child) for child in value]
        if isinstance(value, str) and value.startswith(_CREDENTIAL_PREFIX):
            secret = resolve_credential(value, root=_credential_root(config_dir))
            if secret is None:
                raise ConfigError("Perceptor credential is unavailable")
            return secret
        return value
    return dict(walk(resource.config))


def public_perceptor_payload(resource: PerceptorResource) -> dict[str, object]:
    def walk(value: object) -> object:
        if isinstance(value, Mapping):
            return {str(key): walk(child) for key, child in value.items()}
        if isinstance(value, list):
            return [walk(child) for child in value]
        return PERCEPTOR_SECRET_PLACEHOLDER if isinstance(value, str) and value.startswith(_CREDENTIAL_PREFIX) else value
    return {
        "perceptor_id": resource.perceptor_id, "name": resource.name, "kind": resource.kind,
        "adapter": resource.adapter, "enabled": resource.enabled,
        "capabilities": list(resource.capabilities), "config": walk(resource.config),
        "revision": perceptor_revision(resource),
    }


def perceptor_revision(resource: PerceptorResource) -> str:
    payload = {
        "perceptor_id": resource.perceptor_id, "kind": resource.kind, "adapter": resource.adapter,
        "enabled": resource.enabled, "capabilities": resource.capabilities, "config": resource.config,
    }
    return "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def merge_perceptor_secret_placeholders(new: Mapping[str, object], old: Mapping[str, object]) -> dict[str, object]:
    def walk(current: object, previous: object) -> object:
        if current == PERCEPTOR_SECRET_PLACEHOLDER:
            if isinstance(previous, str) and previous.startswith(_CREDENTIAL_PREFIX):
                return previous
            raise ConfigError("Perceptor secret placeholder has no existing credential")
        if isinstance(current, Mapping):
            prior = previous if isinstance(previous, Mapping) else {}
            return {str(key): walk(value, prior.get(key)) for key, value in current.items()}
        if isinstance(current, list):
            prior = previous if isinstance(previous, list) else []
            return [walk(value, prior[index] if index < len(prior) else None) for index, value in enumerate(current)]
        return current
    return dict(walk(new, old))


def _protect_config(config: Mapping[str, object], config_dir: str | Path) -> dict[str, object]:
    def walk(value: object, key: str = "") -> object:
        if isinstance(value, Mapping):
            return {str(child_key): walk(child, str(child_key)) for child_key, child in value.items()}
        if isinstance(value, list):
            return [walk(child, key) for child in value]
        if key.lower() in {"api_key", "token", "password", "secret", "credential"} and value not in (None, ""):
            text = str(value)
            if text == PERCEPTOR_SECRET_PLACEHOLDER:
                raise ConfigError("A configured Perceptor secret requires its existing reference")
            return text if text.startswith(_CREDENTIAL_PREFIX) else store_credential(text, root=_credential_root(config_dir))
        return value
    return dict(walk(config))


def _references(value: object) -> set[str]:
    if isinstance(value, Mapping):
        return set().union(*(_references(child) for child in value.values()), set())
    if isinstance(value, list):
        return set().union(*(_references(child) for child in value), set())
    return {value} if isinstance(value, str) and value.startswith(_CREDENTIAL_PREFIX) else set()


def _read_resource(path: Path) -> PerceptorResource:
    try:
        with path.open("rb") as stream:
            raw = tomllib.load(stream)
        resource = PerceptorResource(
            perceptor_id=canonical_perceptor_id(str(raw["perceptor_id"])),
            kind=_required(raw["kind"], "Perceptor kind"), adapter=_required(raw["adapter"], "Perceptor adapter"),
            capabilities=tuple(json.loads(str(raw.get("capabilities_json") or "[]"))),
            config=dict(json.loads(str(raw.get("config_json") or "{}"))),
            name=str(raw["name"]) if raw.get("name") else None, enabled=bool(raw.get("enabled", True)),
        )
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"Perceptor resource '{path.name}' is invalid") from exc
    if raw.get("schema_version") != 1 or path.name != f"perceptor_{resource.perceptor_id}.toml":
        raise ConfigError(f"Perceptor resource '{path.name}' is invalid")
    return resource


def _render_resource(resource: PerceptorResource) -> str:
    rows = [
        "schema_version = 1\n", f"perceptor_id = {json.dumps(resource.perceptor_id)}\n",
        f"kind = {json.dumps(resource.kind)}\n", f"adapter = {json.dumps(resource.adapter)}\n",
        f"enabled = {'true' if resource.enabled else 'false'}\n",
    ]
    if resource.name:
        rows.append(f"name = {json.dumps(resource.name, ensure_ascii=False)}\n")
    rows.extend([
        f"capabilities_json = {json.dumps(json.dumps(resource.capabilities, ensure_ascii=False))}\n",
        f"config_json = {json.dumps(json.dumps(resource.config, sort_keys=True, ensure_ascii=False), ensure_ascii=False)}\n",
    ])
    return "".join(rows)


def _required(value: object, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ConfigError(f"{label} is required")
    return text


def _atomic_write(path: Path, payload: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            handle.write(payload); handle.flush(); os.fsync(handle.fileno()); temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists(): temporary.unlink(missing_ok=True)
