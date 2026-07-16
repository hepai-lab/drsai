from __future__ import annotations

from pathlib import Path
import importlib.util
import os
import subprocess
import sys

import pytest

_MODULE_PATH = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "runtime_registry.py"
_SPEC = importlib.util.spec_from_file_location("runtime_registry", _MODULE_PATH)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)
RuntimeRegistry = _MODULE.RuntimeRegistry


def test_runtime_id_is_stable_and_instance_id_changes(tmp_path: Path) -> None:
    database = tmp_path / "state" / "runtime.sqlite3"
    first = RuntimeRegistry(database)
    second = RuntimeRegistry(database)
    assert first.identity.runtime_id == second.identity.runtime_id
    assert first.identity.instance_id != second.identity.instance_id
    replacement = RuntimeRegistry(tmp_path / "replacement" / "runtime.sqlite3")
    assert replacement.identity.runtime_id != first.identity.runtime_id


def test_workspace_path_normalization(tmp_path: Path) -> None:
    home = tmp_path / "home"
    workspace = home / "projects" / "alpha"
    workspace.mkdir(parents=True)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    assert registry.open_workspace("~/projects/alpha", home=home).path == str(workspace.resolve())
    assert registry.open_workspace("alpha", cwd=workspace.parent).path == str(workspace.resolve())
    with pytest.raises(FileNotFoundError):
        registry.open_workspace("missing", cwd=workspace.parent)
    file_path = workspace / "file.txt"
    file_path.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        registry.open_workspace(str(file_path))


def test_runtime_generates_stable_workspace_id_and_persists_registry(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    first_runtime = RuntimeRegistry(database)
    opened = first_runtime.open_workspace(str(workspace))
    assert opened.workspace_id.startswith("workspace-")
    assert first_runtime.get_workspace(opened.workspace_id) == opened

    restarted_runtime = RuntimeRegistry(database)
    restored = restarted_runtime.list_workspaces()
    assert [item.workspace_id for item in restored] == [opened.workspace_id]
    reopened = restarted_runtime.open_workspace(str(workspace))
    assert reopened.workspace_id == opened.workspace_id


def test_ten_workspaces_are_isolated_and_close_preserves_history(tmp_path: Path) -> None:
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    opened = []
    for index in range(10):
        workspace = tmp_path / f"workspace-{index}"
        workspace.mkdir()
        opened.append(registry.open_workspace(str(workspace)))
    assert len({item.workspace_id for item in opened}) == 10
    assert len({item.path for item in registry.list_workspaces()}) == 10

    closed = registry.close_workspace(opened[0].workspace_id)
    assert closed and not closed.open
    assert registry.get_workspace(opened[0].workspace_id) is None
    historical = registry.get_workspace(opened[0].workspace_id, include_closed=True)
    assert historical and historical.workspace_id == opened[0].workspace_id
    assert len(registry.list_workspaces()) == 9
    assert len(registry.list_workspaces(include_closed=True)) == 10


@pytest.mark.skipif(os.name != "nt", reason="Windows path contract")
def test_windows_drive_unc_junction_missing_and_permission_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    drive_record = registry.open_workspace(str(workspace))
    assert Path(drive_record.path).drive == workspace.drive

    junction = tmp_path / "workspace-junction"
    created = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(workspace)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert created.returncode == 0, created.stderr or created.stdout
    junction_record = registry.open_workspace(str(junction))
    assert junction_record.workspace_id == drive_record.workspace_id
    junction.rmdir()

    with pytest.raises(FileNotFoundError):
        registry.open_workspace(str(tmp_path / "missing"))

    original_resolve = Path.resolve
    seen = []

    def controlled_resolve(path: Path, *args, **kwargs):
        raw = str(path)
        seen.append(raw)
        if raw.startswith("\\\\server.invalid\\"):
            raise FileNotFoundError(raw)
        if raw.endswith("permission-denied"):
            raise PermissionError(raw)
        return original_resolve(path, *args, **kwargs)

    monkeypatch.setattr(Path, "resolve", controlled_resolve)
    with pytest.raises(FileNotFoundError):
        registry.open_workspace(r"\\server.invalid\share\workspace")
    with pytest.raises(PermissionError):
        registry.open_workspace(str(tmp_path / "permission-denied"))
    assert any(item.startswith("\\\\server.invalid\\") for item in seen)
