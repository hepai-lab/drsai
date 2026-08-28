import json
import math
import os
import shutil
import socket
import time
from pathlib import Path


HOME = Path("/tmp/opendrsai-runtime-performance")
ROOT = Path("/tmp/opendrsai-performance-workspaces")
SOAK_SECONDS = int(os.environ.get("OPENDRSAI_REMOTE_SOAK_SECONDS", "5"))
OUTPUT_PATH = os.environ.get("OPENDRSAI_REMOTE_PERFORMANCE_OUTPUT")
os.environ["DRSAI_HOME"] = str(HOME)
os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = "temporary-performance-token"
shutil.rmtree(HOME, ignore_errors=True)
shutil.rmtree(ROOT, ignore_errors=True)
ROOT.mkdir(parents=True)

from fastapi.testclient import TestClient
from drsai.backend import gateway


HEADERS = {"X-OpenDrSai-Gateway-Token": "temporary-performance-token"}


def request(client, method, path, expected=200, **kwargs):
    response = client.request(method, path, headers={**HEADERS, **kwargs.pop("headers", {})}, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response.json()


def p95(samples):
    ordered = sorted(samples)
    return ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]


workspace_paths = []
for index in range(100):
    path = ROOT / f"workspace-{index:03d}"
    path.mkdir()
    workspace_paths.append(path)

# A 100,000-file tree proves the first page is bounded instead of materializing
# the entire repository into one response.
large_root = workspace_paths[0]
for bucket in range(100):
    directory = large_root / f"bucket-{bucket:03d}"
    directory.mkdir()
    for index in range(1000):
        (directory / f"file-{index:04d}.txt").touch()

handshake_ms = []
workspace_open_ms = []
event_display_ms = []
reconnect_successes = 0

with TestClient(gateway.app) as client:
    for _ in range(30):
        started = time.perf_counter()
        payload = request(client, "POST", "/v1/remote/handshake", json={"protocol_version": 1, "client_version": "acceptance", "workspace_path": str(large_root)})
        handshake_ms.append((time.perf_counter() - started) * 1000)
        assert payload["protocol_version"] == 1 and payload["runtime_id"]

    workspaces = []
    for path in workspace_paths:
        started = time.perf_counter()
        workspaces.append(request(client, "POST", "/v1/workspaces", json={"path": str(path)}))
        workspace_open_ms.append((time.perf_counter() - started) * 1000)
    assert len({item["workspace_id"] for item in workspaces}) == 100

    started = time.perf_counter()
    first_page = request(client, "GET", f"/v1/workspaces/{workspaces[0]['workspace_id']}/files?depth=5&max_entries=500")
    file_tree_ms = (time.perf_counter() - started) * 1000
    assert first_page["truncated"] and len(first_page["data"]) <= 500 and first_page["scan_limit"] <= 5000

    session = request(client, "POST", "/v1/sessions", json={"workspace_id": workspaces[1]["workspace_id"], "title": "performance"})
    run = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers={"Idempotency-Key": "performance-run"}, json={"agent_definition": "performance@1"})
    request(client, "POST", f"/v1/runs/{run['run_id']}/transition", json={"status": "running"})
    sequence = 1
    for index in range(100):
        started = time.perf_counter()
        request(client, "POST", f"/v1/runs/{run['run_id']}/events", json={"type": "model.delta", "data": {"index": index}})
        events = request(client, "GET", f"/v1/runs/{run['run_id']}/events?after_sequence={sequence}&limit=10")["data"]
        event_display_ms.append((time.perf_counter() - started) * 1000)
        assert events and events[-1]["data"]["index"] == index
        sequence = events[-1]["sequence"]

    durable_run_id = run["run_id"]
    durable_event_count = sequence

for _ in range(100):
    try:
        with TestClient(gateway.app) as client:
            identity = request(client, "GET", "/v1/runtime")
            restored = request(client, "GET", "/v1/workspaces")["data"]
            if identity["runtime_id"] and len(restored) == 100:
                reconnect_successes += 1
    except Exception:
        pass

time.sleep(SOAK_SECONDS)
with TestClient(gateway.app) as client:
    durable = request(client, "GET", f"/v1/runs/{durable_run_id}")
    durable_events = request(client, "GET", f"/v1/runs/{durable_run_id}/events?after_sequence=0&limit=1000")["data"]
    assert durable["status"] == "running" and len(durable_events) == durable_event_count

evidence = {
    "marker": "Real Runtime performance preflight passed.",
    "remote_hostname": socket.gethostname(),
    "workspace_count": 100,
    "file_count": 100000,
    "soak_seconds": SOAK_SECONDS,
    "handshake_p95_ms": round(p95(handshake_ms), 3),
    "workspace_open_p95_ms": round(p95(workspace_open_ms), 3),
    "event_display_p95_ms": round(p95(event_display_ms), 3),
    "file_tree_first_page_ms": round(file_tree_ms, 3),
    "reconnect_successes": reconnect_successes,
    "reconnect_attempts": 100,
    "durable_event_count": len(durable_events),
    "thresholds": {
        "handshake_p95_ms": 5000,
        "workspace_open_p95_ms": 3000,
        "event_display_p95_ms": 500,
        "file_tree_first_page_ms": 2000,
        "reconnect_success_rate": 0.99,
    },
}
assert evidence["handshake_p95_ms"] < 5000
assert evidence["workspace_open_p95_ms"] < 3000
assert evidence["event_display_p95_ms"] < 500
assert evidence["file_tree_first_page_ms"] < 2000
assert reconnect_successes / 100 >= 0.99
if OUTPUT_PATH:
    output_path = Path(OUTPUT_PATH)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.tmp")
    temporary_path.write_text(json.dumps(evidence), encoding="utf-8")
    temporary_path.replace(output_path)
print(json.dumps(evidence))
