"""Agent runtime-policy routes (tools / skills / knowledge) + realtime voice probe.

This module reproduces the **runtime policy** side of the legacy config surface
that ``gateway_legacy.py`` (V1) served.  The Electron renderer calls these
endpoints to read, edit, and preview an Agent's tool / skill / knowledge
policy, to reload skills at runtime, and to probe the Realtime voice Provider.

All routes are adapted from ``gateway_legacy.py`` (V1) to the V2
``APIRouter`` pattern:

* ``@app.get/post/put/delete`` -> ``@api.get/post/put/delete``
* ``_get_user_id()`` / ``_effective_user_id()`` -> ``effective_user_id()``
* ``manager.evict_user(_get_user_id())`` -> ``_state.agent_manager().evict_user(effective_user_id())``
* Blocking registry calls wrapped in ``asyncio.to_thread()``

Key imports come from ``drsai.config`` (the shared agent-policy registry).
``_require_local_opendrsai_agent`` and ``_activate_model_config_commit`` are
reused from sibling V2 modules ``.config`` and ``.config_providers``.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from drsai.config import (
    AgentKnowledgePolicy,
    AgentModelPolicyConflict,
    AgentRuntimePolicySnapshot,
    AgentSkillPolicy,
    AgentToolPolicy,
    ConfigError as ModelProviderConfigError,
    KnowledgeResource,
    ToolResource,
    canonical_agent_name,
    commit_agent_runtime_policy,
    current_agent_name,
    knowledge_resource_payload,
    knowledge_registry_revision,
    knowledge_status,
    list_agent_names,
    list_knowledge_resources,
    list_perceptor_resources,
    list_tool_resources,
    load_agent_descriptor,
    load_agent_model_policy,
    load_agent_runtime_policy,
    load_user_config as load_model_provider_config,
    resolve_model_ref,
    resolve_perceptor_config,
    resolve_tool_set,
    update_current_agent,
)
from drsai.config.model_operation_adapters import ModelProtocolError
from drsai.config.model_operation_routing import ModelOperationRoutingError
from drsai.config.realtime_audio_adapter import OpenAIRealtimeAudioAdapter
from drsai.platform_auth import get_platform_auth

from .. import _state
from .._auth import effective_user_id
from .config import _require_local_opendrsai_agent
from .config_providers import _activate_model_config_commit

api = APIRouter(tags=["config"])


# =============================================================================
# Pydantic request models  (mirrors gateway_legacy.py L11729-L11762)
# =============================================================================

class CurrentAgentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_-]{0,63}$")


class AgentToolPolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["inherit", "explicit", "all_enabled"] = "inherit"
    enabled: list[str] = Field(default_factory=list)
    disabled: list[str] = Field(default_factory=list)
    require_approval: list[str] = Field(default_factory=list)
    expected_revision: str | None = None


class AgentSkillPolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["inherit", "explicit", "all_enabled"] = "inherit"
    enabled: list[str] = Field(default_factory=list)
    disabled: list[str] = Field(default_factory=list)
    allow_thread_override: bool = True
    expected_revision: str | None = None


class AgentKnowledgePolicyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["inherit", "explicit", "all_enabled"] = "inherit"
    sources: list[str] = Field(default_factory=list)
    retrieval_policy: Literal["auto", "always", "never"] = "auto"
    top_k: int = Field(default=6, ge=1, le=50)
    score_threshold: float = Field(default=0.35, ge=0, le=1)
    require_citations: bool = True
    expected_revision: str | None = None


# =============================================================================
# User-config / skills-dir helpers  (adapted from gateway_legacy.py)
# =============================================================================

def _get_config_dir(user_id: str | None = None) -> Path:
    """Resolve the user config directory."""
    from drsai.backend.run_drsai_agent_factory import WORKDIR

    uid = effective_user_id(user_id)
    return Path(WORKDIR) / uid / "configs"


def _get_skills_dir(user_id: str | None = None) -> Path:
    """Resolve the skills directory for a user."""
    from drsai.backend.run_drsai_agent_factory import WORKDIR

    uid = effective_user_id(user_id)
    # Aligned with create_agent's storage_dir: WORKDIR / user_id / "configs" / "skills"
    return Path(WORKDIR) / uid / "configs" / "skills"


def _get_available_skills_dirs() -> list[Path]:
    """Return only the product's single built-in ``skills/skills`` catalog."""
    from drsai.modules.components.skills import resolve_builtin_skills_dir

    root = resolve_builtin_skills_dir(search_from=(Path(__file__), Path.cwd()))
    return [root] if root is not None else []


