from __future__ import annotations

import asyncio
import base64
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import pytest

from drsai.backend.runtime.agent_bindings import AgentBackendBindingStore
from drsai.backend.runtime.agent import (
    AgentDefinitionStore,
    AgentDefinition,
    AgentExecutionServices,
    OpenDrSaiAgentBackend,
    RuntimeAgentService,
    RuntimeExecutionError,
    RuntimeRunContext,
    RuntimeToolDispatcher,
)
from drsai.backend.codex_adapter import CodexAdapter
from drsai.backend.codex_adapter.backend_client import CodexAgentBackendClient, _codex_turn_timing
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry
from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal
from drsai.owop.process_pty import LocalProcessPtyOperations


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_cancel_is_idempotent_when_turn_finished_before_interrupt(tmp_path: Path):
    bindings = AgentBackendBindingStore(tmp_path / "cancel-race.sqlite3")
    bindings.bind_session(
        session_id="session-race", workspace_id="workspace-race", backend_id="codex",
        agent_backend_runtime_id="runtime-race", workspace_runtime_id="runtime-race",
        backend_session_id="thread-race", backend_version="test",
    )
    bindings.bind_run(
        run_id="run-race", session_id="session-race", workspace_id="workspace-race", backend_id="codex",
        agent_backend_runtime_id="runtime-race", workspace_runtime_id="runtime-race",
        backend_run_id="turn-race", generation=1, status="running",
    )
    rpc = FakeRPC()
    rpc.interrupt_no_active = True
    client = CodexAgentBackendClient(rpc, bindings)
    await client.interrupt_turn("run-race")
    await client.interrupt_turn("run-race")
    assert [method for method, _ in rpc.calls] == ["turn/interrupt"]


@dataclass
class _Binary:
    version: str = "0.142.5"


class _Supervisor:
    binary = _Binary()

    async def health(self):
        return {"available": True, "version": self.binary.version}


class FakeRPC:
    def __init__(self):
        self.supervisor = _Supervisor()
        self._generation = 1
        self._state = "ready"
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.routes: list[tuple[str | None, str | None, Any]] = []
        self.thread_count = 0
        self.turn_count = 0
        self.thread_by_session: dict[str, str] = {}
        self.turn_status = "completed"
        self.fail_method: str | None = None
        self.read_turns: list[dict[str, Any]] = []
        self.delivery_gate: asyncio.Event | None = None
        self.interrupt_no_active = False
        self.thread_lists: dict[bool, list[dict[str, Any]]] = {False: [], True: []}

    async def connect(self):
        return {"connected": True}

    async def reconnect(self):
        self._generation += 1
        self._state = "ready"
        return {"protocolVersion": "1", "connected": True}

    async def request(self, method: str, params: Mapping[str, Any] | None = None, **_kwargs):
        values = dict(params or {})
        self.calls.append((method, values))
        if method == "turn/interrupt" and self.interrupt_no_active:
            raise RuntimeExecutionError("codex_jsonrpc_error", "no active turn to interrupt")
        if method == "model/list":
            return {"data": [{"id": "gpt-5.4", "isDefault": True,
                               "supportedReasoningEfforts": ["medium", "high"], "inputModalities": ["text"]}]}
        if method == "thread/list":
            return {"data": list(self.thread_lists[bool(values.get("archived"))]), "nextCursor": None}
        if method == self.fail_method:
            if method == "thread/start":
                self.thread_count += 1
            elif method == "turn/start":
                self.turn_count += 1
            raise RuntimeExecutionError("codex_request_timeout", "response was lost", retryable=True)
        if method == "thread/start":
            self.thread_count += 1
            identity = f"thread-{self.thread_count}"
            return {"thread": {"id": identity}}
        if method == "thread/resume":
            return {"thread": {"id": values["threadId"]}}
        if method in {"thread/archive", "thread/unarchive"}:
            return {}
        if method == "turn/start":
            self.turn_count += 1
            identity = f"turn-{self.turn_count}"

            async def deliver():
                await asyncio.sleep(0)
                if self.delivery_gate is not None:
                    await self.delivery_gate.wait()
                messages = [
                    {"method": "item/agentMessage/delta",
                     "params": {"threadId": values["threadId"], "turnId": identity, "delta": f"reply-{identity}"}},
                    {"method": "turn/completed",
                     "params": {"threadId": values["threadId"],
                                "turn": {"id": identity, "status": self.turn_status,
                                         "error": {"message": "controlled failure"} if self.turn_status == "failed" else None}}},
                ]
                for message in messages:
                    for thread_id, turn_id, handler in list(self.routes):
                        if thread_id in {None, values["threadId"]} and turn_id in {None, identity}:
                            result = handler(message)
                            if asyncio.iscoroutine(result):
                                await result

            asyncio.create_task(deliver())
            return {"turn": {"id": identity}}
        if method == "turn/interrupt":
            return {}
        if method == "thread/read":
            return {"thread": {"turns": list(self.read_turns)}}
        raise AssertionError(f"unexpected method {method}")

    def on_route(self, handler, *, thread_id=None, turn_id=None):
        item = (thread_id, turn_id, handler)
        self.routes.append(item)
        return lambda: self.routes.remove(item)

    async def close(self):
        self._state = "closed"


