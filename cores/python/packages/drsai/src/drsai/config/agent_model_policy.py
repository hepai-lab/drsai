"""Per-Agent TOML persistence with one-time legacy JSON migration."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import tomllib

from .defaults import DEFAULT_AGENT, DEFAULT_AGENT_CONFIG_FILE
from .loader import ConfigError, default_config_path, load_user_config
from .locking import config_write_lock
from .model_catalog import AgentModelPolicy, AgentModelSelection, ModelRef
from .writer import update_current_agent

_AGENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_LEGACY_AGENT_NAMES = {"my-drsai": DEFAULT_AGENT}


class AgentModelPolicyConflict(ConfigError):
    """The Agent configuration changed after the caller read it."""


@dataclass(frozen=True)
class AgentModelPolicySnapshot:
    policy: AgentModelPolicy
    revision: str


_RESOURCE_MODES = {"inherit", "explicit", "all_enabled"}
_RETRIEVAL_POLICIES = {"auto", "always", "never"}


@dataclass(frozen=True)
class AgentToolPolicy:
    mode: str = "inherit"
    enabled: tuple[str, ...] = ()
    disabled: tuple[str, ...] = ()
    require_approval: tuple[str, ...] = ()


@dataclass(frozen=True)
class AgentSkillPolicy:
    mode: str = "inherit"
    enabled: tuple[str, ...] = ()
    disabled: tuple[str, ...] = ()
    allow_thread_override: bool = True


@dataclass(frozen=True)
class AgentKnowledgePolicy:
    mode: str = "inherit"
    sources: tuple[str, ...] = ()
    retrieval_policy: str = "auto"
    top_k: int = 6
    score_threshold: float = 0.35
    require_citations: bool = True


@dataclass(frozen=True)
class AgentRuntimePolicySnapshot:
    agent_id: str
    tools: AgentToolPolicy
    skills: AgentSkillPolicy
    knowledge: AgentKnowledgePolicy
    revision: str


def canonical_agent_name(agent_name: str | None) -> str:
    value = (agent_name or "").strip() or DEFAULT_AGENT
    value = _LEGACY_AGENT_NAMES.get(value, value)
    if not _AGENT_NAME_RE.fullmatch(value):
        raise ConfigError("Agent name is invalid")
    return value


def current_agent_name(config_path: str | Path | None = None) -> str:
    config = load_user_config(config_path)
    return canonical_agent_name(config.current_agent)


def agent_model_policy_path(
    config_path: str | Path | None = None, *, agent_name: str | None = None,
) -> Path:
    config_file = Path(config_path) if config_path is not None else default_config_path()
    name = canonical_agent_name(agent_name)
    config = load_user_config(config_file)
    if name == canonical_agent_name(config.current_agent):
        relative = config.agent_config_file or f"configs/agents/agent_{name}.toml"
    else:
        relative = f"configs/agents/agent_{name}.toml"
    normalized = relative.replace("\\", "/")
    expected = f"configs/agents/agent_{name}.toml"
    if normalized != expected:
        raise ConfigError(f"agent_config_file must be '{expected}'")
    return config_file.parent / Path(normalized)


def list_agent_names(config_path: str | Path | None = None) -> tuple[str, ...]:
    config_file = Path(config_path) if config_path is not None else default_config_path()
    directory = config_file.parent / "configs" / "agents"
    names = []
    for path in directory.glob("agent_*.toml") if directory.is_dir() else ():
        candidate = path.stem.removeprefix("agent_")
        try:
            snapshot = load_agent_model_policy(candidate, path=path)
        except ConfigError:
            continue
        if snapshot.policy.agent_id == candidate:
            names.append(candidate)
    current = current_agent_name(config_file)
    return tuple(dict.fromkeys((current, *sorted(names))))


def load_agent_descriptor(
    agent_name: str | None = None, *, config_path: str | Path | None = None,
) -> dict[str, object]:
    name = canonical_agent_name(agent_name or current_agent_name(config_path))
    target = agent_model_policy_path(config_path, agent_name=name)
    if not target.exists():
        load_agent_model_policy(name)
    raw = _read_toml(target)
    return {
        "agent_name": name,
        "display_name": str(raw.get("display_name") or name),
        "enabled": bool(raw.get("enabled", True)),
        "config_file": target.relative_to((Path(config_path) if config_path else default_config_path()).parent).as_posix(),
    }


def load_agent_model_policy(
    agent_id: str | None = None, *, path: str | Path | None = None,
) -> AgentModelPolicySnapshot:
    name = canonical_agent_name(agent_id or current_agent_name())
    target = Path(path) if path is not None else agent_model_policy_path(agent_name=name)
    if not target.exists() and path is None:
        _migrate_legacy_policy(name)
    with config_write_lock(target):
        raw = _read_toml(target)
        if not raw:
            return AgentModelPolicySnapshot(AgentModelPolicy(agent_id=name), _revision(raw))
        stored_name = canonical_agent_name(str(raw.get("agent_name") or name))
        if stored_name != name:
            raise ConfigError("Agent configuration identity does not match its file")
        return AgentModelPolicySnapshot(_decode_policy(name, raw), _revision(raw))


def commit_agent_model_policy(
    policy: AgentModelPolicy, *, expected_revision: str | None,
    path: str | Path | None = None,
) -> AgentModelPolicySnapshot:
    name = canonical_agent_name(policy.agent_id)
    target = Path(path) if path is not None else agent_model_policy_path(agent_name=name)
    with config_write_lock(target):
        current = _read_toml(target)
        current_revision = _revision(current)
        if expected_revision is not None and expected_revision != current_revision:
            raise AgentModelPolicyConflict("Agent configuration changed; reload it before saving")
        document = _encode_policy(policy, agent_name=name, base=current)
        _atomic_write(target, _render_toml(document))
        return AgentModelPolicySnapshot(_decode_policy(name, document), _revision(document))


def load_agent_runtime_policy(
    agent_id: str | None = None, *, path: str | Path | None = None,
) -> AgentRuntimePolicySnapshot:
    name = canonical_agent_name(agent_id or current_agent_name())
    target = Path(path) if path is not None else agent_model_policy_path(agent_name=name)
    if not target.exists():
        # Runtime policy reads must be side-effect free. Model-policy admission
        # owns the one-time legacy file migration before Agent construction.
        return AgentRuntimePolicySnapshot(
            agent_id=name, tools=AgentToolPolicy(),
            skills=AgentSkillPolicy(mode="all_enabled"), knowledge=AgentKnowledgePolicy(),
            revision=_revision({}),
        )
    with config_write_lock(target):
        raw = _read_toml(target)
        if raw:
            stored_name = canonical_agent_name(str(raw.get("agent_name") or name))
            if stored_name != name:
                raise ConfigError("Agent configuration identity does not match its file")
        return AgentRuntimePolicySnapshot(
            agent_id=name,
            tools=_decode_tool_policy(raw.get("tools")),
            skills=(
                AgentSkillPolicy(mode="all_enabled")
                if raw.get("schema_version") == 1 and raw.get("skills") is None
                else _decode_skill_policy(raw.get("skills"))
            ),
            knowledge=_decode_knowledge_policy(raw.get("knowledge")),
            revision=_revision(raw),
        )


def commit_agent_runtime_policy(
    policy: AgentRuntimePolicySnapshot, *, expected_revision: str | None,
    path: str | Path | None = None,
) -> AgentRuntimePolicySnapshot:
    name = canonical_agent_name(policy.agent_id)
    target = Path(path) if path is not None else agent_model_policy_path(agent_name=name)
    with config_write_lock(target):
        current = _read_toml(target)
        current_revision = _revision(current)
        if expected_revision is not None and expected_revision != current_revision:
            raise AgentModelPolicyConflict("Agent configuration changed; reload it before saving")
        document = dict(current) if current else _encode_policy(AgentModelPolicy(agent_id=name), agent_name=name)
        document["schema_version"] = 2
        document["tools"] = _encode_tool_policy(policy.tools)
        document["skills"] = _encode_skill_policy(policy.skills)
        document["knowledge"] = _encode_knowledge_policy(policy.knowledge)
        _atomic_write(target, _render_toml(document))
        return AgentRuntimePolicySnapshot(
            agent_id=name,
            tools=_decode_tool_policy(document["tools"]),
            skills=_decode_skill_policy(document["skills"]),
            knowledge=_decode_knowledge_policy(document["knowledge"]),
            revision=_revision(document),
        )


def _migrate_legacy_policy(agent_name: str) -> None:
    config_path = default_config_path()
    target = agent_model_policy_path(config_path, agent_name=agent_name)
    legacy = config_path.with_name("agent-model-policies.json")
    raw_policy = None
    if legacy.is_file():
        try:
            document = json.loads(legacy.read_text(encoding="utf-8"))
            policies = document.get("policies", {}) if isinstance(document, dict) else {}
            raw_policy = policies.get(agent_name) or policies.get("my-drsai")
        except (OSError, UnicodeError, json.JSONDecodeError):
            raw_policy = None
    policy = _decode_legacy_policy(agent_name, raw_policy)
    target.parent.mkdir(parents=True, exist_ok=True)
    migrated = _encode_policy(policy, agent_name=agent_name)
    migrated["skills"] = _encode_skill_policy(AgentSkillPolicy(mode="all_enabled"))
    _atomic_write(target, _render_toml(migrated))
    update_current_agent(
        agent_name=agent_name,
        agent_config_file=f"configs/agents/agent_{agent_name}.toml",
        path=config_path,
    )
    if legacy.is_file():
        backup = legacy.with_suffix(legacy.suffix + ".migrated.bak")
        if not backup.exists():
            os.replace(legacy, backup)


def _read_toml(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        with path.open("rb") as stream:
            value = tomllib.load(stream)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError("Agent configuration is unavailable or corrupted") from exc
    if not isinstance(value, dict) or value.get("schema_version") not in {1, 2}:
        raise ConfigError("Agent configuration has an unsupported schema")
    return value


def _decode_policy(agent_name: str, raw: dict[str, object]) -> AgentModelPolicy:
    models = raw.get("models", {})
    if not isinstance(models, dict):
        raise ConfigError("Agent models configuration is invalid")
    return AgentModelPolicy(
        agent_id=agent_name,
        primary_model=_decode_role(models.get("primary"), required=False),
        image_understanding_model=_decode_optional_role(models.get("image_understanding")),
        image_generation_model=_decode_optional_role(models.get("image_generation")),
        text_to_speech_model=_decode_optional_role(models.get("text_to_speech")),
        realtime_voice_model=_decode_optional_role(models.get("realtime_voice")),
        speech_to_text_model=_decode_optional_role(models.get("speech_to_text")),
        reasoning_effort=_decode_reasoning_effort(models.get("reasoning_effort")),
    )


def _decode_legacy_policy(agent_name: str, raw: object) -> AgentModelPolicy:
    if not isinstance(raw, dict):
        return AgentModelPolicy(agent_id=agent_name)
    legacy_image = raw.get("image_generation_model") or raw.get("image_model")
    return AgentModelPolicy(
        agent_id=agent_name,
        primary_model=_decode_legacy_selection(raw.get("primary_model")),
        image_understanding_model=_decode_legacy_optional(raw.get("image_understanding_model")),
        image_generation_model=_decode_legacy_optional(legacy_image),
        text_to_speech_model=_decode_legacy_optional(raw.get("text_to_speech_model")),
        realtime_voice_model=_decode_legacy_optional(raw.get("realtime_voice_model")),
        speech_to_text_model=_decode_legacy_optional(raw.get("speech_to_text_model")),
        reasoning_effort=_decode_reasoning_effort(raw.get("reasoning_effort")),
    )


def _decode_role(raw: object, *, required: bool) -> AgentModelSelection:
    if raw is None and not required:
        return AgentModelSelection("inherit_provider_default")
    if not isinstance(raw, dict):
        raise ConfigError("Agent model selection is invalid")
    mode = str(raw.get("mode") or "explicit")
    if mode == "inherit_provider_default":
        return AgentModelSelection(mode)
    try:
        return AgentModelSelection("explicit", ModelRef(str(raw["provider_id"]), str(raw["model_id"])))
    except (KeyError, ValueError) as exc:
        raise ConfigError("Agent model selection is invalid") from exc


def _decode_optional_role(raw: object) -> AgentModelSelection | None:
    return None if raw is None else _decode_role(raw, required=True)


def _decode_legacy_selection(raw: object) -> AgentModelSelection:
    if not isinstance(raw, dict):
        return AgentModelSelection("inherit_provider_default")
    if raw.get("mode") == "inherit_provider_default":
        return AgentModelSelection("inherit_provider_default")
    ref = raw.get("ref")
    if not isinstance(ref, dict):
        raise ConfigError("Agent model selection requires a ref")
    return AgentModelSelection("explicit", ModelRef(str(ref["provider_id"]), str(ref["model_id"])))


def _decode_legacy_optional(raw: object) -> AgentModelSelection | None:
    return None if raw is None else _decode_legacy_selection(raw)


def _decode_reasoning_effort(raw: object) -> str | None:
    if raw is None:
        return None
    if raw not in {"none", "low", "medium", "high", "xhigh", "max"}:
        raise ConfigError("Agent reasoning effort is invalid")
    return str(raw)


def _encode_policy(
    policy: AgentModelPolicy, *, agent_name: str, base: dict[str, object] | None = None,
) -> dict[str, object]:
    models: dict[str, object] = {}
    for key, selection in (
        ("primary", policy.primary_model),
        ("image_understanding", policy.image_understanding_model),
        ("image_generation", policy.image_generation_model or policy.image_model),
        ("text_to_speech", policy.text_to_speech_model),
        ("realtime_voice", policy.realtime_voice_model),
        ("speech_to_text", policy.speech_to_text_model),
    ):
        if selection is not None:
            models[key] = _encode_selection(selection)
    if policy.reasoning_effort is not None:
        models["reasoning_effort"] = policy.reasoning_effort
    document: dict[str, object] = dict(base or {})
    document.update({
        "schema_version": 2,
        "agent_name": agent_name,
        "display_name": document.get("display_name") or ("OpenDrSai" if agent_name == DEFAULT_AGENT else agent_name),
        "enabled": bool(document.get("enabled", True)),
        "models": models,
    })
    document.setdefault("tools", _encode_tool_policy(AgentToolPolicy()))
    document.setdefault("skills", _encode_skill_policy(
        AgentSkillPolicy(mode="all_enabled") if (base or {}).get("schema_version") == 1 else AgentSkillPolicy()
    ))
    document.setdefault("knowledge", _encode_knowledge_policy(AgentKnowledgePolicy()))
    return document


def _resource_ids(raw: object, field: str) -> tuple[str, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list) or any(not isinstance(value, str) or not value.strip() for value in raw):
        raise ConfigError(f"Agent {field} must be a list of non-empty resource IDs")
    values = tuple(value.strip() for value in raw)
    if len(values) != len(set(values)):
        raise ConfigError(f"Agent {field} contains duplicate resource IDs")
    return values


def _resource_mode(raw: object, kind: str) -> str:
    value = str(raw or "inherit")
    if value not in _RESOURCE_MODES:
        raise ConfigError(f"Agent {kind} mode is invalid")
    return value


def _decode_tool_policy(raw: object) -> AgentToolPolicy:
    if raw is None:
        return AgentToolPolicy()
    if not isinstance(raw, dict):
        raise ConfigError("Agent tools configuration is invalid")
    return AgentToolPolicy(
        mode=_resource_mode(raw.get("mode"), "tools"),
        enabled=_resource_ids(raw.get("enabled"), "tools.enabled"),
        disabled=_resource_ids(raw.get("disabled"), "tools.disabled"),
        require_approval=_resource_ids(raw.get("require_approval"), "tools.require_approval"),
    )


def _decode_skill_policy(raw: object) -> AgentSkillPolicy:
    if raw is None:
        return AgentSkillPolicy()
    if not isinstance(raw, dict):
        raise ConfigError("Agent skills configuration is invalid")
    override = raw.get("allow_thread_override", True)
    if not isinstance(override, bool):
        raise ConfigError("Agent skills.allow_thread_override must be a boolean")
    return AgentSkillPolicy(
        mode=_resource_mode(raw.get("mode"), "skills"),
        enabled=_resource_ids(raw.get("enabled"), "skills.enabled"),
        disabled=_resource_ids(raw.get("disabled"), "skills.disabled"),
        allow_thread_override=override,
    )


def _decode_knowledge_policy(raw: object) -> AgentKnowledgePolicy:
    if raw is None:
        return AgentKnowledgePolicy()
    if not isinstance(raw, dict):
        raise ConfigError("Agent knowledge configuration is invalid")
    retrieval_policy = str(raw.get("retrieval_policy") or "auto")
    if retrieval_policy not in _RETRIEVAL_POLICIES:
        raise ConfigError("Agent knowledge retrieval_policy is invalid")
    top_k = raw.get("top_k", 6)
    threshold = raw.get("score_threshold", 0.35)
    citations = raw.get("require_citations", True)
    if not isinstance(top_k, int) or isinstance(top_k, bool) or not 1 <= top_k <= 50:
        raise ConfigError("Agent knowledge top_k must be between 1 and 50")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0 <= float(threshold) <= 1:
        raise ConfigError("Agent knowledge score_threshold must be between 0 and 1")
    if not isinstance(citations, bool):
        raise ConfigError("Agent knowledge require_citations must be a boolean")
    return AgentKnowledgePolicy(
        mode=_resource_mode(raw.get("mode"), "knowledge"),
        sources=_resource_ids(raw.get("sources"), "knowledge.sources"),
        retrieval_policy=retrieval_policy,
        top_k=top_k,
        score_threshold=float(threshold),
        require_citations=citations,
    )


def _encode_tool_policy(policy: AgentToolPolicy) -> dict[str, object]:
    return {"mode": policy.mode, "enabled": list(policy.enabled), "disabled": list(policy.disabled), "require_approval": list(policy.require_approval)}


def _encode_skill_policy(policy: AgentSkillPolicy) -> dict[str, object]:
    return {"mode": policy.mode, "enabled": list(policy.enabled), "disabled": list(policy.disabled), "allow_thread_override": policy.allow_thread_override}


def _encode_knowledge_policy(policy: AgentKnowledgePolicy) -> dict[str, object]:
    return {"mode": policy.mode, "sources": list(policy.sources), "retrieval_policy": policy.retrieval_policy, "top_k": policy.top_k, "score_threshold": policy.score_threshold, "require_citations": policy.require_citations}


def _encode_selection(selection: AgentModelSelection) -> dict[str, object]:
    value: dict[str, object] = {"mode": selection.mode}
    if selection.ref is not None:
        value.update(provider_id=selection.ref.provider_id, model_id=selection.ref.model_id)
    return value


def _render_toml(document: dict[str, object]) -> str:
    lines = [
        f"schema_version = {document['schema_version']}\n",
        f"agent_name = {json.dumps(document['agent_name'], ensure_ascii=False)}\n",
        f"display_name = {json.dumps(document['display_name'], ensure_ascii=False)}\n",
        f"enabled = {'true' if document['enabled'] else 'false'}\n",
    ]
    models = document["models"]
    assert isinstance(models, dict)
    if "reasoning_effort" in models:
        lines.extend(["\n[models]\n", f"reasoning_effort = {json.dumps(models['reasoning_effort'])}\n"])
    for role in ("primary", "image_understanding", "image_generation", "text_to_speech", "realtime_voice", "speech_to_text"):
        selection = models.get(role)
        if not isinstance(selection, dict):
            continue
        lines.extend([f"\n[models.{role}]\n", f"mode = {json.dumps(selection['mode'])}\n"])
        if "provider_id" in selection:
            lines.append(f"provider_id = {json.dumps(selection['provider_id'], ensure_ascii=False)}\n")
            lines.append(f"model_id = {json.dumps(selection['model_id'], ensure_ascii=False)}\n")
    for section_name in ("execution", "tools", "skills", "knowledge"):
        section = document.get(section_name)
        if not isinstance(section, dict):
            continue
        lines.append(f"\n[{section_name}]\n")
        for key, value in section.items():
            if isinstance(value, bool):
                rendered = "true" if value else "false"
            elif isinstance(value, (str, int, float)):
                rendered = json.dumps(value, ensure_ascii=False)
            elif isinstance(value, list) and all(isinstance(item, str) for item in value):
                rendered = "[" + ", ".join(json.dumps(item, ensure_ascii=False) for item in value) + "]"
            else:
                raise ConfigError(f"Agent {section_name}.{key} cannot be serialized")
            lines.append(f"{key} = {rendered}\n")
    return "".join(lines)


def _revision(document: dict[str, object]) -> str:
    canonical = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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
        try:
            path.chmod(0o600)
        except OSError:
            pass
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink(missing_ok=True)
