from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Mapping


OVERRIDE_SCHEMA_VERSION = "opendrsai.run-experiment-overrides/1"
EXPERIMENT_CAPABILITY_SCHEMA_VERSION = "opendrsai.run-experiment-capabilities/1"
ALLOWED_OVERRIDE_FIELDS = {
    "input", "attachments", "resources", "model", "prompt", "agent",
    "skills", "tools", "credential_refs",
}
# P3 exposes only values that the current executor applies to the candidate Run.
# The larger schema remains documented here so future fields can be enabled without
# inventing a second override format.
SUPPORTED_OVERRIDE_FIELDS = {"input", "attachments", "model"}
SUPPORTED_MODEL_OVERRIDE_FIELDS = {"provider_id", "model_id"}
DEFAULT_REPLAY_MODES = ("rerun_from_start",)
_DIGEST = re.compile(r"^(?:sha256:)?[0-9a-f]{64}$")
_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,499}$")
_CREDENTIAL_REFERENCE = re.compile(r"^(?:credential|keychain|vault)://[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,499}$")
_SECRET_KEY = re.compile(r"(?:api.?key|access.?token|refresh.?token|password|secret|authorization|private.?key)", re.I)
_SECRET_TEXT = re.compile(
    r"(?:Bearer\s+[A-Za-z0-9._~+/=-]{8,}|"
    r"(?:token|password|secret|api[_-]?key|credential)\s*[:=]\s*[^\s,;]{4,}|"
    r"-----BEGIN [^-]*PRIVATE KEY-----|"
    r"https?://[^/\s:@]+:[^/\s@]+@)",
    re.I,
)


class OverrideValidationError(ValueError):
    code = "invalid_experiment_overrides"


class UnsupportedOverrideError(OverrideValidationError):
    code = "unsupported_override"


def run_experiment_capabilities() -> dict[str, Any]:
    """Return the truthful, versioned contract shared by API, planner and UI."""
    return {
        "schema_version": EXPERIMENT_CAPABILITY_SCHEMA_VERSION,
        "override_schema_version": OVERRIDE_SCHEMA_VERSION,
        "supported_override_fields": sorted(SUPPORTED_OVERRIDE_FIELDS),
        "supported_model_fields": sorted(SUPPORTED_MODEL_OVERRIDE_FIELDS),
        "default_replay_modes": list(DEFAULT_REPLAY_MODES),
        "advanced_replay_modes": [],
    }


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _sha(value: Any) -> str:
    return "sha256:" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _string(value: Any, field: str, *, maximum: int = 500, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value.strip()):
        raise OverrideValidationError(f"{field} must be a valid string")
    if "\x00" in value:
        raise OverrideValidationError(f"{field} contains an invalid character")
    return value


def _reference(value: Any, field: str) -> str:
    result = _string(value, field)
    if not _REFERENCE.fullmatch(result):
        raise OverrideValidationError(f"{field} is not a valid reference")
    return result


def _digest(value: Any, field: str) -> str:
    result = _string(value, field, maximum=71)
    if not _DIGEST.fullmatch(result):
        raise OverrideValidationError(f"{field} is not a SHA-256 digest")
    return result if result.startswith("sha256:") else f"sha256:{result}"


