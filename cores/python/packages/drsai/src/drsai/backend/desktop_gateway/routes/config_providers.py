"""Model-provider configuration write/test/probe routes.

The V2 Desktop gateway's ``routes/config.py`` covers the read side of the
``/v1/config/*`` surface (agent policy, model catalog, provider listing).
This module reproduces the **write and probe** side of the legacy config
surface -- enough routes to let the desktop configure providers, test
connections, run capability probes, and migrate legacy model selections.

All routes are adapted from ``gateway_legacy.py`` (V1) to the V2
``APIRouter`` pattern:

* ``@app.get/post/put/delete`` -> ``@api.get/post/put/delete``
* ``_get_user_id()`` -> ``effective_user_id()``
* ``_activate_model_config_commit()`` adapts to the V2 ``DesktopAgentManager``
  which does not track per-agent config revisions -- it still invalidates the
  shared discovery cache but returns ``0`` for the evicted-session count.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal

from drsai.config import (
    ConfigError as ModelProviderConfigError,
    ConfigConflict as ModelProviderConfigConflict,
    ConfigUpdateRequest,
    canonical_agent_name,
    clear_model_discovery_cache,
    commit_agent_model_policy,
    commit_update as commit_model_config_update,
    config_revision as model_config_revision,
    current_agent_name,
    diagnose_model_config,
    discover_provider_models,
    guidance_for,
    list_agent_names,
    load_agent_model_policy,
    load_user_config as load_model_provider_config,
    probe_provider_draft,
    ProviderDraft,
    remove_legacy_model_selection,
    resolve_model_config,
    resolve_model_ref,
    restore_last_known_good,
    test_provider_connection,
    AgentModelPolicyConflict,
)
from drsai.config.model_catalog import (
    AgentModelPolicy,
    AgentModelSelection,
    ModelRef as RuntimeModelRef,
)
from drsai.config.schema import DrSaiConfig, ProviderInput
from drsai.config.capability_probe import (
    CapabilityProbeResult,
    CapabilityProbeService,
    ProbeAssertion,
)
from drsai.config.model_operation_routing import (
    ModelOperationRoute,
    ModelOperationRoutePlan,
    ModelOperationRoutingError,
    ResolvedAgentOperation,
    default_operation_routes,
    resolve_agent_operation,
)
from drsai.platform_auth import get_platform_auth

from .._auth import effective_user_id
from .config import (
    _agent_model_policy_payload,
    _require_local_opendrsai_agent,
    _runtime_model_catalog_payload,
)

api = APIRouter(tags=["config"])


# =============================================================================
# Pydantic request/response models
# =============================================================================

class ProviderModelDefinitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    alias: Optional[str] = Field(default=None, min_length=1, max_length=256)
    input_modalities: list[Literal["text", "image", "audio", "video"]] = Field(default_factory=lambda: ["text"], min_length=1, max_length=4)
    output_modalities: list[Literal["text", "image", "audio", "video"]] = Field(default_factory=lambda: ["text"], min_length=1, max_length=4)
    api_protocol: Literal["openai", "anthropic", "gemini"] = "openai"
    enabled: bool = True
    capabilities: list[Literal["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"]] = Field(default_factory=lambda: ["chat"], max_length=8)
    upstream_id: Optional[str] = Field(default=None, min_length=1, max_length=256)


class ModelProviderConfigRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base_url: str = Field(..., min_length=1, max_length=2048)
    anthropic_base_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    google_base_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=8192)
    api_key_env: Optional[str] = Field(default=None, min_length=1, max_length=256)
    api_key_credential: Optional[str] = Field(default=None, min_length=1, max_length=512)
    wire_api: str = Field(default="openai", pattern=r"^(openai|anthropic|gemini)$")
    requires_api_key: bool = True
    models: Optional[dict[str, ProviderModelDefinitionRequest] | list[str]] = Field(default=None, max_length=500)
    model_aliases: Optional[dict[str, str]] = Field(default=None, max_length=500)
    model_upstream_ids: Optional[dict[str, str]] = Field(default=None, max_length=500)
    model_operations: Optional[dict[str, list[Literal["image_generation", "image_edit"]]]] = Field(default=None, max_length=500)
    expected_revision: Optional[str] = Field(default=None, min_length=64, max_length=64)


def _serialized_provider_models(
    models: Optional[dict[str, ProviderModelDefinitionRequest] | list[str]],
) -> Optional[dict[str, dict[str, object]] | list[str]]:
    """Convert validated request models into plain values accepted by the config writer."""
    if isinstance(models, dict):
        return {model_id: definition.model_dump(exclude_none=True) for model_id, definition in models.items()}
    return models


class ModelProviderTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Optional[str] = Field(default=None, min_length=1, max_length=256)


class ModelCapabilityProbeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: Optional[str] = Field(default=None, min_length=1, max_length=240)
    model: Optional[str] = Field(default=None, min_length=1, max_length=256)
    role: Literal["primary_model", "image_understanding_model", "image_generation_model", "text_to_speech_model", "speech_to_text_model"]
    operation: Literal["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "text_to_speech", "speech_to_text"]
    protocol: Literal["auto", "openai_responses", "openai_chat_completions", "gemini_generate_content", "openai_images_generation", "openai_images_edits", "openai_audio_speech", "openai_audio_transcriptions"] = "auto"


class ModelProviderDraftTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    base_url: str = Field(..., min_length=1, max_length=2048)
    model: str = Field(..., min_length=1, max_length=256)
    wire_api: str = Field(default="openai", pattern=r"^(openai|anthropic|gemini)$")
    requires_api_key: bool = True
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=8192, repr=False)
    api_key_env: Optional[str] = Field(default=None, min_length=1, max_length=256)
    mode: str = Field(default="basic", pattern=r"^(basic|model)$")


class ModelConfigRestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: Optional[str] = Field(default=None, min_length=64, max_length=64)


class ModelDoctorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    online: bool = False


class ModelDiscoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    refresh: bool = False
    base_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    anthropic_base_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    google_base_url: Optional[str] = Field(default=None, min_length=1, max_length=2048)
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=8192, repr=False)
    api_key_env: Optional[str] = Field(default=None, min_length=1, max_length=256)
    wire_api: str = Field(default="openai", pattern=r"^(openai|anthropic|gemini)$")
    requires_api_key: bool = True


class RuntimeModelRefResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str
    model_id: str
    catalog_revision: Optional[str] = None


class RuntimeModelDescriptorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ref: RuntimeModelRefResponse
    display_name: str
    input_modalities: list[Literal["text", "image", "audio", "video"]]
    output_modalities: list[Literal["text", "image", "audio", "video"]]
    operations: list[Literal["chat", "tool_calling", "reasoning", "image_generation", "image_edit", "speech_to_text", "text_to_speech", "video_generation"]]
    reasoning_efforts: list[Literal["none", "low", "medium", "high", "xhigh", "max"]]
    token_limit: Optional[int] = None
    max_output_tokens: Optional[int] = None
    availability: Literal["available", "configured_unverified", "unavailable", "stale", "offline", "unauthorized", "error"]
    capability_source: Literal["user_override", "provider", "builtin", "unknown"]
    capability_confidence: Literal["verified", "declared", "inferred", "unknown"]
    updated_at: Optional[str] = None


class ModelDiscoveryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool
    provider: Optional[str] = None
    models: list[str]
    model_details: list[dict[str, object]] = Field(default_factory=list)
    descriptors: list[RuntimeModelDescriptorResponse] = Field(default_factory=list)
    catalog_revision: Optional[str] = None
    catalog_state: Optional[Literal["fresh", "stale", "offline", "unauthorized", "error"]] = None
    cached: Optional[bool] = None
    updated_at: Optional[str] = None
    error: Optional[str] = None


class LegacyAgentModelPolicyMigrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    legacy_model: str = Field(..., min_length=1, max_length=240)
    expected_revision: Optional[str] = Field(default=None, pattern=r"^sha256:[0-9a-f]{64}$")


# =============================================================================
# Module-level state and helpers
# =============================================================================

_model_capability_probe_results: dict[str, dict[str, Any]] = {}
_model_capability_route_lock = threading.RLock()


def _model_capability_route_path() -> Path:
    root = Path(os.environ.get("DRSAI_HOME") or Path.home() / ".drsai").expanduser()
    return root / "runtime" / "verified-model-routes.json"


def _record_verified_model_protocol(result: Mapping[str, Any]) -> None:
    """Persist a bounded, secret-free protocol selected by a real probe."""
    if result.get("status") not in {"verified", "runtime_verified"} or result.get("evidence_kind") != "real_provider":
        return
    fields = [str(result.get(name) or "") for name in ("agent_id", "provider_id", "model_id", "operation", "protocol")]
    if not all(fields):
        return
    agent_id, provider_id, model_id, operation, protocol = fields
    key = "|".join((agent_id, provider_id, model_id, operation))
    path = _model_capability_route_path()
    with _model_capability_route_lock:
        try:
            value = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
        except (OSError, json.JSONDecodeError):
            value = {}
        routes = value.get("routes") if isinstance(value, dict) else None
        routes = routes if isinstance(routes, dict) else {}
        revisions = result.get("revisions") if isinstance(result.get("revisions"), Mapping) else {}
        routes[key] = {
            "protocol": protocol,
            "verified_at": str(result.get("started_at") or ""),
            "provider_config_revision": str(revisions.get("provider_config") or ""),
            "agent_policy_revision": str(revisions.get("agent_policy") or ""),
        }
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps({"schema_version": 1, "routes": routes}, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            temporary.replace(path)
        except OSError:
            # A read-only runtime may still probe models; routing simply falls
            # back to the declared plan for that process.
            return


def _preferred_verified_model_protocol(agent_id: str, provider_id: str, model_id: str, operation: str) -> str | None:
    key = "|".join((agent_id, provider_id, model_id, operation))
    path = _model_capability_route_path()
    with _model_capability_route_lock:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    routes = value.get("routes") if isinstance(value, dict) else None
    item = routes.get(key) if isinstance(routes, dict) else None
    protocol = item.get("protocol") if isinstance(item, dict) else None
    return str(protocol) if isinstance(protocol, str) and protocol else None


def _commit_metadata(committed: object) -> dict[str, object]:
    return {
        "changed_fields": list(getattr(committed, "changed_fields", ())),
        "restart_required": bool(getattr(committed, "restart_required", False)),
        "apply_strategy": str(getattr(committed, "apply_strategy", "next_turn_atomic_client_swap")),
    }


async def _activate_model_config_commit() -> int:
    """Invalidate shared discovery state.

    The V2 ``DesktopAgentManager`` does not track per-agent model config
    revisions (the alias comes from the request, not from a policy layer).
    We still clear the shared discovery cache so subsequent reads pick up the
    new provider/model topology, but return ``0`` for the evicted-session
    count since there are no per-user config revisions to evict.
    """
    clear_model_discovery_cache()
    return 0


def _model_provider_references(config: DrSaiConfig, name: str) -> list[dict[str, str]]:
    """List durable configuration references before a Provider is removed.

    Agent policy references join this list in P3-MC03. Keeping the preflight in
    one helper ensures DELETE remains fail-closed as new reference kinds appear.
    """
    references: list[dict[str, str]] = []
    for agent_name in list_agent_names():
        policy = load_agent_model_policy(agent_name).policy
        policy_ref = policy.primary_model.ref
        if policy_ref is not None and policy_ref.provider_id == name:
            references.append({
                "kind": "agent_model_policy",
                "id": agent_name,
                "label": f"{agent_name} primary model",
                "model_id": policy_ref.model_id,
            })
        capability_policies = (
            (
                "agent_image_model_policy",
                "Local OpenDrSai Agent image generation model",
                policy.image_generation_model or policy.image_model,
            ),
            (
                "agent_image_understanding_model_policy",
                "Local OpenDrSai Agent image understanding model",
                policy.image_understanding_model,
            ),
            (
                "agent_text_to_speech_model_policy",
                "Local OpenDrSai Agent text-to-speech model",
                policy.text_to_speech_model,
            ),
            (
                "agent_speech_to_text_model_policy",
                "Local OpenDrSai Agent speech-to-text model",
                policy.speech_to_text_model,
            ),
        )
        for kind, label, selection in capability_policies:
            capability_ref = selection.ref if selection is not None else None
            if capability_ref is not None and capability_ref.provider_id == name:
                references.append({
                    "kind": kind,
                    "id": agent_name,
                    "label": label,
                    "model_id": capability_ref.model_id,
                })
    return references


# =============================================================================
# Routes
# =============================================================================

@api.post("/v1/config/model/doctor", operation_id="doctorModelConfig")
async def doctor_model_config(req: ModelDoctorRequest = ModelDoctorRequest()):
    """Run offline configuration and credential diagnostics."""
    return await asyncio.to_thread(diagnose_model_config, online=req.online)


@api.post("/v1/config/model/restore", operation_id="restoreModelConfig")
async def restore_model_config(req: ModelConfigRestoreRequest):
    """Restore the last-known-good configuration with optimistic concurrency."""
    try:
        committed = await asyncio.to_thread(
            restore_last_known_good,
            expected_revision=req.expected_revision,
        )
    except ModelProviderConfigConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={**guidance_for("config_conflict"), "message": str(exc)},
        ) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await _activate_model_config_commit()
    return {
        "ok": True,
        "effective": committed.resolved.public_dict(),
        "revision": committed.revision,
        "config_revision": revision,
        **_commit_metadata(committed),
    }


@api.post("/v1/config/agents/{agent_id}/models/migrate", operation_id="migrateLegacyAgentModelPolicy")
async def migrate_legacy_agent_model_policy(agent_id: str, req: LegacyAgentModelPolicyMigrationRequest):
    """One-time migration for the old provider-less renderer model preference."""
    _require_local_opendrsai_agent(agent_id)
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        hepai = config.providers.get("hepai")
        use_hepai_product = hepai is not None and req.legacy_model in hepai.model_configs
        snapshot = (
            await asyncio.to_thread(load_agent_model_policy, agent_id)
            if use_hepai_product else None
        )
        provider_id = "hepai" if use_hepai_product else config.model_provider or "hepai"
        resolve_model_ref(
            config, provider_id=provider_id, model_id=req.legacy_model,
            environ=os.environ, require_credentials=False,
        )
        selection = AgentModelSelection("explicit", RuntimeModelRef(provider_id, req.legacy_model))
        policy = AgentModelPolicy(
            agent_id=agent_id,
            primary_model=selection,
            image_model=snapshot.policy.image_model if snapshot is not None else None,
            image_understanding_model=snapshot.policy.image_understanding_model if snapshot is not None else None,
            image_generation_model=snapshot.policy.image_generation_model if snapshot is not None else None,
            text_to_speech_model=snapshot.policy.text_to_speech_model if snapshot is not None else None,
            realtime_voice_model=snapshot.policy.realtime_voice_model if snapshot is not None else None,
            speech_to_text_model=snapshot.policy.speech_to_text_model if snapshot is not None else None,
            reasoning_effort=snapshot.policy.reasoning_effort if snapshot is not None else None,
        )
        snapshot = await asyncio.to_thread(
            commit_agent_model_policy, policy, expected_revision=req.expected_revision,
        )
        if config.source_path is not None:
            await asyncio.to_thread(remove_legacy_model_selection, path=config.source_path)
        return {**_agent_model_policy_payload(snapshot.policy, snapshot.revision, config), "migrated": True}
    except AgentModelPolicyConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "agent_model_policy_conflict", "message": str(exc)}) from exc
    except (ModelProviderConfigError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.post("/v1/config/model-providers/models", operation_id="discoverModelProviderModels", response_model=ModelDiscoveryResponse)
async def discover_model_provider_models(req: ModelDiscoveryRequest):
    """Discover models with a short-lived in-memory cache."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        auth = get_platform_auth() if req.provider == "hepai" else None
        if req.base_url is not None or auth is not None:
            existing_provider = config.providers.get(req.provider)
            oidc_base_url = auth.model_base_url if auth is not None else None
            oidc_access_token = auth.access_token if auth is not None else None
            config = DrSaiConfig(
                current_agent=config.current_agent,
                agent_config_file=config.agent_config_file,
                model=config.model,
                model_provider=req.provider,
                config_version=config.config_version,
                providers={
                    **config.providers,
                    req.provider: ProviderInput(
                        name=req.provider,
                        base_url=oidc_base_url or req.base_url,
                        anthropic_base_url=req.anthropic_base_url or (existing_provider.anthropic_base_url if existing_provider else None),
                        google_base_url=req.google_base_url or (existing_provider.google_base_url if existing_provider else None),
                        wire_api=req.wire_api,
                        requires_api_key=req.requires_api_key,
                        api_key=(
                            oidc_access_token
                            if oidc_access_token is not None
                            else req.api_key
                            if req.api_key is not None
                            else existing_provider.api_key
                            if existing_provider and req.api_key_env is None
                            else None
                        ),
                        api_key_env=(
                            None
                            if oidc_access_token is not None
                            else req.api_key_env
                            if req.api_key_env is not None
                            else existing_provider.api_key_env
                            if existing_provider and req.api_key is None
                            else None
                        ),
                        api_key_credential=(
                            None
                            if oidc_access_token is not None
                            else existing_provider.api_key_credential
                            if existing_provider and req.api_key is None and req.api_key_env is None
                            else None
                        ),
                        models_file=existing_provider.models_file if existing_provider else None,
                        models=existing_provider.models if existing_provider else (),
                        model_aliases=existing_provider.model_aliases if existing_provider else {},
                        model_upstream_ids=existing_provider.model_upstream_ids if existing_provider else {},
                        model_operations=existing_provider.model_operations if existing_provider else {},
                        model_configs=existing_provider.model_configs if existing_provider else {},
                    ),
                },
                source_path=config.source_path,
            )
        resolved = resolve_model_config(
            config,
            environ=os.environ,
            provider=req.provider,
            require_credentials=True,
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await discover_provider_models(resolved, refresh=req.refresh)


@api.put("/v1/config/model-providers/{name}", operation_id="updateModelProvider")
async def update_model_provider(name: str, req: ModelProviderConfigRequest):
    """Create or replace a user Provider without returning its secret."""
    try:
        values = req.model_dump(exclude_none=True, exclude={"expected_revision"})
        raw_key = values.pop("api_key", None)
        committed = await asyncio.to_thread(
            commit_model_config_update,
            ConfigUpdateRequest(
                provider_name=name,
                provider_values=values,
                provider_secret=raw_key if isinstance(raw_key, str) else None,
            ),
            expected_revision=req.expected_revision or model_config_revision(),
        )
        resolved = resolve_model_config(
            committed.config,
            environ=os.environ,
            provider=name,
            require_credentials=False,
        )
    except ModelProviderConfigConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "config_conflict", "message": str(exc)}) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await _activate_model_config_commit()
    return {"ok": True, "provider": resolved.provider.public_dict(), "evicted_sessions": 0, "config_revision": revision, "revision": committed.revision, "warnings": list(committed.warnings), **_commit_metadata(committed)}


