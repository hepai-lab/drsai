import os
import json
import shutil
from pathlib import Path

os.environ["DRSAI_HOME"] = "/tmp/opendrsai-runtime-engine"
os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = "temporary-engine-token"
shutil.rmtree(os.environ["DRSAI_HOME"], ignore_errors=True)
definition_path = Path(os.environ["DRSAI_HOME"]) / "assets" / "agents" / "agent" / "v1.json"
definition_path.parent.mkdir(parents=True, exist_ok=True)
definition_path.write_text(json.dumps({
    "id": "agent", "version": "v1", "backend": "opendrsai",
    "instructions": "runtime engine acceptance", "permissions": [],
    "controlled_plan": {"content": "engine fixture"},
}), encoding="utf-8")

from fastapi.testclient import TestClient
from drsai.backend import gateway


headers = {"X-OpenDrSai-Gateway-Token": "temporary-engine-token"}


def request(client, method, path, expected=200, **kwargs):
    response = client.request(method, path, headers={**headers, **kwargs.pop("headers", {})}, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response.json()


with TestClient(gateway.app) as client:
    workspace = request(client, "POST", "/v1/workspaces", json={"path": "/home/vscode/workspace"})
    request(client, "POST", "/v1/sessions", expected=404, json={"workspace_id": "missing", "title": "Missing"})
    session = request(client, "POST", "/v1/sessions", json={"workspace_id": workspace["workspace_id"], "title": "Engine E2E"})
    listed = request(client, "GET", f"/v1/sessions?workspace_id={workspace['workspace_id']}&limit=1")
    assert listed["total"] == 1 and listed["data"][0]["session_id"] == session["session_id"]
    archived = request(client, "PATCH", f"/v1/sessions/{session['session_id']}", json={"title": "Renamed", "archived": True})
    assert archived["title"] == "Renamed" and archived["archived"]
    request(client, "PATCH", f"/v1/sessions/{session['session_id']}", json={"archived": False})

    run_headers = {"Idempotency-Key": "runtime-engine-e2e"}
    run = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers=run_headers, json={"agent_definition": "agent@v1"})
    repeated = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", headers=run_headers, json={"agent_definition": "agent@v1"})
    assert repeated["run_id"] == run["run_id"]
    request(client, "POST", f"/v1/runs/{run['run_id']}/transition", json={"status": "running"})
    for index in range(20):
        request(client, "POST", f"/v1/runs/{run['run_id']}/events", json={"type": "tool.output", "data": {"index": index}})
    resumed = request(client, "GET", f"/v1/runs/{run['run_id']}/events?after_sequence=10")
    assert resumed["data"][0]["sequence"] == 11 and all(left["sequence"] < right["sequence"] for left, right in zip(resumed["data"], resumed["data"][1:]))
    cursor = 0
    replayed = []
    for _ in range(20):
        page = request(client, "GET", f"/v1/runs/{run['run_id']}/events?after_sequence={cursor}&limit=1")["data"]
        assert page and page[0]["sequence"] == cursor + 1
        replayed.extend(page); cursor = page[-1]["sequence"]
    tail = request(client, "GET", f"/v1/runs/{run['run_id']}/events?after_sequence={cursor}")["data"]
    replayed.extend(tail)
    assert [event["sequence"] for event in replayed] == list(range(1, len(replayed) + 1))
    checkpoint = request(client, "POST", f"/v1/runs/{run['run_id']}/checkpoint", json={"state": {"agent": {"step": 2}, "tools": {"shell": "done"}, "subagents": [{"id": "child"}]}})
    assert request(client, "GET", f"/v1/runs/{run['run_id']}/checkpoint")["checkpoint_id"] == checkpoint["checkpoint_id"]

    approval = request(client, "POST", f"/v1/runs/{run['run_id']}/approvals", json={"request": {"tool": "shell"}})
    request(client, "POST", f"/v1/approvals/{approval['approval_id']}/decision", json={"decision": "approved"})
    assert request(client, "POST", f"/v1/runs/{run['run_id']}/cancel")["status"] == "cancelled"

    for decision, expected in (("denied", "cancelled"), ("timeout", "failed")):
        extra = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers={"Idempotency-Key": f"approval-{decision}"}, json={"agent_definition": "agent@v1"})
        request(client, "POST", f"/v1/runs/{extra['run_id']}/transition", json={"status": "running"})
        pending = request(client, "POST", f"/v1/runs/{extra['run_id']}/approvals", json={"request": {"tool": "shell"}})
        request(client, "POST", f"/v1/approvals/{pending['approval_id']}/decision", json={"decision": decision})
        assert request(client, "GET", f"/v1/runs/{extra['run_id']}")["status"] == expected

gateway._runtime_engine_instance = None
with TestClient(gateway.app) as restarted:
    persisted = request(restarted, "GET", f"/v1/runs/{run['run_id']}")
    restored_checkpoint = request(restarted, "GET", f"/v1/runs/{run['run_id']}/checkpoint")
    assert persisted["status"] == "cancelled" and restored_checkpoint["state"]["subagents"][0]["id"] == "child"

print("Real Runtime Engine API verification passed.")
