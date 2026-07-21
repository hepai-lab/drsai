from __future__ import annotations

import asyncio
from pathlib import Path

from drsai.backend.runtime_engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.owop import InProcessWorkspaceOperationsClient, OWOPProtocol
from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal


SCHEMA = Path(__file__).resolve().parents[5] / "protocol" / "owop" / "owop.schema.json"


def test_workspace_checkpoint_modify_add_delete_large_skip_restore_accept_and_runtime_isolation(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    modified = root / "modified.txt"
    deleted = root / "deleted.txt"
    large = root / "large.bin"
    modified.write_text("checkpoint version", encoding="utf-8")
    deleted.write_text("restore me", encoding="utf-8")
    large.write_bytes(b"L" * 4096)

    protocol = OWOPProtocol(SCHEMA)
    operations = LocalWorkspaceOperations(
        "workspace-checkpoint-test", root, WorkspaceWatchJournal(tmp_path / "watch.sqlite3")
    )
    client = InProcessWorkspaceOperationsClient(protocol, operations.handlers())

    async def call(operation: str, params: dict):
        return await client.execute({
            "version": "1.0", "request_id": f"request-{operation}", "correlation_id": "correlation-checkpoint",
            "workspace_id": "workspace-checkpoint-test", "operation": operation, "params": params,
            "binding": {"kind": "in_process"},
        })

    try:
        created = asyncio.run(call("checkpoint.create", {"label": "baseline", "max_file_bytes": 1024}))
        assert created["ok"] and created["result"]["checkpoint_id"].startswith("workspace-checkpoint-")
        assert created["result"]["stored_count"] == 2 and created["result"]["skipped_count"] == 1
        checkpoint_id = created["result"]["checkpoint_id"]

        modified.write_text("changed after checkpoint", encoding="utf-8")
        deleted.unlink()
        added = root / "added.txt"
        added.write_text("remove on restore", encoding="utf-8")
        large.write_bytes(b"M" * 4096)
        preview = asyncio.run(call("checkpoint.preview", {"checkpoint_id": checkpoint_id}))
        changes = {item["path"]: item for item in preview["result"]["changes"]}
        assert changes["modified.txt"]["change"] == "modified"
        assert changes["deleted.txt"]["change"] == "deleted"
        assert changes["added.txt"]["change"] == "added"
        assert changes["large.bin"]["restorable"] is False

        modified.write_text("stale preview mutation", encoding="utf-8")
        stale = asyncio.run(call("checkpoint.restore", {
            "checkpoint_id": checkpoint_id, "preview_digest": preview["result"]["preview_digest"]
        }))
        assert stale["error"]["code"] == "owop_conflict"
        current = asyncio.run(call("checkpoint.preview", {"checkpoint_id": checkpoint_id}))
        restored = asyncio.run(call("checkpoint.restore", {
            "checkpoint_id": checkpoint_id, "preview_digest": current["result"]["preview_digest"]
        }))
        assert restored["ok"]
        assert modified.read_text(encoding="utf-8") == "checkpoint version"
        assert deleted.read_text(encoding="utf-8") == "restore me"
        assert not added.exists()
        assert large.read_bytes() == b"M" * 4096

        accepted = asyncio.run(call("checkpoint.accept", {"checkpoint_id": checkpoint_id}))
        assert accepted["result"]["status"] == "accepted"

        runtime = RuntimeEngine(
            tmp_path / "runtime-engine.sqlite3",
            RuntimeEngineIdentity("runtime-1", "instance-1"),
            lambda workspace_id: workspace_id == "workspace-checkpoint-test",
        )
        session = runtime.create_session("workspace-checkpoint-test")
        run, _ = runtime.create_run(session["session_id"], "agent@1", "runtime-run")
        runtime.transition_run(run["run_id"], "running")
        runtime_checkpoint = runtime.save_checkpoint(run["run_id"], {"turn": 1})
        assert runtime_checkpoint["checkpoint_id"].startswith("checkpoint-")
        assert not runtime_checkpoint["checkpoint_id"].startswith("workspace-checkpoint-")
        assert runtime_checkpoint["state"] == {"turn": 1}
        assert (tmp_path / "runtime-engine.sqlite3").is_file()
        assert operations.checkpoints.state_root.parent.name == "workspace-checkpoints"
    finally:
        asyncio.run(client.close())