class EventState:
    def __init__(self):
        self.events: list[dict[str, Any]] = []

    def append_event(self, run_id, event_type, data):
        event = {"run_id": run_id, "type": event_type, "data": dict(data)}
        self.events.append(event)
        return event


def _definition(*, version="1", backend_config=None, model="gpt-5.4"):
    raw = {"id": "codex-agent", "version": version, "backend": "codex", "model": model}
    if backend_config is not None:
        raw["backend_config"] = backend_config
    return AgentDefinition("codex-agent", version, "codex", model, "Follow exact instructions.",
                           frozenset({"workspace:read"}), raw)


def _context(root: Path, *, workspace="workspace-1", session="session-1", run="run-1"):
    workspace_root = root / workspace
    workspace_root.mkdir(parents=True, exist_ok=True)
    return RuntimeRunContext(
        runtime_id="runtime-local", instance_id="instance-1", workspace_id=workspace,
        workspace_path=workspace_root, session_id=session, run_id=run,
        agent_definition_id="codex-agent", agent_definition_version="1",
    )


def _services():
    state = EventState()
    return AgentExecutionServices(state, None, None), state


@pytest.mark.anyio
async def test_backend_restart_rotates_generation_without_restarting_runtime(tmp_path: Path):
    rpc = FakeRPC()
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "restart.sqlite3"))
    result = await client.restart_backend()
    assert result["restarted"] is True
    assert result["protocol_version"] == "1"
    assert result["available"] is True
    assert rpc._generation == 2


@pytest.mark.anyio
async def test_workspace_session_discovery_filters_path_classifies_archive_and_binds_idempotently(tmp_path: Path):
    workspace = tmp_path / "project"
    other = tmp_path / "other"
    workspace.mkdir(); other.mkdir()
    rpc = FakeRPC()
    rpc.thread_lists[False] = [
        {"id": "thread-active", "cwd": str(workspace), "title": "Active", "updatedAt": 1_800_000_000},
        {"id": "thread-other", "cwd": str(other), "title": "Wrong project"},
    ]
    rpc.thread_lists[True] = [
        {"id": "thread-archived", "cwd": str(workspace), "name": "Archived", "updated_at": "2026-01-01T00:00:00+00:00"},
    ]
    bindings = AgentBackendBindingStore(tmp_path / "sync.sqlite3")
    client = CodexAgentBackendClient(rpc, bindings)
    sessions = await client.discover_sessions(str(workspace))
    assert [(item["backend_session_id"], item["archived"]) for item in sessions] == [
        ("thread-active", False), ("thread-archived", True),
    ]
    await client.bind_imported_session("session-a", "workspace-a", "runtime-a", "thread-active")
    await client.bind_imported_session("session-a", "workspace-a", "runtime-a", "thread-active")
    assert bindings.find_session_by_backend_id("codex", "thread-active").session_id == "session-a"
    with pytest.raises(RuntimeExecutionError) as caught:
        await client.bind_imported_session("session-b", "workspace-a", "runtime-a", "thread-active")
    assert caught.value.code == "codex_import_binding_conflict"


