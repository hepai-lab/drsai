import asyncio
import json
from pathlib import Path

from drsai.backend import gateway
from drsai.backend.runtime_registry import RuntimeRegistry


async def main() -> None:
    state = Path("/tmp/opendrsai-worktree-state")
    gateway._runtime_registry_instance = RuntimeRegistry(state / "runtime.sqlite3")
    parent = gateway._runtime_registry().open_workspace("/home/vscode/workspace")
    result = await gateway.remote_workspace_worktree_create(
        parent.workspace_id,
        gateway.RemoteWorktreeRequest(intent="inherit runtime"),
    )
    worktree = Path(result["worktree_path"])
    assert result["location"] == "remote"
    assert result["transport"] == "ssh"
    assert result["workspace_id"] != parent.workspace_id
    assert worktree.is_dir()
    assert (worktree / "tracked.txt").read_text(encoding="utf-8").strip() == "tracked"
    registered = gateway._runtime_registry().get_workspace(result["workspace_id"])
    assert registered is not None and registered.path == str(worktree)
    print(json.dumps(result, sort_keys=True))


asyncio.run(main())
