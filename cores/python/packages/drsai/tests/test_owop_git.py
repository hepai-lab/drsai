from __future__ import annotations

import asyncio
import base64
import subprocess
from pathlib import Path

from drsai.owop import InProcessWorkspaceOperationsClient, OWOPProtocol
from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal


SCHEMA = Path(__file__).resolve().parents[5] / "cores" / "protocol" / "owop" / "owop.schema.json"


def git(root: Path, *args: str) -> str:
    completed = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True)
    return completed.stdout.strip()


def test_real_git_read_write_stale_hash_hook_failure_and_file_at_ref(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.email", "owop@example.test")
    git(root, "config", "user.name", "OWOP Test")
    tracked = root / "tracked.txt"
    tracked.write_text("initial\n", encoding="utf-8")
    git(root, "add", "tracked.txt")
    git(root, "commit", "-qm", "initial")
    initial_head = git(root, "rev-parse", "HEAD")

    protocol = OWOPProtocol(SCHEMA)
    operations = LocalWorkspaceOperations("workspace-git", root, WorkspaceWatchJournal(tmp_path / "watch.sqlite3"))
    client = InProcessWorkspaceOperationsClient(protocol, operations.handlers())

    async def call(operation: str, params: dict):
        return await client.execute({
            "version": "1.0", "request_id": f"request-{operation}", "correlation_id": "correlation-git",
            "workspace_id": "workspace-git", "operation": operation, "params": params,
            "binding": {"kind": "in_process"},
        })

    try:
        initial = asyncio.run(call("git.status", {}))
        assert initial["result"]["clean"]
        at_ref = asyncio.run(call("git.file_at_ref", {"path": "tracked.txt", "ref": "HEAD"}))
        assert base64.b64decode(at_ref["result"]["content_base64"]) == b"initial\n"

        tracked.write_text("changed\n", encoding="utf-8")
        unstaged = asyncio.run(call("git.diff", {"path": "tracked.txt", "staged": False}))
        assert "changed" in unstaged["result"]["diff"]
        stale_revert = asyncio.run(call("git.revert", {"paths": ["tracked.txt"], "diff_digest": "sha256:" + "0" * 64}))
        assert stale_revert["error"]["code"] == "owop_conflict" and tracked.read_text() == "changed\n"

        reverted = asyncio.run(call("git.revert", {"paths": ["tracked.txt"], "diff_digest": unstaged["result"]["diff_digest"]}))
        assert reverted["ok"] and tracked.read_text() == "initial\n"

        tracked.write_text("commit me\n", encoding="utf-8")
        staged = asyncio.run(call("git.stage", {"paths": ["tracked.txt"]}))
        assert staged["ok"]
        staged_diff = asyncio.run(call("git.diff", {"staged": True}))
        unstage = asyncio.run(call("git.unstage", {"paths": ["tracked.txt"]}))
        assert unstage["ok"] and not asyncio.run(call("git.diff", {"staged": True}))["result"]["diff"]
        asyncio.run(call("git.stage", {"paths": ["tracked.txt"]}))

        hook = root / ".git" / "hooks" / "pre-commit"
        hook.write_text("#!/bin/sh\nexit 23\n", encoding="utf-8", newline="\n")
        hook.chmod(0o755)
        failed = asyncio.run(call("git.commit", {"message": "blocked", "diff_digest": staged_diff["result"]["diff_digest"]}))
        assert failed["error"]["code"] == "git_command_failed"
        assert git(root, "rev-parse", "HEAD") == initial_head

        hook.unlink()
        committed = asyncio.run(call("git.commit", {"message": "accepted", "diff_digest": staged_diff["result"]["diff_digest"]}))
        assert committed["ok"] and committed["result"]["commit_id"] == git(root, "rev-parse", "HEAD")
        assert asyncio.run(call("git.status", {}))["result"]["clean"]
    finally:
        asyncio.run(client.close())
