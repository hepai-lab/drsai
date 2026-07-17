from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
import time

import pytest
from drsai.backend.terminal_state_service import TerminalStateService, TerminalWorkspaceBinding
from drsai.owop.process_pty import LocalProcessPtyOperations
from drsai.owop.protocol import OWOPProtocol
from drsai.owop.runtime_terminal import RuntimeTerminalOWOPOperations


ROOT = Path(__file__).resolve().parents[5]
SCHEMA = ROOT / "protocol" / "owop" / "owop.schema.json"


class FakeHandle:
    def __init__(self, on_output, on_exit, pid):
        self.on_output, self.on_exit, self.pid = on_output, on_exit, pid
        self.writes, self.sizes, self.killed = [], [], False
    def write(self, data): self.writes.append(data)
    def resize(self, cols, rows): self.sizes.append((cols, rows))
    def kill(self):
        self.killed = True
        self.on_exit(137, "explicit_kill")


class FakeProvider:
    def __init__(self): self.handles = []
    def spawn(self, *, cwd, argv, cols, rows, on_output, on_exit):
        handle = FakeHandle(on_output, on_exit, 2000 + len(self.handles))
        self.handles.append(handle)
        return handle


def request(operation: str, params: dict, workspace_id: str = "workspace-a") -> dict:
    return {
        "version": "1.0", "request_id": f"request-{operation.replace('.', '-')}",
        "correlation_id": "terminal-contract", "workspace_id": workspace_id,
        "operation": operation, "params": params, "binding": {"kind": "in_process"},
    }


def test_runtime_terminal_owop_contract_and_workspace_isolation(tmp_path: Path) -> None:
    roots = {name: tmp_path / name for name in ("workspace-a", "workspace-b")}
    for root in roots.values(): root.mkdir()
    provider = FakeProvider()
    service = TerminalStateService(
        tmp_path / "runtime.sqlite3", "runtime-local", provider,
        lambda workspace_id: TerminalWorkspaceBinding(
            workspace_id, roots[workspace_id], f"worktree-{workspace_id[-1]}"
        ) if workspace_id in roots else None,
    )
    protocol = OWOPProtocol(SCHEMA)
    operations = RuntimeTerminalOWOPOperations(service, "workspace-a")

    async def execute(operation: str, params: dict) -> dict:
        return await protocol.dispatch(request(operation, params), operations.handlers())

    created = asyncio.run(execute("pty.create", {
        "argv": ["pwsh", "-NoLogo"], "cwd": ".", "cols": 120, "rows": 40,
    }))
    assert created["ok"] is True
    terminal = created["result"]["terminal"]
    terminal_id = terminal["terminal_id"]
    assert terminal["runtime_id"] == "runtime-local"
    assert terminal["workspace_id"] == "workspace-a" and terminal["worktree_id"] == "worktree-a"

    attached = asyncio.run(execute("pty.attach", {
        "pty_id": terminal_id, "client_id": "renderer-1", "mode": "writer", "after_sequence": 0,
    }))["result"]
    lease_id = attached["lease_id"]
    payload = base64.b64encode(b"echo owop\r\n").decode("ascii")
    written = asyncio.run(execute("pty.write", {
        "pty_id": terminal_id, "lease_id": lease_id, "content_base64": payload,
    }))
    assert written["result"]["written"] == len(b"echo owop\r\n")
    assert provider.handles[0].writes == [b"echo owop\r\n"]

    provider.handles[0].on_output(b"terminal output")
    resumed = asyncio.run(execute("pty.attach", {
        "pty_id": terminal_id, "lease_id": lease_id, "client_id": "renderer-1",
        "mode": "writer", "after_sequence": 0,
    }))["result"]
    assert resumed["lease_id"] == lease_id
    assert base64.b64decode(resumed["events"][0]["content_base64"]) == b"terminal output"
    snapshot_resume = asyncio.run(execute("pty.attach", {
        "pty_id": terminal_id, "lease_id": lease_id, "client_id": "renderer-1",
        "mode": "writer", "after_sequence": 0, "prefer_snapshot": True,
    }))["result"]
    assert snapshot_resume["snapshot"]["snapshot_sequence"] == 1
    assert snapshot_resume["events"] == []
    reader = asyncio.run(execute("pty.attach", {
        "pty_id": terminal_id, "client_id": "observer-1", "mode": "reader", "after_sequence": 0,
    }))["result"]
    assert base64.b64decode(reader["events"][0]["content_base64"]) == b"terminal output"
    assert "data" not in reader["events"][0]
    assert reader["events"][0]["terminal_id"] == terminal_id
    assert reader["events"][0]["runtime_id"] == "runtime-local"
    assert reader["events"][0]["workspace_id"] == "workspace-a"
    assert reader["events"][0]["worktree_id"] == "worktree-a"
    assert reader["events"][0]["generation"] == 1

    listed = asyncio.run(execute("pty.list", {}))
    assert [item["terminal_id"] for item in listed["result"]["terminals"]] == [terminal_id]
    described = asyncio.run(execute("pty.describe", {"pty_id": terminal_id}))
    assert described["result"]["terminal"]["argv"] == ["pwsh", "-NoLogo"]
    resized = asyncio.run(execute("pty.resize", {
        "pty_id": terminal_id, "lease_id": lease_id, "cols": 132, "rows": 43,
    }))
    assert resized["result"]["terminal"]["cols"] == 132

    foreign = RuntimeTerminalOWOPOperations(service, "workspace-b")
    rejected = asyncio.run(protocol.dispatch(
        request("pty.describe", {"pty_id": terminal_id}, "workspace-b"), foreign.handlers()
    ))
    assert rejected["ok"] is False and rejected["error"]["code"] == "terminal_workspace_mismatch"

    detached = asyncio.run(execute("pty.detach", {"pty_id": terminal_id, "lease_id": lease_id}))
    assert detached["ok"] is True and provider.handles[0].killed is False
    killed = asyncio.run(execute("pty.kill", {"pty_id": terminal_id}))
    assert killed["result"]["terminal"]["status"] == "exited"


