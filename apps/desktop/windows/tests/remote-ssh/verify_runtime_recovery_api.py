import json
import os
import shutil
import socket
import threading
import time
from pathlib import Path


HOME = Path("/tmp/opendrsai-runtime-recovery")
os.environ["DRSAI_HOME"] = str(HOME)
os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = "temporary-m10-runtime-token"
os.environ["DRSAI_RUNTIME_CONTROLLED_MODEL"] = "1"
shutil.rmtree(HOME, ignore_errors=True)

definition = HOME / "assets" / "agents" / "recovery" / "1.json"
definition.parent.mkdir(parents=True, exist_ok=True)
definition.write_text(json.dumps({
    "id": "recovery", "version": "1", "backend": "opendrsai", "permissions": [],
    "controlled_plan": {"delay_seconds": 1.2, "content": "runtime-owned-completion"},
}), encoding="utf-8")

from fastapi.testclient import TestClient
from drsai.backend import gateway
from drsai.backend.remote_pty import manager as pty_manager


headers = {"X-OpenDrSai-Gateway-Token": "temporary-m10-runtime-token"}


def request(client, method, path, expected=200, **kwargs):
    response = client.request(method, path, headers={**headers, **kwargs.pop("headers", {})}, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response.json()


workspace_paths = []
for index in range(10):
    path = Path(f"/tmp/m10-workspace-{index}")
    shutil.rmtree(path, ignore_errors=True); path.mkdir()
    workspace_paths.append(path)

with TestClient(gateway.app) as desktop_before_disconnect:
    first_identity = request(desktop_before_disconnect, "GET", "/v1/runtime")
    workspaces = [request(desktop_before_disconnect, "POST", "/v1/workspaces", json={"path": str(path)}) for path in workspace_paths]
    # One Runtime owns N Workspace domains without crossing Session, watch or PTY state.
    isolated_sessions = []
    isolated_ptys = []
    for index, workspace in enumerate(workspaces):
        isolated = request(desktop_before_disconnect, "POST", "/v1/sessions", json={"workspace_id": workspace["workspace_id"], "title": f"isolated-{index}"})
        isolated_sessions.append(isolated)
        assert request(desktop_before_disconnect, "GET", f"/v1/sessions?workspace_id={workspace['workspace_id']}")["data"] == [isolated]
        gateway._workspace_watch_scan(workspace["workspace_id"], workspace_paths[index])
        (workspace_paths[index] / f"watch-{index}.txt").write_text(str(index), encoding="utf-8")
        journal = gateway._workspace_watch_scan(workspace["workspace_id"], workspace_paths[index])
        assert journal["events"][-1]["path"] == f"watch-{index}.txt"
        with desktop_before_disconnect.websocket_connect("/v1/pty") as websocket:
            websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"]})
            websocket.send_json({"type": "create", "workspaceId": workspace["workspace_id"], "cwd": ".", "cols": 80, "rows": 24})
            created = websocket.receive_json(); assert created["type"] == "created"
            isolated_ptys.append(created["id"])
            websocket.send_json({"type": "write", "id": created["id"], "data": f"printf ISO-{index}\\n"})
    time.sleep(0.5)
    assert set(gateway._workspace_watch_journals) == {workspace["workspace_id"] for workspace in workspaces}
    for index, pty_id in enumerate(isolated_ptys):
        pty = pty_manager.sessions[pty_id]
        assert pty.workspace_id == workspaces[index]["workspace_id"]
        assert f"ISO-{index}" in pty.buffer.decode("utf-8", "replace")
        assert all(f"ISO-{other}" not in pty.buffer.decode("utf-8", "replace") for other in range(10) if other != index)
        pty_manager.kill(pty_id)
    session = request(desktop_before_disconnect, "POST", "/v1/sessions", json={"workspace_id": workspaces[0]["workspace_id"], "title": "M10 detached Run"})
    run = request(desktop_before_disconnect, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers={"Idempotency-Key": "m10-detached"}, json={"agent_definition": "recovery@1"})

    failure = []
    def execute_without_desktop():
        try:
            gateway._runtime_agent_service().execute(run["run_id"], "continue after Desktop disconnect")
        except Exception as exc:
            failure.append(repr(exc))
    worker = threading.Thread(target=execute_without_desktop, daemon=True)
    worker.start()
    time.sleep(0.2)
# TestClient is now closed: the Runtime-owned worker must continue.
worker.join(timeout=10)
assert not worker.is_alive() and not failure, failure

with TestClient(gateway.app) as desktop_after_reconnect:
    completed = request(desktop_after_reconnect, "GET", f"/v1/runs/{run['run_id']}")
    detached_events = request(desktop_after_reconnect, "GET", f"/v1/runs/{run['run_id']}/events")["data"]
    assert completed["status"] == "completed" and any(event["type"] == "agent.completed" for event in detached_events)

    # Runtime process identity changes, stable runtime_id and all Workspace Registry associations survive.
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_tool_dispatcher_instance = None
    restarted_identity = request(desktop_after_reconnect, "GET", "/v1/runtime")
    restored = request(desktop_after_reconnect, "GET", "/v1/workspaces")["data"]
    assert restarted_identity["runtime_id"] == first_identity["runtime_id"]
    assert restarted_identity["instance_id"] != first_identity["instance_id"]
    assert {row["workspace_id"] for row in restored} == {row["workspace_id"] for row in workspaces}

    # Response-loss idempotency: first result is discarded, retry through HTTP returns the same sole Run.
    retry_session = request(desktop_after_reconnect, "POST", "/v1/sessions", json={"workspace_id": workspaces[1]["workspace_id"], "title": "M10 retry"})
    lost, created = gateway._runtime_engine().create_run(retry_session["session_id"], "recovery@1", "m10-response-lost")
    assert created
    retried = request(desktop_after_reconnect, "POST", f"/v1/sessions/{retry_session['session_id']}/runs", headers={"Idempotency-Key": "m10-response-lost"}, json={"agent_definition": "recovery@1"})
    assert retried["run_id"] == lost["run_id"]

    # Overlapping and out-of-order reconnect queries deduplicate by event_id and converge without gaps.
    event_run = request(desktop_after_reconnect, "POST", f"/v1/sessions/{retry_session['session_id']}/runs", expected=201, headers={"Idempotency-Key": "m10-events"}, json={"agent_definition": "recovery@1"})
    request(desktop_after_reconnect, "POST", f"/v1/runs/{event_run['run_id']}/transition", json={"status": "running"})
    for index in range(40):
        request(desktop_after_reconnect, "POST", f"/v1/runs/{event_run['run_id']}/events", json={"type": "model.delta", "data": {"index": index}})
    canonical = request(desktop_after_reconnect, "GET", f"/v1/runs/{event_run['run_id']}/events?after_sequence=0&limit=2000")["data"]
    received = {}
    pending = {}
    contiguous_sequence = 0
    for cursor in (0, 0, 5, 3, 17, 12, 30, 20, 40):
        page = request(desktop_after_reconnect, "GET", f"/v1/runs/{event_run['run_id']}/events?after_sequence={cursor}&limit=9")["data"]
        for event in page:
            received[event["event_id"]] = event
            pending[event["sequence"]] = event
        while contiguous_sequence + 1 in pending:
            contiguous_sequence += 1
    # Resume from the highest contiguous sequence, never from the highest observed
    # sequence: out-of-order pages may have left a gap below it.
    for event in request(desktop_after_reconnect, "GET", f"/v1/runs/{event_run['run_id']}/events?after_sequence={contiguous_sequence}&limit=2000")["data"]:
        received[event["event_id"]] = event
        pending[event["sequence"]] = event
    while contiguous_sequence + 1 in pending:
        contiguous_sequence += 1
    ordered = sorted(received.values(), key=lambda event: event["sequence"])
    assert [event["event_id"] for event in ordered] == [event["event_id"] for event in canonical]
    assert [event["sequence"] for event in ordered] == list(range(1, len(canonical) + 1))
    assert contiguous_sequence == len(canonical)

    # PTY survives WebSocket interruption, reattaches with buffer and accepts more input.
    with desktop_after_reconnect.websocket_connect("/v1/pty") as websocket:
        websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"]})
        websocket.send_json({"type": "create", "workspaceId": workspaces[2]["workspace_id"], "cwd": ".", "cols": 80, "rows": 24})
        created_message = websocket.receive_json(); assert created_message["type"] == "created"
        pty_id = created_message["id"]
        websocket.send_json({"type": "write", "id": pty_id, "data": "printf BEFORE_DISCONNECT\n"})
        output = ""
        for _ in range(20):
            message = websocket.receive_json(); output += message.get("data", "")
            if "BEFORE_DISCONNECT" in output: break
        assert "BEFORE_DISCONNECT" in output
    pty_manager.write(pty_id, "printf AFTER_DISCONNECT\n")
    time.sleep(0.4)
    with desktop_after_reconnect.websocket_connect("/v1/pty") as websocket:
        websocket.send_json({"type": "auth", "token": headers["X-OpenDrSai-Gateway-Token"]})
        websocket.send_json({"type": "attach", "id": pty_id})
        attached = websocket.receive_json(); assert attached["type"] == "attached"
        assert "BEFORE_DISCONNECT" in attached["buffer"] and "AFTER_DISCONNECT" in attached["buffer"]
        websocket.send_json({"type": "write", "id": pty_id, "data": "printf AFTER_REATTACH\n"})
        output = ""
        for _ in range(20):
            message = websocket.receive_json(); output += message.get("data", "")
            if "AFTER_REATTACH" in output: break
        assert "AFTER_REATTACH" in output
        websocket.send_json({"type": "kill", "id": pty_id})
        while websocket.receive_json().get("type") != "killed": pass

print(json.dumps({
    "marker": "Real Runtime Recovery API verification passed.",
    "remote_hostname": socket.gethostname(),
    "workspace_count": len(restored),
    "detached_run_id": run["run_id"],
    "event_count": len(canonical),
    "first_instance_id": first_identity["instance_id"],
    "restarted_instance_id": restarted_identity["instance_id"],
}))
