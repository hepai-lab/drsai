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
import hashlib
import re
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
    _reject_companion_preview_delivery(context, dict(arguments))
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

    Companion document thumbnails (``foo-预览.png`` next to ``foo.pdf``) are
    rejected when the matching document already exists — Desktop previews
    PDF/Office natively.
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
    _reject_companion_preview_delivery(context, arguments)
    item = await asyncio.to_thread(_state.artifact_store().deliver, context, arguments)
    if item.get("idempotent_replay") is not True:
        _state.runtime_engine().append_event(context.run_id, "artifact.created", item)
    return item


def _reject_companion_preview_delivery(
    context: RuntimeRunContext,
    arguments: Mapping[str, Any],
) -> None:
    """Block unsolicited document thumbnails; keep real image deliverables."""
    candidates = [
        str(arguments.get("destination_name") or "").strip(),
        str(arguments.get("display_name") or "").strip(),
        str(arguments.get("source_path") or "").strip().replace("\\", "/").rsplit("/", 1)[-1],
    ]
    leaf = next((name for name in candidates if name), "")
    match = _PREVIEW_IMAGE_RE.match(leaf.split("/")[-1])
    if match is None:
        return
    stem = match.group("stem").lower()
    known_names: set[str] = set()
    artifacts_root = context.workspace_path / "artifacts"
    if artifacts_root.is_dir():
        for path in artifacts_root.rglob("*"):
            if path.is_file():
                known_names.add(path.name.lower())
    for item in _state.artifact_store().list_for_run(context.workspace_id, context.run_id):
        name = str(item.get("display_name") or item.get("relative_path") or "")
        if name:
            known_names.add(name.replace("\\", "/").rsplit("/", 1)[-1].lower())
    for suffix in _DOCUMENT_SUFFIXES:
        if f"{stem}{suffix}" in known_names:
            raise RuntimeExecutionError(
                "artifact_companion_preview_rejected",
                "Companion preview images for documents are not delivered. "
                "Desktop previews PDF/Office natively — deliver only the document "
                "unless the user explicitly asked for an image.",
            )


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
    """Publish files this Run wrote under ``artifacts/`` and emit their Items.

    Explicit delivery wins: if a file was already registered for this Run with
    the same content digest (for example ``deliver_artifact`` copied a source
    already under ``artifacts/`` to a display name), skip re-publishing the
    source path so the user sees one logical Artifact card.
    """
    store = _state.artifact_store()
    registered = store.list_for_run(context.workspace_id, context.run_id)
    existing_paths = {
        str(item.get("relative_path") or "")
        for item in registered
    }
    existing_digests = {
        str(item.get("sha256") or "")
        for item in registered
        if item.get("sha256")
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
    candidate_relatives = {
        path.relative_to(context.workspace_path).as_posix()
        for path in candidates
    }
    known_paths = existing_paths | candidate_relatives
    # Prefer documents over companion preview images when both appear this run.
    ordered = sorted(
        candidates,
        key=lambda path: (1 if _PREVIEW_IMAGE_RE.match(path.name) else 0, path.as_posix()),
    )
    for path in ordered:
        relative = path.relative_to(context.workspace_path).as_posix()
        if relative in existing_paths:
            continue
        try:
            modified_at = path.stat().st_mtime
        except OSError:
            continue
        if modified_at < (started_at - 1.0):
            continue
        digest = hashlib.sha256()
        try:
            with path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    digest.update(chunk)
        except OSError:
            continue
        digest_hex = digest.hexdigest()
        if digest_hex in existing_digests:
            # Same bytes already delivered under another path (display name).
            continue
        # Skip thumbnail/companion previews when a document deliverable exists
        # for the same stem (e.g. ``短诗-夜坐.pdf`` + ``短诗-夜坐-预览.png``).
        if _is_companion_preview_path(relative, known_paths):
            continue
        descriptor = store.publish(context, {"path": relative})
        emit(context, "artifact.created", descriptor)
        existing_paths.add(relative)
        known_paths.add(relative)
        existing_digests.add(str(descriptor.get("sha256") or digest_hex))


_DOCUMENT_SUFFIXES = (
    ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".rtf",
    ".odt", ".ods", ".odp",
)
_PREVIEW_IMAGE_RE = re.compile(
    r"(?i)^(?P<stem>.+?)[-_.]?(?:预览|preview|thumb|thumbnail)\.(?:png|jpe?g|gif|webp)$",
)


def _is_companion_preview_path(relative: str, known_paths: set[str]) -> bool:
    leaf = relative.rsplit("/", 1)[-1]
    match = _PREVIEW_IMAGE_RE.match(leaf)
    if match is None:
        return False
    stem = match.group("stem").lower()
    for path in known_paths:
        name = path.rsplit("/", 1)[-1].lower()
        for suffix in _DOCUMENT_SUFFIXES:
            if name == f"{stem}{suffix}":
                return True
    return False