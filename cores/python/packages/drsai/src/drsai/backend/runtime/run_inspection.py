"""Versioned, read-only Run inspection and reproducibility helpers."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import platform
import re
import sys
from typing import Any, Mapping

from drsai.backend.runtime.oaep import OAEP_VERSION
from drsai.version import __version__ as DRS_AI_VERSION
from .security import redact_sensitive


MANIFEST_SCHEMA_VERSION = "opendrsai.run-manifest/1"
INSPECTION_SCHEMA_VERSION = "opendrsai.run-inspection/1"

_REQUIRED_CORE = (
    "runtime.runtime_id",
    "backend.id",
    "agent.definition",
    "model.id",
    "input.sha256",
    "workspace.id",
)
_REQUIRED_RECORDED = (
    "runtime.version",
    "backend.version",
    "protocol.oaep_version",
    "protocol.adapter_version",
    "protocol.mapping_version",
    "agent.definition_digest",
    "model.provider",
    "prompt.digest",
    "workspace.revision",
    "security.policy_version",
)


def canonical_json(value: Mapping[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest_manifest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def text_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _lookup(value: Mapping[str, Any], path: str) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, Mapping) or part not in current:
            return None
        current = current[part]
    return current


def _missing(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def reproducibility(value: Mapping[str, Any]) -> tuple[str, list[str]]:
    declared = value.get("external_dependencies")
    external = declared if isinstance(declared, list) else []
    missing_core = [path for path in _REQUIRED_CORE if _missing(_lookup(value, path))]
    if missing_core:
        return "unavailable", sorted(set(missing_core))

    missing = [path for path in _REQUIRED_RECORDED if _missing(_lookup(value, path))]
    declarations = value.get("evidence_declarations")
    declarations = declarations if isinstance(declarations, Mapping) else {}
    for name in ("attachments", "tools", "skills", "external_dependencies"):
        if declarations.get(f"{name}_recorded") is not True:
            missing.append(f"{name}.not_recorded")

    attachments = value.get("attachments") if isinstance(value.get("attachments"), list) else []
    for index, attachment in enumerate(attachments):
        if not isinstance(attachment, Mapping) or not attachment.get("sha256"):
            missing.append(f"attachments.{index}.sha256")
    tools = value.get("tools") if isinstance(value.get("tools"), list) else []
    for index, tool in enumerate(tools):
        if not isinstance(tool, Mapping) or not (tool.get("schema_digest") or tool.get("version")):
            missing.append(f"tools.{index}.version")
    skills = value.get("skills") if isinstance(value.get("skills"), list) else []
    for index, skill in enumerate(skills):
        if not isinstance(skill, Mapping) or not (skill.get("digest") or skill.get("version")):
            missing.append(f"skills.{index}.version")
    if any(not isinstance(item, Mapping) or item.get("mutable") is not False for item in external):
        missing.append("external_dependencies.mutable")
    if _lookup(value, "workspace.dirty") is not False:
        missing.append("workspace.dirty_or_unknown")

    compatible_missing = [*missing]
    for path in ("model.version", "environment.os", "environment.arch", "environment.runtime_versions"):
        if _missing(_lookup(value, path)):
            compatible_missing.append(path)
    if not compatible_missing:
        exact_missing = []
        if not (_lookup(value, "model.revision_digest") or _lookup(value, "model.content_digest")):
            exact_missing.append("model.revision_digest")
        if not _lookup(value, "environment.image_digest"):
            exact_missing.append("environment.image_digest")
        return ("exact", []) if not exact_missing else ("compatible", sorted(exact_missing))
    return "partial", sorted(set(compatible_missing))


def safe_manifest(value: Mapping[str, Any]) -> dict[str, Any]:
    """Return the bounded public view. Prompt/message bodies never survive."""
    safe = redact_sensitive(dict(value))
    if not isinstance(safe, dict):
        return {}
    safe.pop("input_text", None)
    safe.pop("system_prompt", None)
    prompt = value.get("prompt") if isinstance(value.get("prompt"), Mapping) else {}
    safe["prompt"] = {
        key: _scrub_public(redact_sensitive(prompt[key]), key)
        for key in ("id", "version", "digest", "template_digest")
        if key in prompt
    }
    input_evidence = value.get("input") if isinstance(value.get("input"), Mapping) else {}
    safe["input"] = {
        key: _scrub_public(redact_sensitive(input_evidence[key]), key)
        for key in ("sha256", "length", "resource_digest")
        if key in input_evidence
    }
    # Numeric usage and a bounded public error summary are explicitly safe
    # evidence. The generic secret filter intentionally treats any "token" or
    # "message" key as sensitive, so restore only this narrow allowlist.
    outcome = value.get("outcome") if isinstance(value.get("outcome"), Mapping) else {}
    safe_outcome = safe.get("outcome") if isinstance(safe.get("outcome"), dict) else {}
    usage = outcome.get("usage") if isinstance(outcome.get("usage"), Mapping) else {}
    safe_usage = {
        str(key): int(number)
        for key, number in usage.items()
        if key in {"input_tokens", "output_tokens", "total_tokens", "prompt_tokens", "completion_tokens"}
        and isinstance(number, (int, float)) and number >= 0
    }
    if safe_usage:
        safe_outcome["usage"] = safe_usage
    error = outcome.get("error") if isinstance(outcome.get("error"), Mapping) else {}
    if error.get("message"):
        safe_outcome["error"] = {
            "code": str(redact_sensitive(error.get("code")))[:120],
            "message": str(redact_sensitive(error.get("message")))[:500],
            "retryable": bool(error.get("retryable", False)),
        }
    if safe_outcome:
        safe["outcome"] = safe_outcome
    return _scrub_public(safe)


def safe_inspection_item(value: Mapping[str, Any]) -> dict[str, Any]:
    """Return a bounded public OAEP item; private chain-of-thought is never exported."""
    safe = _scrub_public(redact_sensitive(dict(value)))
    if not isinstance(safe, dict):
        return {}
    if safe.get("type") == "reasoning":
        # Preserve only Backend-explicit public summaries. Raw segments are
        # private by default even if a future Adapter adds unknown fields.
        original_content = value.get("content") if isinstance(value.get("content"), Mapping) else {}
        public_summary = original_content.get("public_summary") or original_content.get("summary")
        safe["content"] = {
            "segments": [],
            **({"summary": str(_scrub_public(redact_sensitive(public_summary)))[:2_000]} if isinstance(public_summary, str) else {}),
        }
    bounded = _bound_public(safe)
    return bounded if isinstance(bounded, dict) else {}


def _bound_public(value: Any, *, depth: int = 0) -> Any:
    """Keep one public Item bounded even when a Tool emits hostile output."""
    if depth >= 8:
        return "[TRUNCATED: depth limit]"
    if isinstance(value, str):
        if len(value) <= 4_096:
            return value
        digest = hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()
        return f"{value[:4_096]}… [TRUNCATED sha256={digest}]"
    if isinstance(value, Mapping):
        rows = list(value.items())
        result = {
            str(key): _bound_public(item, depth=depth + 1)
            for key, item in rows[:100]
        }
        if len(rows) > 100:
            result["_truncated_fields"] = len(rows) - 100
        return result
    if isinstance(value, list):
        result = [_bound_public(item, depth=depth + 1) for item in value[:100]]
        if len(value) > 100:
            result.append({"_truncated_items": len(value) - 100})
        return result
    return value


_URL_CREDENTIAL = re.compile(r"(?i)([a-z][a-z0-9+.-]*://)[^/@\s]+@")
_WINDOWS_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")
_URI_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
_WINDOWS_PRIVATE_PATH = re.compile(r"(?:[A-Za-z]:[\\/](?:[^\s<>:\"|?*\\/]+[\\/])+[^\s<>:\"|?*\\/]*)|(?:\\\\[^\s\\/]+[\\/][^\s<>:\"|?*]+(?:[\\/][^\s<>:\"|?*]+)*)")
_POSIX_PRIVATE_PATH = re.compile(r"/(?:Users|home|root|private|var/folders|tmp)(?:/[^\s<>'\"`]+)+")
_PRIVATE_REASONING_KEY = re.compile(r"(?i)(?:chain[_-]?of[_-]?thought|raw[_-]?(?:reasoning|analysis|thought)|private[_-]?(?:reasoning|analysis|thought)|internal[_-]?(?:reasoning|analysis|thought)|reasoning[_-]?(?:content|tokens|trace)|thinking|scratchpad|hidden[_-]?(?:reasoning|analysis))")


def _scrub_public(value: Any, key: str = "") -> Any:
    if _PRIVATE_REASONING_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {str(child): _scrub_public(item, str(child)) for child, item in value.items()}
    if isinstance(value, list):
        return [_scrub_public(item, key) for item in value]
    if isinstance(value, str):
        if key.lower() in {"path", "root", "cwd", "workspace_path"} and (
            value.startswith("/")
            or _WINDOWS_ABSOLUTE.match(value)
            or _URI_SCHEME.match(value)
            or ".." in value.replace("\\", "/").split("/")
        ):
            return "[REDACTED ABSOLUTE PATH]"
        scrubbed = _URL_CREDENTIAL.sub(r"\1[REDACTED]@", value)
        scrubbed = _WINDOWS_PRIVATE_PATH.sub("[REDACTED PRIVATE PATH]", scrubbed)
        scrubbed = _POSIX_PRIVATE_PATH.sub("[REDACTED PRIVATE PATH]", scrubbed)
        return scrubbed
    return value


def encode_cursor(sequence: int) -> str:
    return base64.urlsafe_b64encode(str(max(0, sequence)).encode()).rstrip(b"=").decode()


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        value = int(raw)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Invalid Run inspection cursor") from exc
    if value < 0:
        raise ValueError("Invalid Run inspection cursor")
    return value


def encode_timeline_cursor(sequence: int, item_id: str) -> str:
    """Encode a stable Run Item keyset cursor.

    Timeline cursors include the Item identity so a future projection may allow
    more than one Item at the same Run sequence without skipping either Item.
    """
    payload = json.dumps(
        [max(0, int(sequence)), str(item_id)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode()


def decode_timeline_cursor(cursor: str | None) -> tuple[int, str]:
    if not cursor:
        return 0, ""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode()
        value = json.loads(raw)
        if (
            not isinstance(value, list)
            or len(value) != 2
            or not isinstance(value[0], int)
            or value[0] < 0
            or not isinstance(value[1], str)
        ):
            raise ValueError
        return value[0], value[1]
    except (ValueError, json.JSONDecodeError, UnicodeError):
        # Phase 1 cursors encoded only an integer sequence. Keep them readable
        # while every active Desktop upgrades to the keyset contract.
        return decode_cursor(cursor), ""


def initial_manifest(
    *,
    run_id: str,
    runtime_id: str,
    instance_id: str,
    backend_id: str,
    agent_definition: str,
    workspace_id: str,
    worktree_id: str | None,
) -> dict[str, Any]:
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "run_id": run_id,
        "runtime": {"runtime_id": runtime_id, "instance_id": instance_id, "version": DRS_AI_VERSION},
        "backend": {"id": backend_id},
        "protocol": {
            "oaep_version": OAEP_VERSION,
        },
        "agent": {"definition": agent_definition},
        "model": {},
        "prompt": {},
        "input": {},
        "workspace": {"id": workspace_id, "worktree_id": worktree_id},
        "environment": {
            "os": platform.system() or os.name,
            "arch": platform.machine() or "unknown",
            "runtime_versions": {"python": platform.python_version(), "implementation": sys.implementation.name},
        },
        "attachments": [],
        "tools": [],
        "skills": [],
        "external_dependencies": [],
        "security": {"policy_version": "runtime-security-v1"},
        "evidence_declarations": {
            "attachments_recorded": False,
            "tools_recorded": False,
            "skills_recorded": False,
            "external_dependencies_recorded": False,
        },
    }


def merge_manifest(base: Mapping[str, Any], update: Mapping[str, Any]) -> dict[str, Any]:
    """Recursively merge a trusted evidence update without accepting identity drift."""
    result = json.loads(canonical_json(base))
    for key, value in update.items():
        if key in {"schema_version", "run_id"}:
            if key in result and result[key] != value:
                raise ValueError(f"Run manifest {key} is immutable")
            continue
        if isinstance(value, Mapping) and isinstance(result.get(key), Mapping):
            result[key] = merge_manifest(result[key], value)
        else:
            result[key] = value
    return result


def event_summary(event_type: str, data: Mapping[str, Any]) -> str:
    error = data.get("error")
    if isinstance(error, Mapping) and error.get("message"):
        return str(redact_sensitive(error.get("message")))
    for key in ("summary", "reason", "name", "status"):
        if data.get(key) not in {None, ""}:
            return str(redact_sensitive(data[key]))[:500]
    return event_type.replace(".", " ")


def classify_event(event_type: str) -> str:
    lowered = event_type.lower()
    if "approval" in lowered:
        return "interaction"
    if "artifact" in lowered:
        return "artifact"
    if "file" in lowered:
        return "file_change"
    if "command" in lowered:
        return "command_execution"
    if "tool" in lowered:
        return "tool_call"
    if "subtask" in lowered:
        return "subtask"
    if "reasoning" in lowered or "thinking" in lowered:
        return "reasoning"
    if "plan" in lowered:
        return "plan"
    if "message" in lowered or "agent.completed" in lowered:
        return "message"
    if "run." in lowered or "trace." in lowered:
        return "notice"
    return "notice"
