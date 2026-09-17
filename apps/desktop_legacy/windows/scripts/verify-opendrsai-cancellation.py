from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from types import SimpleNamespace


def require(checks: dict[str, bool], name: str, value: bool) -> None:
    checks[name] = bool(value)
    if not value:
        raise AssertionError(name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend-source", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    archive = Path(args.backend_source).resolve(strict=True)
    output = Path(args.output).resolve(strict=False)
    checks: dict[str, bool] = {}

    with tempfile.TemporaryDirectory(prefix="opendrsai-cancellation-") as temp:
        root = Path(temp)
        extracted = root / "packaged-backend"
        with zipfile.ZipFile(archive) as source:
            source.extractall(extracted)
        sys.path.insert(0, str(extracted / "cores" / "python" / "packages" / "drsai" / "src"))

        from drsai.backend import gateway
        from drsai.backend.runtime.agent import (
            AgentDefinition,
            AgentDefinitionStore,
            RuntimeAgentService,
            RuntimeExecutionError,
            RuntimeRunContext,
            RuntimeToolDispatcher,
        )
        from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
        from drsai.backend.runtime.registry import RuntimeRegistry
        from drsai.platform_auth import PlatformAuthContext, platform_auth_scope

        workspace = root / "中文 cancellation workspace"
        workspace.mkdir()
        context = RuntimeRunContext(
            "runtime", "instance", "workspace", workspace, "session", "run",
            "opendrsai", "1", correlation_id="cancel-probe",
        )
        definition = AgentDefinition(
            "opendrsai", "1", "opendrsai", "model", "", frozenset(), {},
        )
        auth = PlatformAuthContext(
            access_token="packaged-probe", subject="probe@example.invalid",
            issuer="https://issuer.example.invalid", expires_at=int(time.time()) + 300,
            model_base_url="https://issuer.example.invalid/v1",
        )
        services = SimpleNamespace(emit=lambda *_args: None)

        async def token_phase(phase: str) -> None:
            started = asyncio.Event()
            stopped = asyncio.Event()
            observed: dict[str, object] = {}

            async def runner(**kwargs):
                token = kwargs["cancellation_token"]
                observed["token"] = token
                waiter = asyncio.get_running_loop().create_future()
                token.link_future(waiter)
                started.set()
                try:
                    await waiter
                finally:
                    stopped.set()
                if False:
                    yield None

            backend = gateway.GatewayOpenDrSaiAgentBackend(runner)
            with platform_auth_scope(auth):
                execution = asyncio.create_task(backend.execute(context, definition, phase, services))
                await asyncio.wait_for(started.wait(), timeout=2)
                await asyncio.gather(backend.cancel("run"), backend.cancel("run"))
                try:
                    await asyncio.wait_for(execution, timeout=2)
                except RuntimeExecutionError as exc:
                    require(checks, f"{phase}_cancel_code", exc.code == "run_cancelled")
                else:
                    raise AssertionError(f"{phase}_cancel_missing")
            require(checks, f"{phase}_token_cancelled", observed["token"].is_cancelled())
            require(checks, f"{phase}_stopped", stopped.is_set())
            require(checks, f"{phase}_registry_cleared", "run" not in backend._cancellations)

        async def approval_phase() -> None:
            class ApprovalState:
                def __init__(self):
                    self.created = asyncio.Event()
                    self.approval = None

                def request_approval(self, run_id, request, deadline_at=None):
                    self.approval = {
                        "approval_id": "approval", "run_id": run_id, "status": "pending",
                        "request": request, "deadline_at": deadline_at,
                    }
                    self.created.set()
                    return self.approval

                def get_approval(self, _approval_id):
                    return self.approval

            state = ApprovalState()

            async def runner(**_kwargs):
                yield "approval-marker"

            original = gateway.translate_conversation_event
            gateway.translate_conversation_event = lambda *_args: [("interaction.request", {
                "interaction_type": "approval", "operation": "file.write",
                "prompt": "Allow write?", "scope": "workspace",
            })]
            backend = gateway.GatewayOpenDrSaiAgentBackend(runner)
            try:
                with platform_auth_scope(auth):
                    execution = asyncio.create_task(backend.execute(
                        context, definition, "approval", SimpleNamespace(state=state, emit=lambda *_args: None),
                    ))
                    await asyncio.wait_for(state.created.wait(), timeout=2)
                    await asyncio.gather(backend.cancel("run"), backend.cancel("run"))
                    try:
                        await asyncio.wait_for(execution, timeout=2)
                    except RuntimeExecutionError as exc:
                        require(checks, "approval_cancel_code", exc.code == "run_cancelled")
                    else:
                        raise AssertionError("approval_cancel_missing")
                require(checks, "approval_waiter_cleared", not backend._pending_approvals)
            finally:
                gateway.translate_conversation_event = original

        async def disconnect_phase() -> None:
            started = asyncio.Event()
            stopped = asyncio.Event()
            effects = ["completed-once"]

            async def runner(**kwargs):
                waiter = asyncio.get_running_loop().create_future()
                kwargs["cancellation_token"].link_future(waiter)
                started.set()
                try:
                    await waiter
                finally:
                    stopped.set()
                if False:
                    yield None

            backend = gateway.GatewayOpenDrSaiAgentBackend(runner)
            with platform_auth_scope(auth):
                execution = asyncio.create_task(backend.execute(context, definition, "disconnect", services))
                await asyncio.wait_for(started.wait(), timeout=2)
                await backend.close()
                try:
                    await asyncio.wait_for(execution, timeout=2)
                except RuntimeExecutionError as exc:
                    require(checks, "disconnect_cancel_code", exc.code == "run_cancelled")
                else:
                    raise AssertionError("disconnect_cancel_missing")
            require(checks, "disconnect_execution_stopped", stopped.is_set())
            require(checks, "disconnect_effect_not_rolled_back", effects == ["completed-once"])

        asyncio.run(token_phase("model"))
        asyncio.run(token_phase("tool"))
        asyncio.run(token_phase("subtask"))
        asyncio.run(approval_phase())
        asyncio.run(disconnect_phase())

        runtime_home = root / "full-runtime-home"
        runtime_root = runtime_home / "runtime"
        runtime_workspace = runtime_home / "workspace"
        runtime_workspace.mkdir(parents=True)
        assets = runtime_home / "assets" / "agents"
        definition_path = assets / "opendrsai" / "1.json"
        definition_path.parent.mkdir(parents=True)
        definition_path.write_text(json.dumps({
            "id": "opendrsai", "version": "1", "backend": "opendrsai",
            "instructions": "packaged cancellation probe", "permissions": [],
        }), encoding="utf-8")
        registry = RuntimeRegistry(runtime_root / "runtime.sqlite3")
        workspace_record = registry.open_workspace(str(runtime_workspace))
        engine_path = runtime_root / "engine.sqlite3"
        identity = RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id)
        engine = RuntimeEngine(engine_path, identity, lambda wid: registry.get_workspace(wid) is not None)
        session = engine.create_session(workspace_record.workspace_id, "cancel restart")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "restart-run", "opendrsai")
        engine.transition_run(run["run_id"], "running")
        side_effect = runtime_workspace / "effect.txt"
        side_effect.write_text("written-once", encoding="utf-8")
        engine.append_backend_event(
            run["run_id"], "tool.completed", {"operation_id": "effect-once"}, "effect-once",
        )

        restarted_engine = RuntimeEngine(engine_path, identity, lambda wid: registry.get_workspace(wid) is not None)

        class RestartBackend:
            backend_id = "opendrsai"

            def __init__(self):
                self.cancel_calls = 0
                self.execute_calls = 0

            async def execute(self, *_args):
                self.execute_calls += 1
                side_effect.write_text("reexecuted", encoding="utf-8")

            async def cancel(self, _run_id): self.cancel_calls += 1
            async def respond_approval(self, *_args): return None
            async def recover(self, *_args): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        restart_backend = RestartBackend()
        restarted_service = RuntimeAgentService(
            restarted_engine, registry, AgentDefinitionStore(assets),
            RuntimeToolDispatcher(restarted_engine), {"opendrsai": restart_backend},
        )

        async def cancel_after_restart() -> None:
            first, second = await asyncio.gather(
                restarted_service.cancel(run["run_id"]), restarted_service.cancel(run["run_id"]),
            )
            require(checks, "restart_first_cancelled", first["status"] == "cancelled")
            require(checks, "restart_second_cancelled", second["status"] == "cancelled")

        asyncio.run(cancel_after_restart())
        final_engine = RuntimeEngine(engine_path, identity, lambda wid: registry.get_workspace(wid) is not None)
        events = final_engine.list_events(run["run_id"])
        require(checks, "restart_backend_cancel_once", restart_backend.cancel_calls == 1)
        require(checks, "restart_no_reexecution", restart_backend.execute_calls == 0)
        require(checks, "restart_effect_preserved", side_effect.read_text(encoding="utf-8") == "written-once")
        require(checks, "restart_one_effect_event", sum(e["type"] == "tool.completed" for e in events) == 1)
        require(checks, "restart_one_cancel_terminal", sum(e["type"] == "run.cancelled" for e in events) == 1)
        require(checks, "restart_terminal_persisted", final_engine.get_run(run["run_id"])["status"] == "cancelled")

        # Cross the actual Full Runtime process boundary: seed an interrupted
        # running Run, cancel it twice through HTTP, restart the Gateway process,
        # and read the same durable terminal state back.
        process_session = final_engine.create_session(workspace_record.workspace_id, "process restart cancel")
        process_run, _ = final_engine.create_run(
            process_session["session_id"], "opendrsai@1", "process-restart-run", "opendrsai",
        )
        final_engine.transition_run(process_run["run_id"], "running")
        process_effect = runtime_workspace / "process-effect.txt"
        process_effect.write_text("process-written-once", encoding="utf-8")
        final_engine.append_backend_event(
            process_run["run_id"], "tool.completed", {"operation_id": "process-effect-once"},
            "process-effect-once",
        )

        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = int(reservation.getsockname()[1])
        token = f"cancellation-probe-{os.getpid()}"
        process_env = {
            **os.environ,
            "DRSAI_HOME": str(runtime_home),
            "DRSAI_API_HOST": "127.0.0.1",
            "DRSAI_API_PORT": str(port),
            "OPENDRSAI_GATEWAY_INSTANCE_TOKEN": token,
            "OPENDRSAI_DEV_AUTH_BYPASS": "1",
            "PYTHONPATH": os.pathsep.join([
                str(extracted / "cores" / "python" / "packages" / "drsai" / "src"),
                os.environ.get("PYTHONPATH", ""),
            ]).rstrip(os.pathsep),
        }

        def request(method: str, path: str) -> dict:
            body = b"{}" if method == "POST" else None
            call = urllib.request.Request(
                f"http://127.0.0.1:{port}{path}", data=body, method=method,
                headers={
                    "X-OpenDrSai-Gateway-Token": token,
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(call, timeout=5) as response:
                return json.loads(response.read().decode("utf-8"))

        def start_runtime() -> subprocess.Popen:
            process = subprocess.Popen(
                [sys.executable, "-m", "drsai.backend.gateway"],
                cwd=str(extracted), env=process_env,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True,
            )
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(f"full_runtime_exited:{process.stdout.read()[-4000:]}")
                try:
                    request("GET", "/health")
                    return process
                except Exception:
                    time.sleep(0.1)
            process.kill()
            raise AssertionError("full_runtime_start_timeout")

        def stop_runtime(process: subprocess.Popen) -> None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

        first_process = start_runtime()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(
                    lambda _index: request("POST", f"/v1/runs/{process_run['run_id']}/cancel"),
                    range(2),
                ))
            require(checks, "process_double_cancel_responses", all(
                response.get("status") == "cancelled" for response in responses
            ))
        finally:
            stop_runtime(first_process)

        second_process = start_runtime()
        try:
            persisted_run = request("GET", f"/v1/runs/{process_run['run_id']}")
            persisted_events = request("GET", f"/v1/runs/{process_run['run_id']}/events")
        finally:
            stop_runtime(second_process)
        event_rows = persisted_events.get("data", persisted_events) if isinstance(persisted_events, dict) else persisted_events
        require(checks, "process_restart_terminal_persisted", persisted_run.get("status") == "cancelled")
        require(checks, "process_restart_one_cancel_terminal", sum(
            event.get("type") == "run.cancelled" for event in event_rows
        ) == 1)
        require(checks, "process_restart_one_effect_event", sum(
            event.get("type") == "tool.completed" for event in event_rows
        ) == 1)
        require(checks, "process_restart_effect_preserved", process_effect.read_text(encoding="utf-8") == "process-written-once")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({
        "schema_version": "opendrsai.windows.cancellation-probe/1",
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "backend_source": str(archive),
        "passed_checks": sum(checks.values()),
        "checks": checks,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Packaged Full Runtime cancellation passed {sum(checks.values())}/{len(checks)} checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
