"""Workspace-scoped Artifact metadata and chunk RPCs for the TUI."""

from __future__ import annotations

import base64
from pathlib import Path

from drsai.modules.managers.datamodel.db import Thread

from ..adapter.agent_runner import _legacy_artifact_descriptor
from ..server import _err, _get_db_manager, _ok, _resolve_user_id, method


def _workdir(session_id: str) -> Path:
    response = _get_db_manager().get(
        Thread,
        filters={"user_id": _resolve_user_id(), "thread_id": session_id},
        return_json=False,
    )
    if not response.status or not response.data:
        raise ValueError("session not found")
    meta = getattr(response.data[0], "meta", None) or {}
    workdir = meta.get("workdir") if isinstance(meta, dict) else None
    if not workdir:
        raise ValueError("session has no Workspace")
    return Path(workdir).resolve(strict=True)


def _find(session_id: str, artifact_id: str) -> tuple[Path, dict]:
    root = _workdir(session_id)
    artifacts = (root / "artifacts").resolve(strict=True)
    artifacts.relative_to(root)
    checked = 0
    for path in artifacts.rglob("*"):
        if not path.is_file():
            continue
        checked += 1
        if checked > 1000:
            break
        # Legacy lookup hashes candidates to derive a stable ID. Bound the
        # per-candidate work so a single oversized file cannot monopolize TUI RPC.
        if path.stat().st_size > 256 * 1024 * 1024:
            continue
        descriptor = _legacy_artifact_descriptor(root, path, session_id)
        if descriptor["artifact_id"] == artifact_id:
            return path.resolve(strict=True), descriptor
    raise FileNotFoundError("artifact not found")


@method("artifact.metadata")
def artifact_metadata(rid, params: dict) -> dict:
    try:
        _path, descriptor = _find(str(params.get("session_id") or ""), str(params.get("artifact_id") or ""))
        return _ok(rid, descriptor)
    except (OSError, ValueError):
        return _err(rid, 4041, "artifact_unavailable")


@method("artifact.chunk")
def artifact_chunk(rid, params: dict) -> dict:
    try:
        offset = int(params.get("offset", 0))
        length = int(params.get("length", 0))
        if offset < 0 or length < 1 or length > 1024 * 1024:
            return _err(rid, 4004, "artifact_range_invalid")
        path, descriptor = _find(str(params.get("session_id") or ""), str(params.get("artifact_id") or ""))
        with path.open("rb") as handle:
            handle.seek(offset)
            content = handle.read(length)
        return _ok(rid, {
            "artifact_id": descriptor["artifact_id"], "offset": offset,
            "length": len(content), "content_base64": base64.b64encode(content).decode("ascii"),
            "eof": offset + len(content) >= descriptor["size"], "sha256": descriptor["sha256"],
        })
    except (OSError, ValueError):
        return _err(rid, 4041, "artifact_unavailable")
