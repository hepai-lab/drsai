"""Real TCP/HTTP P2 resource benchmark for the remote healthy-network gate.

This intentionally uses the production FastAPI application through an Uvicorn
loopback socket.  It therefore measures the same JSON, authentication, OWOP
dispatch and HTTP transport path used through a healthy SSH tunnel instead of
FastAPI's in-process TestClient.
"""

from __future__ import annotations

import json
import http.client
import os
import socket
import tempfile
import threading
import time
from pathlib import Path
from uuid import uuid4

import uvicorn


def p95(samples: list[float]) -> float:
    return sorted(samples)[max(0, int(len(samples) * 0.95) - 1)]


def _reset_gateway(gateway, home: Path) -> None:
    gateway._WORKSPACE = home / "workspace-state"
    gateway._DATASET = gateway._WORKSPACE / "drsai"
    gateway._DATASET.mkdir(parents=True, exist_ok=True)
    gateway._DB_URI = f"sqlite:///{gateway._DATASET}/drsai.db"
    gateway._db_manager = None
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_security_instance = None
    gateway._runtime_agent_service_instance = None
    gateway._runtime_tool_dispatcher_instance = None
    gateway._runtime_artifact_store_instance = None
    gateway._owop_protocol_instance = None
    gateway._local_workspace_owop_instances.clear()
    gateway._resource_service_instances.clear()
    gateway._remote_workspaces.clear()


def _free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        candidate.bind(("127.0.0.1", 0))
        return int(candidate.getsockname()[1])


def benchmark() -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="drsai-resource-http-perf-") as raw:
        root = Path(raw)
        home, workspace = root / "home", root / "workspace"
        workspace.mkdir()
        for index in range(100):
            (workspace / f"resource-{index}.txt").write_text(f"resource-{index}\n", encoding="utf-8")

        token = "remote-resource-performance-gate-token"
        os.environ["DRSAI_HOME"] = str(home)
        os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN"] = token
        os.environ["OPENDRSAI_RESOURCE_AUDIT_SALT"] = "remote-performance-gate-audit-salt"

        from drsai.backend import gateway
        _reset_gateway(gateway, home)

        port = _free_loopback_port()
        server = uvicorn.Server(uvicorn.Config(
            gateway.app,
            host="127.0.0.1",
            port=port,
            log_level="error",
            access_log=False,
        ))
        thread = threading.Thread(target=server.run, name="p2-http-benchmark", daemon=True)
        thread.start()
        deadline = time.monotonic() + 15
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        if not server.started:
            server.should_exit = True
            thread.join(timeout=5)
            raise RuntimeError("benchmark_gateway_start_timeout")

        common_headers = {
            "Content-Type": "application/json",
            "X-OpenDrSai-Gateway-Token": token,
        }

        def post(path: str, payload: dict, *, session_id: str | None = None) -> dict:
            headers = dict(common_headers)
            if session_id:
                headers["X-OpenDrSai-Session-ID"] = session_id
            # HTTPConnection avoids environment proxy configuration while still
            # exercising a real kernel TCP socket and production HTTP server.
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            try:
                connection.request("POST", path, body=json.dumps(payload).encode("utf-8"), headers=headers)
                response = connection.getresponse()
                body = response.read()
                if response.status != 200:
                    raise AssertionError(f"HTTP {response.status}: {body.decode('utf-8', 'replace')}")
                return json.loads(body)
            finally:
                connection.close()

        try:
            opened = post("/v1/workspaces", {"path": str(workspace), "display_name": "P2 HTTP benchmark"})
            workspace_id = opened["workspace_id"]
            session_id = gateway._runtime_engine().create_session(workspace_id, "P2 HTTP benchmark")["session_id"]
            runtime_id = gateway._runtime_registry().identity.runtime_id

            def owop(operation: str, params: dict) -> dict:
                result = post("/v1/owop", {
                    "version": "1.0",
                    "request_id": str(uuid4()),
                    "correlation_id": str(uuid4()),
                    "workspace_id": workspace_id,
                    "operation": operation,
                    "params": params,
                    "binding": {"kind": "ssh", "endpoint": "127.0.0.1"},
                }, session_id=session_id)
                assert result.get("ok") is True, result.get("error")
                return result["result"]

            observations = []
            for index in range(100):
                file_resource = owop("files.register", {"path": f"resource-{index}.txt"})["resource"]
                registered = owop("resources.register", {
                    "authority_id": runtime_id,
                    "resource_type": "file",
                    "host_handle": f"file:{file_resource['file_id']}",
                    "idempotency_key": f"http-performance-{index}",
                })
                observations.append({
                    "association_id": f"association-{index}",
                    "resource": registered["resource"],
                    "observed_version_id": registered["version"]["version_id"],
                })

            # Warm the server and SQLite page cache before recording steady-state
            # healthy-network latency, as required by the P95 service objective.
            for _ in range(5):
                assert len(owop("resources.resolve_batch", {"observations": observations})["results"]) == 100

            samples = []
            for _ in range(25):
                started = time.perf_counter()
                result = owop("resources.resolve_batch", {"observations": observations})
                samples.append((time.perf_counter() - started) * 1000)
                assert len(result["results"]) == 100

            report = {
                "transport": "production uvicorn over loopback TCP/HTTP (SSH-equivalent OWOP binding)",
                "batch_items": 100,
                "recorded_requests": len(samples),
                "remote_healthy_network_p95_ms": round(p95(samples), 3),
                "remote_healthy_network_max_ms": round(max(samples), 3),
                "threshold_ms": 800,
            }
            assert report["remote_healthy_network_p95_ms"] <= report["threshold_ms"], json.dumps(report, sort_keys=True)
            return report
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            if thread.is_alive():
                raise RuntimeError("benchmark_gateway_shutdown_timeout")


if __name__ == "__main__":
    print(json.dumps(benchmark(), indent=2, sort_keys=True))