@pytest.mark.anyio
async def test_imported_thread_read_normalizes_historical_items(tmp_path: Path):
    rpc = FakeRPC()
    rpc.read_turns = [{
        "id": "turn-history", "status": "completed",
        "startedAt": 1785542400, "completedAt": 1785542428, "durationMs": 28000,
        "items": [
            {"id": "user-history", "type": "userMessage", "text": "old question"},
            {"id": "assistant-history", "type": "agentMessage", "text": "old answer"},
            {"id": "reasoning-history", "type": "reasoning", "summary": "old reasoning"},
        ],
    }]
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "history.sqlite3"))
    await client.bind_imported_session("session-history", "workspace-history", "runtime-history", "thread-history")
    history = await client.read_imported_session_history("session-history")

    assert history[0]["backend_run_id"] == "turn-history"
    assert history[0]["created_at"] == "2026-08-01T00:00:00+00:00"
    assert history[0]["completed_at"] == "2026-08-01T00:00:28+00:00"
    assert history[0]["duration_ms"] == 28000
    assert [(item["kind"], item["role"], item["payload"].get("text") or item["payload"].get("summary"))
            for item in history[0]["items"]] == [
        ("message", "user", "old question"),
        ("message", "assistant", "old answer"),
        ("reasoning", None, "old reasoning"),
    ]


def test_codex_turn_duration_repairs_missing_started_at():
    started_at, completed_at, duration_ms = _codex_turn_timing({
        "completedAt": 1785542428,
        "durationMs": 28000,
    })
    assert started_at == "2026-08-01T00:00:00+00:00"
    assert completed_at == "2026-08-01T00:00:28+00:00"
    assert duration_ms == 28000


@pytest.mark.parametrize("backend_config", [
    {"approvalPolicy": "never"},
    {"approvalPolicy": "bypass"},
    {"sandbox": "danger-full-access"},
    {"sandbox": "disabled"},
])
def test_rejects_codex_approval_or_workspace_safety_bypass(backend_config):
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexAgentBackendClient._backend_config(_definition(backend_config=backend_config))
    assert caught.value.code in {"codex_approval_policy_unsafe", "codex_sandbox_policy_unsafe"}


@pytest.mark.anyio
async def test_session_thread_run_turn_mapping_uses_authoritative_workspace_and_metadata(tmp_path: Path):
    rpc = FakeRPC()
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "bindings.sqlite3"))
    context = _context(tmp_path)
    services, state = _services()
    result = await client.execute_turn(
        context,
        _definition(backend_config={"personality": "pragmatic", "approvalPolicy": "on-request",
                                    "sandbox": "workspace-write", "reasoningEffort": "high"}),
        "implement this", services,
    )
    await client.archive_session(context.session_id, archived=True)
    await client.archive_session(context.session_id, archived=False)
    assert [method for method, _ in rpc.calls if method in {"thread/archive", "thread/unarchive"}] == ["thread/archive", "thread/unarchive"]
    assert result["status"] == "completed"
    assert result["backend_metadata"] == {"thread_id": "thread-1", "turn_id": "turn-1"}
    thread_request = next(params for method, params in rpc.calls if method == "thread/start")
    assert thread_request["cwd"] == str(context.workspace_path)
    assert thread_request["model"] == "gpt-5.4"
    assert thread_request["developerInstructions"] == "Follow exact instructions."
    assert thread_request["personality"] == "pragmatic"
    assert thread_request["approvalsReviewer"] == "user"
    turn_request = next(params for method, params in rpc.calls if method == "turn/start")
    assert turn_request["effort"] == "high"
    assert context.session_id == "session-1" and context.run_id == "run-1"
    # RuntimeAgentService owns the single Run lifecycle producer; the Adapter
    # client emits only normalized Item semantics.
    assert [event["type"] for event in state.events] == ["oaep.item.message.delta"]


@pytest.mark.anyio
async def test_response_then_storage_fault_reuses_ids_without_duplicate_rpc(tmp_path: Path):
    database = tmp_path / "bindings.sqlite3"
    rpc = FakeRPC()
    points = {"after_thread_response_before_bind": 1}

    def inject(point):
        if points.get(point):
            points[point] -= 1
            raise RuntimeError("injected crash")

    context = _context(tmp_path)
    services, _ = _services()
    first = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database), fault_injector=inject)
    with pytest.raises(RuntimeError, match="injected crash"):
        await first.execute_turn(context, _definition(), "prompt", services)
    assert rpc.thread_count == 1
    restarted = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database))
    result = await restarted.execute_turn(context, _definition(), "prompt", services)
    assert result["backend_metadata"]["thread_id"] == "thread-1"
    assert rpc.thread_count == 1 and rpc.turn_count == 1

    second_context = _context(tmp_path, session="session-1", run="run-2")
    turn_points = {"after_turn_response_before_bind": 1}

    def turn_inject(point):
        if turn_points.get(point):
            turn_points[point] -= 1
            raise RuntimeError("turn storage crash")

    crashing = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database), fault_injector=turn_inject)
    with pytest.raises(RuntimeError, match="turn storage crash"):
        await crashing.execute_turn(second_context, _definition(), "prompt-2", services)
    turn_count = rpc.turn_count
    recovering = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database))
    with pytest.raises(RuntimeExecutionError) as caught:
        await recovering.execute_turn(second_context, _definition(), "prompt-2", services)
    assert caught.value.code == "codex_turn_recovery_required"
    assert rpc.turn_count == turn_count
    assert recovering.bindings.get_run("run-2").backend_run_id == "turn-2"


