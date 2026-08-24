"""HepAI worker routes — configured worker tools and per-worker state.

Extracted from the legacy monolith (``gateway_legacy.py`` L8470-8497) in
Phase 1. Uses the shared ``_load_remote_hepai_tools`` / ``_remote_audit`` /
``_remote_hepai_cache`` / ``manager`` / ``_get_user_id`` accessors (lazily
imported from the ``gateway`` package, like ``gateway_wechat``) until Phase 2
moves them into ``gateway._state``. No test patches these route symbols.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel


class HepaiWorkerStateRequest(BaseModel):
    enabled: bool


api = APIRouter(tags=["hepai-workers"])


@api.get("/v1/hepai/workers")
async def list_hepai_workers():
    """Return configured HepAI worker tools without making workspace access depend on HepAI."""
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    try:
        tools, rows = await gateway._load_remote_hepai_tools(force=True)
        gateway._remote_audit(
            "hepai.workers.discovered",
            worker_count=len(rows),
            callable_count=sum(len(row.get("callables", [])) for row in rows),
        )
        return {
            "object": "list",
            "data": rows,
            "available": True,
            "registered_tool_count": len(tools),
        }
    except Exception as exc:
        gateway._remote_audit("hepai.workers.degraded", error=type(exc).__name__)
        return {
            "object": "list",
            "data": [],
            "available": False,
            "error": type(exc).__name__,
        }


@api.put("/v1/hepai/workers/{worker_id}/state")
async def set_hepai_worker_state(worker_id: str, request: HepaiWorkerStateRequest):
    from drsai.backend import gateway  # lazy: shared accessors still in legacy ns

    if not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,200}", worker_id):
        raise HTTPException(status_code=400, detail="Invalid Worker id")
    path = Path.home() / ".local" / "share" / "opendrsai" / "remote" / "hepai-workers.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        config = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        config = {}
    config[worker_id] = request.enabled
    path.write_text(json.dumps(config, indent=2), "utf-8")
    # Invalidate the in-process HepAI tool cache (module-global in legacy ns).
    gateway._remote_hepai_cache = (0.0, [], [])
    gateway._remote_audit("hepai.worker.state", worker_id=worker_id, enabled=request.enabled)
    await gateway.manager.evict_user(gateway._get_user_id())
    return {"id": worker_id, "enabled": request.enabled}


def router() -> APIRouter:
    """Return the configured ``APIRouter`` for HepAI worker routes."""
    return api