@pytest.mark.skipif(os.name != "nt", reason="Runtime-owned Local Terminal uses Windows ConPTY")
def test_runtime_terminal_service_owns_real_windows_conpty(tmp_path: Path) -> None:
    node_pty = ROOT / "apps" / "desktop" / "windows" / "node_modules" / "node-pty"
    assert node_pty.is_dir(), "node-pty must be installed for the real ConPTY acceptance test"
    provider = LocalProcessPtyOperations(tmp_path, node_pty_module=node_pty)
    service = TerminalStateService(
        tmp_path / "real-conpty.sqlite3", "runtime-windows", provider,
        lambda workspace_id: TerminalWorkspaceBinding(workspace_id, tmp_path),
    )
    try:
        terminal = service.create(
            "workspace-real", argv=["powershell.exe", "-NoLogo", "-NoProfile", "-NoExit"],
            cols=100, rows=30,
        )
        attached = service.attach(terminal["terminal_id"], "acceptance-writer", writer=True)
        marker = "RUNTIME_OWOP_CONPTY_OK"
        service.write(
            attached["lease_id"], f"Write-Output '{marker}'\r".encode(),
            expected_terminal_id=terminal["terminal_id"],
        )
        deadline, output = time.monotonic() + 15, b""
        while time.monotonic() < deadline:
            output = b"".join(event["data"] for event in service.replay(terminal["terminal_id"], 0)["events"])
            if marker.encode() in output: break
            time.sleep(0.05)
        assert marker.encode() in output
        service.kill(terminal["terminal_id"])
        deadline = time.monotonic() + 10
        while service.describe(terminal["terminal_id"])["status"] != "exited" and time.monotonic() < deadline:
            time.sleep(0.05)
        assert service.describe(terminal["terminal_id"])["status"] == "exited"
    finally:
        provider.close()