@pytest.mark.anyio
async def test_fault_before_rpc_leaves_retryable_pending_intent(tmp_path: Path):
    database = tmp_path / "bindings.sqlite3"
    rpc = FakeRPC()
    fired = False

    def inject(point):
        nonlocal fired
        if point == "before_thread_request" and not fired:
            fired = True
            raise RuntimeError("crash before write")

    context = _context(tmp_path)
    services, _ = _services()
    first = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database), fault_injector=inject)
    with pytest.raises(RuntimeError, match="before write"):
        await first.execute_turn(context, _definition(), "prompt", services)
    assert rpc.thread_count == 0
    assert first.bindings.get_operation("session", context.session_id).state == "pending"
    restarted = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database))
    result = await restarted.execute_turn(context, _definition(), "prompt", services)
    assert result["status"] == "completed"
    assert rpc.thread_count == 1


@pytest.mark.anyio
async def test_lost_response_enters_unknown_and_never_blindly_retries(tmp_path: Path):
    rpc = FakeRPC()
    rpc.fail_method = "thread/start"
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "bindings.sqlite3"))
    context = _context(tmp_path)
    services, _ = _services()
    with pytest.raises(RuntimeExecutionError) as caught:
        await client.execute_turn(context, _definition(), "prompt", services)
    assert caught.value.code == "codex_request_timeout"
    rpc.fail_method = None
    with pytest.raises(RuntimeExecutionError) as caught:
        await client.execute_turn(context, _definition(), "prompt", services)
    assert caught.value.code == "codex_binding_unknown"
    assert rpc.thread_count == 1


@pytest.mark.anyio
async def test_restart_resumes_same_thread_and_unsupported_config_fails_closed(tmp_path: Path):
    database = tmp_path / "bindings.sqlite3"
    rpc = FakeRPC()
    services, _ = _services()
    first_context = _context(tmp_path, run="run-1")
    first = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database))
    await first.execute_turn(first_context, _definition(), "first", services)

    rpc._generation = 2
    second = CodexAgentBackendClient(rpc, AgentBackendBindingStore(database))
    second_context = _context(tmp_path, run="run-2")
    result = await second.execute_turn(second_context, _definition(), "second", services)
    assert result["backend_metadata"]["thread_id"] == "thread-1"
    resumes = [params for method, params in rpc.calls if method == "thread/resume"]
    assert resumes[-1]["threadId"] == "thread-1"
    assert resumes[-1]["cwd"] == str(second_context.workspace_path)
    assert resumes[-1]["approvalsReviewer"] == "user"

    invalid_context = _context(tmp_path, session="session-invalid", run="run-invalid")
    with pytest.raises(RuntimeExecutionError) as caught:
        await second.execute_turn(invalid_context, _definition(backend_config={"cwd": "C:/attacker"}), "x", services)
    assert caught.value.code == "codex_capability_unsupported"
    assert all(params.get("cwd") != "C:/attacker" for _, params in rpc.calls)


@pytest.mark.anyio
async def test_twenty_turns_reuse_one_codex_thread_and_create_one_turn_each(tmp_path: Path):
    rpc = FakeRPC()
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "twenty.sqlite3"))
    services, _ = _services()
    thread_ids = []
    turn_ids = []
    for index in range(20):
        context = _context(tmp_path, session="session-continuous", run=f"run-continuous-{index}")
        result = await client.execute_turn(context, _definition(), f"message {index}", services)
        thread_ids.append(result["backend_metadata"]["thread_id"])
        turn_ids.append(result["backend_metadata"]["turn_id"])
    assert len(set(thread_ids)) == 1
    assert len(set(turn_ids)) == 20
    assert rpc.thread_count == 1 and rpc.turn_count == 20


