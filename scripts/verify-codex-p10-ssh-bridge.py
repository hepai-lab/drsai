"""P10 controlled Linux SSH-tunnel/Bridge/OAEP equivalence acceptance."""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from drsai.backend.codex_adapter.bridge_transport import RemoteCodexSupervisor, issue_bridge_token
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext, RuntimeToolDispatcher
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "apps/desktop/windows/tests/remote-ssh/Dockerfile.codex-p10"
FIXTURE = ROOT / "apps/desktop/windows/tests/remote-ssh/fake_codex_app_server.py"
ARTIFACT = ROOT / ".artifacts/codex-p10/ssh-bridge.json"


def checked(*args: str, timeout: int = 600, capture: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
                            capture_output=capture, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(args[:3])}\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")
    return result


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode()).hexdigest()


def thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): thaw(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [thaw(item) for item in value]
    return getattr(value, "value", value)


_VOLATILE_IDENTITY_KEYS = {
    "runtime_id", "agent_backend_runtime_id", "workspace_runtime_id", "instance_id",
    "workspace_id", "session_id", "run_id", "parent_run_id", "correlation_id",
}


def canonicalize_oaep(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): canonicalize_oaep(item) for key, item in value.items()
                if str(key) not in _VOLATILE_IDENTITY_KEYS}
    if isinstance(value, list):
        return [canonicalize_oaep(item) for item in value]
    return value


def oaep_projection(messages: list[dict[str, Any]]) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="opendrsai-p10-oaep-") as temporary:
        root = Path(temporary)
        workspace = root / "workspace"
        workspace.mkdir()
        registry = RuntimeRegistry(root / "registry.sqlite3")
        record = registry.open_workspace(str(workspace))
        engine = RuntimeEngine(root / "runtime.sqlite3", RuntimeEngineIdentity(
            registry.identity.runtime_id, registry.identity.instance_id,
        ), lambda identity: registry.get_workspace(identity) is not None)
        session = engine.create_session(record.workspace_id, "P10 transport equivalence")
        run, _ = engine.create_run(session["session_id"], "codex@1", "P10 transport equivalence", "codex")
        engine.transition_run(run["run_id"], "running")
        context = RuntimeRunContext(
            runtime_id=registry.identity.runtime_id, instance_id=registry.identity.instance_id,
            workspace_id=record.workspace_id, workspace_path=workspace,
            session_id=session["session_id"], run_id=run["run_id"],
            agent_definition_id="codex", agent_definition_version="1",
        )
        services = AgentExecutionServices(engine, RuntimeToolDispatcher(engine), None)
        mapper = CodexEventMapper(batch_bytes=1, max_buffer_bytes=64 * 1024)
        for message in messages:
            mapper.handle(context, services, message)
        mapper.flush_run(context, services)
        if any(message.get("method") == "turn/completed" for message in messages):
            engine.transition_run(run["run_id"], "completed")
        snapshot = engine.oaep_snapshot(session["session_id"])
        projection = {
            "items": [{
                "type": item.get("type"), "status": item.get("status"),
                "phase": item.get("phase"), "content": canonicalize_oaep(thaw(item.get("content", {}))),
            } for item in snapshot.get("items", [])],
            "runStatuses": [row.get("status") for row in snapshot.get("runs", [])],
        }
        return projection


async def exchange(port: int, token: str) -> dict[str, Any]:
    supervisor = RemoteCodexSupervisor(f"tcp://127.0.0.1:{port}", token)
    process = await supervisor.start()
    try:
        request = {"id": 1, "method": "turn/start", "params": {"threadId": "p10-linux-thread", "input": []}}
        process.stdin.write((json.dumps(request, separators=(",", ":")) + "\n").encode())
        await process.stdin.drain()
        events: list[dict[str, Any]] = []
        while True:
            message = json.loads(await asyncio.wait_for(process.stdout.readline(), timeout=20))
            if message.get("id") == 1:
                turn_result = message
                break
            events.append(message)
        process.stdin.write((json.dumps({"id": 2, "method": "thread/read", "params": {
            "threadId": "p10-linux-thread"}}, separators=(",", ":")) + "\n").encode())
        await process.stdin.drain()
        history = json.loads(await asyncio.wait_for(process.stdout.readline(), timeout=20))
        process.stdin.write((json.dumps({"id": 3, "method": "model/list", "params": {}},
                                        separators=(",", ":")) + "\n").encode())
        await process.stdin.drain()
        error = json.loads(await asyncio.wait_for(process.stdout.readline(), timeout=20))
        return {"identity": process.identity, "events": events, "turn": turn_result,
                "history": history, "error": error}
    finally:
        await supervisor.close()


