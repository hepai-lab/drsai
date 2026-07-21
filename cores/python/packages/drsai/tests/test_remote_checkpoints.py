from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path


MODULE = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "remote_checkpoints.py"
SPEC = importlib.util.spec_from_file_location("remote_checkpoints", MODULE)
assert SPEC and SPEC.loader
checkpoints = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checkpoints)


def git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def test_create_preview_restore_and_accept(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))
    workspace = tmp_path / "workspace"; workspace.mkdir()
    git(workspace, "init"); git(workspace, "config", "user.email", "test@example.com"); git(workspace, "config", "user.name", "Test")
    target = workspace / "file.txt"; target.write_text("original", "utf-8"); git(workspace, "add", "file.txt"); git(workspace, "commit", "-m", "initial")
    target.write_text("checkpoint", "utf-8")
    created = checkpoints.create_checkpoint("workspace-test", workspace.resolve(), {"kind": "agent_run_baseline"})
    assert created["storedFileCount"] == 1
    target.write_text("later", "utf-8")
    preview = checkpoints.preview_checkpoint("workspace-test", workspace.resolve(), created["id"])
    assert preview["changedEntryCount"] == 1
    restored = checkpoints.restore_checkpoint("workspace-test", workspace.resolve(), created["id"])
    assert restored["restored"] and target.read_text("utf-8") == "checkpoint"
    assert checkpoints.accept_checkpoint("workspace-test", created["id"])["reviewStatus"] == "accepted"