@pytest.mark.anyio
async def test_ten_workspaces_two_sessions_concurrent_are_fully_isolated(tmp_path: Path):
    rpc = FakeRPC()
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "bindings.sqlite3"))

    async def execute(index: int, session_index: int):
        context = _context(
            tmp_path, workspace=f"workspace-{index}", session=f"session-{index}-{session_index}",
            run=f"run-{index}-{session_index}",
        )
        services, _ = _services()
        result = await client.execute_turn(context, _definition(), f"prompt-{index}-{session_index}", services)
        return context, result

    results = await asyncio.gather(*(execute(index, session) for index in range(10) for session in range(2)))
    threads = {result["backend_metadata"]["thread_id"] for _, result in results}
    turns = {result["backend_metadata"]["turn_id"] for _, result in results}
    assert len(threads) == 20 and len(turns) == 20
    for context, result in results:
        binding = client.bindings.get_session(context.session_id)
        assert binding.workspace_id == context.workspace_id
        assert binding.backend_session_id == result["backend_metadata"]["thread_id"]


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status", "code", "binding_status"),
    [("failed", "codex_turn_failed", "failed"), ("interrupted", "run_cancelled", "interrupted")],
)
async def test_failed_and_interrupted_terminal_mapping(tmp_path: Path, status: str, code: str, binding_status: str):
    rpc = FakeRPC()
    rpc.turn_status = status
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / f"{status}.sqlite3"))
    services, _ = _services()
    context = _context(tmp_path, session=f"session-{status}", run=f"run-{status}")
    with pytest.raises(RuntimeExecutionError) as caught:
        await client.execute_turn(context, _definition(), "prompt", services)
    assert caught.value.code == code
    assert client.bindings.get_run(context.run_id).status == binding_status


@pytest.mark.anyio
async def test_formal_runtime_service_executes_codex_without_changing_product_ids(tmp_path: Path):
    workspace = tmp_path / "formal-workspace"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda identity: registry.get_workspace(identity) is not None,
    )
    assets = tmp_path / "assets"
    definition_path = assets / "formal-codex" / "1.json"
    definition_path.parent.mkdir(parents=True)
    definition_path.write_text(
        '{"id":"formal-codex","version":"1","backend":"codex","model":"gpt-5.4",'
        '"instructions":"formal flow","permissions":[]}', encoding="utf-8",
    )
    definitions = AgentDefinitionStore(assets)
    session = engine.create_session(record.workspace_id, "formal")
    run, _ = engine.create_run(session["session_id"], "formal-codex@1", "formal-codex-run", "codex")
    rpc = FakeRPC()
    client = CodexAgentBackendClient(rpc, AgentBackendBindingStore(tmp_path / "bindings.sqlite3"))
    open_calls: list[str] = []
    service = RuntimeAgentService(
        engine, registry, definitions, RuntimeToolDispatcher(engine),
        {
            "opendrsai": OpenDrSaiAgentBackend(
                lambda prompt, *_: open_calls.append(prompt) or {"content": "forbidden", "done": True}
            ),
            "codex": CodexAdapter(client),
        },
    )
    rpc.delivery_gate = asyncio.Event()
    execution = asyncio.create_task(service.execute(run["run_id"], "formal prompt"))
    deadline = time.monotonic() + 5
    while not any(method == "turn/start" for method, _ in rpc.calls) and time.monotonic() < deadline:
        await asyncio.sleep(0.01)
    # No Desktop/Event subscriber is retained; the Runtime-owned Turn continues independently.
    rpc.delivery_gate.set()
    result = await execution
    assert result["run"]["run_id"] == run["run_id"]
    assert result["context"]["session_id"] == session["session_id"]
    assert result["result"]["backend_metadata"] == {"thread_id": "thread-1", "turn_id": "turn-1"}
    assert result["run"]["status"] == "completed"
    assert result["run"]["started_at"] and result["run"]["completed_at"]
    assert open_calls == []
    restarted_engine = RuntimeEngine(engine.database, engine.identity, engine.workspace_exists)
    persisted = restarted_engine.list_events(run["run_id"])
    assert any(event["type"] == "agent.message.delta" for event in persisted)
    oaep = restarted_engine.list_oaep_events(session["session_id"], limit=2000)
    assert sum(event["type"] == "event.run.started" for event in oaep) == 1
    assert sum(event["type"] == "event.run.completed" for event in oaep) == 1
    await service.close()


