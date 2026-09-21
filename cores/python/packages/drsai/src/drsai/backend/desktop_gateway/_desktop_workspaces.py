"""Read the Workspace the Desktop treats as its managed default.

The Electron main process owns ``$DRSAI_HOME/desktop/workspaces.json``
(``apps/desktop/shared/main/workspaces.ts``).  The gateway shares
``$DRSAI_HOME`` with it -- the paired instance token is read from the same root
-- so a channel does not need a new route to learn which space the user sees as
the default one: the entry carrying ``metadata.managedDefault`` *is* that space,
and the Desktop re-asserts the flag on every launch.

Only the fields a channel needs are returned.  Every failure mode (no store
yet, a half-written file, a store from a future version) degrades to ``None``
so the caller falls back to its own Workspace resolution instead of failing to
start.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: Guards against reading a runaway file into memory; the real store holds at
#: most ``MAX_WORKSPACES`` entries and stays in the kilobyte range.
_MAX_STORE_BYTES = 4 * 1024 * 1024

_MANAGED_DEFAULT_KEY = "managedDefault"


@dataclass(frozen=True)
class DesktopDefaultWorkspace:
    """The parts of a Desktop Workspace entry the Runtime can act on."""

    path: str
    display_name: str | None = None
    desktop_workspace_id: str | None = None


def store_path(state_root: Path) -> Path:
    """The Desktop Workspace store inside an OpenDrSai state root."""
    return Path(state_root) / "desktop" / "workspaces.json"


def managed_default_workspace(state_root: Path) -> DesktopDefaultWorkspace | None:
    """Return the Desktop's managed default Workspace, or ``None`` if unknown."""
    entries = _read_entries(store_path(state_root))
    if entries is None:
        return None
    for entry in entries:
        workspace = _managed_default(entry)
        if workspace is not None:
            return workspace
    return None


def _read_entries(path: Path) -> list[Any] | None:
    """Parse the store, or ``None`` when it is absent or not trustworthy."""
    try:
        if path.stat().st_size > _MAX_STORE_BYTES:
            return None
        # The Desktop writes UTF-8 (it has emitted a BOM in the past), so the
        # decode accepts one rather than rejecting the whole store.
        value = json.loads(path.read_bytes().decode("utf-8-sig"))
    except (OSError, UnicodeError, ValueError):
        return None
    entries = value.get("workspaces") if isinstance(value, dict) else value
    return entries if isinstance(entries, list) else None


def _managed_default(entry: Any) -> DesktopDefaultWorkspace | None:
    if not isinstance(entry, dict):
        return None
    metadata = entry.get("metadata")
    if not isinstance(metadata, dict) or metadata.get(_MANAGED_DEFAULT_KEY) is not True:
        return None
    path = entry.get("path")
    if not isinstance(path, str) or not path.strip():
        return None
    return DesktopDefaultWorkspace(
        path=path,
        display_name=_optional_text(entry.get("name")),
        desktop_workspace_id=_optional_text(entry.get("id")),
    )


def _optional_text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
