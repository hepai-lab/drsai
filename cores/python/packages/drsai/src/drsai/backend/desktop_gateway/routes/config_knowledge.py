"""Knowledge-base management routes (local-files + RAGFlow).

This module reproduces the **knowledge-base management** side of the legacy
config surface that ``gateway_legacy.py`` (V1) served.  The Electron renderer
calls these endpoints to list, create, update, delete, inspect status of,
test, index, and search-preview configured Knowledge Bases.

All routes are adapted from ``gateway_legacy.py`` (V1) to the V2
``APIRouter`` pattern:

* ``@app.get/post/put/delete`` -> ``@api.get/post/put/delete``
* ``_effective_user_id(user_id)`` -> ``effective_user_id(user_id)``
* ``manager.evict_user(...)`` -> ``await _state.agent_manager().evict_user(...)``
* Blocking registry calls wrapped in ``asyncio.to_thread()``

Helper functions ``_get_config_dir`` is reused from the sibling V2 module
``.config_agents``.  The knowledge-resource registry functions
(``list_knowledge_resources``, ``put_knowledge_resource``, etc.) and
credential helpers (``store_credential``, ``resolve_credential``,
``delete_credential``) come from ``drsai.config``.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path
from typing import Any, Literal, Mapping

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from drsai.config import (
    ConfigError as ModelProviderConfigError,
    KnowledgeResource,
    canonical_knowledge_id,
    delete_credential,
    delete_knowledge_resource,
    get_knowledge_resource,
    index_local_files,
    knowledge_resource_payload,
    knowledge_status,
    list_agent_names,
    list_knowledge_resources,
    load_agent_runtime_policy,
    put_knowledge_resource,
    resolve_credential,
    search_local_knowledge,
    store_credential,
)

from .. import _state
from .._auth import effective_user_id
from .config_agents import _get_config_dir

api = APIRouter(tags=["config"])


# =============================================================================
# Pydantic request models  (mirrors gateway_legacy.py L660-L674)
# =============================================================================

class KnowledgeResourceRequest(BaseModel):
    """Request body for creating / updating a Knowledge Base."""

    model_config = ConfigDict(extra="forbid")
    knowledge_id: str = Field(..., min_length=1, max_length=128, pattern=r"^[a-z][a-z0-9_.-]{0,127}$")
    display_name: str = Field(..., min_length=1, max_length=160)
    type: Literal["local-files", "ragflow"]
    enabled: bool = True
    config: dict[str, object] = Field(default_factory=dict)
    credential: SecretStr | None = Field(default=None, exclude=True)


class KnowledgeSearchRequest(BaseModel):
    """Request body for searching / previewing a Knowledge Base."""

    model_config = ConfigDict(extra="forbid")
    query: str = Field(..., min_length=1, max_length=8000)
    top_k: int = Field(default=6, ge=1, le=50)
    score_threshold: float = Field(default=0.0, ge=0, le=1)


# =============================================================================
# Knowledge-config helpers  (adapted from gateway_legacy.py L10533-L10559)
# =============================================================================

def _knowledge_agent_references(knowledge_id: str) -> list[dict[str, str]]:
    """List agents whose runtime policy references *knowledge_id*."""
    references: list[dict[str, str]] = []
    for agent_name in list_agent_names():
        policy = load_agent_runtime_policy(agent_name)
        if knowledge_id in policy.knowledge.sources or (
            policy.knowledge.mode in {"inherit", "all_enabled"}
            and policy.knowledge.retrieval_policy != "never"
        ):
            references.append({"kind": "agent_knowledge_reference", "agent_name": agent_name, "knowledge_id": knowledge_id})
    return references


def _migrate_legacy_knowledge_config(config_dir: Path) -> None:
    """One-time migration of legacy RAGFlow env vars into the registry."""
    if list_knowledge_resources(config_dir):
        return
    dataset_id = str(os.environ.get("MEMORY_DATASET_ID") or "").strip()
    if not dataset_id:
        return
    token = str(os.environ.get("RAGFLOW_TOKEN") or "").strip()
    credential_ref = store_credential(token) if token else ""
    config: dict[str, object] = {
        "base_url": str(os.environ.get("RAGFLOW_URL") or "https://ragflow.ihep.ac.cn").rstrip("/"),
        "dataset_ids": [dataset_id],
    }
    if credential_ref:
        config["credential_ref"] = credential_ref
    put_knowledge_resource(config_dir, KnowledgeResource("legacy-ragflow", "Legacy RAGFlow", "ragflow", True, config))


def _knowledge_evidence_payload(evidence: Any) -> dict[str, object]:
    """Normalize a retrieval-evidence item into a plain dict."""
    if hasattr(evidence, "__dataclass_fields__"):
        return {name: getattr(evidence, name) for name in evidence.__dataclass_fields__}
    return dict(evidence) if isinstance(evidence, Mapping) else {}


# =============================================================================
# Routes
# =============================================================================

@api.get("/v1/config/knowledge-bases", operation_id="listKnowledgeBases")
async def list_knowledge_bases(user_id: str | None = Query(default=None)):
    """Return all configured Knowledge Bases with status and agent references."""
    config_dir = _get_config_dir(user_id)
    await asyncio.to_thread(_migrate_legacy_knowledge_config, config_dir)
    resources = await asyncio.to_thread(list_knowledge_resources, config_dir)
    return {"object": "list", "data": [
        {**knowledge_resource_payload(resource), **knowledge_status(config_dir, resource), "references": _knowledge_agent_references(resource.knowledge_id)}
        for resource in resources
    ]}


@api.post("/v1/config/knowledge-bases", operation_id="createKnowledgeBase")
async def create_knowledge_base(req: KnowledgeResourceRequest, user_id: str | None = Query(default=None)):
    """Create a new Knowledge Base entry."""
    config_dir = _get_config_dir(user_id)
    try:
        await asyncio.to_thread(get_knowledge_resource, config_dir, req.knowledge_id)
    except ModelProviderConfigError:
        pass
    else:
        raise HTTPException(status_code=409, detail={"code": "knowledge_base_exists", "message": "Knowledge Base already exists"})
    try:
        config = dict(req.config)
        if req.credential is not None:
            if req.type != "ragflow":
                raise ModelProviderConfigError("Only RAGFlow Knowledge Bases accept credentials")
            config["credential_ref"] = store_credential(req.credential.get_secret_value())
        resource = await asyncio.to_thread(
            put_knowledge_resource, config_dir,
            KnowledgeResource(req.knowledge_id, req.display_name, req.type, req.enabled, config),
        )
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**knowledge_resource_payload(resource), **knowledge_status(config_dir, resource)}


@api.get("/v1/config/knowledge-bases/{knowledge_id}", operation_id="getKnowledgeBase")
async def get_knowledge_base(knowledge_id: str, user_id: str | None = Query(default=None)):
    """Return a single Knowledge Base with status and agent references."""
    try:
        resource = await asyncio.to_thread(get_knowledge_resource, _get_config_dir(user_id), knowledge_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {**knowledge_resource_payload(resource), **knowledge_status(_get_config_dir(user_id), resource), "references": _knowledge_agent_references(resource.knowledge_id)}


@api.put("/v1/config/knowledge-bases/{knowledge_id}", operation_id="updateKnowledgeBase")
async def update_knowledge_base(knowledge_id: str, req: KnowledgeResourceRequest, user_id: str | None = Query(default=None)):
    """Replace a Knowledge Base entry, preserving credentials when not supplied."""
    if canonical_knowledge_id(knowledge_id) != canonical_knowledge_id(req.knowledge_id):
        raise HTTPException(status_code=400, detail="Knowledge Base identity cannot be changed")
    try:
        existing = await asyncio.to_thread(get_knowledge_resource, _get_config_dir(user_id), knowledge_id)
        config = dict(req.config)
        if req.credential is not None:
            if req.type != "ragflow":
                raise ModelProviderConfigError("Only RAGFlow Knowledge Bases accept credentials")
            config["credential_ref"] = store_credential(req.credential.get_secret_value())
        elif req.type == "ragflow" and "credential_ref" not in config and existing.type == "ragflow":
            existing_ref = (existing.config or {}).get("credential_ref")
            if existing_ref:
                config["credential_ref"] = existing_ref
        resource = await asyncio.to_thread(
            put_knowledge_resource, _get_config_dir(user_id),
            KnowledgeResource(req.knowledge_id, req.display_name, req.type, req.enabled, config),
        )
        old_reference = str((existing.config or {}).get("credential_ref") or "")
        new_reference = str((resource.config or {}).get("credential_ref") or "")
        if old_reference and old_reference != new_reference:
            delete_credential(old_reference)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _state.agent_manager().evict_user(effective_user_id(user_id))
    return {**knowledge_resource_payload(resource), **knowledge_status(_get_config_dir(user_id), resource)}


@api.delete("/v1/config/knowledge-bases/{knowledge_id}", operation_id="deleteKnowledgeBase")
async def delete_knowledge_base(knowledge_id: str, user_id: str | None = Query(default=None)):
    """Remove a Knowledge Base entry and clean up its stored credential."""
    resolved = canonical_knowledge_id(knowledge_id)
    references = _knowledge_agent_references(resolved)
    if references:
        raise HTTPException(status_code=409, detail={"code": "knowledge_base_in_use", "message": "Knowledge Base is referenced by one or more Agents", "references": references})
    try:
        resource = await asyncio.to_thread(delete_knowledge_resource, _get_config_dir(user_id), resolved)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    reference = str((resource.config or {}).get("credential_ref") or "")
    if reference:
        delete_credential(reference)
    await _state.agent_manager().evict_user(effective_user_id(user_id))
    return {"status": "ok", "removed": knowledge_resource_payload(resource)}


@api.get("/v1/config/knowledge-bases/{knowledge_id}/status", operation_id="getKnowledgeBaseStatus")
async def get_knowledge_base_status(knowledge_id: str, user_id: str | None = Query(default=None)):
    """Return the runtime status of a single Knowledge Base."""
    try:
        resource = await asyncio.to_thread(get_knowledge_resource, _get_config_dir(user_id), knowledge_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    status = knowledge_status(_get_config_dir(user_id), resource)
    if resource.type == "ragflow" and status["status"] == "configured":
        reference = str((resource.config or {}).get("credential_ref") or "")
        status["status"] = "configured" if resolve_credential(reference) else "credential_required"
    return status


@api.post("/v1/config/knowledge-bases/{knowledge_id}/test", operation_id="testKnowledgeBase")
async def test_knowledge_base(knowledge_id: str, user_id: str | None = Query(default=None)):
    """Verify a Knowledge Base connection without returning credentials or document contents."""
    config_dir = _get_config_dir(user_id)
    try:
        resource = await asyncio.to_thread(get_knowledge_resource, config_dir, knowledge_id)
        if resource.type == "local-files":
            status = knowledge_status(config_dir, resource)
            root = Path(str((resource.config or {}).get("root_path") or "")).expanduser()
            if not root.is_dir():
                raise ModelProviderConfigError("Local Knowledge Base root directory is unavailable")
            return {"ok": True, "knowledge_id": knowledge_id, "type": resource.type, "status": status["status"]}
        config = dict(resource.config or {})
        token = resolve_credential(str(config.get("credential_ref") or ""))
        if not token:
            raise ModelProviderConfigError("RAGFlow Knowledge Base credential is unavailable")
        from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
        datasets = await RAGFlowMemoryManager(str(config["base_url"]), token).list_datasets()
        available = {str(row.get("id") or "") for row in datasets if isinstance(row, Mapping)}
        configured = set(config.get("dataset_ids") or [])
        missing = sorted(configured - available)
        if missing:
            raise ModelProviderConfigError("Configured RAGFlow datasets are unavailable: " + ", ".join(missing))
        return {"ok": True, "knowledge_id": knowledge_id, "type": resource.type, "dataset_count": len(configured)}
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.post("/v1/config/knowledge-bases/{knowledge_id}/index", operation_id="indexKnowledgeBase")
async def index_knowledge_base(knowledge_id: str, user_id: str | None = Query(default=None)):
    """Trigger local-file indexing for a local-files Knowledge Base."""
    try:
        resource = await asyncio.to_thread(get_knowledge_resource, _get_config_dir(user_id), knowledge_id)
        if resource.type != "local-files":
            raise ModelProviderConfigError("RAGFlow indexing is managed by the configured RAGFlow service")
        return await asyncio.to_thread(index_local_files, _get_config_dir(user_id), resource)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@api.post("/v1/config/knowledge-bases/{knowledge_id}/search-preview", operation_id="searchPreviewKnowledgeBase")
async def search_knowledge_base(knowledge_id: str, req: KnowledgeSearchRequest, user_id: str | None = Query(default=None)):
    """Preview a search against a Knowledge Base without exposing credentials."""
    try:
        resource = await asyncio.to_thread(get_knowledge_resource, _get_config_dir(user_id), knowledge_id)
    except ModelProviderConfigError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if resource.type == "local-files":
        try:
            evidence = await asyncio.to_thread(search_local_knowledge, _get_config_dir(user_id), resource, req.query, top_k=req.top_k, score_threshold=req.score_threshold)
        except ModelProviderConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"knowledge_id": resource.knowledge_id, "query": req.query, "evidence": [_knowledge_evidence_payload(item) for item in evidence]}
    config = dict(resource.config or {})
    token = resolve_credential(str(config.get("credential_ref") or ""))
    if not token:
        raise HTTPException(status_code=400, detail="RAGFlow Knowledge Base credential is unavailable")
    from drsai.modules.components.memory.ragflow_memory import RAGFlowMemoryManager
    manager_instance = RAGFlowMemoryManager(str(config["base_url"]), token)
    raw = await manager_instance.retrieve_chunks_by_content(
        question=req.query, dataset_ids=list(config.get("dataset_ids") or []),
        page_size=req.top_k, top_k=req.top_k, similarity_threshold=req.score_threshold,
    )
    chunks = raw.get("chunks", []) if isinstance(raw, dict) else []
    evidence = []
    for index, chunk in enumerate(chunks[:req.top_k] if isinstance(chunks, list) else []):
        if not isinstance(chunk, dict):
            continue
        content = str(chunk.get("content_with_weight") or chunk.get("content") or "")
        document_id = str(chunk.get("document_id") or chunk.get("doc_id") or "unknown")
        chunk_id = str(chunk.get("id") or f"{document_id}:{index}")
        evidence.append({
            "knowledge_id": resource.knowledge_id, "document_id": document_id,
            "title": str(chunk.get("document_keyword") or chunk.get("document_name") or document_id),
            "source": str(chunk.get("document_name") or document_id), "chunk_id": chunk_id,
            "score": float(chunk.get("similarity") or chunk.get("score") or 0), "content": content,
            "content_sha256": hashlib.sha256(content.encode()).hexdigest(),
        })
    return {"knowledge_id": resource.knowledge_id, "query": req.query, "evidence": evidence}


def router() -> APIRouter:
    return api
