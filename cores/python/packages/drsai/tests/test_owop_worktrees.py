from __future__ import annotations

import asyncio
import importlib.util
import subprocess
import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
BACKEND = ROOT / "cores" / "python" / "packages" / "drsai" / "src" / "drsai" / "backend"
OWOP = ROOT / "cores" / "python" / "packages" / "drsai" / "src" / "drsai" / "owop"
SCHEMA = ROOT / "cores" / "protocol" / "owop" / "owop.schema.json"

for package_name, package_path in (
    ("drsai", BACKEND.parent), ("drsai.backend", BACKEND), ("drsai.owop", OWOP),
):
    package = types.ModuleType(package_name)
    package.__path__ = [str(package_path)]
    sys.modules.setdefault(package_name, package)


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


protocol_module = load("drsai.owop.protocol", OWOP / "protocol.py")
bindings_module = load("drsai.owop.bindings", OWOP / "bindings.py")
registry_module = load("drsai.backend.runtime.registry", BACKEND / "runtime" / "registry.py")
service_module = load("drsai.backend.workspace.git_worktree_service", BACKEND / "workspace" / "git_worktree_service.py")


def git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
    return completed.stdout.strip()


def repository(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init")
    git(repo, "config", "user.email", "tests@opendrsai.local")
    git(repo, "config", "user.name", "OpenDrSai Tests")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "commit", "-m", "base")
    return repo


class Journal:
    def __init__(self):
        self.events: list[tuple[str, str, dict, str | None]] = []

    def append(self, workspace_id, event_type, data, *, dedupe_key=None):
        self.events.append((workspace_id, event_type, data, dedupe_key))
        return {"type": event_type, "data": data}


def request(operation: str, params: dict, workspace_id: str) -> dict:
    return {
        "version": "1.0",
        "request_id": "request-1",
        "correlation_id": "correlation-1",
        "workspace_id": workspace_id,
        "operation": operation,
        "params": params,
        "binding": {"kind": "in_process"},
    }


def test_worktree_owop_inprocess_and_local_ipc_have_identical_semantics(tmp_path: Path) -> None:
    async def scenario() -> None:
        repo = repository(tmp_path)
        registry = registry_module.RuntimeRegistry(tmp_path / "runtime.sqlite3")
        source = registry.open_workspace(str(repo))
        service = service_module.GitWorktreeService(registry, tmp_path / "managed")
        journal = Journal()
        operations = service_module.GitWorktreeOWOPOperations(service, source.workspace_id, journal)
        protocol = protocol_module.OWOPProtocol(SCHEMA)
        in_process = bindings_module.InProcessWorkspaceOperationsClient(protocol, operations.handlers())
        server = bindings_module.LocalIPCWorkspaceOperationsServer(protocol, operations.handlers())
        await server.start()
        host, port = server.address
        ipc = bindings_module.LocalIPCWorkspaceOperationsClient(protocol, host, port, server.token)
        create_request = request(
            "git.worktree.create", {"idempotency_key": "same", "intent": "Same task"}, source.workspace_id
        )
        first = await in_process.execute(create_request)
        second = await ipc.execute(create_request)
        assert first["ok"] and second["ok"]
        assert first["result"] == second["result"]
        worktree_id = first["result"]["worktree"]["worktree_id"]
        listed = await ipc.execute(request("git.worktree.list", {"include_removed": False}, source.workspace_id))
        described = await in_process.execute(request("git.worktree.describe", {"worktree_id": worktree_id}, source.workspace_id))
        assert listed["result"]["worktrees"] == [described["result"]["worktree"]]
        assert {event[1] for event in journal.events} == {"worktree.created"}
        await in_process.close()
        await ipc.close()
        await server.close()

    asyncio.run(scenario())


def test_worktree_result_schema_rejects_unknown_and_missing_fields(tmp_path: Path) -> None:
    protocol = protocol_module.OWOPProtocol(SCHEMA)
    create_request = request("git.worktree.create", {"idempotency_key": "x", "intent": "x"}, "workspace-1")
    unknown = asyncio.run(protocol.dispatch(
        create_request, {"git.worktree.create": lambda _params: {"worktree": {"arbitrary": True}}}
    ))
    assert unknown["ok"] is False
    assert unknown["error"]["code"] == "owop_result_invalid"


def test_worktree_params_are_strict_and_capability_is_negotiated() -> None:
    protocol = protocol_module.OWOPProtocol(SCHEMA)
    negotiated = protocol.negotiate(["1.0"], ["worktree", "git"])
    assert negotiated["capabilities"] == ["git", "worktree"]
    invalid = request(
        "git.worktree.create",
        {"idempotency_key": "x", "intent": "x", "arbitrary_json": {}},
        "workspace-1",
    )
    try:
        protocol.validate_request(invalid)
    except protocol_module.OWOPError as exc:
        assert exc.code == "owop_params_invalid"
    else:
        raise AssertionError("Unknown Worktree parameter was accepted")