def _parse_skill_frontmatter(content: str) -> tuple[str, str, str]:
    """Parse SKILL.md frontmatter for name, description, and category."""
    name, description, category = "", "", ""

    if not content.startswith("---"):
        heading = re.search(r"^#\s+(.+)", content, re.MULTILINE)
        if heading:
            name = heading.group(1).strip()
        para = re.search(r"^(?!#)(?!---).+", content, re.MULTILINE)
        if para:
            description = para.group(0).strip()[:120]
        return name, description, category

    end_idx = content.find("---", 3)
    if end_idx == -1:
        return name, description, category

    frontmatter = content[3:end_idx]
    name_match = re.search(r"^\s*name:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if name_match:
        name = name_match.group(1).strip()
    desc_match = re.search(r"^\s*description:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if desc_match:
        description = desc_match.group(1).strip()
    cat_match = re.search(r"^\s*category:\s*[\"']?([^\"'\n]+)[\"']?\s*$", frontmatter, re.MULTILINE)
    if cat_match:
        category = cat_match.group(1).strip()

    return name, description, category


async def list_skills(user_id: str | None = None) -> dict[str, Any]:
    """List installed skills for the given user.

    This is a **helper**, not a route — it is called from
    ``preview_agent_skills`` to enumerate the installed Skill catalog.
    Adapted from gateway_legacy.py L9801.
    """
    skills_dir = _get_skills_dir(user_id)
    skills: list[dict] = []

    if skills_dir.exists():
        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            try:
                content = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
                name, description, category = _parse_skill_frontmatter(content)
                skills.append({
                    "name": name or skill_dir.name,
                    "category": category or "",
                    "description": description or "",
                    "path": str(skill_dir),
                })
            except Exception:
                skills.append({
                    "name": skill_dir.name,
                    "category": "",
                    "description": "",
                    "path": str(skill_dir),
                })

    return {"object": "list", "data": sorted(skills, key=lambda s: (s["category"], s["name"]))}


# =============================================================================
# Remote HepAI tool discovery  (adapted from gateway_legacy.py L745-L815)
# =============================================================================

_remote_hepai_cache: tuple[float, list[Any], list[dict[str, Any]]] = (0.0, [], [])


def _remote_hepai_model_row(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return dict(item)
    if hasattr(item, "model_dump"):
        return dict(item.model_dump())
    if hasattr(item, "dict"):
        return dict(item.dict())
    return {key: value for key, value in vars(item).items() if not key.startswith("_")}


async def _load_remote_hepai_tools(force: bool = False) -> tuple[list[Any], list[dict[str, Any]]]:
    """Discover enabled HepAI worker tools, cached for 60 seconds."""
    global _remote_hepai_cache
    cached_at, tools, rows = _remote_hepai_cache
    if not force and time.time() - cached_at < 60:
        return list(tools), [dict(row) for row in rows]

    from hepai import HepAI
    from hepai.tools.get_woker_functions import get_worker_sync_functions
    from drsai.backend.integrations.hepai import discover_enabled_worker_tools

    api_key = os.environ.get("HEPAI_API_KEY")
    base_url = os.environ.get("HEPAI_BASE_URL")
    client = HepAI(api_key=api_key)
    models = await asyncio.wait_for(asyncio.to_thread(client.models.list), timeout=5)
    model_rows = [_remote_hepai_model_row(item) for item in getattr(models, "data", [])]

    def load(worker_id: str):
        return get_worker_sync_functions(name=worker_id, api_key=api_key, base_url=base_url)

    tools, rows = await discover_enabled_worker_tools(
        model_rows, load,
        Path.home() / ".local" / "share" / "opendrsai" / "remote" / "hepai-workers.json",
        timeout=5,
    )
    _remote_hepai_cache = (time.time(), list(tools), [dict(row) for row in rows])
    return tools, rows


# =============================================================================
# Web-search / Tavily helpers  (adapted from gateway_legacy.py L10241-L10340)
# =============================================================================

def _managed_tavily_config() -> dict[str, object]:
    return {
        "adapter": "hai_managed_tavily",
        "model": "hepai/tavily-web-search-v1",
        "timeout_seconds": 20,
        "max_document_chars": 20_000,
    }


def _active_tavily_config_for_dir(config_dir: Path) -> dict[str, object] | None:
    for resource in list_perceptor_resources(config_dir):
        if (
            resource.enabled
            and resource.kind == "public_web"
            and resource.adapter == "tavily"
            and "web.search" in resource.capabilities
        ):
            try:
                config = resolve_perceptor_config(resource, config_dir)
            except ModelProviderConfigError:
                return None
            return {
                "api_key": config.get("api_key", ""),
                "base_url": config.get("base_url", "https://api.tavily.com"),
                "project_id": config.get("project_id", ""),
                "search_depth": config.get("search_depth", "basic"),
                "extract_depth": config.get("extract_depth", "basic"),
                "timeout_seconds": config.get("timeout_seconds", 15),
                "max_document_chars": config.get("max_document_chars", 20000),
            }
    return None


def _active_web_search_config(user_id: str | None = None) -> dict[str, object] | None:
    """Resolve the active web-search provider configuration."""
    from drsai.backend.runtime.web_search.provider_policy import (
        read_provider_mode,
        resolve_web_search_provider,
    )

    config_dir = _get_config_dir(user_id)
    byok = _active_tavily_config_for_dir(config_dir)
    selection = resolve_web_search_provider(
        read_provider_mode(config_dir),
        platform_authenticated=get_platform_auth() is not None,
        byok_available=byok is not None,
    )
    if selection.provider == "hai_managed_tavily":
        return _managed_tavily_config()
    if selection.provider == "tavily":
        return byok
    return None


def _web_search_status(user_id: str | None = None) -> dict[str, object]:
    user_id = user_id if isinstance(user_id, str) else None
    active = _active_web_search_config(user_id)
    if active is not None:
        return {
            "status": "available",
            "provider": active.get("adapter", "tavily"),
            "error": None,
            "capabilities": ["web.search", "web.extract", "network.public_https"],
        }
    return {
        "status": "configuration_required",
        "provider": "tavily",
        "error": "perceptor_required",
        "capabilities": ["web.search", "web.extract", "network.public_https"],
    }


def _builtin_web_search_resource() -> ToolResource:
    runtime = _web_search_status()
    return ToolResource(
        tool_id="builtin.web-search",
        type="builtin",
        config={},
        name="Web search",
        enabled=runtime["status"] == "available",
        source="builtin",
    )


# =============================================================================
# Tool-status helpers  (adapted from gateway_legacy.py L11883-L11930)
# =============================================================================

def _tool_agent_references(tool_id: str) -> list[dict[str, str]]:
    """List agents whose runtime policy references *tool_id*."""
    references: list[dict[str, str]] = []
    for agent_name in list_agent_names():
        policy = load_agent_runtime_policy(agent_name)
        if (
            tool_id in policy.tools.enabled
            or tool_id in policy.tools.disabled
            or tool_id in policy.tools.require_approval
            or (policy.tools.mode in {"inherit", "all_enabled"} and tool_id not in policy.tools.disabled)
        ):
            references.append({
                "kind": "agent_tool_reference",
                "agent_name": agent_name,
                "tool_id": tool_id,
            })
    return references


def _tool_status(resource: ToolResource) -> dict[str, object]:
    """Return runtime status for a ToolResource."""
    status = "available" if resource.enabled else "disabled"
    error: str | None = None
    capabilities: list[str] = ["tool.call"]
    if resource.type == "mcp-std":
        capabilities.append("mcp.stdio")
        command = str(resource.config.get("command") or "").strip()
        if not command:
            status, error = "degraded", "MCP stdio command is missing"
        elif shutil.which(command) is None and not Path(command).is_file():
            status, error = "runtime_unavailable", f"Command '{command}' was not found"
    elif resource.type in {"mcp-sse", "mcp-http"}:
        capabilities.append("mcp.remote")
        raw_url = str(resource.config.get("url") or "").strip()
        try:
            parsed = urlparse(raw_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
                raise ValueError
        except ValueError:
            status, error = "degraded", "MCP URL must be an HTTP(S) URL without embedded credentials"
    elif resource.type in {"local", "builtin", "function"}:
        capabilities.append("local")
    else:
        status, error = "unsupported_platform", f"Tool type '{resource.type}' is unsupported"
    return {
        "tool_id": resource.tool_id,
        "status": status,
        "error": error,
        "capabilities": capabilities,
    }


# =============================================================================
# Runtime-policy payload helpers  (adapted from gateway_legacy.py L11763+)
# =============================================================================

def _agent_runtime_policy_payload(snapshot: AgentRuntimePolicySnapshot) -> dict[str, object]:
    """Build the secret-free dict representation of an Agent runtime policy."""
    return {
        "agent_id": snapshot.agent_id,
        "tools": {
            "mode": snapshot.tools.mode,
            "enabled": list(snapshot.tools.enabled),
            "disabled": list(snapshot.tools.disabled),
            "require_approval": list(snapshot.tools.require_approval),
        },
        "skills": {
            "mode": snapshot.skills.mode,
            "enabled": list(snapshot.skills.enabled),
            "disabled": list(snapshot.skills.disabled),
            "allow_thread_override": snapshot.skills.allow_thread_override,
        },
        "knowledge": {
            "mode": snapshot.knowledge.mode,
            "sources": list(snapshot.knowledge.sources),
            "retrieval_policy": snapshot.knowledge.retrieval_policy,
            "top_k": snapshot.knowledge.top_k,
            "score_threshold": snapshot.knowledge.score_threshold,
            "require_citations": snapshot.knowledge.require_citations,
        },
        "revision": snapshot.revision,
    }


async def get_agent_runtime_policy(agent_id: str) -> dict[str, object]:
    """Load the runtime policy snapshot and return its payload dict.

    This is the shared read helper behind GET tools / skills / knowledge.
    In V1 it was an inline pattern; here it is an explicit async helper.
    """
    _require_local_opendrsai_agent(agent_id)
    snapshot = await asyncio.to_thread(load_agent_runtime_policy, agent_id)
    return _agent_runtime_policy_payload(snapshot)


async def _commit_agent_runtime_section(
    agent_id: str,
    *,
    tools: AgentToolPolicy | None = None,
    skills: AgentSkillPolicy | None = None,
    knowledge: AgentKnowledgePolicy | None = None,
    expected_revision: str | None,
) -> AgentRuntimePolicySnapshot:
    """Commit one section of the runtime policy with optimistic concurrency."""
    _require_local_opendrsai_agent(agent_id)
    current = await asyncio.to_thread(load_agent_runtime_policy, agent_id)
    candidate = AgentRuntimePolicySnapshot(
        agent_id=agent_id,
        tools=tools or current.tools,
        skills=skills or current.skills,
        knowledge=knowledge or current.knowledge,
        revision=current.revision,
    )
    try:
        committed = await asyncio.to_thread(
            commit_agent_runtime_policy, candidate, expected_revision=expected_revision,
        )
    except AgentModelPolicyConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "agent_config_conflict", "message": str(exc)},
        ) from exc
    await _state.agent_manager().evict_user(effective_user_id())
    return committed


# =============================================================================
# Routes: current agent
# =============================================================================

@api.put("/v1/config/agents/current", operation_id="putCurrentAgentConfig")
async def put_current_agent_config(req: CurrentAgentUpdateRequest):
    """Switch the active OpenDrSai Agent."""
    name = canonical_agent_name(req.agent_name)
    _require_local_opendrsai_agent(name)
    await asyncio.to_thread(
        update_current_agent,
        agent_name=name,
        agent_config_file=f"configs/agents/agent_{name}.toml",
    )
    await _activate_model_config_commit()
    await _state.agent_manager().evict_user(effective_user_id())
    desc = await asyncio.to_thread(load_agent_descriptor, name)
    return {**desc, "current": True}


# =============================================================================
# Routes: agent tools
# =============================================================================

@api.get("/v1/config/agents/{agent_id}/tools", operation_id="getAgentToolPolicy")
async def get_agent_tool_policy(agent_id: str):
    """Return the Agent's tool policy and current revision."""
    payload = await get_agent_runtime_policy(agent_id)
    return {"agent_id": agent_id, **payload["tools"], "revision": payload["revision"]}


@api.put("/v1/config/agents/{agent_id}/tools", operation_id="putAgentToolPolicy")
async def put_agent_tool_policy(agent_id: str, req: AgentToolPolicyUpdateRequest):
    """Persist the Agent's tool policy with optimistic concurrency control."""
    snapshot = await _commit_agent_runtime_section(
        agent_id,
        tools=AgentToolPolicy(
            req.mode, tuple(req.enabled), tuple(req.disabled), tuple(req.require_approval),
        ),
        expected_revision=req.expected_revision,
    )
    return {
        "agent_id": agent_id,
        **_agent_runtime_policy_payload(snapshot)["tools"],
        "revision": snapshot.revision,
    }


@api.post("/v1/config/agents/{agent_id}/tools/preview", operation_id="previewAgentTools")
async def preview_agent_tools(agent_id: str):
    """Preview the resolved tool set for the Agent's current policy."""
    _require_local_opendrsai_agent(agent_id)
    policy = await asyncio.to_thread(load_agent_runtime_policy, agent_id)
    resources = await asyncio.to_thread(list_tool_resources, _get_config_dir())
    remote_tools: list[Any] = []
    try:
        remote_tools, _ = await _load_remote_hepai_tools()
    except Exception:
        pass
    dynamic = tuple(
        ToolResource(
            str(getattr(tool, "name", "")).strip(),
            "function",
            {},
            str(getattr(tool, "name", "")).strip(),
            True,
            "hepai",
        )
        for tool in remote_tools
        if str(getattr(tool, "name", "")).strip()
    )
    all_resources = (*resources, *dynamic, _builtin_web_search_resource())
    web_search_available = _web_search_status().get("status") == "available"
    enabled_tool_ids = policy.tools.enabled
    if web_search_available and "builtin.web-search" not in policy.tools.disabled:
        enabled_tool_ids = tuple(dict.fromkeys((*enabled_tool_ids, "builtin.web-search")))
    resolved = resolve_tool_set(
        mode=policy.tools.mode,
        enabled=enabled_tool_ids,
        disabled=policy.tools.disabled,
        resources=all_resources,
        builtin_ids=("builtin.image_generation", "builtin.image_edit"),
    )
    rows = []
    by_id = {resource.tool_id: resource for resource in all_resources}
    catalog_ids = list(
        dict.fromkeys(
            (
                *resolved.enabled_ids,
                *by_id.keys(),
                "builtin.image_generation",
                "builtin.image_edit",
                "builtin.web-search",
            )
        )
    )
    for tool_id in catalog_ids:
        selected = tool_id in resolved.enabled_ids
        if tool_id == "builtin.web-search":
            rows.append({
                "tool_id": tool_id,
                **_web_search_status(),
                "capabilities": ["tool.call", "builtin", "network.public_https"],
                "selected": selected,
            })
        elif tool_id in by_id:
            rows.append({**_tool_status(by_id[tool_id]), "selected": selected})
        elif tool_id.startswith("builtin."):
            rows.append({
                "tool_id": tool_id,
                "status": "available",
                "error": None,
                "capabilities": ["tool.call", "builtin"],
                "selected": selected,
            })
        else:
            rows.append({
                "tool_id": tool_id,
                "status": "runtime_unavailable",
                "error": f"Tool resource '{tool_id}' is not currently available",
                "capabilities": [],
                "selected": selected,
            })
    return {
        "agent_id": agent_id,
        "mode": policy.tools.mode,
        "tools": rows,
        "missing_ids": list(resolved.missing_ids),
        "disabled_ids": list(resolved.disabled_ids),
        "agent_revision": policy.revision,
        "registry_revision": resolved.registry_revision,
    }


# =============================================================================
# Routes: agent skills
# =============================================================================

@api.get("/v1/config/agents/{agent_id}/skills", operation_id="getAgentSkillPolicy")
async def get_agent_skill_policy(agent_id: str):
    """Return the Agent's skill policy and current revision."""
    payload = await get_agent_runtime_policy(agent_id)
    return {"agent_id": agent_id, **payload["skills"], "revision": payload["revision"]}


@api.put("/v1/config/agents/{agent_id}/skills", operation_id="putAgentSkillPolicy")
async def put_agent_skill_policy(agent_id: str, req: AgentSkillPolicyUpdateRequest):
    """Persist the Agent's skill policy with optimistic concurrency control."""
    snapshot = await _commit_agent_runtime_section(
        agent_id,
        skills=AgentSkillPolicy(
            req.mode, tuple(req.enabled), tuple(req.disabled), req.allow_thread_override,
        ),
        expected_revision=req.expected_revision,
    )
    return {
        "agent_id": agent_id,
        **_agent_runtime_policy_payload(snapshot)["skills"],
        "revision": snapshot.revision,
    }


@api.post("/v1/config/agents/{agent_id}/skills/preview", operation_id="previewAgentSkills")
async def preview_agent_skills(agent_id: str):
    """Preview the resolved skill set for the Agent's current policy."""
    _require_local_opendrsai_agent(agent_id)
    policy = await asyncio.to_thread(load_agent_runtime_policy, agent_id)
    installed_rows = (await list_skills(None))["data"]
    installed = {str(row.get("name") or "") for row in installed_rows}
    disabled = set(policy.skills.disabled)
    selected = (
        [name for name in policy.skills.enabled if name in installed and name not in disabled]
        if policy.skills.mode == "explicit"
        else [name for name in sorted(installed) if name not in disabled]
    )
    missing = [name for name in policy.skills.enabled if name not in installed]
    return {
        "agent_id": agent_id,
        "mode": policy.skills.mode,
        "skills": [
            {**row, "enabled_for_agent": str(row.get("name") or "") in selected}
            for row in installed_rows
        ],
        "enabled_ids": selected,
        "missing_ids": missing,
        "allow_thread_override": policy.skills.allow_thread_override,
        "revision": policy.revision,
    }


@api.post("/v1/config/agents/{agent_id}/skills/reload", operation_id="reloadAgentSkills")
async def reload_agent_skills(agent_id: str):
    """Evict the Agent cache so skills are re-loaded on the next turn."""
    _require_local_opendrsai_agent(agent_id)
    await _state.agent_manager().evict_user(effective_user_id())
    return {"ok": True, "reloaded": True, "agent_id": agent_id}


# =============================================================================
# Routes: agent knowledge
# =============================================================================

@api.get("/v1/config/agents/{agent_id}/knowledge", operation_id="getAgentKnowledgePolicy")
async def get_agent_knowledge_policy(agent_id: str):
    """Return the Agent's knowledge policy and current revision."""
    payload = await get_agent_runtime_policy(agent_id)
    return {"agent_id": agent_id, **payload["knowledge"], "revision": payload["revision"]}


@api.put("/v1/config/agents/{agent_id}/knowledge", operation_id="putAgentKnowledgePolicy")
async def put_agent_knowledge_policy(agent_id: str, req: AgentKnowledgePolicyUpdateRequest):
    """Persist the Agent's knowledge policy with optimistic concurrency control."""
    snapshot = await _commit_agent_runtime_section(
        agent_id,
        knowledge=AgentKnowledgePolicy(
            req.mode,
            tuple(req.sources),
            req.retrieval_policy,
            req.top_k,
            req.score_threshold,
            req.require_citations,
        ),
        expected_revision=req.expected_revision,
    )
    return {
        "agent_id": agent_id,
        **_agent_runtime_policy_payload(snapshot)["knowledge"],
        "revision": snapshot.revision,
    }


@api.post("/v1/config/agents/{agent_id}/knowledge/preview", operation_id="previewAgentKnowledge")
async def preview_agent_knowledge(agent_id: str):
    """Preview the resolved knowledge sources for the Agent's current policy."""
    _require_local_opendrsai_agent(agent_id)
    policy = await asyncio.to_thread(load_agent_runtime_policy, agent_id)
    config_dir = _get_config_dir()
    resources = await asyncio.to_thread(list_knowledge_resources, config_dir)
    by_id = {resource.knowledge_id: resource for resource in resources}
    if policy.knowledge.mode == "explicit":
        selected = [source for source in policy.knowledge.sources if source in by_id and by_id[source].enabled]
        missing = [source for source in policy.knowledge.sources if source not in by_id]
    else:
        selected = [resource.knowledge_id for resource in resources if resource.enabled]
        missing = []
    rows = [
        {
            **knowledge_resource_payload(resource),
            **knowledge_status(config_dir, resource),
            "selected": resource.knowledge_id in selected,
        }
        for resource in resources
    ]
    return {
        "agent_id": agent_id,
        "mode": policy.knowledge.mode,
        "sources": selected,
        "missing_ids": missing,
        "knowledge_bases": rows,
        "retrieval_policy": policy.knowledge.retrieval_policy,
        "top_k": policy.knowledge.top_k,
        "score_threshold": policy.knowledge.score_threshold,
        "require_citations": policy.knowledge.require_citations,
        "revision": policy.revision,
    }


# =============================================================================
# Route: realtime voice probe
# =============================================================================

_realtime_voice_probe_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_realtime_voice_probe_locks: dict[str, asyncio.Lock] = {}


@api.post("/v1/config/agents/{agent_id}/realtime-voice-probe", operation_id="probeAgentRealtimeVoice")
async def probe_agent_realtime_voice(agent_id: str, force: bool = False):
    """Run a bounded Provider handshake for the Agent's exact Realtime model.

    Adapted from gateway_legacy.py L8564-L8660.  The probe opens a Realtime
    session, sends ``session.update`` with a minimal configuration, and waits
    for a ``session.created`` / ``session.updated`` confirmation.  Results are
    cached for 5 minutes (15 seconds on failure).
    """
    _require_local_opendrsai_agent(agent_id)
    now = time.monotonic()
    cached = _realtime_voice_probe_cache.get(agent_id)
    if not force and cached is not None and cached[0] > now:
        return cached[1]
    probe_lock = _realtime_voice_probe_locks.setdefault(agent_id, asyncio.Lock())
    await probe_lock.acquire()
    now = time.monotonic()
    cached = _realtime_voice_probe_cache.get(agent_id)
    if not force and cached is not None and cached[0] > now:
        probe_lock.release()
        return cached[1]
    adapter: OpenAIRealtimeAudioAdapter | None = None
    checked_at = datetime.now(timezone.utc).isoformat()
    try:
        config = await asyncio.to_thread(load_model_provider_config)
        snapshot = await asyncio.to_thread(load_agent_model_policy, agent_id)
        selection = snapshot.policy.realtime_voice_model
        if selection is None or selection.mode != "explicit" or selection.ref is None:
            raise ModelOperationRoutingError(
                "agent_model_unbound",
                "Agent realtime voice model must be explicit",
            )
        resolved = await asyncio.to_thread(
            resolve_model_ref, config,
            provider_id=selection.ref.provider_id,
            model_id=selection.ref.model_id,
            require_credentials=True,
        )
        adapter = OpenAIRealtimeAudioAdapter()
        await asyncio.wait_for(adapter.connect(resolved), timeout=12)
        await adapter.send_json({
            "type": "session.update",
            "session": {
                "type": "realtime",
                "model": selection.ref.model_id,
                "output_modalities": ["audio"],
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "transcription": {"model": "gpt-4o-mini-transcribe"},
                        "turn_detection": {
                            "type": "server_vad",
                            "create_response": True,
                            "interrupt_response": True,
                        },
                    },
                    "output": {"format": {"type": "audio/pcm", "rate": 24000}},
                },
                "tool_choice": "auto",
                "tools": [{
                    "type": "function",
                    "name": "realtime_probe_noop",
                    "description": "A no-op tool used only to verify Realtime session configuration.",
                    "parameters": {"type": "object", "additionalProperties": False, "properties": {}},
                }],
            },
        })
        events = adapter.events().__aiter__()
        accepted = None
        for _ in range(4):
            event = await asyncio.wait_for(events.__anext__(), timeout=8)
            if event.get("type") == "error":
                raise ModelProtocolError(
                    "capability_unverified",
                    "Realtime Provider rejected the capability probe",
                )
            if event.get("type") in {"session.created", "session.updated"}:
                accepted = event
                if event.get("type") == "session.updated":
                    break
        if accepted is None:
            raise ModelProtocolError(
                "invalid_provider_response",
                "Realtime Provider did not confirm the session",
            )
        result = {
            "status": "verified",
            "provider_id": selection.ref.provider_id,
            "model_id": selection.ref.model_id,
            "checked_at": checked_at,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
            "evidence_kind": "real_provider",
            "capabilities": {
                "input_transcription": True,
                "output_transcription": True,
                "server_vad": True,
                "response_cancel": True,
                "conversation_truncation": True,
                "tool_calling": True,
            },
        }
        _realtime_voice_probe_cache[agent_id] = (now + 300, result)
        return result
    except (ModelOperationRoutingError, ModelProviderConfigError, ModelProtocolError, asyncio.TimeoutError) as exc:
        code = str(getattr(exc, "code", "provider_timeout" if isinstance(exc, asyncio.TimeoutError) else "capability_unverified"))
        result = {
            "status": "unavailable",
            "provider_id": None,
            "model_id": None,
            "checked_at": checked_at,
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=15)).isoformat(),
            "evidence_kind": "real_provider",
            "error_code": code,
            "capabilities": {},
        }
        _realtime_voice_probe_cache[agent_id] = (now + 15, result)
        return result
    finally:
        if adapter is not None:
            await adapter.close()
        probe_lock.release()


# =============================================================================
# Router export
# =============================================================================

def router() -> APIRouter:
    return api
