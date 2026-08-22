"""Evidence captured from the concrete assets used by a Runtime execution."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.runtime.oaep import OAEP_VERSION
from drsai.version import __version__ as DRS_AI_VERSION


def _digest(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _versioned_references(value: Any, *, schema_key: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    for entry in value:
        if isinstance(entry, str) and entry:
            identity, separator, version = entry.rpartition("@")
            result.append({
                "id": identity if separator and identity else entry,
                **({"version": version} if separator and identity and version else {}),
            })
            continue
        if not isinstance(entry, Mapping):
            continue
        identity = entry.get("id") or entry.get("name")
        if not identity:
            continue
        schema = entry.get(schema_key)
        result.append({
            "id": str(identity),
            **({"version": str(entry["version"])} if entry.get("version") else {}),
            **({"digest": str(entry["digest"])} if entry.get("digest") else {}),
            **({"schema_digest": _digest(schema)} if isinstance(schema, Mapping) else {}),
        })
    return result


def agent_definition_evidence(definition: Any) -> dict[str, Any]:
    """Describe the loaded immutable Agent asset, never merely its reference."""
    raw = definition.raw if isinstance(getattr(definition, "raw", None), Mapping) else {}
    backend_id = str(getattr(definition, "backend", "") or "")
    model_id = str(getattr(definition, "model", "") or "")
    instructions = str(getattr(definition, "instructions", "") or "")
    provider = raw.get("model_provider") or raw.get("provider")
    backend_version = raw.get("backend_version")
    tools = _versioned_references(raw.get("tools"), schema_key="schema")
    skills = _versioned_references(raw.get("skills"), schema_key="schema")
    external = raw.get("external_dependencies")
    external = [dict(item) for item in external if isinstance(item, Mapping)] if isinstance(external, list) else []
    # Backend-specific mapping versions arrive through the generic Agent
    # definition SPI. Runtime Core must never import a concrete Adapter.
    adapter_version = str(raw.get("adapter_version") or backend_version or DRS_AI_VERSION)
    return {
        "runtime": {"version": DRS_AI_VERSION},
        "backend": {
            "id": backend_id,
            **({"version": str(backend_version)} if backend_version else {}),
        },
        "protocol": {
            "oaep_version": OAEP_VERSION,
            "adapter_version": adapter_version,
            "mapping_version": adapter_version,
        },
        "agent": {
            "definition": str(getattr(definition, "reference", "") or ""),
            "definition_digest": _digest(raw),
        },
        "model": {
            **({"id": model_id} if model_id else {}),
            **({"provider": str(provider)} if provider else {}),
            **({"version": str(raw["model_version"])} if raw.get("model_version") else {}),
            **({"revision_digest": str(raw["model_revision_digest"])} if raw.get("model_revision_digest") else {}),
        },
        "prompt": {
            "id": str(getattr(definition, "reference", "") or ""),
            "digest": hashlib.sha256(instructions.encode("utf-8")).hexdigest(),
        },
        "tools": tools,
        "skills": skills,
        "external_dependencies": external,
        "evidence_declarations": {
            "tools_recorded": "tools" in raw,
            "skills_recorded": "skills" in raw,
            "external_dependencies_recorded": "external_dependencies" in raw,
        },
    }


def workspace_revision_evidence(workspace_path: Path) -> dict[str, Any]:
    """Capture Git identity when it is actually available; never invent it."""
    root = Path(workspace_path).resolve(strict=True)

    def git(*arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(root), *arguments],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

    try:
        revision = git("rev-parse", "--verify", "HEAD")
        if revision.returncode != 0 or not revision.stdout.strip():
            return {}
        status = git("status", "--porcelain=v1", "--untracked-files=normal")
        if status.returncode != 0:
            return {"workspace": {"revision": revision.stdout.strip(), "vcs": "git"}}
        return {
            "workspace": {
                "revision": revision.stdout.strip(),
                "dirty": bool(status.stdout),
                "vcs": "git",
            },
        }
    except (OSError, subprocess.SubprocessError):
        return {}


def backend_runtime_evidence(backend_id: str, health: Mapping[str, Any]) -> dict[str, Any]:
    """Extract only backend identities reported by the live backend itself."""
    version = health.get("version")
    adapter_version = health.get("adapter_version")
    contract = health.get("contract") if isinstance(health.get("contract"), Mapping) else {}
    return {
        "backend": {
            "id": backend_id,
            **({"version": str(version)} if version else {}),
            **({"contract_digest": str(contract["digest"])} if contract.get("digest") else {}),
        },
        "protocol": {
            **({"adapter_version": str(adapter_version)} if adapter_version else {}),
            **({"mapping_version": str(adapter_version)} if adapter_version else {}),
        },
    }
