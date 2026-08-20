"""Shared TUI host adapter for OAEP/OWOP Workspace resources.

The terminal host does not persist absolute paths in conversation events.  It
binds every request to the authenticated TUI user and the Workspace selected by
the current session, then delegates registration and resolution to the same
local OWOP implementation used by the Desktop gateway.
"""

from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping

from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal


def tui_workspace_id(user_id: str, root: Path) -> str:
    """Return a stable opaque Workspace id without exposing the local path."""
    canonical = Path(root).resolve(strict=True)
    identity = f"opendrsai:tui:{user_id}:{os.path.normcase(str(canonical))}"
    return f"workspace-{uuid.uuid5(uuid.NAMESPACE_URL, identity)}"


def _journal_path() -> Path:
    state_root = Path(os.environ.get("DRSAI_HOME", str(Path.home() / ".drsai"))).expanduser()
    return state_root / "runtime" / "workspace-events.sqlite3"


@contextmanager
def tui_workspace_operations(user_id: str, root: Path) -> Iterator[LocalWorkspaceOperations]:
    canonical = Path(root).resolve(strict=True)
    operations = LocalWorkspaceOperations(
        tui_workspace_id(user_id, canonical),
        canonical,
        WorkspaceWatchJournal(_journal_path()),
    )
    try:
        yield operations
    finally:
        operations.close()


def register_tui_resource(
    user_id: str,
    root: Path,
    relative_path: str,
    *,
    expected_digest: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {"path": relative_path}
    if expected_digest:
        params["expected_digest"] = expected_digest
    with tui_workspace_operations(user_id, root) as operations:
        return operations.register_file(params)["resource"]


def resolve_tui_resource(
    user_id: str,
    root: Path,
    file_id: str,
    *,
    expected_digest: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {"file_id": file_id}
    if expected_digest:
        params["expected_digest"] = expected_digest
    with tui_workspace_operations(user_id, root) as operations:
        return operations.resolve_file(params)["resource"]


def read_tui_resource(
    user_id: str,
    root: Path,
    relative_path: str,
    *,
    offset: int,
    length: int,
) -> dict[str, Any]:
    with tui_workspace_operations(user_id, root) as operations:
        return operations.read_file({"path": relative_path, "offset": offset, "length": length})


def oaep_resource_ref(
    resource: Mapping[str, Any],
    *,
    workspace_id: str,
    relation: str,
    presentation: str,
) -> dict[str, Any]:
    reference: dict[str, Any] = {
        "protocol": "owop/1",
        "workspace_id": workspace_id,
        "resource_type": "file",
        "resource_id": str(resource["file_id"]),
        "label": str(resource.get("name") or resource["file_id"]),
        "relation": relation,
        "presentation": presentation,
    }
    if resource.get("digest"):
        reference["digest"] = str(resource["digest"])
    return reference