@api.get("/v1/config/model-providers/{name}/references", operation_id="listModelProviderReferences")
async def list_model_provider_references(name: str):
    """Preflight Provider deletion without changing configuration or credentials."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        if name == "hepai" or name not in config.providers:
            raise HTTPException(status_code=404, detail=f"Model provider '{name}' not found")
        references = await asyncio.to_thread(_model_provider_references, config, name)
        return {
            "provider": name,
            "references": references,
            "can_delete": not references,
        }
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.delete("/v1/config/model-providers/{name}", operation_id="deleteModelProvider")
async def delete_model_provider(name: str, expected_revision: Optional[str] = None, delete_credential: bool = True):
    """Delete an unreferenced user Provider; never silently rewrite references."""
    try:
        base_revision = expected_revision or model_config_revision()
        config = await asyncio.to_thread(load_model_provider_config)
        if name == "hepai" or name not in config.providers:
            raise HTTPException(status_code=404, detail=f"Model provider '{name}' not found")
        references = await asyncio.to_thread(_model_provider_references, config, name)
        if references:
            raise HTTPException(status_code=409, detail={
                "code": "provider_references_present",
                "message": "Migrate the affected model selections before deleting this Provider.",
                "provider": name,
                "references": references,
            })
        committed = await asyncio.to_thread(
            commit_model_config_update,
            ConfigUpdateRequest(
                delete_provider_name=name,
                delete_provider_credential=delete_credential,
            ),
            expected_revision=base_revision,
        )
    except ModelProviderConfigConflict as exc:
        raise HTTPException(status_code=409, detail={"code": "config_conflict", "message": str(exc)}) from exc
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    revision = await _activate_model_config_commit()
    return {"ok": True, "active": config.model_provider, "evicted_sessions": 0, "config_revision": revision, "revision": committed.revision}


@api.post("/v1/config/model-providers/{name}/test", operation_id="testModelProviderConnection")
async def test_model_provider_connection(name: str, req: ModelProviderTestRequest = ModelProviderTestRequest()):
    """Perform a bounded, authenticated protocol check against a Provider."""
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        # HepAI authenticates with the caller's request-scoped OIDC token, not a
        # persisted API key. Mirror model discovery so Verify Connection works.
        auth = get_platform_auth() if name == "hepai" else None
        if auth is not None:
            existing_provider = config.providers.get(name)
            if existing_provider is not None:
                config = DrSaiConfig(
                    model=req.model or config.model,
                    model_provider=name,
                    config_version=config.config_version,
                    providers={
                        **config.providers,
                        name: ProviderInput(
                            name=name,
                            base_url=auth.model_base_url or existing_provider.base_url,
                            anthropic_base_url=existing_provider.anthropic_base_url,
                            google_base_url=existing_provider.google_base_url,
                            wire_api=existing_provider.wire_api,
                            requires_api_key=existing_provider.requires_api_key,
                            api_key=auth.access_token,
                            api_key_env=None,
                            api_key_credential=None,
                            models_file=existing_provider.models_file,
                            models=existing_provider.models,
                            model_aliases=existing_provider.model_aliases,
                            model_upstream_ids=existing_provider.model_upstream_ids,
                            model_operations=existing_provider.model_operations,
                            model_configs=existing_provider.model_configs,
                        ),
                    },
                    source_path=config.source_path,
                )
        resolved = resolve_model_config(
            config,
            environ=os.environ,
            provider=name,
            model=req.model,
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await asyncio.to_thread(test_provider_connection, resolved)


@api.post("/v1/config/model-providers/{name}/capability-probes", operation_id="probeModelProviderCapability")
async def probe_model_provider_capability(name: str, req: ModelCapabilityProbeRequest):
    """Run one bounded capability probe with the Agent's saved Provider credential."""
    config = None
    policy_snapshot = None
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        agent_id = req.agent_id or current_agent_name()
        policy_snapshot = await asyncio.to_thread(load_agent_model_policy, agent_id)
        if req.model:
            provider = config.providers.get(name)
            configured_model = provider.model_configs.get(req.model) if provider is not None else None
            if configured_model is None:
                raise HTTPException(status_code=404, detail={"code": "model_not_found", "message": "The requested model is not configured for this Provider."})
            ref = RuntimeModelRef(provider_id=name, model_id=req.model)
            model = await asyncio.to_thread(resolve_model_ref, config, provider_id=name, model_id=req.model, require_credentials=True)
            route_plan = default_operation_routes(ref, req.operation)
            if req.operation in {"image_generation", "image_edit"} and model.provider.wire_api == "gemini":
                route_plan = ModelOperationRoutePlan(ref, req.operation, (ModelOperationRoute("gemini_generate_content", 10),))
            if req.operation in {"chat", "tool_calling"} and req.model.casefold().startswith("gemini-"):
                if req.operation == "tool_calling":
                    route_plan = ModelOperationRoutePlan(ref, req.operation, (ModelOperationRoute("gemini_generate_content", 10),))
                else:
                    route_plan = ModelOperationRoutePlan(ref, req.operation, (*route_plan.routes, ModelOperationRoute("gemini_generate_content", 30)))
            resolved = ResolvedAgentOperation(role=req.role, ref=ref, model=model, route_plan=route_plan)
        else:
            resolved = await asyncio.to_thread(
                resolve_agent_operation, config, policy_snapshot.policy, role=req.role,
                operation=req.operation, require_credentials=True, allow_undeclared_operation=True,
            )
        if resolved.ref.provider_id != name:
            raise HTTPException(status_code=409, detail={
                "code": "agent_model_provider_mismatch",
                "message": "The Agent-bound model does not belong to the requested Provider.",
            })
        candidates = [route.protocol for route in resolved.route_plan.routes]
        # "auto" follows the ordered operation route. In particular, a
        # Gemini-family model may deliberately be exposed through the
        # Provider's OpenAI-compatible Responses endpoint; model family alone
        # must never override its configured protocol/base URL.
        protocol = candidates[0] if req.protocol == "auto" else req.protocol
        if protocol not in candidates:
            raise HTTPException(status_code=400, detail={
                "code": "protocol_unsupported",
                "message": "The requested protocol is not a candidate for this Agent model operation.",
                "candidates": candidates,
            })
        revisions = {
            "provider_config": f"sha256:{model_config_revision()}",
            "agent_policy": policy_snapshot.revision,
            "model_catalog": str(_runtime_model_catalog_payload(config).get("revision") or "unknown"),
            "route_rules": "opendrsai.model-operation-routes/1",
            "probe_definition": "opendrsai.model-capability-probes/1",
        }
        audio_input = None
        if req.operation == "speech_to_text":
            tts = await asyncio.to_thread(
                resolve_agent_operation,
                config,
                policy_snapshot.policy,
                role="text_to_speech_model",
                operation="text_to_speech",
                require_credentials=True,
            )
            tts_result, synthesized = await CapabilityProbeService().probe(
                tts, agent_id=agent_id, protocol="openai_audio_speech", revisions=revisions,
            )
            if tts_result.status != "verified" or synthesized is None:
                # The TTS call is only a fixture dependency for the STT probe.
                # Returning its result directly changes the requested model and
                # operation identities, causing matrix runners to abort instead
                # of recording an auditable STT failure. Preserve the requested
                # STT identity and expose only bounded dependency metadata.
                dependency_code = tts_result.error_code or "capability_assertion_failed"
                public = CapabilityProbeResult(
                    probe_id=f"probe-{uuid.uuid4()}",
                    agent_id=agent_id,
                    provider_id=resolved.ref.provider_id,
                    model_id=resolved.ref.model_id,
                    upstream_model_id=resolved.ref.model_id,
                    operation="speech_to_text",
                    protocol=protocol,  # type: ignore[arg-type]
                    status="unavailable" if tts_result.status == "unavailable" else "error",
                    started_at=datetime.now(timezone.utc).isoformat(),
                    duration_ms=tts_result.duration_ms,
                    assertions=(ProbeAssertion(
                        "text_to_speech_fixture",
                        False,
                        f"dependency_status={tts_result.status}; dependency_error={dependency_code}",
                    ),),
                    may_incur_cost=tts_result.may_incur_cost,
                    error_code="speech_to_text_fixture_dependency_failed",
                    http_status=tts_result.http_status,
                    retryable=tts_result.retryable,
                    request_bytes=tts_result.request_bytes,
                    output_bytes=0,
                    revisions=revisions,
                ).public_dict()
                _model_capability_probe_results[str(public["probe_id"])] = public
                _record_verified_model_protocol(public)
                return {
                    "result": public,
                    "dependency": {
                        "operation": "text_to_speech",
                        "status": tts_result.status,
                        "error_code": dependency_code,
                    },
                }
            audio_input = synthesized.content
        result, _ = await CapabilityProbeService().probe(
            resolved,
            agent_id=agent_id,
            protocol=protocol,  # type: ignore[arg-type]
            audio_input=audio_input,
            revisions=revisions,
        )
        public = result.public_dict()
        _model_capability_probe_results[str(public["probe_id"])] = public
        _record_verified_model_protocol(public)
        return {"result": public}
    except HTTPException:
        raise
    except ModelOperationRoutingError as exc:
        # A matrix probe must still produce a terminal machine result when the
        # Agent declaration blocks an exploratory capability before any paid
        # upstream request. This is configuration evidence, not real Provider
        # evidence, and therefore cannot satisfy the P2 real-provider Gate.
        policy = policy_snapshot.policy if policy_snapshot is not None else None
        selection = ({
            "primary_model": getattr(policy, "primary_model", None),
            "image_understanding_model": getattr(policy, "image_understanding_model", None),
            "image_generation_model": getattr(policy, "image_generation_model", None) or getattr(policy, "image_model", None),
            "text_to_speech_model": getattr(policy, "text_to_speech_model", None),
            "speech_to_text_model": getattr(policy, "speech_to_text_model", None),
        }).get(req.role)
        ref = getattr(selection, "ref", None)
        if ref is None:
            raise HTTPException(status_code=409, detail={"code": exc.code, "message": str(exc)[:500]}) from exc
        revisions = {
            "provider_config": f"sha256:{model_config_revision()}",
            "agent_policy": policy_snapshot.revision if policy_snapshot is not None else "unknown",
            "model_catalog": str(_runtime_model_catalog_payload(config).get("revision") or "unknown") if config is not None else "unknown",
            "route_rules": "opendrsai.model-operation-routes/1",
            "probe_definition": "opendrsai.model-capability-probes/1",
        }
        result = CapabilityProbeResult(
            probe_id=f"probe-{uuid.uuid4()}", agent_id=req.agent_id,
            provider_id=ref.provider_id, model_id=ref.model_id, upstream_model_id=ref.model_id,
            operation=req.operation, protocol=req.protocol if req.protocol != "auto" else "gemini_generate_content",
            status="unsupported" if exc.code in {"operation_unsupported", "model_role_operation_mismatch"} else "error",
            started_at=datetime.now(timezone.utc).isoformat(), duration_ms=0, assertions=(),
            may_incur_cost=False, error_code=exc.code, revisions=revisions,
        ).public_dict()
        result["evidence_kind"] = "configuration"
        _model_capability_probe_results[str(result["probe_id"])] = result
        return {"result": result}
    except ModelProviderConfigError as exc:
        code = str(getattr(exc, "code", "configuration_invalid"))
        raise HTTPException(status_code=409, detail={"code": code, "message": str(exc)[:500]}) from exc


