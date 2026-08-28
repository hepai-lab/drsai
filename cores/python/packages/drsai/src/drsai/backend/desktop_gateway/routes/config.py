"""V1-compatible ``/v1/config/*`` routes for the Desktop gateway.

The V2 Desktop gateway deliberately started with only runtime/workspaces/
sessions/runs/models/audio routes.  The Electron renderer, however, calls a
set of ``/v1/config/*`` endpoints that the V1 legacy gateway served
(``gateway_legacy.py``).  Until the renderer is migrated to the new surface,
those calls must not 404.

This module reproduces the **read** side of the legacy config surface — enough
routes to let the desktop boot, show the model picker, and display the agent
model policy.  Write routes (``PUT``, ``POST``, ``DELETE``) are ported too,
because the renderer uses them for settings and model policy edits.

Key imports come from two packages:

* ``drsai.config`` — the model-provider / agent-policy registry shared with the
  legacy gateway.
* ``drsai.backend.cli.config`` — the CLI config JSON (``cli_config.json``).
* ``drsai.config.model_catalog`` — ``AgentModelPolicy``, ``ModelRef``, etc.

The helpers ``_agent_model_policy_payload`` and ``_runtime_model_catalog_payload``
are adapted from ``gateway_legacy.py`` lines 11604 and 11508.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Mapping

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional

from drsai.backend.cli.config import CLI_CONFIG_PATH, _SENSITIVE_KEYS, load_config, save_config
from drsai.config import (
    ConfigError as ModelProviderConfigError,
    canonical_agent_name,
    current_agent_name,
    list_agent_names,
    load_agent_descriptor,
    load_agent_model_policy,
    commit_agent_model_policy,
    AgentModelPolicyConflict,
    load_user_config as load_model_provider_config,
    resolve_model_config,
    resolve_model_ref,
    remove_legacy_model_selection,
    builtin_provider_names,
    cached_provider_model_catalog,
    telemetry_snapshot,
    config_revision as model_config_revision,
    latest_probe_result,
    probe_fingerprint,
    last_known_good_path,
    list_provider_presets,
)
from drsai.config.model_catalog import (
    AgentModelPolicy,
    AgentModelSelection,
    ModelDescriptor as RuntimeModelDescriptor,
    ModelRef as RuntimeModelRef,
    build_runtime_model_catalog,
)
from drsai.config.model_registry import find_model_capabilities
from drsai.config.schema import DrSaiConfig
from drsai.config.loader import default_config_path as default_model_config_path

from .._auth import effective_user_id

api = APIRouter(tags=["config"])

# ── Writable CLI config keys (mirrors the renderer's WRITABLE_KEYS) ─────────
WRITABLE_KEYS = frozenset({"plan_mode", "workspace_enabled", "dangerous_allowed"})


# ══════════════════════════════════════════════════════════════════════════
# CLI config routes  (/v1/config/cli)
# ══════════════════════════════════════════════════════════════════════════

def _mask_cli_config(cfg: dict) -> dict:
    """Return a copy of *cfg* with sensitive keys masked for the API."""
    masked = dict(cfg)
    for key in _SENSITIVE_KEYS:
        if key in masked and masked[key] is not None:
            masked[key] = "********"
    return masked


@api.get("/v1/config/cli", operation_id="getCliConfig")
async def get_cli_config():
    """Return the CLI config (``cli_config.json``) with secrets masked."""
    cfg = await asyncio.to_thread(load_config)
    return {
        "path": str(CLI_CONFIG_PATH),
        "config": _mask_cli_config(cfg),
    }


class CliConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: Any


@api.put("/v1/config/cli/{key}", operation_id="updateCliConfigKey")
async def update_cli_config_key(key: str, req: CliConfigUpdateRequest):
    """Update a single CLI config key (only writable keys are allowed)."""
    if key not in WRITABLE_KEYS and key != "user_id":
        raise HTTPException(
            status_code=400,
            detail=f"Key '{key}' is not writable. Writable keys: {sorted(WRITABLE_KEYS | {'user_id'})}",
        )
    cfg = await asyncio.to_thread(load_config)
    cfg[key] = req.value
    await asyncio.to_thread(save_config, cfg)
    return {"ok": True, "key": key, "value": req.value}


# ══════════════════════════════════════════════════════════════════════════
# Agent routes  (/v1/config/agents)
# ══════════════════════════════════════════════════════════════════════════

@api.get("/v1/config/agents", operation_id="listConfiguredAgents")
async def list_configured_agents():
    """List configured agents and the current one."""
    active = await asyncio.to_thread(current_agent_name)
    names = await asyncio.to_thread(list_agent_names)

    def _build():
        return [
            {**load_agent_descriptor(name), "current": name == active}
            for name in names
        ]

    agents = await asyncio.to_thread(_build)
    return {"current_agent": active, "agents": agents}


@api.get("/v1/config/agents/current", operation_id="getCurrentAgentConfig")
async def get_current_agent_config():
    name = await asyncio.to_thread(current_agent_name)
    desc = await asyncio.to_thread(load_agent_descriptor, name)
    return {**desc, "current": True}


def _require_local_opendrsai_agent(agent_id: str) -> str:
    try:
        canonical = canonical_agent_name(agent_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail="Local Agent configuration not found") from exc
    if canonical not in list_agent_names():
        raise HTTPException(status_code=404, detail="Local OpenDrSai Agent model policy not found")
    return canonical


# ── helpers adapted from gateway_legacy.py ──────────────────────────────────

def _normalize_agent_reasoning_effort(effort: str, supported: tuple[str, ...]) -> str:
    if "max" in supported and "xhigh" not in supported and effort == "xhigh":
        return "max"
    if "high" in supported and "max" in supported and effort in {"low", "medium"}:
        return "high"
    return effort


def _descriptor_supports_agent_role(descriptor: Mapping[str, object], role: str) -> bool:
    inputs = set(descriptor.get("input_modalities") or [])
    outputs = set(descriptor.get("output_modalities") or [])
    model_ref = descriptor.get("ref")
    model_id = str(model_ref.get("model_id") or "").lower() if isinstance(model_ref, Mapping) else ""
    return {
        "image_understanding_model": "image" in inputs and "text" in outputs,
        "image_generation_model": "image" in outputs,
        "text_to_speech_model": "text" in inputs and "audio" in outputs,
        "realtime_voice_model": ("audio" in inputs and "audio" in outputs) or model_id.startswith("gpt-realtime"),
        "speech_to_text_model": "audio" in inputs and "text" in outputs,
    }.get(role, False)


def _runtime_model_catalog_payload(config: DrSaiConfig) -> dict[str, Any]:
    """Build the authoritative catalog (adapted from gateway_legacy.py:11508)."""
    provider_names = set(config.providers)
    provider_names.add(config.model_provider or "hepai")
    descriptors: list[RuntimeModelDescriptor] = []
    catalog_state = "fresh"
    state_priority = {"fresh": 0, "stale": 1, "offline": 2, "unauthorized": 3, "error": 4}
    for provider_id in sorted(provider_names):
        resolved = resolve_model_config(
            config, environ=os.environ, provider=provider_id, require_credentials=False,
        )
        provider = resolved.provider
        model_ids = list(provider.models)
        configured_model_ids = set(model_ids)
        discovered = cached_provider_model_catalog(provider_id, provider.base_url)
        if discovered is not None:
            for discovered_model_id in discovered["models"]:
                if discovered_model_id not in model_ids:
                    model_ids.append(discovered_model_id)
            discovered_state = str(discovered["catalog_state"])
            if state_priority.get(discovered_state, 4) > state_priority.get(catalog_state, 0):
                catalog_state = discovered_state
        if provider_id == (config.model_provider or "hepai") and config.model and config.model not in model_ids:
            model_ids.append(config.model)
        for model_id in model_ids:
            capabilities, known = find_model_capabilities(model_id)
            configured_model = provider.model_configs.get(model_id)
            if configured_model is not None and not configured_model.enabled:
                continue
            declared_image_operations = tuple(provider.model_operations.get(model_id, ()))
            input_modalities = configured_model.input_modalities if configured_model is not None else (("text", "image") if known and capabilities.vision else ("text",) if known else ())
            output_modalities = configured_model.output_modalities if configured_model is not None else (("text",) if known else ())
            operations: tuple[str, ...] = ()
            reasoning_efforts: tuple[str, ...] = ()
            if known:
                operations = ("chat",) + (("tool_calling",) if capabilities.function_calling else ())
                if capabilities.reasoning.supported:
                    operations += ("reasoning",)
                    reasoning_efforts = tuple(capabilities.reasoning.effort_levels)
            if configured_model is not None:
                operations = tuple(configured_model.capabilities)
                if capabilities.reasoning.supported and "reasoning" not in operations:
                    operations += ("reasoning",)
                reasoning_efforts = tuple(capabilities.reasoning.effort_levels) if "reasoning" in operations else ()
            if declared_image_operations:
                if "image_edit" in declared_image_operations and "image" not in input_modalities:
                    input_modalities += ("image",)
                if "image" not in output_modalities:
                    output_modalities += ("image",)
                operations += tuple(operation for operation in declared_image_operations if operation not in operations)
            discovered_models = set(discovered["models"]) if discovered is not None else set()
            availability = "configured_unverified"
            if discovered is not None:
                if model_id in discovered_models:
                    availability = str(discovered["availability"])
                elif model_id in configured_model_ids and discovered["catalog_state"] == "fresh":
                    availability = "configured_unverified"
                elif discovered["catalog_state"] == "fresh":
                    availability = "unavailable"
                else:
                    availability = str(discovered["catalog_state"])
            descriptors.append(RuntimeModelDescriptor(
                ref=RuntimeModelRef(provider_id, model_id),
                display_name=configured_model.alias if configured_model and configured_model.alias else provider.model_aliases.get(model_id, model_id),
                input_modalities=input_modalities,  # type: ignore[arg-type]
                output_modalities=output_modalities,  # type: ignore[arg-type]
                operations=operations,  # type: ignore[arg-type]
                reasoning_efforts=reasoning_efforts,  # type: ignore[arg-type]
                token_limit=capabilities.token_limit if known else None,
                max_output_tokens=capabilities.max_tokens if known else None,
                availability=availability,  # type: ignore[arg-type]
                capability_source="user_override" if configured_model is not None or declared_image_operations else "builtin" if known else "unknown",
                capability_confidence="declared" if configured_model is not None or declared_image_operations else "inferred" if known else "unknown",
                updated_at=(
                    discovered["updated_at"]
                    if discovered is not None and model_id in discovered_models
                    else None
                ),
            ))
    catalog = build_runtime_model_catalog(descriptors, state=catalog_state)  # type: ignore[arg-type]
    return {"models": [model.public_dict() for model in catalog.models], "revision": catalog.revision, "state": catalog.state}


def _agent_model_policy_payload(policy: AgentModelPolicy, revision: str, config: DrSaiConfig) -> dict[str, object]:
    """Build the policy response (adapted from gateway_legacy.py:11604)."""
    selection = policy.primary_model
    catalog_revision = str(_runtime_model_catalog_payload(config)["revision"])
    effective_ref = (
        RuntimeModelRef(selection.ref.provider_id, selection.ref.model_id, catalog_revision)
        if selection.mode == "explicit" and selection.ref is not None
        else None
    )
    valid = effective_ref is not None
    error = None if valid else "This Agent has no primary model configured."
    effective_capability_refs: dict[str, object | None] = {}
    try:
        if effective_ref is not None:
            resolve_model_ref(
                config,
                provider_id=effective_ref.provider_id,
                model_id=effective_ref.model_id,
                environ=os.environ,
                require_credentials=False,
            )
    except ModelProviderConfigError as exc:
        valid = False
        error = str(exc)
    catalog_models = _runtime_model_catalog_payload(config)["models"]
    primary_descriptor = next((item for item in catalog_models
                               if effective_ref is not None
                               and item["ref"]["provider_id"] == effective_ref.provider_id
                               and item["ref"]["model_id"] == effective_ref.model_id), None)
    effective_reasoning_effort = policy.reasoning_effort
    if effective_reasoning_effort is not None:
        supported_efforts = tuple(primary_descriptor.get("reasoning_efforts") or ()) if primary_descriptor else ()
        effective_reasoning_effort = _normalize_agent_reasoning_effort(
            effective_reasoning_effort, supported_efforts,
        )
        if effective_reasoning_effort not in supported_efforts:
            valid = False
            error = "The selected text model does not support the requested reasoning effort."
    capability_selections = {
        "image_understanding_model": policy.image_understanding_model,
        "image_generation_model": policy.image_generation_model or policy.image_model,
        "text_to_speech_model": policy.text_to_speech_model,
        "realtime_voice_model": policy.realtime_voice_model,
        "speech_to_text_model": policy.speech_to_text_model,
    }
    for role, capability_selection in capability_selections.items():
        effective_capability_refs[role] = None
        if capability_selection is None:
            continue
        capability_ref = capability_selection.ref
        if capability_selection.mode != "explicit" or capability_ref is None:
            valid, error = False, f"{role} must use an explicit Provider model."
            continue
        descriptor = next((item for item in catalog_models
                           if item["ref"]["provider_id"] == capability_ref.provider_id
                           and item["ref"]["model_id"] == capability_ref.model_id), None)
        if descriptor is None or not _descriptor_supports_agent_role(descriptor, role):
            valid, error = False, (
                "The selected image model has no declared image operation."
                if role == "image_generation_model"
                else f"The selected model does not support {role}."
            )
            continue
        effective_capability_refs[role] = RuntimeModelRef(
            capability_ref.provider_id, capability_ref.model_id, catalog_revision,
        ).public_dict(include_revision=False)
    return {
        "agent_id": policy.agent_id,
        "primary_model": {
            "mode": "explicit",
            "ref": selection.ref.public_dict(include_revision=False) if selection.ref else None,
        },
        **{
            role: ({"mode": selection.mode, "ref": selection.ref.public_dict(include_revision=False) if selection.ref else None} if selection is not None else None)
            for role, selection in capability_selections.items()
        },
        "image_model": ({
            "mode": capability_selections["image_generation_model"].mode,
            "ref": capability_selections["image_generation_model"].ref.public_dict(include_revision=False) if capability_selections["image_generation_model"].ref else None,
        } if capability_selections["image_generation_model"] is not None else None),
        "effective_ref": effective_ref.public_dict(include_revision=False) if effective_ref else None,
        "effective_image_ref": effective_capability_refs["image_generation_model"],
        "effective_image_understanding_ref": effective_capability_refs["image_understanding_model"],
        "effective_image_generation_ref": effective_capability_refs["image_generation_model"],
        "effective_text_to_speech_ref": effective_capability_refs["text_to_speech_model"],
        "effective_realtime_voice_ref": effective_capability_refs["realtime_voice_model"],
        "effective_speech_to_text_ref": effective_capability_refs["speech_to_text_model"],
        "reasoning_effort": effective_reasoning_effort,
        "revision": revision,
        "valid": valid,
        "error": error,
    }


def _resolve_agent_primary_model(config: DrSaiConfig, agent_name: str | None = None):
    """Resolve the current agent's primary model (adapted from gateway_legacy.py:11362)."""
    policy = load_agent_model_policy(agent_name or current_agent_name()).policy
    selection = policy.primary_model
    if selection.mode != "explicit" or selection.ref is None:
        raise ModelProviderConfigError(
            "OpenDrSai Agent has no primary model configured; configure the Agent model policy."
        )
    return resolve_model_ref(
        config,
        provider_id=selection.ref.provider_id,
        model_id=selection.ref.model_id,
        environ=os.environ,
        require_credentials=False,
    )


