"""Atomic persistence for local OpenDrSai Agent model policies."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import tempfile

from .loader import ConfigError, default_config_path
from .locking import config_write_lock
from .model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef


class AgentModelPolicyConflict(ConfigError):
    """The policy store changed after the caller read it."""


@dataclass(frozen=True)
class AgentModelPolicySnapshot:
    policy: AgentModelPolicy
    revision: str


def agent_model_policy_path(config_path: str | Path | None = None) -> Path:
    config = Path(config_path) if config_path is not None else default_config_path()
    return config.with_name("agent-model-policies.json")


def load_agent_model_policy(
    agent_id: str, *, path: str | Path | None = None,
) -> AgentModelPolicySnapshot:
    target = Path(path) if path is not None else agent_model_policy_path()
    with config_write_lock(target):
        document = _read_document(target)
        policy = _decode_policy(agent_id, document.get("policies", {}).get(agent_id))
        return AgentModelPolicySnapshot(policy, _revision(document))


def commit_agent_model_policy(
    policy: AgentModelPolicy,
    *,
    expected_revision: str | None,
    path: str | Path | None = None,
) -> AgentModelPolicySnapshot:
    target = Path(path) if path is not None else agent_model_policy_path()
    with config_write_lock(target):
        document = _read_document(target)
        current_revision = _revision(document)
        if expected_revision is not None and expected_revision != current_revision:
            raise AgentModelPolicyConflict("Agent model policy changed; reload it before saving")
        policies = dict(document.get("policies", {}))
        policies[policy.agent_id] = _encode_policy(policy)
        committed = {"schema_version": 1, "policies": policies}
        _atomic_write(target, committed)
        return AgentModelPolicySnapshot(policy, _revision(committed))


def _read_document(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"schema_version": 1, "policies": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ConfigError("Agent model policy store is unavailable or corrupted") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1 or not isinstance(value.get("policies"), dict):
        raise ConfigError("Agent model policy store has an unsupported schema")
    return value


def _decode_policy(agent_id: str, raw: object) -> AgentModelPolicy:
    if raw is None:
        return AgentModelPolicy(agent_id=agent_id)
    if not isinstance(raw, dict):
        raise ConfigError(f"Agent model policy '{agent_id}' is invalid")
    legacy_image = _decode_selection(raw.get("image_model")) if raw.get("image_model") is not None else None
    return AgentModelPolicy(
        agent_id=agent_id,
        primary_model=_decode_selection(raw.get("primary_model")),
        image_understanding_model=_decode_selection(raw.get("image_understanding_model")) if raw.get("image_understanding_model") is not None else None,
        image_generation_model=_decode_selection(raw.get("image_generation_model")) if raw.get("image_generation_model") is not None else legacy_image,
        text_to_speech_model=_decode_selection(raw.get("text_to_speech_model")) if raw.get("text_to_speech_model") is not None else None,
        speech_to_text_model=_decode_selection(raw.get("speech_to_text_model")) if raw.get("speech_to_text_model") is not None else None,
        reasoning_effort=_decode_reasoning_effort(raw.get("reasoning_effort")),
    )


def _decode_selection(raw: object) -> AgentModelSelection:
    if not isinstance(raw, dict) or raw.get("mode") not in {"inherit_provider_default", "explicit"}:
        raise ConfigError("Agent model selection is invalid")
    ref_value = raw.get("ref")
    ref = None
    if ref_value is not None:
        if not isinstance(ref_value, dict):
            raise ConfigError("Agent model reference is invalid")
        try:
            ref = ModelRef(str(ref_value["provider_id"]), str(ref_value["model_id"]))
        except (KeyError, ValueError) as exc:
            raise ConfigError("Agent model reference is invalid") from exc
    try:
        return AgentModelSelection(str(raw["mode"]), ref)  # type: ignore[arg-type]
    except ValueError as exc:
        raise ConfigError(str(exc)) from exc


def _encode_policy(policy: AgentModelPolicy) -> dict[str, object]:
    value: dict[str, object] = {"primary_model": _encode_selection(policy.primary_model)}
    image_generation = policy.image_generation_model or policy.image_model
    for key, selection in (
        ("image_understanding_model", policy.image_understanding_model),
        ("image_generation_model", image_generation),
        ("text_to_speech_model", policy.text_to_speech_model),
        ("speech_to_text_model", policy.speech_to_text_model),
    ):
        if selection is not None:
            value[key] = _encode_selection(selection)
    if policy.reasoning_effort is not None:
        value["reasoning_effort"] = policy.reasoning_effort
    return value


def _decode_reasoning_effort(raw: object) -> str | None:
    if raw is None:
        return None
    if raw not in {"none", "low", "medium", "high", "xhigh", "max"}:
        raise ConfigError("Agent reasoning effort is invalid")
    # DeepSeek and several compatibility clients historically exposed xhigh;
    # keep it readable while new DeepSeek selections persist the native max.
    return str(raw)


def _encode_selection(selection: AgentModelSelection) -> dict[str, object]:
    value: dict[str, object] = {"mode": selection.mode}
    if selection.ref is not None:
        value["ref"] = selection.ref.public_dict(include_revision=False)
    return value


def _revision(document: dict[str, object]) -> str:
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _atomic_write(path: Path, document: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink(missing_ok=True)