@api.get("/v1/config/model-providers/{name}/capability-probes/{probe_id}", operation_id="getModelProviderCapabilityProbe")
async def get_model_provider_capability_probe(name: str, probe_id: str):
    result = _model_capability_probe_results.get(probe_id)
    if result is None or result.get("provider_id") != name:
        raise HTTPException(status_code=404, detail={"code": "probe_not_found", "message": "Capability probe was not found."})
    return {"result": result}


@api.post("/v1/config/model-providers/test", operation_id="testModelProviderDraft")
async def test_model_provider_draft(req: ModelProviderDraftTestRequest):
    """Test an unsaved Provider draft without writing TOML or credentials."""
    try:
        existing_provider = None
        if req.api_key is None and req.api_key_env is None:
            config = await asyncio.to_thread(load_model_provider_config)
            existing_provider = config.providers.get(req.name)
        return await probe_provider_draft(
            ProviderDraft(
                name=req.name,
                base_url=req.base_url,
                model=req.model,
                wire_api=req.wire_api,  # type: ignore[arg-type]
                requires_api_key=req.requires_api_key,
                api_key=req.api_key if req.api_key is not None else (existing_provider.api_key if existing_provider else None),
                api_key_env=req.api_key_env if req.api_key_env is not None else (existing_provider.api_key_env if existing_provider else None),
                api_key_credential=existing_provider.api_key_credential if existing_provider else None,
            ),
            mode=req.mode,  # type: ignore[arg-type]
            environ=os.environ,
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def router() -> APIRouter:
    return api