def _reject_plaintext_secrets(value: Any, path: str = "overrides") -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if _SECRET_KEY.search(str(key)):
                raise OverrideValidationError(f"Plaintext credential field is forbidden at {path}.{key}")
            _reject_plaintext_secrets(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_plaintext_secrets(child, f"{path}[{index}]")


def _identity(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise OverrideValidationError(f"{field} must be an object")
    allowed = {"reference", "version", "digest"}
    unknown = set(value) - allowed
    if unknown:
        raise OverrideValidationError(f"Unknown {field} fields: {', '.join(sorted(unknown))}")
    result = {"reference": _reference(value.get("reference"), f"{field}.reference")}
    if value.get("version") is not None:
        result["version"] = _reference(value["version"], f"{field}.version")
    if value.get("digest") is not None:
        result["digest"] = _digest(value["digest"], f"{field}.digest")
    return result


def _resource(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise OverrideValidationError(f"{field} must be an object")
    allowed = {"reference", "content_digest", "required", "kind"}
    unknown = set(value) - allowed
    if unknown:
        raise OverrideValidationError(f"Unknown {field} fields: {', '.join(sorted(unknown))}")
    result: dict[str, Any] = {
        "reference": _reference(value.get("reference"), f"{field}.reference"),
        "required": bool(value.get("required", True)),
    }
    if value.get("content_digest") is not None:
        result["content_digest"] = _digest(value["content_digest"], f"{field}.content_digest")
    if value.get("kind") is not None:
        result["kind"] = _reference(value["kind"], f"{field}.kind")
    return result


def normalize_overrides(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise OverrideValidationError("Experiment overrides must be an object")
    unknown = set(value) - ALLOWED_OVERRIDE_FIELDS
    if unknown:
        raise OverrideValidationError(f"Unknown override fields: {', '.join(sorted(unknown))}")
    unsupported = set(value) - SUPPORTED_OVERRIDE_FIELDS
    if unsupported:
        raise UnsupportedOverrideError(
            f"Unsupported override fields: {', '.join(sorted(unsupported))}"
        )
    _reject_plaintext_secrets(value)
    result: dict[str, Any] = {}
    if "input" in value:
        raw = value["input"]
        if not isinstance(raw, Mapping) or set(raw) - {"message"}:
            raise OverrideValidationError("input only accepts message")
        message = _string(raw.get("message"), "input.message", maximum=200_000, allow_empty=True)
        if _SECRET_TEXT.search(message):
            raise OverrideValidationError("input.message contains credential-like plaintext; use credential_refs")
        result["input"] = {"message": message}
    for field in ("attachments", "resources"):
        if field not in value:
            continue
        raw_items = value[field]
        if not isinstance(raw_items, list) or len(raw_items) > 200:
            raise OverrideValidationError(f"{field} must be an array of at most 200 references")
        normalized = [_resource(item, f"{field}[{index}]") for index, item in enumerate(raw_items)]
        references = [item["reference"] for item in normalized]
        if len(references) != len(set(references)):
            raise OverrideValidationError(f"{field} contains duplicate references")
        result[field] = normalized
    if "model" in value:
        raw = value["model"]
        if not isinstance(raw, Mapping):
            raise OverrideValidationError("model must be an object")
        allowed = {"provider_id", "model_id", "revision_digest", "temperature", "top_p", "max_output_tokens", "seed"}
        unknown_model = set(raw) - allowed
        if unknown_model:
            raise OverrideValidationError(f"Unknown model fields: {', '.join(sorted(unknown_model))}")
        unsupported_model = set(raw) - SUPPORTED_MODEL_OVERRIDE_FIELDS
        if unsupported_model:
            raise UnsupportedOverrideError(
                f"Unsupported model override fields: {', '.join(sorted(unsupported_model))}"
            )
        model: dict[str, Any] = {
            "provider_id": _reference(raw.get("provider_id"), "model.provider_id"),
            "model_id": _reference(raw.get("model_id"), "model.model_id"),
        }
        if raw.get("revision_digest") is not None:
            model["revision_digest"] = _digest(raw["revision_digest"], "model.revision_digest")
        for field, low, high in (("temperature", 0.0, 2.0), ("top_p", 0.0, 1.0)):
            if raw.get(field) is not None:
                number = raw[field]
                if isinstance(number, bool) or not isinstance(number, (int, float)) or not low <= float(number) <= high:
                    raise OverrideValidationError(f"model.{field} must be between {low} and {high}")
                model[field] = float(number)
        if raw.get("max_output_tokens") is not None:
            tokens = raw["max_output_tokens"]
            if isinstance(tokens, bool) or not isinstance(tokens, int) or not 1 <= tokens <= 1_000_000:
                raise OverrideValidationError("model.max_output_tokens is invalid")
            model["max_output_tokens"] = tokens
        if raw.get("seed") is not None:
            seed = raw["seed"]
            if isinstance(seed, bool) or not isinstance(seed, int) or not -(2**63) <= seed < 2**63:
                raise OverrideValidationError("model.seed is invalid")
            model["seed"] = seed
        result["model"] = model
    for field in ("prompt", "agent"):
        if field in value:
            result[field] = _identity(value[field], field)
    for field in ("skills", "tools"):
        if field not in value:
            continue
        raw_items = value[field]
        if not isinstance(raw_items, list) or len(raw_items) > 200:
            raise OverrideValidationError(f"{field} must be an array of at most 200 identities")
        result[field] = [_identity(item, f"{field}[{index}]") for index, item in enumerate(raw_items)]
    if "credential_refs" in value:
        raw_refs = value["credential_refs"]
        if not isinstance(raw_refs, list) or len(raw_refs) > 100:
            raise OverrideValidationError("credential_refs must be an array")
        refs = []
        for index, raw in enumerate(raw_refs):
            ref = _string(raw, f"credential_refs[{index}]")
            if not _CREDENTIAL_REFERENCE.fullmatch(ref):
                raise OverrideValidationError("Only opaque credential references may be stored")
            refs.append(ref)
        if len(refs) != len(set(refs)):
            raise OverrideValidationError("credential_refs contains duplicates")
        result["credential_refs"] = refs
    return result


def safe_override_summary(overrides: Mapping[str, Any]) -> dict[str, Any]:
    fields = sorted(overrides)
    summary: dict[str, Any] = {
        "schema_version": OVERRIDE_SCHEMA_VERSION,
        "changed_fields": fields,
        "change_count": len(fields),
        "overrides_digest": _sha(overrides),
    }
    if isinstance(overrides.get("input"), Mapping):
        message = str(overrides["input"].get("message") or "")
        summary["input"] = {"content_digest": _sha(message), "characters": len(message)}
    for field in ("attachments", "resources", "skills", "tools", "credential_refs"):
        if isinstance(overrides.get(field), list):
            summary[field] = {"count": len(overrides[field])}
    if isinstance(overrides.get("model"), Mapping):
        model = overrides["model"]
        summary["model"] = {
            key: model[key] for key in ("provider_id", "model_id", "revision_digest") if key in model
        }
    return summary


def overrides_digest(overrides: Mapping[str, Any]) -> str:
    return _sha(overrides)
