"""Dependency-free Linux acceptance for descriptor-relative Workspace FS safety."""

from __future__ import annotations

import tempfile
from pathlib import Path

from drsai.backend.runtime.security import SecureWorkspaceFS, SecurityError


with tempfile.TemporaryDirectory(prefix="opendrsai-security-") as directory:
    base = Path(directory)
    root, outside = base / "workspace", base / "outside"
    root.mkdir(); outside.mkdir()
    (root / "safe").mkdir(); (root / "safe" / "file.txt").write_text("inside")
    (outside / "file.txt").write_text("outside")
    (root / "link").symlink_to(outside, target_is_directory=True)
    filesystem = SecureWorkspaceFS(root)
    assert filesystem.read_bytes("safe/file.txt") == b"inside"
    for path in ("../outside/file.txt", str(outside / "file.txt"), "link/file.txt"):
        try:
            filesystem.read_bytes(path)
        except SecurityError:
            pass
        else:
            raise AssertionError(f"Workspace escape was accepted: {path}")

    original = root / "race"
    original.mkdir()
    moved = root / "race-original"
    def swap() -> None:
        original.rename(moved)
        original.symlink_to(outside, target_is_directory=True)
    filesystem.atomic_write("race/target.txt", b"secure", before_replace=swap)
    assert (moved / "target.txt").read_bytes() == b"secure"
    assert not (outside / "target.txt").exists()

print("Linux SecureWorkspaceFS traversal, symlink and directory-swap verification passed.")
