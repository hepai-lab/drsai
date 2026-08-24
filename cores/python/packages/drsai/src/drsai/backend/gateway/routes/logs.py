"""Logs routes — tail ``FS_DIR/logs/*.log`` files.

Extracted from the legacy monolith (``gateway_legacy.py`` L13292-13344) in
Phase 1. No shared-state dependencies: only stdlib, FastAPI primitives, and
``FS_DIR``. No test patches these symbols, so the standard
``APIRouter`` + ``router()`` factory pattern applies cleanly.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from drsai.configs.constant import FS_DIR

_LOG_DIR = Path(FS_DIR) / "logs"
_ALLOWED_LOG_NAMES = ("agent.log", "errors.log", "gateway.log")

api = APIRouter(tags=["logs"])


@api.get("/v1/logs")
async def get_logs(
    file: str = Query(default="agent.log", description="Log file name."),
    lines: int = Query(default=200, ge=1, le=5000),
):
    """Return the last ``lines`` lines of FS_DIR/logs/<file>.

    The ``file`` argument is restricted to a small allowlist to avoid path
    traversal. Missing files return an empty payload instead of 404 so the
    UI can render a "no logs yet" state.
    """
    if file not in _ALLOWED_LOG_NAMES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown log file '{file}'. Allowed: {list(_ALLOWED_LOG_NAMES)}",
        )
    full_path = _LOG_DIR / file
    if not full_path.exists():
        return {"path": str(full_path), "content": "", "exists": False}
    try:
        # Tail without loading the whole file: read last ~64KB then split.
        with full_path.open("rb") as f:
            try:
                f.seek(-64 * 1024, os.SEEK_END)
            except OSError:
                f.seek(0)
            data = f.read().decode("utf-8", errors="replace")
        all_lines = data.splitlines()
        tail = "\n".join(all_lines[-lines:])
        return {"path": str(full_path), "content": tail, "exists": True}
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log: {e}")


@api.get("/v1/logs/list")
async def list_log_files():
    """Return which of the well-known log files exist."""
    if not _LOG_DIR.exists():
        return {"path": str(_LOG_DIR), "files": []}
    files: list[dict[str, Any]] = []
    for name in _ALLOWED_LOG_NAMES:
        p = _LOG_DIR / name
        if p.exists():
            try:
                files.append({"name": name, "size": p.stat().st_size})
            except OSError:
                files.append({"name": name, "size": None})
    return {"path": str(_LOG_DIR), "files": files}


def router() -> APIRouter:
    """Return the configured ``APIRouter`` for logs routes."""
    return api
