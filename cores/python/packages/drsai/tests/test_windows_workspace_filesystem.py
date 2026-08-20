from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    SandboxError,
    WindowsWorkspaceFilesystem,
    normalize_workspace_relative_path,
)


@pytest.mark.parametrize(
    "value,code",
    [
        ("../secret", "filesystem_traversal_denied"),
        ("folder/../secret", "filesystem_traversal_denied"),
        ("C:/secret", "filesystem_namespace_denied"),
        ("\\\\server\\share\\secret", "filesystem_namespace_denied"),
        ("\\\\?\\C:\\secret", "filesystem_namespace_denied"),
        ("file.txt:stream", "filesystem_ads_denied"),
        ("folder//file", "filesystem_path_ambiguous"),
        ("NUL.txt", "filesystem_device_name_denied"),
        ("folder. /file", "filesystem_name_ambiguous"),
    ],
)
def test_windows_namespace_and_traversal_forms_are_rejected(value: str, code: str) -> None:
    with pytest.raises(SandboxError) as rejected:
        normalize_workspace_relative_path(value)
    assert rejected.value.code == code


def test_normalization_accepts_only_unambiguous_relative_components() -> None:
    assert normalize_workspace_relative_path("src\\package/file.py") == ("src", "package", "file.py")


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_handle_broker_reads_and_atomically_writes_inside_workspace(tmp_path: Path) -> None:
    nested = tmp_path / "nested"
    nested.mkdir()
    (nested / "input.bin").write_bytes(b"input")
    broker = WindowsWorkspaceFilesystem(tmp_path)

    assert broker.read_bytes("nested/input.bin") == b"input"
    broker.atomic_write("nested/output.bin", b"first")
    broker.atomic_write("nested/output.bin", b"second")

    assert (nested / "output.bin").read_bytes() == b"second"
    assert not list(nested.glob("*.opendrsai-*.tmp"))


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_read_limit_is_fail_closed(tmp_path: Path) -> None:
    (tmp_path / "large.bin").write_bytes(b"12345")
    broker = WindowsWorkspaceFilesystem(tmp_path)
    with pytest.raises(SandboxError) as rejected:
        broker.read_bytes("large.bin", max_bytes=4)
    assert rejected.value.code == "filesystem_read_limit_exceeded"


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_symlink_or_junction_components_and_targets_are_denied(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "sentinel.txt").write_text("secret", encoding="utf-8")
    link = workspace / "escape"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        created = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(outside)],
            capture_output=True,
            check=False,
        )
        if created.returncode:
            pytest.skip("neither symlink nor junction creation is available")
    broker = WindowsWorkspaceFilesystem(workspace)
    with pytest.raises(SandboxError) as rejected:
        broker.read_bytes("escape/sentinel.txt")
    assert rejected.value.code == "filesystem_reparse_point_denied"


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_hardlink_to_external_sentinel_is_denied_for_read_and_write(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "sentinel.txt"
    outside.write_bytes(b"do-not-change")
    alias = workspace / "alias.txt"
    os.link(outside, alias)
    broker = WindowsWorkspaceFilesystem(workspace)

    for operation in (lambda: broker.read_bytes("alias.txt"), lambda: broker.atomic_write("alias.txt", b"changed")):
        with pytest.raises(SandboxError) as rejected:
            operation()
        assert rejected.value.code == "filesystem_hardlink_denied"
    assert outside.read_bytes() == b"do-not-change"


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_reparse_point_cannot_be_used_as_projection_root(tmp_path: Path) -> None:
    actual = tmp_path / "actual"
    actual.mkdir()
    root = tmp_path / "root-link"
    created = subprocess.run(
        ["cmd.exe", "/d", "/c", "mklink", "/J", str(root), str(actual)],
        capture_output=True,
        check=False,
    )
    if created.returncode:
        pytest.skip("junction creation is unavailable")
    with pytest.raises(SandboxError) as rejected:
        WindowsWorkspaceFilesystem(root)
    assert rejected.value.code == "filesystem_reparse_point_denied"


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_handle_based_rename_moves_exact_source_without_replacement(tmp_path: Path) -> None:
    (tmp_path / "source").mkdir()
    (tmp_path / "destination").mkdir()
    source = tmp_path / "source" / "file.txt"
    source.write_bytes(b"content")
    broker = WindowsWorkspaceFilesystem(tmp_path)
    broker.atomic_rename("source/file.txt", "destination/renamed.txt")
    assert not source.exists()
    assert (tmp_path / "destination" / "renamed.txt").read_bytes() == b"content"

    (tmp_path / "source" / "second.txt").write_bytes(b"second")
    with pytest.raises(SandboxError) as exists:
        broker.atomic_rename("source/second.txt", "destination/renamed.txt")
    assert exists.value.code == "filesystem_destination_exists"
    assert (tmp_path / "source" / "second.txt").read_bytes() == b"second"


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_compare_and_swap_replaces_only_approved_source_version(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = workspace / "edit.txt"
    source = b"approved-source"
    target.write_bytes(source)
    broker = WindowsWorkspaceFilesystem(workspace)
    expected = "sha256:" + hashlib.sha256(source).hexdigest()

    broker.compare_and_swap("edit.txt", expected, b"approved-result")
    assert target.read_bytes() == b"approved-result"

    target.write_bytes(b"concurrent-change")
    with pytest.raises(SandboxError) as conflict:
        broker.compare_and_swap("edit.txt", expected, b"must-not-overwrite")
    assert conflict.value.code == "filesystem_edit_conflict"
    assert target.read_bytes() == b"concurrent-change"


@pytest.mark.skipif(os.name != "nt", reason="real Win32 handle test")
def test_delete_is_recoverable_tombstone_move_and_rejects_hardlinks(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    target = workspace / "delete-me.txt"
    target.write_bytes(b"recoverable")
    broker = WindowsWorkspaceFilesystem(workspace)
    tombstone = broker.move_to_tombstone("delete-me.txt", "a" * 32)
    assert not target.exists()
    assert tombstone == ".opendrsai-trash/" + "a" * 32 + ".deleted"
    assert (workspace / Path(tombstone)).read_bytes() == b"recoverable"

    outside = tmp_path / "outside-delete.txt"
    outside.write_bytes(b"protected")
    alias = workspace / "hardlink.txt"
    os.link(outside, alias)
    with pytest.raises(SandboxError) as hardlink:
        broker.move_to_tombstone("hardlink.txt", "b" * 32)
    assert hardlink.value.code == "filesystem_hardlink_denied"
    assert outside.read_bytes() == b"protected"
