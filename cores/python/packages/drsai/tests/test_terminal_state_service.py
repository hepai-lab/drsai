from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


MODULE = (
    Path(__file__).parents[1]
    / "src"
    / "drsai"
    / "backend"
    / "runtime"
    / "terminal"
    / "state_service.py"
)
SCREEN_MODULE = MODULE.with_name("screen.py")
SCREEN_SPEC = importlib.util.spec_from_file_location("terminal_screen", SCREEN_MODULE)
assert SCREEN_SPEC and SCREEN_SPEC.loader
screen_module = importlib.util.module_from_spec(SCREEN_SPEC)
sys.modules[SCREEN_SPEC.name] = screen_module
SCREEN_SPEC.loader.exec_module(screen_module)
SPEC = importlib.util.spec_from_file_location("terminal_state_service_test_module", MODULE)
assert SPEC and SPEC.loader
terminal_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = terminal_module
SPEC.loader.exec_module(terminal_module)
TerminalStateService = terminal_module.TerminalStateService
TerminalStateError = terminal_module.TerminalStateError
TerminalWorkspaceBinding = terminal_module.TerminalWorkspaceBinding


class FakeHandle:
    def __init__(self, on_output, on_exit, pid):
        self.on_output, self.on_exit, self.pid = on_output, on_exit, pid
        self.writes, self.sizes, self.killed = [], [], False
    def write(self, data): self.writes.append(data)
    def resize(self, cols, rows): self.sizes.append((cols, rows))
    def kill(self):
        self.killed = True
        self.on_exit(137, "explicit_kill")
    def output(self, data): self.on_output(data)
    def exit(self, code=0, signal=None): self.on_exit(code, signal)


class FakeProvider:
    def __init__(self): self.handles = []
    def spawn(self, *, cwd, argv, cols, rows, on_output, on_exit):
        handle = FakeHandle(on_output, on_exit, 1000 + len(self.handles))
        handle.spawn = {"cwd": cwd, "argv": argv, "cols": cols, "rows": rows}
        self.handles.append(handle)
        return handle


def build(tmp_path: Path, *, max_event_bytes=64 * 1024, max_journal_bytes=1024 * 1024):
    root = tmp_path / "workspace"
    root.mkdir(exist_ok=True)
    (root / "subdir").mkdir(exist_ok=True)
    provider = FakeProvider()
    service = TerminalStateService(
        tmp_path / "terminals.sqlite3", "runtime-test", provider,
        lambda workspace_id: TerminalWorkspaceBinding(workspace_id, root, "worktree-test") if workspace_id == "workspace-test" else None,
        max_event_bytes=max_event_bytes, max_journal_bytes=max_journal_bytes,
    )
    return service, provider, root


def test_workspace_binding_single_writer_multi_reader_and_detach(tmp_path: Path) -> None:
    service, provider, root = build(tmp_path)
    terminal = service.create("workspace-test", cwd="subdir", shell="pwsh", cols=120, rows=40)
    assert terminal["runtime_id"] == "runtime-test"
    assert terminal["workspace_id"] == "workspace-test" and terminal["worktree_id"] == "worktree-test"
    assert provider.handles[0].spawn["cwd"] == (root / "subdir")
    assert provider.handles[0].spawn["argv"] == ["pwsh"]
    reader = service.attach(terminal["terminal_id"], "renderer-reader", writer=False)
    writer = service.attach(terminal["terminal_id"], "renderer-writer", writer=True)
    with pytest.raises(TerminalStateError) as conflict:
        service.attach(terminal["terminal_id"], "second-writer", writer=True)
    assert conflict.value.code == "terminal_writer_conflict"
    service.write(writer["lease_id"], b"echo safe\r\n", expected_terminal_id=terminal["terminal_id"])
    service.resize(writer["lease_id"], 999, 1)
    assert provider.handles[0].writes == [b"echo safe\r\n"]
    assert provider.handles[0].sizes == [(500, 5)]
    service.detach(reader["lease_id"])
    detached = service.detach(writer["lease_id"])
    assert detached["status"] == "detached" and not provider.handles[0].killed
    with pytest.raises(TerminalStateError): service.write(writer["lease_id"], b"rejected")
    for cwd in (str(root), "../"):
        with pytest.raises(TerminalStateError): service.create("workspace-test", cwd=cwd)


