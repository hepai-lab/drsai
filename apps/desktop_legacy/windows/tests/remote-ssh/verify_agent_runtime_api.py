import json
import os
import shutil
import socket
from pathlib import Path


HOME = Path("/tmp/opendrsai-agent-runtime")
os.environ["DRSAI_HOME"] = str(HOME)
os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = "temporary-agent-runtime-token"
os.environ["DRSAI_RUNTIME_CONTROLLED_MODEL"] = "1"
shutil.rmtree(HOME, ignore_errors=True)


def write_definition(asset_id, version, permissions, plan):
    path = HOME / "assets" / "agents" / asset_id / f"{version}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "id": asset_id,
        "version": version,
        "backend": "opendrsai",
        "instructions": "controlled remote acceptance",
        "permissions": permissions,
        "controlled_plan": plan,
    }), encoding="utf-8")


marker = "/home/vscode/workspace/.opendrsai-m07-remote-marker"
probe_code = (
    "from pathlib import Path; import os,socket; "
    f"Path({marker!r}).write_text(socket.gethostname()+'|'+os.getcwd(),encoding='utf-8'); "
    "print(socket.gethostname()+'|'+os.getcwd())"
)
write_definition("child", "1", ["tool:probe"], {"content": "child-complete"})
write_definition("remote-agent", "1", [
    "shell:python", "process:python", "test:python", "tool:probe", "skill:review", "mcp:catalog"
], {
    "calls": [
        {"kind": "tool", "name": "probe", "arguments": {}},
        {"kind": "skill", "name": "review", "arguments": {}},
        {"kind": "mcp", "name": "catalog", "arguments": {}},
        {"kind": "shell", "name": "python", "arguments": {"command": ["python3", "-c", probe_code]}},
        {"kind": "process", "name": "python", "arguments": {"command": ["python3", "-c", "import socket; print(socket.gethostname())"]}},
        {"kind": "test", "name": "python", "arguments": {"command": ["python3", "-c", "import os; print(os.getcwd())"]}},
        {"kind": "subagent", "name": "child@1", "arguments": {"prompt": "inherit context"}},
    ],
    "final_content": "remote-agent-complete",
})
write_definition("forged", "1", ["tool:probe"], {
    "calls": [{"kind": "tool", "name": "probe", "arguments": {"runtime_id": "forged-runtime"}}]
})
write_definition("escape", "1", [], {
    "calls": [{"kind": "subagent", "name": "child@1", "arguments": {"workspace_id": "forged-workspace"}}]
})

from fastapi.testclient import TestClient
from drsai.backend import gateway
from drsai.backend.runtime.agent import RuntimeToolDispatcher


def runtime_probe(kind):
    def invoke(context, _arguments):
        return {"kind": kind, "hostname": socket.gethostname(), "cwd": str(context.workspace_path)}
    return invoke


gateway._runtime_tool_dispatcher_instance = RuntimeToolDispatcher(
    gateway._runtime_engine(),
    tools={"probe": runtime_probe("tool")},
    skills={"review": runtime_probe("skill")},
    mcp_servers={"catalog": runtime_probe("mcp")},
)

headers = {"X-OpenDrSai-Gateway-Token": "temporary-agent-runtime-token"}


