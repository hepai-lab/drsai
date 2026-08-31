"""Tool management routes (MCP servers + local tool descriptions).

This module reproduces the **tool management** side of the legacy config surface
that ``gateway_legacy.py`` (V1) served.  The Electron renderer calls these
endpoints to list, create, update, delete, test, and inspect capabilities of
configured tools.

All routes are adapted from ``gateway_legacy.py`` (V1) to the V2
``APIRouter`` pattern:

* ``@app.get/post/put/delete`` -> ``@api.get/post/put/delete``
* ``_effective_user_id(user_id)`` -> ``effective_user_id(user_id)``
* ``manager.evict_user(...)`` -> ``await _state.agent_manager().evict_user(...)``
* Blocking registry calls wrapped in ``asyncio.to_thread()``

Helper functions ``_get_config_dir``, ``_web_search_status``,
``_tool_agent_references`` and ``_tool_status`` are reused from the sibling V2
module ``.config_agents``.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from drsai.config import (
    ConfigError as ModelProviderConfigError,
    ToolResource,
    canonical_tool_id,
    delete_tool_resource,
    get_tool_resource,
    legacy_tool_id,
    list_tool_resources,
    merge_tool_secret_placeholders,
    put_tool_resource,
    resolve_tool_config,
    tool_resource_payload,
)

from .. import _state
from .._auth import effective_user_id
from .config_agents import (
    _get_config_dir,
    _tool_agent_references,
    _tool_status,
    _web_search_status,
)

logger = logging.getLogger("drsai.desktop_gateway")

api = APIRouter(tags=["config"])


# =============================================================================
# Pydantic request models  (mirrors gateway_legacy.py L630-L641)
# =============================================================================

class ToolEntry(BaseModel):
    """A single tool entry in TOOLS_CONFIG.json.

    type: ``mcp-std`` | ``mcp-sse`` | other (local). Anything else is treated
    as a free-form local-tool description that the agent surfaces to the LLM
    via tool prompts but does not invoke directly.
    """

    tool_id: str | None = Field(default=None, description="Stable Tool resource ID")
    type: str = Field(..., description="Tool type: mcp-std | mcp-sse | <local>")
    config: dict = Field(default_factory=dict, description="Tool-specific config payload")
    name: str | None = Field(default=None, description="Optional display name (UI only)")
    enabled: bool = Field(default=True, description="UI-only flag; disabled entries are skipped on load")


# =============================================================================
# Tool-config helpers  (adapted from gateway_legacy.py L10225-L10418)
# =============================================================================

def _read_tools_config(user_id: str | None = None) -> list[dict]:
    """Return all configured tool entries as payload dicts."""
    try:
        return [
            tool_resource_payload(item)
            for item in list_tool_resources(_get_config_dir(user_id))
        ]
    except Exception as e:
        logger.warning("Failed to load Tool Registry: %s", e)
        return []


def _write_tools_config(entries: list[dict], user_id: str | None = None) -> None:
    """Replace the full tool registry with *entries*."""
    config_dir = _get_config_dir(user_id)
    wanted: set[str] = set()
    for entry in entries:
        tool_id = canonical_tool_id(str(entry.get("tool_id") or legacy_tool_id(entry)))
        wanted.add(tool_id)
        put_tool_resource(
            config_dir,
            ToolResource(
                tool_id=tool_id,
                type=str(entry.get("type") or "local"),
                config=dict(entry.get("config") or {}),
                name=str(entry["name"]) if entry.get("name") else None,
                enabled=bool(entry.get("enabled", True)),
            ),
        )
    for existing in list_tool_resources(config_dir):
        if existing.tool_id not in wanted:
            delete_tool_resource(config_dir, existing.tool_id)


# =============================================================================
# Routes
# =============================================================================

@api.get("/v1/config/tools", operation_id="listTools")
async def list_tools(user_id: str | None = Query(default=None)):
    """Return all configured tools (MCP servers + local tool descriptions)."""
    entries = await asyncio.to_thread(_read_tools_config, user_id)
    return {"object": "list", "data": entries}


@api.get("/v1/config/tools/{tool_id}/capabilities", operation_id="getToolCapabilities")
async def get_tool_capabilities(tool_id: str, user_id: str | None = Query(default=None)):
    """Return the runtime status and capabilities for a single tool."""
    if tool_id == "builtin.web-search":
        runtime = await asyncio.to_thread(_web_search_status, user_id)
        references = await asyncio.to_thread(_tool_agent_references, tool_id)
        return {"tool_id": tool_id, **runtime, "capabilities": ["tool.call", "builtin", "network.public_https"], "references": references}
    if tool_id in {"builtin.image_generation", "builtin.image_edit"}:
        references = await asyncio.to_thread(_tool_agent_references, tool_id)
        return {"tool_id": tool_id, "status": "available", "capabilities": ["tool.call", "builtin"], "error": None, "references": references}
    try:
        resource = await asyncio.to_thread(get_tool_resource, _get_config_dir(user_id), tool_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    status = await asyncio.to_thread(_tool_status, resource)
    references = await asyncio.to_thread(_tool_agent_references, resource.tool_id)
    return {**status, "references": references}


@api.post("/v1/config/tools/{tool_id}/test", operation_id="testToolConnection")
async def test_tool_connection(tool_id: str, user_id: str | None = Query(default=None)):
    """Test a tool's connection without returning credentials."""
    if tool_id == "builtin.web-search":
        runtime = await asyncio.to_thread(_web_search_status, user_id)
        return {"tool_id": tool_id, **runtime, "capabilities": ["tool.call", "builtin", "network.public_https"], "ok": runtime["status"] == "available", "tested": "runtime-registration"}
    if tool_id in {"builtin.image_generation", "builtin.image_edit"}:
        return {"tool_id": tool_id, "status": "available", "capabilities": ["tool.call", "builtin"], "error": None, "ok": True, "tested": "runtime-registration"}
    try:
        resource = await asyncio.to_thread(get_tool_resource, _get_config_dir(user_id), tool_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    result = await asyncio.to_thread(_tool_status, resource)
    if result["status"] not in {"available", "disabled"}:
        return {**result, "ok": False, "tested": "configuration"}
    if resource.type in {"mcp-sse", "mcp-http"} and resource.enabled:
        try:
            config_dir = _get_config_dir(user_id)
            runtime_config = await asyncio.to_thread(resolve_tool_config, resource.config, config_dir)
            async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
                headers = {"accept": "text/event-stream", **dict(runtime_config.get("headers") or {})}
                response = await client.get(str(runtime_config["url"]), headers=headers)
            ok = response.status_code < 500
            return {**result, "ok": ok, "tested": "connection", "http_status": response.status_code}
        except httpx.HTTPError as exc:
            return {**result, "ok": False, "status": "runtime_unavailable", "tested": "connection", "error": type(exc).__name__}
        except ModelProviderConfigError:
            return {**result, "ok": False, "status": "credential_unavailable", "tested": "configuration"}
    return {**result, "ok": resource.enabled, "tested": "configuration"}


@api.post("/v1/config/tools", operation_id="createTool")
async def create_tool(
    req: ToolEntry,
    user_id: str | None = Query(default=None),
):
    """Append a new tool entry to TOOLS_CONFIG.json."""
    raw = req.model_dump()
    config_dir = _get_config_dir(user_id)
    resource = await asyncio.to_thread(
        put_tool_resource,
        config_dir,
        ToolResource(
            tool_id=canonical_tool_id(req.tool_id or legacy_tool_id(raw)),
            type=req.type,
            config=dict(req.config),
            name=req.name,
            enabled=req.enabled,
        ),
    )
    await _state.agent_manager().evict_user(effective_user_id(user_id))
    return tool_resource_payload(resource)


@api.put("/v1/config/tools/{tool_id}", operation_id="updateTool")
async def update_tool(
    tool_id: str,
    req: ToolEntry,
    user_id: str | None = Query(default=None),
):
    """Replace the tool entry at ``index``."""
    entries = await asyncio.to_thread(_read_tools_config, user_id)
    resolved_id = entries[int(tool_id)]["tool_id"] if tool_id.isdigit() and int(tool_id) < len(entries) else tool_id
    try:
        existing = await asyncio.to_thread(get_tool_resource, _get_config_dir(user_id), resolved_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    merged_config = merge_tool_secret_placeholders(req.config, existing.config)
    config_dir = _get_config_dir(user_id)
    resource = await asyncio.to_thread(
        put_tool_resource,
        config_dir,
        ToolResource(
            tool_id=canonical_tool_id(req.tool_id or resolved_id),
            type=req.type,
            config=merged_config,
            name=req.name,
            enabled=req.enabled,
        ),
    )
    if resource.tool_id != resolved_id:
        await asyncio.to_thread(delete_tool_resource, config_dir, resolved_id)
    await _state.agent_manager().evict_user(effective_user_id(user_id))
    return tool_resource_payload(resource)


@api.delete("/v1/config/tools/{tool_id}", operation_id="deleteTool")
async def delete_tool(
    tool_id: str,
    user_id: str | None = Query(default=None),
):
    """Remove the tool entry at ``index``."""
    entries = await asyncio.to_thread(_read_tools_config, user_id)
    resolved_id = entries[int(tool_id)]["tool_id"] if tool_id.isdigit() and int(tool_id) < len(entries) else tool_id
    references = await asyncio.to_thread(_tool_agent_references, canonical_tool_id(str(resolved_id)))
    if references:
        raise HTTPException(status_code=409, detail={
            "code": "tool_in_use",
            "message": "Tool is referenced by one or more Agents",
            "references": references,
        })
    try:
        removed = await asyncio.to_thread(delete_tool_resource, _get_config_dir(user_id), resolved_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await _state.agent_manager().evict_user(effective_user_id(user_id))
    return {"status": "ok", "removed": tool_resource_payload(removed)}


def router() -> APIRouter:
    return api
