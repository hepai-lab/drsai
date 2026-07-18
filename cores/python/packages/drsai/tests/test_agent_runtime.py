from __future__ import annotations

import asyncio
import importlib.util
import inspect
import json
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Mapping, Sequence


ROOT = Path(__file__).resolve().parents[1] / "src" / "drsai" / "backend"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


registry_module = load("m07_runtime_registry", "runtime_registry.py")
engine_module = load("m07_runtime_engine", "runtime_engine.py")
agent_module = load("m07_agent_runtime", "agent_runtime.py")

AgentDefinitionStore = agent_module.AgentDefinitionStore
AgentBackend = agent_module.AgentBackend
HAIModelAdapter = agent_module.HAIModelAdapter
ModelIdentity = agent_module.ModelIdentity
OpenDrSaiAgentBackend = agent_module.OpenDrSaiAgentBackend
RuntimeAgentService = agent_module.RuntimeAgentService
RuntimeExecutionError = agent_module.RuntimeExecutionError
RuntimeToolDispatcher = agent_module.RuntimeToolDispatcher
RuntimeRunContext = agent_module.RuntimeRunContext


class AgentRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.assets = self.root / "assets"
        self.registry = registry_module.RuntimeRegistry(self.root / "registry.sqlite3")
        self.workspace_record = self.registry.open_workspace(str(self.workspace))
        self.engine = engine_module.RuntimeEngine(
            self.root / "engine.sqlite3",
            engine_module.RuntimeEngineIdentity(self.registry.identity.runtime_id, self.registry.identity.instance_id),
            lambda workspace_id: self.registry.get_workspace(workspace_id) is not None,
        )
        self.store = AgentDefinitionStore(self.assets, allowed_backends=("opendrsai", "codex", "replacement"))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def definition(self, asset_id: str, version: str, permissions: list[str], *, backend: str = "opendrsai") -> str:
        path = self.assets / asset_id / f"{version}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "id": asset_id,
            "version": version,
            "backend": backend,
            "instructions": "test deterministically",
            "permissions": permissions,
        }), encoding="utf-8")
        return f"{asset_id}@{version}"

    def create_runtime_run(self, reference: str, key: str = "key") -> dict[str, Any]:
        session = self.engine.create_session(self.workspace_record.workspace_id, "M07")
        run, _ = self.engine.create_run(session["session_id"], reference, key, self.store.load(reference).backend)
        return run

    def service(self, backend: Any, dispatcher: Any | None = None, **backends: Any) -> Any:
        dispatcher = dispatcher or RuntimeToolDispatcher(self.engine)
        return RuntimeAgentService(
            self.engine,
            self.registry,
            self.store,
            dispatcher,
            {"opendrsai": backend, **backends},
        )

    @staticmethod
    def execute(service: Any, run_id: str, prompt: str, correlation_id: str | None = None) -> Any:
        return asyncio.run(service.execute(run_id, prompt, correlation_id))

    def test_backend_contract_is_replaceable_and_opendrsai_is_default(self) -> None:
        reference = self.definition("default", "1.0.0", [])

        class Replacement:
            backend_id = "replacement"

            async def execute(self, context, definition, prompt, services):
                services.emit(context, "replacement.completed", {"prompt": prompt})
                return {"replacement": True}

            async def cancel(self, run_id): return None
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        replacement_ref = self.definition("replacement", "7", [], backend="replacement")
        default = OpenDrSaiAgentBackend(lambda *_: {"content": "default-ok", "done": True})
        service = self.service(default, replacement=Replacement())
        default_result = self.execute(service, self.create_runtime_run(reference, "default-run")["run_id"], "hello")
        replacement_result = self.execute(service, self.create_runtime_run(replacement_ref, "replacement-run")["run_id"], "hello")
        self.assertEqual(default_result["result"]["content"], "default-ok")
        self.assertTrue(replacement_result["result"]["replacement"])

    def test_agent_backend_async_lifecycle_contract_and_close_idempotency(self) -> None:
        required = ("execute", "cancel", "respond_approval", "recover", "health", "close")
        for method in required:
            self.assertTrue(inspect.iscoroutinefunction(getattr(OpenDrSaiAgentBackend, method)))

        reference = self.definition("lifecycle", "1", [])
        backend = OpenDrSaiAgentBackend(lambda *_: {"content": "ok", "done": True})
        service = self.service(backend)
        run = self.create_runtime_run(reference, "lifecycle-cancel")
        cancelled = asyncio.run(service.cancel(run["run_id"]))
        self.assertEqual(cancelled["status"], "cancelled")

        recover_run = self.create_runtime_run(reference, "lifecycle-recover")
        asyncio.run(service.recover(recover_run["run_id"]))
        with self.assertRaises(RuntimeExecutionError) as caught:
            asyncio.run(service.respond_approval(recover_run["run_id"], "approval-1", "accept"))
        self.assertEqual(caught.exception.code, "approval_not_found")
        self.assertTrue(asyncio.run(service.health())["opendrsai"]["available"])
        asyncio.run(service.close())
        asyncio.run(service.close())
        self.assertFalse(asyncio.run(service.health())["opendrsai"]["available"])

    def test_opendrsai_run_waits_for_runtime_approval_and_resumes_once(self) -> None:
        reference = self.definition("approval", "1", ["shell.execute"])
        model = lambda *_: {
            "calls": [{"kind": "approval", "name": "shell.execute", "arguments": {
                "risk_summary": "Run a command", "scope": "workspace", "timeout_seconds": 5,
            }}],
            "content": "approved-complete", "done": True,
        }
        backend = OpenDrSaiAgentBackend(model)
        service = self.service(backend)
        run = self.create_runtime_run(reference, "approval-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(run["run_id"], "please continue"))
            for _ in range(100):
                pending = self.engine.list_pending_approvals(run["run_id"])
                if pending:
                    break
                await asyncio.sleep(0.01)
            self.assertEqual(len(pending), 1)
            approval_id = pending[0]["approval_id"]
            self.assertEqual(self.engine.get_run(run["run_id"])["status"], "waiting_approval")
            self.engine.resolve_approval(approval_id, "approved")
            await service.respond_approval(run["run_id"], approval_id, "approved")
            result = await execution
            self.assertEqual(result["run"]["status"], "completed")
            self.assertEqual(result["result"]["content"], "approved-complete")
            with self.assertRaises(RuntimeExecutionError) as repeated:
                await service.respond_approval(run["run_id"], approval_id, "approved")
            self.assertEqual(repeated.exception.code, "approval_not_found")

        asyncio.run(scenario())

    def test_unknown_backend_never_falls_back_to_default(self) -> None:
        reference = self.definition("codex-only", "1", [], backend="codex")
        calls: list[str] = []
        backend = OpenDrSaiAgentBackend(lambda *_: calls.append("opendrsai") or {"done": True})
        service = self.service(backend)
        run = self.create_runtime_run(reference, "codex-no-fallback")
        with self.assertRaises(RuntimeExecutionError) as caught:
            self.execute(service, run["run_id"], "must use codex")
        self.assertEqual(caught.exception.code, "agent_backend_not_found")
        self.assertEqual(calls, [])
        self.assertEqual(self.engine.get_run(run["run_id"])["status"], "queued")

    def test_run_context_is_authoritative_and_audited(self) -> None:
        reference = self.definition("context", "1", ["tool:probe"])
        seen: list[Any] = []

        def probe(context, arguments):
            seen.append(context)
            return {"ok": True}

        dispatcher = RuntimeToolDispatcher(self.engine, tools={"probe": probe})
        model = lambda *_: {"calls": [{"kind": "tool", "name": "probe", "arguments": {}}], "content": "ok", "done": True}
        run = self.create_runtime_run(reference)
        result = self.execute(self.service(OpenDrSaiAgentBackend(model), dispatcher), run["run_id"], "go")
        context = result["context"]
        self.assertEqual(
            [context[key] for key in ("runtime_id", "workspace_id", "session_id", "run_id")],
            [self.registry.identity.runtime_id, self.workspace_record.workspace_id, run["session_id"], run["run_id"]],
        )
        completed = next(event for event in self.engine.list_events(run["run_id"]) if event["type"] == "tool.completed")
        for key in ("runtime_id", "workspace_id", "session_id", "run_id"):
            self.assertEqual(completed["data"][key], context[key])
        self.assertEqual(context["agent_backend_runtime_id"], context["runtime_id"])
        self.assertEqual(context["workspace_runtime_id"], context["runtime_id"])
        with self.assertRaisesRegex(RuntimeExecutionError, "cannot override") as caught:
            dispatcher.dispatch(seen[0], "tool", "probe", {"runtime_id": "forged"})
        self.assertEqual(caught.exception.code, "run_context_override_rejected")

    def test_run_context_rejects_distributed_backend_for_local_phase(self) -> None:
        with self.assertRaises(RuntimeExecutionError) as caught:
            RuntimeRunContext(
                runtime_id="runtime-local",
                instance_id="instance-1",
                workspace_id="workspace-1",
                workspace_path=self.workspace,
                session_id="session-1",
                run_id="run-1",
                agent_definition_id="agent",
                agent_definition_version="1",
                agent_backend_runtime_id="runtime-local",
                workspace_runtime_id="runtime-remote",
            )
        self.assertEqual(caught.exception.code, "distributed_backend_not_supported")

    def test_agent_definition_requires_exact_installed_version(self) -> None:
        self.definition("pinned", "1", [])
        self.definition("pinned", "2", [])
        self.assertEqual(self.store.load("pinned@1").version, "1")
        self.assertEqual(self.store.load("pinned@2").version, "2")
        for reference in ("pinned", "pinned@latest", "pinned@3"):
            with self.subTest(reference=reference), self.assertRaises(RuntimeExecutionError):
                self.store.load(reference)

        latest = self.assets / "pinned" / "latest.json"
        latest.write_text(json.dumps({
            "id": "pinned", "version": "latest", "backend": "opendrsai", "permissions": []
        }), encoding="utf-8")
        with self.assertRaises(RuntimeExecutionError) as caught:
            self.store.load("pinned@latest")
        self.assertEqual(caught.exception.code, "agent_definition_version_required")

        unknown = self.assets / "unknown" / "1.json"
        unknown.parent.mkdir(parents=True)
        unknown.write_text(json.dumps({
            "id": "unknown", "version": "1", "backend": "unregistered", "permissions": []
        }), encoding="utf-8")
        with self.assertRaises(RuntimeExecutionError) as caught:
            self.store.load("unknown@1")
        self.assertEqual(caught.exception.code, "agent_backend_invalid")

        tampered = self.assets / "pinned" / "tampered.json"
        tampered.write_text(json.dumps({
            "id": "other", "version": "tampered", "backend": "opendrsai", "permissions": []
        }), encoding="utf-8")
        with self.assertRaises(RuntimeExecutionError) as caught:
            self.store.load("pinned@tampered")
        self.assertEqual(caught.exception.code, "agent_definition_invalid")

    def test_tool_skill_and_mcp_are_runtime_dispatched(self) -> None:
        reference = self.definition("dispatch", "1", ["tool:probe", "skill:review", "mcp:catalog"])
        invocations: list[tuple[str, str, str]] = []

        def handler(kind):
            def invoke(context, arguments):
                invocations.append((kind, socket.gethostname(), str(context.workspace_path)))
                return {"kind": kind, "hostname": socket.gethostname(), "cwd": str(context.workspace_path)}
            return invoke

        dispatcher = RuntimeToolDispatcher(
            self.engine,
            tools={"probe": handler("tool")},
            skills={"review": handler("skill")},
            mcp_servers={"catalog": handler("mcp")},
        )
        model = lambda *_: {
            "calls": [
                {"kind": "tool", "name": "probe", "arguments": {}},
                {"kind": "skill", "name": "review", "arguments": {}},
                {"kind": "mcp", "name": "catalog", "arguments": {}},
            ],
            "content": "dispatched",
            "done": True,
        }
        service = self.service(OpenDrSaiAgentBackend(model), dispatcher)
        self.execute(service, self.create_runtime_run(reference)["run_id"], "go")
        self.assertEqual([item[0] for item in invocations], ["tool", "skill", "mcp"])
        self.assertTrue(all(item[1] == socket.gethostname() and item[2] == str(self.workspace) for item in invocations))

    def test_subagent_inherits_parent_workspace_permissions_and_correlation(self) -> None:
        parent_ref = self.definition("parent", "1", ["tool:*", "skill:review"])
        child_ref = self.definition("child", "2", ["tool:*", "mcp:*"])

        def model(prompt, definition, context, history):
            if context.parent_run_id:
                self.assertEqual(context.workspace_id, self.workspace_record.workspace_id)
                self.assertEqual(context.permissions, frozenset({"tool:*"}))
                return {"content": "child", "done": True}
            if not history:
                return {"calls": [{"kind": "subagent", "name": child_ref, "arguments": {"prompt": "child task"}}], "done": False}
            return {"content": "parent", "done": True}

        run = self.create_runtime_run(parent_ref)
        self.execute(self.service(OpenDrSaiAgentBackend(model)), run["run_id"], "parent task")
        events = self.engine.list_events(run["run_id"])
        started = next(event for event in events if event["type"] == "subagent.started")
        completed = next(event for event in events if event["type"] == "subagent.completed")
        self.assertEqual(completed["data"]["child_run_id"], started["data"]["child_run_id"])
        self.assertEqual(completed["data"]["child_parent_run_id"], run["run_id"])

        escape_model = lambda *_: {
            "calls": [{"kind": "subagent", "name": child_ref, "arguments": {"workspace_id": "workspace-forged"}}],
            "done": True,
        }
        with self.assertRaises(RuntimeExecutionError) as caught:
            service = self.service(OpenDrSaiAgentBackend(escape_model))
            self.execute(service, self.create_runtime_run(parent_ref, "escape")["run_id"], "escape")
        self.assertEqual(caught.exception.code, "workspace_escape_rejected")

    def test_shell_process_and_test_commands_execute_in_workspace(self) -> None:
        reference = self.definition("commands", "1", ["shell:*", "process:*", "test:*"])
        marker = self.workspace / "remote-runtime-marker.txt"
        commands = []
        for kind in ("shell", "process", "test"):
            code = (
                "from pathlib import Path; import os, socket; "
                f"Path({str(marker)!r}).write_text(socket.gethostname()+'|'+os.getcwd(), encoding='utf-8'); "
                "print(socket.gethostname()); print(os.getcwd())"
            )
            commands.append({"kind": kind, "name": "python", "arguments": {"command": [sys.executable, "-c", code]}})
        model = lambda *_: {"calls": commands, "content": "commands-complete", "done": True}
        run = self.create_runtime_run(reference)
        self.execute(self.service(OpenDrSaiAgentBackend(model)), run["run_id"], "go")
        host, cwd = marker.read_text(encoding="utf-8").split("|", 1)
        self.assertEqual(host, socket.gethostname())
        self.assertEqual(Path(cwd), self.workspace)
        tool_events = [event for event in self.engine.list_events(run["run_id"]) if event["type"] == "tool.completed"]
        self.assertEqual([event["data"]["kind"] for event in tool_events], ["shell", "process", "test"])
        with self.assertRaises(RuntimeExecutionError) as caught:
            RuntimeToolDispatcher(self.engine).dispatch(
                self.service_context(run, reference), "shell", "python", {"command": [sys.executable, "-V"], "cwd": ".."}
            )
        self.assertEqual(caught.exception.code, "workspace_escape_rejected")

        mixed = self.workspace / "nested" / "child"
        mixed.mkdir(parents=True)
        context = self.service_context(run, reference)
        self.assertEqual(RuntimeToolDispatcher._cwd(context, r"nested\child"), mixed)
        for forbidden in (r"C:\Windows", r"\\server\share", "/etc", r"nested\..\.."):
            with self.subTest(path=forbidden), self.assertRaises(RuntimeExecutionError) as caught:
                RuntimeToolDispatcher._cwd(context, forbidden)
            self.assertIn(caught.exception.code, {"workspace_absolute_path_rejected", "workspace_escape_rejected"})

    def service_context(self, run: Mapping[str, Any], reference: str):
        service = self.service(OpenDrSaiAgentBackend(lambda *_: {"done": True}))
        return service._context(run, self.store.load(reference))

    def test_hai_identity_and_provider_failures_map_to_runtime_errors(self) -> None:
        reference = self.definition("hai", "1", [])
        definition = self.store.load(reference)
        context = self.service_context(self.create_runtime_run(reference), reference)
        valid = HAIModelAdapter(
            lambda *_: {"content": "ok", "done": True},
            ModelIdentity("user-1", int(time.time()) + 60),
            lambda exc: {},
        )
        self.assertEqual(valid("hello", definition, context, ())["content"], "ok")
        cases = [
            (None, None, "model_unauthorized"),
            (ModelIdentity("user-1", int(time.time()) - 1), None, "token_expired"),
            (ModelIdentity("user-1", int(time.time()) + 60), ("model_unauthorized", False), "model_unauthorized"),
            (ModelIdentity("user-1", int(time.time()) + 60), ("quota_exceeded", True), "quota_exceeded"),
            (ModelIdentity("user-1", int(time.time()) + 60), ("upstream_unavailable", True), "upstream_unavailable"),
        ]
        for identity, mapped, expected in cases:
            with self.subTest(expected=expected):
                def fail(*_args):
                    raise ValueError("provider-secret-canary")
                classifier = (lambda _exc, value=mapped: {"code": value[0], "message": "safe", "retryable": value[1]}) if mapped else None
                adapter = HAIModelAdapter(fail, identity, classifier)
                with self.assertRaises(RuntimeExecutionError) as caught:
                    adapter("hello", definition, context, ())
                self.assertEqual(caught.exception.code, expected)
                self.assertNotIn("provider-secret-canary", str(caught.exception.as_dict()))


if __name__ == "__main__":
    unittest.main()
