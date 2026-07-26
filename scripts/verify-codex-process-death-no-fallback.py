"""Kill a real Windows Codex App Server inside Runtime routing and prove no fallback."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path

from drsai.backend.runtime.agent_bindings import AgentBackendBindingStore
from drsai.backend.runtime.agent import (
    AgentDefinitionStore,
    OpenDrSaiAgentBackend,
    RuntimeAgentService,
    RuntimeExecutionError,
    RuntimeToolDispatcher,
)
from drsai.backend.codex_adapter import (
    CodexAdapter,
    CodexAgentBackendClient,
    CodexAppServerProcess,
    CodexArtifactStore,
    CodexBinaryProvider,
    CodexJSONRPCClient,
    CodexRestartPolicy,
)
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry


async def verify() -> dict[str, object]:
    codex_bin = os.environ.get("CODEX_BIN")
    if not codex_bin or not Path(codex_bin).is_file():
        raise RuntimeError("CODEX_BIN must point to the real Windows npm codex.cmd")
    with tempfile.TemporaryDirectory(prefix="opendrsai-codex-death-") as directory:
        root = Path(directory)
        workspace = root / "workspace"
        workspace.mkdir()
        registry = RuntimeRegistry(root / "registry.sqlite3")
        workspace_record = registry.open_workspace(str(workspace))
        engine = RuntimeEngine(
            root / "runtime.sqlite3",
            RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
            lambda identity: registry.get_workspace(identity) is not None,
        )
        assets = root / "assets"
        definition_path = assets / "codex-real-death" / "1.json"
        definition_path.parent.mkdir(parents=True)
        definition_path.write_text(json.dumps({
            "id": "codex-real-death", "version": "1", "backend": "codex", "model": "gpt-5.4",
            "instructions": "Do not run; the process-death fixture stops before thread/start.", "permissions": [],
        }), encoding="utf-8")
        definitions = AgentDefinitionStore(assets)
        session = engine.create_session(workspace_record.workspace_id, "real process death")
        run, _ = engine.create_run(session["session_id"], "codex-real-death@1", "real-process-death", "codex")

        provider = CodexBinaryProvider(
            CodexArtifactStore(root / "unused-managed", {}), mode="development",
            environ={"CODEX_BIN": codex_bin},
        )
        supervisor = CodexAppServerProcess(
            provider, verify_binary=False, policy=CodexRestartPolicy(startup_grace=0.2),
        )
        rpc = CodexJSONRPCClient(supervisor, request_timeout=30)
        killed: dict[str, int] = {}

        def kill_before_thread(point: str) -> None:
            if point != "before_thread_request":
                return
            process = supervisor.process
            if process is None or process.returncode is not None:
                raise RuntimeError("Real Codex App Server was not alive before the death fixture")
            killed["pid"] = process.pid
            process.kill()
            raise RuntimeExecutionError(
                "codex_process_killed_fixture", "Real Codex App Server was terminated by the verification fixture.",
                retryable=True,
            )

        client = CodexAgentBackendClient(
            rpc, AgentBackendBindingStore(root / "bindings.sqlite3"), fault_injector=kill_before_thread,
        )
        open_calls: list[str] = []
        service = RuntimeAgentService(
            engine, registry, definitions, RuntimeToolDispatcher(engine),
            {
                "opendrsai": OpenDrSaiAgentBackend(
                    lambda prompt, *_: open_calls.append(prompt) or {"content": "FORBIDDEN FALLBACK", "done": True}
                ),
                "codex": CodexAdapter(client),
            },
        )
        observed_code = None
        try:
            await service.execute(run["run_id"], "must remain on Codex")
        except RuntimeExecutionError as exc:
            observed_code = exc.code
        await asyncio.sleep(0.2)
        process_exit = supervisor.process.returncode if supervisor.process else None
        stored = engine.get_run(run["run_id"])
        await service.close()
        assert observed_code == "codex_process_killed_fixture"
        assert open_calls == []
        assert stored["status"] == "failed"
        assert killed.get("pid") is not None and process_exit is not None
        return {
            "ok": True, "killed_pid": killed["pid"], "exit_code": process_exit,
            "runtime_run_status": stored["status"], "opendrsai_fallback_calls": len(open_calls),
            "codex_start_count": supervisor.start_count,
        }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(verify()), indent=2))
