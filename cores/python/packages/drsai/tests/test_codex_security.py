from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Mapping

import pytest

from drsai.backend.runtime.agent_bindings import AgentBackendBindingStore
from drsai.backend.runtime.agent import RuntimeRunContext
from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.security import CodexAccountManager, CodexApprovalBridge
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


@pytest.fixture
def anyio_backend():
    return "asyncio"


class SecurityRPC:
    def __init__(self):
        self.handlers = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.responses: dict[str, Any] = {}

    def handle_server_request(self, method, handler):
        self.handlers[method] = handler

    async def request(self, method: str, params: Mapping[str, Any]):
        self.calls.append((method, dict(params)))
        value = self.responses.get(method, {})
        return value(dict(params)) if callable(value) else value


def _fixture(tmp_path: Path, permissions=frozenset({"process:execute", "workspace:write", "permissions:grant"})):
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda value: registry.get_workspace(value) is not None,
    )
    session = engine.create_session(record.workspace_id, "security")
    run, _ = engine.create_run(session["session_id"], "codex@1", "security-run", "codex")
    engine.transition_run(run["run_id"], "running")
    bindings = AgentBackendBindingStore(tmp_path / "bindings.sqlite3")
    bindings.bind_session(
        session_id=session["session_id"], workspace_id=record.workspace_id, backend_id="codex",
        agent_backend_runtime_id=registry.identity.runtime_id, workspace_runtime_id=registry.identity.runtime_id,
        backend_session_id="thread-security", backend_version="0.142.5",
    )
    bindings.bind_run(
        run_id=run["run_id"], session_id=session["session_id"], workspace_id=record.workspace_id,
        backend_id="codex", agent_backend_runtime_id=registry.identity.runtime_id,
        workspace_runtime_id=registry.identity.runtime_id, backend_run_id="turn-security",
        generation=1, status="running",
    )
    context = RuntimeRunContext(
        runtime_id=registry.identity.runtime_id, instance_id=registry.identity.instance_id,
        workspace_id=record.workspace_id, workspace_path=workspace,
        session_id=session["session_id"], run_id=run["run_id"],
        agent_definition_id="codex", agent_definition_version="1", permissions=permissions,
        correlation_id="correlation-security",
    )
    rpc = SecurityRPC()
    bridge = CodexApprovalBridge(
        rpc, engine, bindings, timeout_seconds=0.2,
        audit_context=lambda _run_id: {"principal": "user-1", "correlation_id": "correlation-security"},
    )
    bridge.attach_context(context)
    return engine, bindings, context, rpc, bridge


async def _wait_pending(engine: RuntimeEngine):
    deadline = asyncio.get_running_loop().time() + 2
    while asyncio.get_running_loop().time() < deadline:
        pending = engine.list_pending_approvals()
        if pending:
            return pending[0]
        await asyncio.sleep(0.01)
    raise AssertionError("approval was not persisted")


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("method", "operation", "decision", "expected"),
    [
        ("item/commandExecution/requestApproval", "command", "accept", {"decision": "accept"}),
        ("item/fileChange/requestApproval", "file_change", "decline", {"decision": "decline"}),
    ],
)
async def test_permission_then_approval_bridge_resolves_server_request_once(
    tmp_path: Path, method: str, operation: str, decision: str, expected: dict[str, str],
):
    engine, _, context, rpc, bridge = _fixture(tmp_path)
    message = {"id": 77, "method": method, "params": {
        "threadId": "thread-security", "turnId": "turn-security", "itemId": "item-1",
        "reason": "needs approval", "apiKey": "SECRET-CANARY",
    }}
    task = asyncio.create_task(rpc.handlers[method](message))
    approval = await _wait_pending(engine)
    assert approval["request"]["operation"] == operation
    assert "SECRET-CANARY" not in json.dumps(approval)
    await bridge.respond(context.run_id, approval["approval_id"], decision)
    await bridge.respond(context.run_id, approval["approval_id"], decision)
    assert await task == expected
    assert engine.get_run(context.run_id)["status"] == "running"
    assert len([item for item in engine.list_events(context.run_id) if item["type"] == "audit.codex.approval.requested"]) == 1
    audit = next(item["data"] for item in engine.list_events(context.run_id)
                 if item["type"] == f"audit.codex.approval.{'approved' if decision == 'accept' else 'denied'}")
    for key in ("principal", "runtime_id", "workspace_id", "session_id", "run_id", "backend", "turn_id", "operation", "correlation_id"):
        assert audit.get(key)