@api.get("/v1/config/agents/{agent_id}/models", operation_id="getAgentModelPolicy")
async def get_agent_model_policy(agent_id: str):
    """Read the persisted local Agent model policy and its effective ref."""
    _require_local_opendrsai_agent(agent_id)
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        snapshot = await asyncio.to_thread(load_agent_model_policy, agent_id)
        # Old releases stored the effective model in top-level Provider fields
        # and persisted an inherited Agent selection. Convert that state once
        # to an explicit provider/model reference. If it cannot be resolved we
        # keep the invalid legacy snapshot so the UI can guide configuration;
        # there is deliberately no silent fallback.
        if snapshot.policy.primary_model.mode != "explicit" and config.source_path is not None:
            legacy_provider = config.model_provider
            legacy_model = config.model
            if legacy_provider and legacy_model:
                try:
                    await asyncio.to_thread(
                        resolve_model_ref,
                        config,
                        provider_id=legacy_provider,
                        model_id=legacy_model,
                        environ=os.environ,
                        require_credentials=False,
                    )
                    migrated_policy = AgentModelPolicy(
                        agent_id=agent_id,
                        primary_model=AgentModelSelection(
                            "explicit", RuntimeModelRef(legacy_provider, legacy_model),
                        ),
                        image_model=snapshot.policy.image_model,
                        image_understanding_model=snapshot.policy.image_understanding_model,
                        image_generation_model=snapshot.policy.image_generation_model,
                        text_to_speech_model=snapshot.policy.text_to_speech_model,
                        realtime_voice_model=snapshot.policy.realtime_voice_model,
                        speech_to_text_model=snapshot.policy.speech_to_text_model,
                        reasoning_effort=snapshot.policy.reasoning_effort,
                    )
                    snapshot = await asyncio.to_thread(
                        commit_agent_model_policy,
                        migrated_policy,
                        expected_revision=snapshot.revision,
                    )
                    await asyncio.to_thread(
                        remove_legacy_model_selection,
                        path=config.source_path,
                    )
                except (ModelProviderConfigError, AgentModelPolicyConflict):
                    pass
        return _agent_model_policy_payload(snapshot.policy, snapshot.revision, config)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Agent model policy write route ──────────────────────────────────────────

class AgentModelSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: str = "explicit"
    ref: Optional["ModelRefRequest"] = None


class ModelRefRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str
    model_id: str


class AgentModelPolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    primary_model: AgentModelSelectionRequest
    image_model: Optional[AgentModelSelectionRequest] = None
    image_understanding_model: Optional[AgentModelSelectionRequest] = None
    image_generation_model: Optional[AgentModelSelectionRequest] = None
    text_to_speech_model: Optional[AgentModelSelectionRequest] = None
    realtime_voice_model: Optional[AgentModelSelectionRequest] = None
    speech_to_text_model: Optional[AgentModelSelectionRequest] = None
    reasoning_effort: Optional[str] = None
    expected_revision: Optional[str] = None


# Resolve forward reference
AgentModelSelectionRequest.model_rebuild()


@api.put("/v1/config/agents/{agent_id}/models", operation_id="putAgentModelPolicy")
async def put_agent_model_policy(agent_id: str, req: AgentModelPolicyUpdateRequest):
    """Persist one provider-aware policy with optimistic concurrency control."""
    _require_local_opendrsai_agent(agent_id)
    try:
        if req.primary_model.ref is None:
            raise ValueError("Primary model selection must include a Provider model reference")
        ref = RuntimeModelRef(req.primary_model.ref.provider_id, req.primary_model.ref.model_id)
        selection = AgentModelSelection("explicit", ref)

        def capability_selection(value: Optional[AgentModelSelectionRequest], label: str) -> AgentModelSelection | None:
            if value is None:
                return None
            if value.mode != "explicit" or value.ref is None:
                raise ValueError(f"{label} selection must be explicit")
            return AgentModelSelection("explicit", RuntimeModelRef(value.ref.provider_id, value.ref.model_id))

        image_understanding_selection = capability_selection(req.image_understanding_model, "Image understanding model")
        image_generation_selection = capability_selection(req.image_generation_model or req.image_model, "Image generation model")
        text_to_speech_selection = capability_selection(req.text_to_speech_model, "Text-to-speech model")
        realtime_voice_selection = capability_selection(req.realtime_voice_model, "Realtime voice model")
        speech_to_text_selection = capability_selection(req.speech_to_text_model, "Speech-to-text model")
        config = await asyncio.to_thread(load_model_provider_config)
        if ref is not None:
            resolve_model_ref(
                config, provider_id=ref.provider_id, model_id=ref.model_id,
                environ=os.environ, require_credentials=False,
            )
        policy = AgentModelPolicy(
            agent_id=agent_id,
            primary_model=selection,
            image_model=image_generation_selection,
            image_understanding_model=image_understanding_selection,
            image_generation_model=image_generation_selection,
            text_to_speech_model=text_to_speech_selection,
            realtime_voice_model=realtime_voice_selection,
            speech_to_text_model=speech_to_text_selection,
            reasoning_effort=req.reasoning_effort,
        )
        candidate = _agent_model_policy_payload(policy, req.expected_revision or "sha256:" + "0" * 64, config)
        if not candidate["valid"]:
            raise ValueError(str(candidate["error"]))
        snapshot = await asyncio.to_thread(
            commit_agent_model_policy, policy, expected_revision=req.expected_revision,
        )
        if config.source_path is not None:
            await asyncio.to_thread(remove_legacy_model_selection, path=config.source_path)
        return _agent_model_policy_payload(snapshot.policy, snapshot.revision, config)
    except AgentModelPolicyConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "agent_model_policy_conflict", "message": str(exc)}) from exc
    except (ModelProviderConfigError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ══════════════════════════════════════════════════════════════════════════
# Model config routes  (/v1/config/model-state, /v1/config/model-providers, ...)
# ══════════════════════════════════════════════════════════════════════════

@api.get("/v1/config/model-state", operation_id="getModelConfigState")
async def get_model_config_state(request: Request):
    """Return effective state and recovery metadata, never credentials."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        resolved = _resolve_agent_primary_model(config)
        configured_providers = [
            resolve_model_config(config, environ=os.environ, provider=name, require_credentials=False).provider.public_dict()
            for name in config.providers
        ]
        target = default_model_config_path()
        # The V2 DesktopAgentManager does not track per-agent model config
        # revisions (the alias comes from the request, not from a policy
        # layer).  Report a static "not_started" status so the renderer knows
        # there is no runtime revision divergence to warn about.
        runtime = {
            "configured_revision": model_config_revision(target),
            "runtime_revisions": [],
            "runtime_status": "not_started",
            "active_runtime_count": 0,
        }
        return {
            "path": str(target),
            "revision": model_config_revision(target),
            "last_known_good_available": last_known_good_path(target).is_file(),
            "effective": resolved.public_dict(),
            "providers": configured_providers,
            "runtime": runtime,
            "last_test": latest_probe_result(
                resolved.provider.name,
                resolved.model_id or resolved.model,
                probe_fingerprint(
                    resolved.provider.name,
                    resolved.model_id or resolved.model,
                    resolved.provider.base_url,
                    resolved.provider.wire_api,
                    resolved.provider.api_key.reveal() if resolved.provider.api_key is not None else "",
                ),
            ),
            "telemetry": telemetry_snapshot(),
        }
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.get("/v1/config/model-providers", operation_id="listModelProviders")
async def list_model_provider_configs():
    """List user-defined Providers and the effective built-in Provider."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        providers: list[dict[str, object]] = []
        names = set(config.providers)
        names.update(builtin_provider_names())
        names.add(config.model_provider or "hepai")
        for name in sorted(names):
            try:
                resolved = resolve_model_config(
                    config,
                    environ=os.environ,
                    provider=name,
                    require_credentials=False,
                )
            except ModelProviderConfigError:
                continue
            providers.append(resolved.provider.public_dict())
        return {"providers": providers}
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.get("/v1/config/model-providers/presets", operation_id="listModelProviderPresets")
async def get_model_provider_presets():
    """List user-facing presets whose invariant fields stay out of TOML."""
    return {"presets": list_provider_presets()}


@api.get("/v1/config/runtime-models", operation_id="getRuntimeModelCatalog")
async def get_runtime_model_catalog():
    """Return only models owned by configured Providers; never legacy global catalogs."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        return _runtime_model_catalog_payload(config)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.get("/v1/config/model", operation_id="getActiveModelConfig")
async def get_active_model_config():
    """Return the effective compact model configuration without secrets."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        resolved = _resolve_agent_primary_model(config)
        result = resolved.public_dict()
        result["path"] = config.source_path
        result["revision"] = model_config_revision()
        return result
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.get("/v1/config/agents/{agent_id}/model-capability-status", operation_id="getAgentModelCapabilityStatus")
async def get_agent_model_capability_status(agent_id: str):
    """Return whether the agent's configured models are valid and available."""
    _require_local_opendrsai_agent(agent_id)
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        snapshot = await asyncio.to_thread(load_agent_model_policy, agent_id)
        payload = _agent_model_policy_payload(snapshot.policy, snapshot.revision, config)
        return {
            "agent_id": agent_id,
            "valid": payload["valid"],
            "error": payload["error"],
            "effective_ref": payload["effective_ref"],
            "revision": payload["revision"],
        }
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ══════════════════════════════════════════════════════════════════════════
# Retired routes (410 Gone — mirrors gateway_legacy.py)
# ══════════════════════════════════════════════════════════════════════════

@api.put("/v1/config/model", operation_id="setActiveModelConfig")
async def set_active_model_config():
    """Retired global-model write endpoint."""
    raise HTTPException(status_code=410, detail={
        "code": "global_model_removed",
        "message": "Configure Provider details and the selected Agent model policy separately.",
    })


@api.post("/v1/config/model/preview", operation_id="previewActiveModelConfig")
async def preview_active_model_config():
    """Retired global-model preview endpoint."""
    raise HTTPException(status_code=410, detail={
        "code": "global_model_removed",
        "message": "Preview Provider changes through the Provider endpoint and models through Agent settings.",
    })


def router() -> APIRouter:
    return api