def main() -> None:
    if not shutil.which("docker") or not shutil.which("ssh") or not shutil.which("ssh-keygen"):
        raise RuntimeError("docker, ssh and ssh-keygen are required for P10 remote acceptance")
    checked("docker", "version", "--format", "{{.Server.Version}}", timeout=30)
    run_id = uuid.uuid4().hex[:12]
    image = f"opendrsai-codex-p10:{run_id}"
    container = f"opendrsai-codex-p10-{run_id}"
    ssh_port, tunnel_port = free_port(), free_port()
    token = issue_bridge_token(lifetime_seconds=900)
    tunnel: subprocess.Popen[str] | None = None
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="opendrsai-p10-ssh-") as temporary:
        key = Path(temporary) / "id_ed25519"
        try:
            checked("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C",
                    f"opendrsai-p10:{run_id}", "-f", str(key), timeout=30)
            public_key = key.with_suffix(".pub").read_text(encoding="utf-8").strip()
            checked("docker", "build", "-f", str(DOCKERFILE), "--build-arg",
                    f"OPENDRSAI_TEMPORARY_AUTHORIZED_KEY={public_key}", "-t", image, str(ROOT), timeout=900)
            checked("docker", "run", "-d", "--name", container,
                    "--label", "ai.opendrsai.purpose=temporary-p10-acceptance",
                    "-p", f"127.0.0.1:{ssh_port}:22", image, timeout=60)
            checked("docker", "exec", "-d", "-e", f"OPENDRSAI_CODEX_BRIDGE_TOKEN={token}",
                    "-e", "DRSAI_CODEX_DEVELOPMENT=1", "-e", "CODEX_BIN=/usr/local/bin/codex-p10-fixture",
                    container, "sh", "-c",
                    "python3 -m drsai.backend.codex_adapter.bridge_server "
                    "--host 127.0.0.1 --port 18643 --state-root /tmp/drsai-p10 "
                    ">/tmp/opendrsai-codex-bridge.log 2>&1")
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                probe = subprocess.run(["docker", "exec", container, "python3", "-c",
                    "import socket;s=socket.create_connection(('127.0.0.1',18643),1);s.close()"],
                    capture_output=True, timeout=5)
                if probe.returncode == 0:
                    break
                time.sleep(0.2)
            else:
                raise RuntimeError("Linux loopback Bridge did not become ready")
            tunnel = subprocess.Popen(["ssh", "-N", "-T", "-i", str(key), "-p", str(ssh_port),
                "-L", f"127.0.0.1:{tunnel_port}:127.0.0.1:18643", "-o", "BatchMode=yes",
                "-o", "StrictHostKeyChecking=no", "-o", f"UserKnownHostsFile={Path(temporary) / 'known_hosts'}",
                "-o", "ExitOnForwardFailure=yes", "vscode@127.0.0.1"],
                cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if tunnel.poll() is not None:
                    raise RuntimeError(f"SSH tunnel exited early: {tunnel.stderr.read()[-2000:]}")
                try:
                    with socket.create_connection(("127.0.0.1", tunnel_port), timeout=0.2):
                        break
                except OSError:
                    time.sleep(0.2)
            try:
                remote = asyncio.run(exchange(tunnel_port, token))
            except Exception as exc:
                logs = subprocess.run(
                    ["docker", "logs", container], cwd=ROOT, text=True,
                    encoding="utf-8", errors="replace", capture_output=True, timeout=30,
                )
                bridge_logs = subprocess.run(
                    ["docker", "exec", container, "sh", "-c",
                     "cat /tmp/opendrsai-codex-bridge.log 2>/dev/null || true"],
                    cwd=ROOT, text=True, encoding="utf-8", errors="replace",
                    capture_output=True, timeout=30,
                )
                diagnostic = (
                    f"Bridge:\n{bridge_logs.stdout}\n{bridge_logs.stderr}\n"
                    f"Container:\n{logs.stdout}\n{logs.stderr}"
                ).strip()[-8000:]
                raise RuntimeError(
                    f"Linux Codex Bridge exchange failed: {type(exc).__name__}: {exc}\n"
                    f"Container logs:\n{diagnostic or '<empty>'}"
                ) from exc
            spec = importlib.util.spec_from_file_location("p10_fake_codex", FIXTURE)
            assert spec is not None and spec.loader is not None
            fixture_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(fixture_module)
            local_events = list(fixture_module.EVENTS)
            # The expected stream is independently fixed here so a transport
            # response cannot bless itself merely by being internally stable.
            expected_methods = ["turn/started", "item/started", "item/started",
                "item/commandExecution/outputDelta", "item/completed", "item/completed",
                "item/started", "item/started", "item/agentMessage/delta", "item/completed", "turn/completed"]
            assert [event.get("method") for event in remote["events"]] == expected_methods
            assert remote["turn"]["result"]["turn"]["status"] == "completed"
            assert remote["history"]["result"]["thread"]["turns"][0]["items"][-1]["text"] == "P10 remote final."
            assert remote["error"]["error"]["code"] == -32001
            remote_projection = oaep_projection(remote["events"])
            local_projection = oaep_projection(local_events)
            remote_digest = digest(remote_projection)
            local_digest = digest(local_projection)
            if remote_digest != local_digest:
                raise AssertionError(json.dumps({"remote": remote_projection, "local": local_projection},
                                                ensure_ascii=False, sort_keys=True))
            result = {
                "schema": "opendrsai.codex-adapter-p10.ssh-bridge.v1", "passed": True,
                "transport": "windows-ssh-local-port-forward-to-linux-loopback-bridge",
                "linux": True, "sshTunnel": True, "bridgeLoopbackOnly": True,
                "codexFixture": True, "eventCount": len(remote["events"]),
                "approvalObserved": any(event.get("params", {}).get("item", {}).get("type") == "hookPrompt" for event in remote["events"]),
                "historyObserved": True, "errorObserved": True, "finalObserved": True,
                "oaepSemanticDigest": remote_digest,
                "localSemanticDigest": local_digest,
                "hostId": remote["identity"].get("hostId"),
                "adapterProtocol": remote["identity"].get("adapterProtocol"),
                "durationMs": round((time.monotonic() - started) * 1000),
                "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
            ARTIFACT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(result))
        finally:
            if tunnel is not None and tunnel.poll() is None:
                tunnel.terminate()
                try:
                    tunnel.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    tunnel.kill()
            subprocess.run(["docker", "rm", "-f", container], cwd=ROOT, capture_output=True)
            subprocess.run(["docker", "image", "rm", "-f", image], cwd=ROOT, capture_output=True)


if __name__ == "__main__":
    main()
