"""Model routes -- catalog picker + OpenAI-compatible ``/v1/models``.

Two routes live here:

* ``GET /v1/config/model-catalog`` — the internal picker used by the Desktop
  renderer.  It reads ``run_drsai_agent_factory`` YAML/JSON config and returns
  ``{default_alias, models: [{alias, display_name, client_type, model,
  token_limit, max_tokens, vision}]}``.

* ``GET /v1/models`` — the **OpenAI-compatible** model list that
  ``bootstrapDesktop()`` → ``discoverGatewayModels()`` calls during startup.
  When the request is OIDC-authenticated, it proxies to the HepAI platform
  ``/models`` endpoint and normalises the response to ``{object: "list", data:
  [...]}``.  In offline mode it falls back to the locally configured catalog.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException

from drsai.backend.run_drsai_agent_factory import (
    build_model_catalog,
    get_llm_config_file_path,
    load_llm_mode_config,
)
from drsai.platform_auth import get_platform_auth

logger = logging.getLogger("drsai.desktop_gateway.models")

api = APIRouter(tags=["models"])


@api.get("/v1/config/model-catalog", operation_id="getModelCatalog")
async def model_catalog():
    """The models configured in ``run_drsai_agent_factory``, for the picker."""
    # Reading the catalog touches the filesystem; keep it off the event loop so
    # a slow disk cannot stall an in-flight chat stream.
    config = await asyncio.to_thread(load_llm_mode_config, get_llm_config_file_path())
    return build_model_catalog(config)


@api.get("/v1/models", operation_id="listModels")
async def list_models():
    """List available models in OpenAI-compatible format.

    Called by ``discoverGatewayModels()`` in the Electron main process during
    ``bootstrapDesktop()``.  When the request carries an OIDC bearer token
    (installed by ``_auth`` middleware), it proxies to the HepAI platform
    ``/models`` endpoint.  In offline mode, it returns the locally configured
    model catalog instead.
    """
    auth = get_platform_auth()
    if auth is not None:
        return await _list_platform_models(auth)
    return await _list_local_models()


async def _list_platform_models(auth) -> dict:
    """Proxy ``/v1/models`` to the HepAI platform and normalise the response."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(
                f"{auth.model_base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {auth.access_token}"},
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail={
                "code": "model_catalog_timeout",
                "message": "The HepAI model catalog timed out.",
                "retryable": True,
            },
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "model_catalog_unreachable",
                "message": "The HepAI model catalog is temporarily unreachable.",
                "retryable": True,
            },
        ) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "model_catalog_invalid_response",
                "message": "The HepAI model catalog returned invalid JSON.",
                "retryable": True,
            },
        ) from exc

    if response.status_code >= 400:
        raw_error = payload.get("error") if isinstance(payload, dict) else None
        raw_detail = payload.get("detail") if isinstance(payload, dict) else None
        error = raw_error if isinstance(raw_error, dict) else raw_detail if isinstance(raw_detail, dict) else {}
        upstream_code = str(error.get("code") or "")
        default_code = (
            "model_unauthorized" if response.status_code == 401
            else "model_forbidden" if response.status_code == 403
            else "quota_exceeded" if response.status_code == 429
            else "upstream_unavailable"
        )
        message = str(error.get("message") or "The HepAI model catalog request failed.")
        raise HTTPException(
            status_code=response.status_code if response.status_code in {401, 403, 429} else 502,
            detail={
                "code": upstream_code or default_code,
                "message": message[:500],
                "retryable": response.status_code not in {401, 403},
            },
        )

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise HTTPException(
            status_code=502,
            detail={
                "code": "model_catalog_invalid_response",
                "message": "The HepAI model catalog response has no model list.",
                "retryable": True,
            },
        )
    models = []
    for item in data[:500]:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id")
        if not isinstance(model_id, str) or not model_id.strip():
            continue
        normalized = dict(item)
        normalized["id"] = model_id.strip()
        models.append(normalized)
    return {"object": "list", "data": models}


async def _list_local_models() -> dict:
    """Return locally configured models as an OpenAI-compatible list."""
    config = await asyncio.to_thread(load_llm_mode_config, get_llm_config_file_path())
    catalog = build_model_catalog(config)
    models = []
    for entry in catalog.get("models", []):
        alias = entry.get("alias") or ""
        if not alias:
            continue
        models.append({
            "id": alias,
            "name": entry.get("display_name") or alias,
        })
    return {"object": "list", "data": models}


def router() -> APIRouter:
    return api