def request(client, method, path, expected=200, **kwargs):
    response = client.request(method, path, headers={**headers, **kwargs.pop("headers", {})}, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response.json()


with TestClient(gateway.app) as client:
    capabilities = request(client, "GET", "/v1/capabilities")
    assert capabilities["capability_versions"]["agent-backend"] == 1
    assert capabilities["agent_backends"]["opendrsai"]["available"] is True
    codex_health = capabilities["agent_backends"]["codex"]
    assert codex_health["backend_id"] == "codex"
    assert codex_health["available"] is False
    assert isinstance(codex_health.get("reason"), str) and codex_health["reason"]
    workspace = request(client, "POST", "/v1/workspaces", json={"path": "/home/vscode/workspace"})
    session = request(client, "POST", "/v1/sessions", json={"workspace_id": workspace["workspace_id"], "title": "M07 E2E"})

    def new_run(reference, key, target_session=None):
        selected_session = target_session or session
        return request(
            client, "POST", f"/v1/sessions/{selected_session['session_id']}/runs", expected=201,
            headers={"Idempotency-Key": key}, json={"agent_definition": reference},
        )

    run = new_run("remote-agent@1", "m07-real")
    correlation_id = "correlation-m11-agent-runtime"
    execution = request(client, "POST", f"/v1/runs/{run['run_id']}/execute", headers={"X-Correlation-ID": correlation_id}, json={"prompt": "execute remotely"})
    assert execution["run"]["status"] == "completed"
    assert execution["result"]["content"] == "remote-agent-complete"
    assert execution["context"]["runtime_id"].startswith("runtime-")
    assert execution["context"]["workspace_id"] == workspace["workspace_id"]
    assert execution["context"]["session_id"] == session["session_id"]
    assert execution["context"]["run_id"] == run["run_id"]
    assert execution["context"]["correlation_id"] == correlation_id

    events = request(client, "GET", f"/v1/runs/{run['run_id']}/events")["data"]
    completed = [event for event in events if event["type"] == "tool.completed"]
    assert [event["data"]["kind"] for event in completed] == ["tool", "skill", "mcp", "shell", "process", "test"]
    for event in completed:
        for key in ("runtime_id", "workspace_id", "session_id", "run_id"):
            assert event["data"][key] == execution["context"][key]
        assert event["data"]["correlation_id"] == correlation_id
    assert any(event["type"] == "subagent.completed" and event["data"]["child_parent_run_id"] == run["run_id"] for event in events)

    request(client, "POST", f"/v1/runs/{run['run_id']}/events", json={"type": "diagnostic.probe", "data": {"correlation_id": correlation_id, "message": "password=temporary-diagnostic-canary"}})
    diagnostics = request(client, "GET", f"/v1/runs/{run['run_id']}/diagnostics")
    assert diagnostics["secret_scan"] == "passed"
    assert correlation_id in diagnostics["trace"]["correlation_ids"]
    assert diagnostics["metrics"]["event_count"] >= len(events)
    serialized_diagnostics = json.dumps(diagnostics)
    assert "temporary-diagnostic-canary" not in serialized_diagnostics
    assert "[REDACTED]" in serialized_diagnostics

    host, cwd = Path(marker).read_text(encoding="utf-8").split("|", 1)
    assert host == socket.gethostname()
    assert cwd == "/home/vscode/workspace"

    forged_session = request(client, "POST", "/v1/sessions", json={"workspace_id": workspace["workspace_id"], "title": "M07 forged"})
    forged = new_run("forged@1", "m07-forged", forged_session)
    failure = request(client, "POST", f"/v1/runs/{forged['run_id']}/execute", expected=409, json={"prompt": "forge"})
    error = failure.get("detail", failure.get("error", failure))
    assert error["code"] == "run_context_override_rejected", failure
    escape_session = request(client, "POST", "/v1/sessions", json={"workspace_id": workspace["workspace_id"], "title": "M07 escape"})
    escape = new_run("escape@1", "m07-escape", escape_session)
    failure = request(client, "POST", f"/v1/runs/{escape['run_id']}/execute", expected=409, json={"prompt": "escape"})
    error = failure.get("detail", failure.get("error", failure))
    assert error["code"] == "workspace_escape_rejected", failure

print(json.dumps({
    "marker": "Real Agent Runtime API verification passed.",
    "remote_hostname": socket.gethostname(),
    "remote_cwd": cwd,
    "runtime_id": execution["context"]["runtime_id"],
    "workspace_id": workspace["workspace_id"],
    "run_id": run["run_id"],
}))
