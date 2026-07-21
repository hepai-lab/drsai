"""OI10 performance acceptance: 100 Worktrees, 50 PTYs and 10 MiB replay."""

from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from drsai.backend.runtime_registry import RuntimeRegistry
from drsai.backend.terminal_state_service import TerminalStateService, TerminalWorkspaceBinding


class Handle:
    def __init__(self, output, exit_callback, pid):
        self.output, self.exit_callback, self.pid = output, exit_callback, pid
    def write(self, _data): pass
    def resize(self, _cols, _rows): pass
    def kill(self): self.exit_callback(0, "explicit_kill")


class Provider:
    def __init__(self): self.handles = []
    def spawn(self, *, on_output, on_exit, **_kwargs):
        handle = Handle(on_output, on_exit, 10_000 + len(self.handles))
        self.handles.append(handle)
        return handle


with tempfile.TemporaryDirectory(prefix="opendrsai-orca-performance-") as directory:
    root = Path(directory)
    source = root / "source"
    source.mkdir()
    registry = RuntimeRegistry(root / "runtime.sqlite3")
    source_workspace = registry.open_workspace(str(source))

    started = time.perf_counter()
    for index in range(100):
        target = root / "worktrees" / f"worktree-{index:03d}"
        target.mkdir(parents=True)
        record = registry.reserve_worktree(
            source_workspace_id=source_workspace.workspace_id,
            idempotency_key=f"performance-{index}", repo_root=str(source), canonical_path=str(target),
            branch=f"opendrsai/performance-{index}", base_commit="a" * 40, location="local",
        )
        registry.bind_worktree_workspace(record.worktree_id)
    worktree_create_ms = (time.perf_counter() - started) * 1000
    started = time.perf_counter()
    listed = registry.list_worktrees(source_workspace_id=source_workspace.workspace_id)
    worktree_list_ms = (time.perf_counter() - started) * 1000
    assert len(listed) == 100

    provider = Provider()
    terminal_service = TerminalStateService(
        root / "terminals.sqlite3", registry.identity.runtime_id, provider,
        lambda workspace_id: TerminalWorkspaceBinding(workspace_id, source)
        if workspace_id == source_workspace.workspace_id else None,
        max_event_bytes=64 * 1024, max_journal_bytes=12 * 1024 * 1024,
    )
    started = time.perf_counter()
    terminals = [terminal_service.create(source_workspace.workspace_id, argv=["controlled-shell"])
                 for _ in range(50)]
    terminal_create_ms = (time.perf_counter() - started) * 1000
    assert len(terminal_service.list(source_workspace.workspace_id)) == 50

    payload = (b"x" * (64 * 1024 - 1)) + b"\n"
    # This gate measures the lossless journal/replay data plane. Screen snapshot
    # rendering has separate deterministic golden/performance coverage.
    terminal_service._screens.pop(terminals[0]["terminal_id"], None)
    started = time.perf_counter()
    for _ in range(160):
        provider.handles[0].output(payload)
    append_10mib_ms = (time.perf_counter() - started) * 1000
    terminal = terminal_service.describe(terminals[0]["terminal_id"])
    assert terminal["journal_bytes"] == 10 * 1024 * 1024
    started = time.perf_counter()
    replay = terminal_service.replay(terminals[0]["terminal_id"], 0)
    replay_10mib_ms = (time.perf_counter() - started) * 1000
    assert sum(len(event["data"]) for event in replay["events"]) == 10 * 1024 * 1024

    evidence = {
        "marker": "ORCA performance acceptance passed.",
        "runtime_id": registry.identity.runtime_id,
        "instance_id": registry.identity.instance_id,
        "workspace_id": source_workspace.workspace_id,
        "worktree_id": listed[0].worktree_id,
        "terminal_id": terminals[0]["terminal_id"],
        "worktree_count": 100, "terminal_count": 50, "replay_bytes": 10 * 1024 * 1024,
        "worktree_create_ms": round(worktree_create_ms, 3),
        "worktree_list_ms": round(worktree_list_ms, 3),
        "terminal_create_ms": round(terminal_create_ms, 3),
        "append_10mib_ms": round(append_10mib_ms, 3),
        "replay_10mib_ms": round(replay_10mib_ms, 3),
        "thresholds": {"worktree_list_ms": 1000, "terminal_create_ms": 5000, "replay_10mib_ms": 5000},
    }
    assert worktree_list_ms < 1000
    assert terminal_create_ms < 5000
    assert replay_10mib_ms < 5000
    print(json.dumps(evidence, sort_keys=True))