@pytest.mark.anyio
@pytest.mark.skipif(__import__("os").name != "nt", reason="C03-F05 validates Windows ConPTY isolation")
async def test_ten_workspace_runtime_event_watch_conpty_and_codex_thread_joint_isolation(tmp_path: Path):
    registry = RuntimeRegistry(tmp_path / "joint-registry.sqlite3")
    engine = RuntimeEngine(
        tmp_path / "joint-runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda identity: registry.get_workspace(identity) is not None,
    )
    assets = tmp_path / "joint-assets"
    definition_path = assets / "joint-codex" / "1.json"
    definition_path.parent.mkdir(parents=True)
    definition_path.write_text(
        '{"id":"joint-codex","version":"1","backend":"codex","model":"gpt-5.4",'
        '"instructions":"joint isolation","permissions":[]}', encoding="utf-8",
    )
    definitions = AgentDefinitionStore(assets)
    rpc = FakeRPC()
    bindings = AgentBackendBindingStore(tmp_path / "joint-bindings.sqlite3")
    client = CodexAgentBackendClient(rpc, bindings)
    service = RuntimeAgentService(
        engine, registry, definitions, RuntimeToolDispatcher(engine),
        {"opendrsai": OpenDrSaiAgentBackend(lambda *_: {"done": True}), "codex": CodexAdapter(client)},
    )
    journal = WorkspaceWatchJournal(tmp_path / "joint-watch.sqlite3")
    repo_root = Path(__file__).resolve().parents[5]
    candidates = (
        repo_root / "apps" / "desktop" / "windows" / "node_modules" / "node-pty",
        repo_root / "apps" / "desktop" / "node_modules" / "node-pty",
    )
    node_pty = next((candidate for candidate in candidates if candidate.is_dir()), candidates[0])
    assert node_pty.is_dir()
    operations: list[LocalWorkspaceOperations] = []
    runs: list[dict[str, Any]] = []
    ptys: list[tuple[LocalProcessPtyOperations, str, bytes]] = []
    try:
        for index in range(10):
            root = tmp_path / f"joint-workspace-{index}"
            root.mkdir()
            workspace = registry.open_workspace(str(root))
            session = engine.create_session(workspace.workspace_id, f"session-{index}")
            run, _ = engine.create_run(session["session_id"], "joint-codex@1", f"joint-run-{index}", "codex")
            runs.append(run)
            manager = LocalProcessPtyOperations(root, node_pty_module=node_pty)
            workspace_operations = LocalWorkspaceOperations(workspace.workspace_id, root, journal, process_pty=manager)
            operations.append(workspace_operations)
            content = f"WATCH_{index}".encode()
            workspace_operations.write_file({
                "path": "owned.txt", "content_base64": base64.b64encode(content).decode(), "create_parents": False,
            })
            created = manager.pty_create({
                "argv": ["cmd.exe", "/d", "/c", f"echo PTY_{index}"], "cwd": ".",
                "cols": 80, "rows": 24, "max_buffer_bytes": 4096,
            })
            ptys.append((manager, created["pty_id"], f"PTY_{index}".encode()))

        results = await asyncio.gather(*(
            service.execute(run["run_id"], f"joint prompt {index}") for index, run in enumerate(runs)
        ))
        assert len({result["result"]["backend_metadata"]["thread_id"] for result in results}) == 10
        assert len({result["result"]["backend_metadata"]["turn_id"] for result in results}) == 10

        for index, (workspace_operations, run, pty) in enumerate(zip(operations, runs, ptys)):
            watch = workspace_operations.watch({"after_sequence": 0, "limit": 100})
            assert len(watch["events"]) == 1
            assert watch["events"][0]["workspace_id"] == workspace_operations.workspace_id
            assert watch["events"][0]["data"]["path"] == "owned.txt"
            events = engine.list_events(run["run_id"])
            assert events and all(event["run_id"] == run["run_id"] for event in events)
            assert any(event["type"] == "agent.message.delta" for event in events)
            manager, pty_id, marker = pty
            deadline = time.monotonic() + 10
            output = b""
            while time.monotonic() < deadline:
                attached = manager.pty_attach({"pty_id": pty_id, "after_offset": 0})
                output = b"".join(base64.b64decode(segment["content_base64"]) for segment in attached["segments"])
                if marker in output:
                    break
                await asyncio.sleep(0.05)
            assert marker in output
            assert all(f"PTY_{other}".encode() not in output for other in range(10) if other != index)
    finally:
        for operation in operations:
            operation.close()
        await service.close()


