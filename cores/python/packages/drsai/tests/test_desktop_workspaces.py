"""The Desktop Workspace store is read defensively.

``$DRSAI_HOME/desktop/workspaces.json`` is written by the Electron main process
and read by the gateway to find the Workspace the user sees as their default
space.  It is not a database: it can be absent (first launch), half-written (the
Desktop writes it with a plain ``writeFile``), or left over from a newer Desktop
build.  The reader must therefore never raise -- a channel that cannot tell which
Workspace is the default falls back to its own resolution, which is far better
than a channel that refuses to start.
"""

from __future__ import annotations

import json
from pathlib import Path

from drsai.backend.desktop_gateway import _desktop_workspaces


def _store(state_root: Path, entries: object, *, bom: bool = False, shape: str = "list") -> Path:
    path = _desktop_workspaces.store_path(state_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    value = {"workspaces": entries} if shape == "dict" else entries
    encoded = json.dumps(value, ensure_ascii=False).encode("utf-8")
    path.write_bytes(b"\xef\xbb\xbf" + encoded if bom else encoded)
    return path


def _entry(path: str, **overrides: object) -> dict[str, object]:
    entry: dict[str, object] = {
        "id": "workspace-default",
        "name": "默认",
        "path": path,
        "metadata": {"managedDefault": True, "defaultWorkspaceVersion": 2},
    }
    entry.update(overrides)
    return entry


def test_reads_the_managed_default_workspace(tmp_path) -> None:
    _store(
        tmp_path,
        [
            _entry("C:/projects/other", metadata=None),
            _entry(str(tmp_path), name="默认"),
        ],
    )

    workspace = _desktop_workspaces.managed_default_workspace(tmp_path)

    assert workspace is not None
    assert workspace.path == str(tmp_path)
    assert workspace.display_name == "默认"
    assert workspace.desktop_workspace_id == "workspace-default"


def test_reads_a_store_wrapped_in_an_object_and_written_with_a_bom(tmp_path) -> None:
    # The Desktop has emitted both shapes; a BOM used to break a naive reader.
    _store(tmp_path, [_entry(str(tmp_path))], bom=True, shape="dict")

    workspace = _desktop_workspaces.managed_default_workspace(tmp_path)

    assert workspace is not None
    assert workspace.path == str(tmp_path)


def test_ignores_entries_that_are_not_the_managed_default(tmp_path) -> None:
    _store(
        tmp_path,
        [
            "not-an-entry",
            {"path": str(tmp_path)},
            _entry(str(tmp_path), metadata={"managedDefault": "true"}),
            _entry(str(tmp_path), metadata={"managedDefault": False}),
            _entry(""),
            _entry(1234),
        ],
    )

    assert _desktop_workspaces.managed_default_workspace(tmp_path) is None


def test_reports_no_managed_default_without_a_usable_store(tmp_path) -> None:
    assert _desktop_workspaces.managed_default_workspace(tmp_path) is None

    path = _desktop_workspaces.store_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'{"workspaces": [')
    assert _desktop_workspaces.managed_default_workspace(tmp_path) is None

    path.write_bytes(b"not json at all")
    assert _desktop_workspaces.managed_default_workspace(tmp_path) is None

    _store(tmp_path, [])
    assert _desktop_workspaces.managed_default_workspace(tmp_path) is None


def test_refuses_to_read_a_runaway_store(tmp_path, monkeypatch) -> None:
    _store(tmp_path, [_entry(str(tmp_path))])
    monkeypatch.setattr(_desktop_workspaces, "_MAX_STORE_BYTES", 8)

    assert _desktop_workspaces.managed_default_workspace(tmp_path) is None


def test_display_name_and_id_are_optional(tmp_path) -> None:
    _store(tmp_path, [{"path": str(tmp_path), "metadata": {"managedDefault": True}}])

    workspace = _desktop_workspaces.managed_default_workspace(tmp_path)

    assert workspace is not None
    assert workspace.display_name is None
    assert workspace.desktop_workspace_id is None