@pytest.mark.anyio
async def test_permission_denial_happens_before_approval_creation(tmp_path: Path):
    engine, _, context, rpc, bridge = _fixture(tmp_path, permissions=frozenset())
    result = await rpc.handlers["item/commandExecution/requestApproval"]({
        "id": 1, "method": "item/commandExecution/requestApproval",
        "params": {"threadId": "thread-security", "turnId": "turn-security", "itemId": "denied"},
    })
    assert result == {"decision": "decline"}
    assert engine.list_pending_approvals() == []
    assert engine.get_run(context.run_id)["status"] == "running"
    event = next(item for item in engine.list_events(context.run_id)
                 if item["type"] == "audit.codex.approval.permission_denied")
    assert event["data"]["approval_created"] is False


@pytest.mark.anyio
async def test_permission_subset_session_scope_timeout_and_cancel(tmp_path: Path):
    engine, _, context, rpc, bridge = _fixture(tmp_path)
    method = "item/permissions/requestApproval"
    task = asyncio.create_task(rpc.handlers[method]({
        "id": 2, "method": method,
        "params": {"threadId": "thread-security", "turnId": "turn-security", "itemId": "permissions",
                   "permissions": [{"network": {"host": "example.com"}}]},
    }))
    approval = await _wait_pending(engine)
    await bridge.respond(context.run_id, approval["approval_id"], "acceptForSession")
    result = await task
    assert result["scope"] == "session" and len(result["permissions"]) == 1

    # Create another run for timeout because the first one resumed cleanly.
    timeout_engine, _, timeout_context, timeout_rpc, timeout_bridge = _fixture(tmp_path / "timeout-correct")
    timeout_bridge.timeout_seconds = 0.01
    timeout_result = await timeout_rpc.handlers["item/fileChange/requestApproval"]({
        "id": 3, "method": "item/fileChange/requestApproval",
        "params": {"threadId": "thread-security", "turnId": "turn-security", "itemId": "timeout"},
    })
    assert timeout_result == {"decision": "cancel"}
    assert timeout_engine.get_run(timeout_context.run_id)["status"] == "failed"


def test_restart_fails_orphaned_pending_approval_closed(tmp_path: Path):
    engine, _, context, _, bridge = _fixture(tmp_path)
    approval = engine.request_approval(context.run_id, {
        "backend": "codex", "backend_approval_key": "orphan", "method": "item/fileChange/requestApproval",
    })
    assert engine.get_run(context.run_id)["status"] == "waiting_approval"
    assert bridge.recover_orphaned_pending() == 1
    assert engine.get_approval(approval["approval_id"])["status"] == "timeout"
    assert engine.get_run(context.run_id)["status"] == "failed"
    assert bridge.recover_orphaned_pending() == 0


@pytest.mark.anyio
async def test_account_state_and_managed_login_actions_never_return_raw_credentials(tmp_path: Path):
    rpc = SecurityRPC()
    manager = CodexAccountManager(rpc)
    fixtures = [
        ({"account": None, "requiresOpenaiAuth": True}, False, None),
        ({"account": {"type": "chatgpt", "email": "user@example.com", "planType": "plus",
                      "accessToken": "SECRET"}, "requiresOpenaiAuth": True}, True, "chatgpt"),
        ({"account": {"type": "apiKey", "apiKey": "sk-secret"}, "requiresOpenaiAuth": True}, True, "apiKey"),
    ]
    for response, logged_in, mode in fixtures:
        rpc.responses["account/read"] = response
        status = await manager.status(refresh=True)
        assert status["logged_in"] is logged_in and status["auth_mode"] == mode
        assert "SECRET" not in str(status) and "sk-secret" not in str(status)
    rpc.responses["account/login/start"] = {
        "type": "chatgptDeviceCode", "loginId": "login-1", "verificationUrl": "https://auth.example",
        "userCode": "ABCD-1234", "accessToken": "must-not-return",
    }
    login = await manager.login_start("chatgptDeviceCode")
    assert "accessToken" not in login and login["userCode"] == "ABCD-1234"
    await manager.login_cancel("login-1")
    await manager.logout()
    assert [method for method, _ in rpc.calls[-2:]] == ["account/login/cancel", "account/logout"]
    rpc.responses["account/read"] = lambda _params: (_ for _ in ()).throw(
        RuntimeExecutionError("token_expired", "expired", retryable=True)
    )
    expired = await manager.status(refresh=True)
    assert expired["logged_in"] is False and expired["reason"] == "token_expired" and expired["retryable"] is True
