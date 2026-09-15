"""Artifact delivery: the one Runtime-hosted capability this surface keeps.

Features 2.3 (workspace file view) and 4.1 (file preview) only show what the
Agent produced, so the Runtime has to know which Workspace files are results
rather than scratch.  Two paths produce that knowledge:

1. The Agent calls :func:`deliver_artifact` explicitly.
2. The Agent writes under ``<workspace>/artifacts/`` and the backend registers
   what appeared during the Run (see ``_agent_backend``).

Both funnel into :class:`RuntimeArtifactStore`, which re-resolves the path
against the registered Workspace and records digest, size and Run relation.

Deliberately dropped from the legacy implementation: OWOP resource
registration (``ResourceService`` + ``GatewayResourceHost`` + audit sink). The
OAEP ``artifact`` Item is projected from ``artifact_id`` alone, so the desktop
surfaces are unaffected; the cost is that these Artifacts carry no OWOP
resource identity for cross-Runtime authorization, which this surface does not
have.
"""

from __future__ import annotations

import asyncio
from contextvars import ContextVar
from typing import Any, Mapping

from drsai.backend.runtime.agent import RuntimeExecutionError, RuntimeRunContext

from . import _state

# Bound for the duration of one Run so an Agent tool with no Runtime arguments
# can still resolve the Workspace it is running inside.
run_context: ContextVar[RuntimeRunContext | None] = ContextVar(
    "opendrsai_v2_run_context", default=None,
)


def required_run_context() -> RuntimeRunContext:
    context = run_context.get()
    if context is None:
        raise RuntimeExecutionError(
            "runtime_context_unavailable",
            "Artifact delivery requires an active OpenDrSai Runtime Run.",
        )
    return context


def publish_runtime_artifact(context: RuntimeRunContext, arguments: dict[str, Any]) -> dict[str, Any]:
    item = _state.artifact_store().publish(context, arguments)
    _state.runtime_engine().append_event(context.run_id, "artifact.created", item)
    return item


def deliver_runtime_artifact(context: RuntimeRunContext, arguments: dict[str, Any]) -> dict[str, Any]:
    item = _state.artifact_store().deliver(context, arguments)
    if item.get("idempotent_replay") is not True:
        _state.runtime_engine().append_event(context.run_id, "artifact.created", item)
    return item


async def deliver_artifact(
    source_path: str,
    destination_name: str | None = None,
    display_name: str | None = None,
    mime_type: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Deliver a Workspace file as a durable user-visible Artifact.

    Use this for documents, spreadsheets, presentations, images, archives,
    reports, and every other file requested as a user deliverable.  The source
    must already exist inside the current Workspace.  The Host selects the
    Workspace and storage namespace; never pass an internal Agent path.
    """
    context = required_run_context()
    arguments: dict[str, Any] = {"source_path": source_path}
    if destination_name:
        arguments["destination_name"] = destination_name
    if display_name:
        arguments["display_name"] = display_name
    if mime_type:
        arguments["mime_type"] = mime_type
    if idempotency_key:
        arguments["idempotency_key"] = idempotency_key
    item = await asyncio.to_thread(_state.artifact_store().deliver, context, arguments)
    if item.get("idempotent_replay") is not True:
        _state.runtime_engine().append_event(context.run_id, "artifact.created", item)
    return item


def artifact_signature(path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return int(stat.st_size), int(stat.st_mtime_ns)


def artifact_snapshot(workspace_path) -> dict[str, tuple[int, int]]:
    """Signatures of everything already under ``artifacts/`` before a Run starts.

    A desktop Workspace is shared across sessions, so ``artifacts/`` normally
    holds output from earlier tasks.  Without this baseline, finishing a Run
    would republish every stale PNG and PPTX as if this Run had produced it.
    """
    from pathlib import Path

    root = Path(workspace_path)
    artifacts_root = root / "artifacts"
    if not artifacts_root.is_dir():
        return {}
    snapshot: dict[str, tuple[int, int]] = {}
    for path in artifacts_root.rglob("*"):
        if not path.is_file():
            continue
        signature = artifact_signature(path)
        if signature is not None:
            snapshot[path.relative_to(root).as_posix()] = signature
    return snapshot


def register_new_artifacts(
    context: RuntimeRunContext,
    baseline: Mapping[str, tuple[int, int]],
    started_at: float,
    emit,
) -> None:
    """Publish files this Run wrote under ``artifacts/`` and emit their Items."""
    store = _state.artifact_store()
    existing = {
        str(item.get("relative_path") or "")
        for item in store.list_for_run(context.workspace_id, context.run_id)
    }
    artifacts_root = context.workspace_path / "artifacts"
    if not artifacts_root.is_dir():
        return
    candidates = sorted(
        path
        for path in artifacts_root.rglob("*")
        if path.is_file()
        and baseline.get(path.relative_to(context.workspace_path).as_posix())
        != artifact_signature(path)
    )
    if len(candidates) > 32:
        raise RuntimeExecutionError(
            "artifact_output_limit_exceeded",
            "The Run produced too many output artifacts to register safely.",
        )
    for path in candidates:
        relative = path.relative_to(context.workspace_path).as_posix()
        if relative in existing:
            continue
        try:
            modified_at = path.stat().st_mtime
        except OSError:
            continue
        if modified_at < (started_at - 1.0):
            continue
        descriptor = store.publish(context, {"path": relative})
        emit(context, "artifact.created", descriptor)
        existing.add(relative)
