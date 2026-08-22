from __future__ import annotations

from pathlib import Path
import importlib.util

import pytest

_MODULE_PATH = (
    Path(__file__).parents[1]
    / "src"
    / "drsai"
    / "backend"
    / "remote_ssh"
    / "workspace.py"
)
_SPEC = importlib.util.spec_from_file_location("remote_workspace_policy", _MODULE_PATH)
assert _SPEC and _SPEC.loader
_POLICY = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_POLICY)
canonical_workspace = _POLICY.canonical_workspace
ensure_protocol = _POLICY.ensure_protocol
list_directories = _POLICY.list_directories
workspace_child = _POLICY.workspace_child


def test_workspace_child_rejects_escape(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    inside = root / "inside"
    inside.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    assert workspace_child(root.resolve(), "inside") == inside.resolve()
    with pytest.raises(PermissionError):
        workspace_child(root.resolve(), str(outside))


def test_canonical_workspace_requires_directory(tmp_path: Path) -> None:
    file_path = tmp_path / "file.txt"
    file_path.write_text("x", encoding="utf-8")
    with pytest.raises(ValueError):
        canonical_workspace(str(file_path))


def test_handshake_protocol_rejects_incompatible_version() -> None:
    ensure_protocol(1)
    with pytest.raises(ValueError):
        ensure_protocol(999)


def test_list_directories_excludes_symlink_escape(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "child").mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (root / "escape").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Symlinks are unavailable in this environment")
    assert [item["name"] for item in list_directories(root.resolve())] == ["child"]