@pytest.mark.anyio
async def test_runtime_restart_recovery_converges_completed_and_in_progress_deterministically(tmp_path: Path):
    workspace = tmp_path / "recovery-workspace"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / "recovery-registry.sqlite3")
    record = registry.open_workspace(str(workspace))
    identity = RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id)
    engine = RuntimeEngine(
        tmp_path / "recovery-runtime.sqlite3", identity,
        lambda value: registry.get_workspace(value) is not None,
    )
    session = engine.create_session(record.workspace_id, "recovery")
    completed_run, _ = engine.create_run(session["session_id"], "codex@1", "recover-completed", "codex")
    interrupted_run, _ = engine.create_run(session["session_id"], "codex@1", "recover-in-progress", "codex")
    cancelled_run, _ = engine.create_run(session["session_id"], "codex@1", "recover-cancel-requested", "codex")
    engine.transition_run(completed_run["run_id"], "running")
    engine.transition_run(interrupted_run["run_id"], "running")
    engine.transition_run(cancelled_run["run_id"], "running")
    engine.mark_cancel_requested(cancelled_run["run_id"])
    bindings = AgentBackendBindingStore(tmp_path / "recovery-bindings.sqlite3")
    bindings.bind_session(
        session_id=session["session_id"], workspace_id=record.workspace_id, backend_id="codex",
        agent_backend_runtime_id=identity.runtime_id, workspace_runtime_id=identity.runtime_id,
        backend_session_id="thread-persisted", backend_version="0.142.5",
    )
    bindings.bind_run(
        run_id=completed_run["run_id"], session_id=session["session_id"], workspace_id=record.workspace_id,
        backend_id="codex", agent_backend_runtime_id=identity.runtime_id, workspace_runtime_id=identity.runtime_id,
        backend_run_id="turn-completed", generation=1, status="running",
    )
    bindings.bind_run(
        run_id=interrupted_run["run_id"], session_id=session["session_id"], workspace_id=record.workspace_id,
        backend_id="codex", agent_backend_runtime_id=identity.runtime_id, workspace_runtime_id=identity.runtime_id,
        backend_run_id="turn-in-progress", generation=1, status="running",
    )
    bindings.bind_run(
        run_id=cancelled_run["run_id"], session_id=session["session_id"], workspace_id=record.workspace_id,
        backend_id="codex", agent_backend_runtime_id=identity.runtime_id, workspace_runtime_id=identity.runtime_id,
        backend_run_id="turn-cancel-requested", generation=1, status="running",
    )

    restarted_engine = RuntimeEngine(engine.database, identity, engine.workspace_exists)
    rpc = FakeRPC()
    rpc._generation = 2
    recovered = CodexAgentBackendClient(rpc, AgentBackendBindingStore(bindings.database), runtime_state=restarted_engine)
    rpc.read_turns = [{"id": "turn-completed", "status": "completed"}]
    await recovered.recover_turn(completed_run["run_id"])
    assert restarted_engine.get_run(completed_run["run_id"])["status"] == "completed"
    assert recovered.bindings.get_run(completed_run["run_id"]).status == "completed"

    rpc.read_turns = [{"id": "turn-in-progress", "status": "inProgress"}]
    await recovered.recover_turn(interrupted_run["run_id"])
    assert restarted_engine.get_run(interrupted_run["run_id"])["status"] == "failed"
    assert recovered.bindings.get_run(interrupted_run["run_id"]).status == "backend_interrupted"
    recovery_events = restarted_engine.list_events(interrupted_run["run_id"])
    assert any(event["type"] == "agent.recovered" and
               event["data"]["policy"] == "fail_backend_interrupted" for event in recovery_events)

    call_offset = len(rpc.calls)
    rpc.read_turns = [{"id": "turn-cancel-requested", "status": "interrupted"}]
    await recovered.recover_turn(cancelled_run["run_id"])
    recovery_calls = rpc.calls[call_offset:]
    assert [method for method, _ in recovery_calls] == ["thread/resume", "turn/interrupt", "thread/read"]
    assert restarted_engine.get_run(cancelled_run["run_id"])["status"] == "cancelled"