def test_bounded_output_journal_reports_expired_cursor(tmp_path: Path) -> None:
    service, provider, _ = build(tmp_path, max_event_bytes=4, max_journal_bytes=8)
    terminal = service.create("workspace-test", argv=["pwsh"])
    provider.handles[0].output(b"abcdefghijkl")
    described = service.describe(terminal["terminal_id"])
    assert described["last_sequence"] == 3 and described["first_sequence"] == 2
    assert described["journal_bytes"] == 8
    replay = service.replay(terminal["terminal_id"], 0)
    assert replay["snapshot_required"] is True
    assert replay["snapshot"]["snapshot_sequence"] == 3
    assert replay["events"] == []
    assert "abcdefghijkl" in "".join(
        run["text"] for line in replay["snapshot"]["screen"] for run in line
    )


def test_exit_retains_tail_and_restart_marks_unrecoverable_terminal_lost(tmp_path: Path) -> None:
    service, provider, root = build(tmp_path)
    exited = service.create("workspace-test", argv=["pwsh"])
    provider.handles[0].output(b"tail")
    provider.handles[0].exit(7, "controlled")
    final = service.describe(exited["terminal_id"])
    assert final["status"] == "exited" and final["exit_code"] == 7 and final["exit_signal"] == "controlled"
    assert service.replay(exited["terminal_id"], 0)["events"][0]["data"] == b"tail"
    running = service.create("workspace-test", argv=["pwsh"])
    restarted = TerminalStateService(
        tmp_path / "terminals.sqlite3", "runtime-test", FakeProvider(),
        lambda workspace_id: TerminalWorkspaceBinding(workspace_id, root, "worktree-test"),
    )
    assert restarted.describe(exited["terminal_id"])["status"] == "exited"
    lost = restarted.describe(running["terminal_id"])
    assert lost["status"] == "lost" and lost["exit_signal"] == "runtime_restart"
    assert set(restarted.purge_expired(now=lost["exited_at"] + 7 * 24 * 60 * 60 + 1)) == {exited["terminal_id"], running["terminal_id"]}
    with pytest.raises(TerminalStateError): restarted.describe(running["terminal_id"])


def test_fifty_terminals_across_ten_workspaces_never_cross_streams(tmp_path: Path) -> None:
    roots = {f"workspace-{index}": tmp_path / f"workspace-{index}" for index in range(10)}
    for root in roots.values(): root.mkdir()
    provider = FakeProvider()
    service = TerminalStateService(
        tmp_path / "isolation.sqlite3", "runtime-test", provider,
        lambda workspace_id: TerminalWorkspaceBinding(workspace_id, roots[workspace_id]) if workspace_id in roots else None,
    )
    terminals = []
    for workspace_id in roots:
        for index in range(5):
            terminals.append((workspace_id, service.create(workspace_id, argv=["pwsh"]), provider.handles[-1], index))
    for workspace_id, terminal, handle, index in terminals:
        handle.output(f"{workspace_id}/terminal-{index}".encode())
    for workspace_id, terminal, _handle, index in terminals:
        output = b"".join(event["data"] for event in service.replay(terminal["terminal_id"], 0)["events"])
        assert output == f"{workspace_id}/terminal-{index}".encode()
        assert all(item["workspace_id"] == workspace_id for item in service.list(workspace_id))


def test_screen_snapshot_sequence_resize_style_and_restart_persistence(tmp_path: Path) -> None:
    service, provider, root = build(tmp_path, max_event_bytes=5)
    terminal = service.create("workspace-test", argv=["pwsh"], cols=20, rows=5)
    provider.handles[0].output("plain \x1b[31;1m红色\x1b[0m".encode())
    current = service.snapshot(terminal["terminal_id"])
    assert current["snapshot_sequence"] == service.describe(terminal["terminal_id"])["last_sequence"]
    assert current["generation"] == 1 and current["rows"] == 5 and current["cols"] == 20
    assert any(run["style"].get("fg") == "ansi:1" for line in current["screen"] for run in line)
    writer = service.attach(terminal["terminal_id"], "resize", writer=True)
    service.resize(writer["lease_id"], 30, 8, expected_terminal_id=terminal["terminal_id"])
    resized = service.snapshot(terminal["terminal_id"])
    assert resized["cols"] == 30 and resized["rows"] == 8

    restarted = TerminalStateService(
        tmp_path / "terminals.sqlite3", "runtime-test", FakeProvider(),
        lambda workspace_id: TerminalWorkspaceBinding(workspace_id, root, "worktree-test"),
    )
    assert restarted.describe(terminal["terminal_id"])["status"] == "lost"
    assert restarted.snapshot(terminal["terminal_id"]) == resized
