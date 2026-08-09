from __future__ import annotations

import asyncio
import importlib.util
import inspect
import json
import socket
import sys
import tempfile
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from typing import Any, Mapping, Sequence

from drsai.config import load_config_snapshot


ROOT = Path(__file__).resolve().parents[1] / "src" / "drsai" / "backend"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


registry_module = load("m07_runtime_registry", "runtime/registry.py")
engine_module = load("m07_runtime_engine", "runtime/engine.py")
agent_module = load("m07_agent_runtime", "runtime/agent.py")

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

    def definition(self, asset_id: str, version: str, permissions: list[str], *, backend: str = "opendrsai", model: str | None = None) -> str:
        path = self.assets / asset_id / f"{version}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "id": asset_id,
            "version": version,
            "backend": backend,
            "model": model,
            "instructions": "test deterministically",
            "permissions": permissions,
        }), encoding="utf-8")
        return f"{asset_id}@{version}"

    def test_execution_model_override_reaches_backend_without_mutating_asset(self) -> None:
        reference = self.definition("model-override", "1", [], model="configured-default")
        observed: list[str | None] = []

        class CapturingBackend:
            backend_id = "opendrsai"

            async def execute(self, context, definition, prompt, services):
                observed.append(definition.model)
                return {"content": prompt}

            async def cancel(self, run_id): return None
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        service = self.service(CapturingBackend())
        first = self.create_runtime_run(reference, "model-override-run")
        asyncio.run(service.execute(
            first["run_id"],
            "hello",
            model_override="selected-model",
            model_evidence={"model": {
                "id": "selected-model",
                "provider": "hepai",
                "revision_digest": "sha256:model-config-revision",
            }},
        ))
        second = self.create_runtime_run(reference, "model-default-run")
        asyncio.run(service.execute(second["run_id"], "hello"))
        self.assertEqual(observed, ["selected-model", "configured-default"])
        self.assertEqual(self.store.load(reference).model, "configured-default")
        manifest = self.engine.get_run_manifest(first["run_id"], safe=False)["manifest"]
        self.assertEqual(manifest["model"]["id"], "selected-model")
        self.assertEqual(manifest["model"]["provider"], "hepai")
        self.assertEqual(manifest["model"]["revision_digest"], "sha256:model-config-revision")

    def test_input_resource_override_is_request_scoped_for_preprocessed_images(self) -> None:
        reference = self.definition("resource-override", "1", [])
        observed: list[tuple[Mapping[str, Any], ...]] = []

        class CapturingBackend:
            backend_id = "opendrsai"

            async def execute(self, context, definition, prompt, services):
                observed.append(context.input_resources)
                return {"content": prompt}

            async def cancel(self, run_id): return None
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        service = self.service(CapturingBackend())
        run = self.create_runtime_run(reference, "resource-override-run")
        retained = ({"resource_id": "notes", "kind": "file", "reference": "notes.txt"},)
        asyncio.run(service.execute(run["run_id"], "hello", input_resources_override=retained))
        self.assertEqual(observed, [retained])

    def test_reasoning_effort_is_request_scoped_and_does_not_mutate_definition(self) -> None:
        reference = self.definition("reasoning-override", "1", [], model="reasoning-model")
        observed: list[str | None] = []

        class CapturingBackend:
            backend_id = "opendrsai"

            async def execute(self, context, definition, prompt, services):
                observed.append(definition.reasoning_effort)
                return {"content": prompt}

            async def cancel(self, run_id): return None
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        service = self.service(CapturingBackend())
        first = self.create_runtime_run(reference, "reasoning-high")
        asyncio.run(service.execute(first["run_id"], "hello", reasoning_effort="high"))
        second = self.create_runtime_run(reference, "reasoning-default")
        asyncio.run(service.execute(second["run_id"], "hello"))
        self.assertEqual(observed, ["high", None])
        self.assertIsNone(self.store.load(reference).reasoning_effort)

    def test_effective_model_binding_is_request_scoped(self) -> None:
        reference = self.definition("provider-binding", "1", [], model="asset-default")
        observed: list[tuple[str | None, str | None, str | None, str | None]] = []

        class CapturingBackend:
            backend_id = "opendrsai"

            async def execute(self, context, definition, prompt, services):
                observed.append((
                    definition.model_provider, definition.model_id,
                    definition.model_config_revision, definition.model_catalog_revision,
                ))
                return {"content": prompt}

            async def cancel(self, run_id): return None
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        service = self.service(CapturingBackend())
        first = self.create_runtime_run(reference, "provider-binding-run")
        asyncio.run(service.execute(
            first["run_id"], "hello", model_override="upstream",
            model_provider="provider-b", model_id="canonical",
            model_config_revision="config-r1", model_catalog_revision="catalog-r1",
        ))
        second = self.create_runtime_run(reference, "provider-binding-default")
        asyncio.run(service.execute(second["run_id"], "hello"))
        self.assertEqual(observed, [
            ("provider-b", "canonical", "config-r1", "catalog-r1"),
            (None, None, None, None),
        ])

    def test_running_run_keeps_snapshot_and_next_run_uses_committed_model(self) -> None:
        reference = self.definition("model-snapshot", "1", [], model="asset-default")
        config_path = self.root / "config.toml"
        config_path.write_text('model = "model-a"\nmodel_provider = "hepai"\n', encoding="utf-8")
        first_snapshot = load_config_snapshot(path=config_path)
        entered = threading.Event()
        release = threading.Event()
        observed: list[str | None] = []

        class BlockingBackend:
            backend_id = "opendrsai"

            async def execute(self, context, definition, prompt, services):
                observed.append(definition.model)
                if len(observed) == 1:
                    entered.set()
                    await asyncio.to_thread(release.wait, 5)
                return {"content": prompt}

            async def cancel(self, run_id): return None
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        service = self.service(BlockingBackend())
        first = self.create_runtime_run(reference, "snapshot-run-a")
        first_thread = threading.Thread(target=lambda: asyncio.run(service.execute(
            first["run_id"], "first", model_override=first_snapshot.config.model,
            model_evidence={"model": {"id": first_snapshot.config.model, "provider": "hepai", "revision_digest": first_snapshot.revision}},
        )))
        first_thread.start()
        self.assertTrue(entered.wait(5), "first Run did not enter the backend")
        # This legacy fixture validates immutable Run evidence, not the removed
        # global model-selection write API. Simulate the next configuration
        # revision directly; production model edits now go through Agent policy.
        config_path.write_text('model = "model-b"\nmodel_provider = "hepai"\n', encoding="utf-8")
        second_snapshot = load_config_snapshot(path=config_path)
        release.set(); first_thread.join(5)
        self.assertFalse(first_thread.is_alive())

        second = self.create_runtime_run(reference, "snapshot-run-b")
        asyncio.run(service.execute(
            second["run_id"], "second", model_override=second_snapshot.config.model,
            model_evidence={"model": {"id": second_snapshot.config.model, "provider": "hepai", "revision_digest": second_snapshot.revision}},
        ))
        self.assertEqual(observed, ["model-a", "model-b"])
        self.assertNotEqual(second_snapshot.revision, first_snapshot.revision)
        first_manifest = self.engine.get_run_manifest(first["run_id"], safe=False)["manifest"]["model"]
        second_manifest = self.engine.get_run_manifest(second["run_id"], safe=False)["manifest"]["model"]
        self.assertEqual((first_manifest["id"], first_manifest["revision_digest"]), ("model-a", first_snapshot.revision))
        self.assertEqual((second_manifest["id"], second_manifest["revision_digest"]), ("model-b", second_snapshot.revision))

    def test_pure_tool_replay_uses_historical_result_without_calling_handler(self) -> None:
        reference = self.definition("pure-replay", "1", ["tool:calculator"])
        run = self.create_runtime_run(reference, "pure-replay-run")
        calls: list[dict[str, Any]] = []

        def calculator(_context: Any, arguments: Mapping[str, Any]) -> Mapping[str, Any]:
            calls.append(dict(arguments))
            return {"value": 999}

        dispatcher = RuntimeToolDispatcher(self.engine, tools={"calculator": calculator})
        dispatcher.install_replay_results(run["run_id"], [{
            "kind": "tool", "name": "calculator", "arguments": {"value": 2},
            "result": {"value": 4}, "source_event_id": "event-pure-source",
        }])
        context = RuntimeRunContext(
            runtime_id=self.registry.identity.runtime_id,
            instance_id=self.registry.identity.instance_id,
            workspace_id=self.workspace_record.workspace_id,
            workspace_path=self.workspace,
            session_id=run["session_id"], run_id=run["run_id"],
            agent_definition_id="pure-replay", agent_definition_version="1",
            permissions=frozenset({"tool:calculator"}),
        )
        result = dispatcher.dispatch(context, "tool", "calculator", {"value": 2})
        self.assertEqual(result["value"], 4)
        self.assertEqual(calls, [])
        events = self.engine.list_events(run["run_id"])
        completed = next(event for event in events if event["type"] == "tool.completed")
        self.assertEqual(completed["data"]["reused_from_event_id"], "event-pure-source")

        dispatcher.install_replay_results(run["run_id"], [{
            "kind": "tool", "name": "calculator", "arguments": {"value": 2},
            "result": {"value": 4}, "source_event_id": "event-pure-source",
        }])
        with self.assertRaisesRegex(RuntimeExecutionError, "does not match"):
            dispatcher.dispatch(context, "tool", "calculator", {"value": 3})
        self.assertEqual(calls, [])

        mutable_calls: list[dict[str, Any]] = []
        dispatcher.tools["weather"] = lambda _ctx, arguments: mutable_calls.append(dict(arguments)) or {"temperature": 22}
        context = replace(context, permissions=frozenset({"tool:calculator", "tool:weather"}))
        dispatcher.install_replay_results(run["run_id"], [{
            "kind": "tool", "name": "calculator", "arguments": {"value": 2},
            "result": {"value": 4}, "source_event_id": "event-pure-source",
        }], allowed_reexecute=[{"kind": "tool", "name": "weather", "arguments": {"city": "Shanghai"}}])
        mutable = dispatcher.dispatch(context, "tool", "weather", {"city": "Shanghai"})
        pure = dispatcher.dispatch(context, "tool", "calculator", {"value": 2})
        dispatcher.assert_replay_results_consumed(run["run_id"])
        self.assertEqual(mutable["temperature"], 22)
        self.assertEqual(pure["value"], 4)
        self.assertEqual(mutable_calls, [{"city": "Shanghai"}])

        dispatcher.install_replay_results(run["run_id"], [], allowed_reexecute=[{
            "kind": "tool", "name": "weather", "arguments": {"city": "Shanghai"},
        }])
        with self.assertRaisesRegex(RuntimeExecutionError, "does not match"):
            dispatcher.dispatch(context, "tool", "weather", {"city": "Beijing"})
        self.assertEqual(mutable_calls, [{"city": "Shanghai"}])

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

    def test_side_effect_ledger_recovers_after_approval_before_write_without_duplicate(self) -> None:
        reference = self.definition("side-effect-ledger", "1", ["tool:write"])
        run = self.create_runtime_run(reference, "side-effect-ledger-run")
        self.engine.transition_run(run["run_id"], "running")
        approval = self.engine.request_approval(run["run_id"], {
            "operation": "tool:write", "risk_summary": "Write one approved receipt", "scope": "workspace",
        })
        approval_id = approval["approval_id"]
        requested = self.engine.get_side_effect(approval_id)
        self.assertEqual(requested["status"], "requested")
        self.assertEqual(requested["idempotency_key"], f"side-effect:{approval_id}")
        self.engine.resolve_approval(approval_id, "approved", {"idempotency_key": "desktop-side-effect-ledger-approved"})
        self.assertEqual(self.engine.get_side_effect(approval_id)["status"], "approved")

        restarted_engine = engine_module.RuntimeEngine(
            self.root / "engine.sqlite3",
            engine_module.RuntimeEngineIdentity(self.registry.identity.runtime_id, self.registry.identity.instance_id),
            lambda workspace_id: self.registry.get_workspace(workspace_id) is not None,
        )
        target = self.workspace / "approved-once.txt"
        calls = 0

        def write_once(_context: Any, _arguments: Mapping[str, Any]) -> Mapping[str, Any]:
            nonlocal calls
            calls += 1
            target.write_text("written-once", encoding="utf-8")
            return {"path": target.name, "bytes": target.stat().st_size}

        dispatcher = RuntimeToolDispatcher(restarted_engine, tools={"write": write_once})
        context = RuntimeRunContext(
            runtime_id=self.registry.identity.runtime_id,
            instance_id=self.registry.identity.instance_id,
            workspace_id=self.workspace_record.workspace_id,
            workspace_path=self.workspace,
            session_id=run["session_id"], run_id=run["run_id"],
            agent_definition_id="side-effect-ledger", agent_definition_version="1",
            permissions=frozenset({"tool:write"}),
        )
        result = dispatcher.dispatch(context, "tool", "write", {}, approval_id=approval_id, recovered=True)
        self.assertEqual(result["path"], target.name)
        completed = restarted_engine.get_side_effect(approval_id)
        self.assertEqual(completed["status"], "completed")
        self.assertIsNotNone(completed["recovered_at"])
        self.assertTrue(str(completed["result_digest"]).startswith("sha256:"))
        self.assertEqual(calls, 1)

        with self.assertRaisesRegex(RuntimeExecutionError, "already completed"):
            dispatcher.dispatch(context, "tool", "write", {}, approval_id=approval_id, recovered=True)
        self.assertEqual(calls, 1)
        self.assertEqual(target.read_text(encoding="utf-8"), "written-once")

    def test_side_effect_ledger_blocks_rejected_mismatched_and_unknown_outcomes(self) -> None:
        reference = self.definition("side-effect-ledger-block", "1", ["tool:write", "tool:delete"])
        run = self.create_runtime_run(reference, "side-effect-ledger-block-run")
        self.engine.transition_run(run["run_id"], "running")
        approval = self.engine.request_approval(run["run_id"], {"operation": "tool:write", "scope": "workspace"})
        self.engine.resolve_approval(approval["approval_id"], "approved")
        context = self.service_context(run, reference)
        calls: list[str] = []
        dispatcher = RuntimeToolDispatcher(self.engine, tools={
            "write": lambda *_: calls.append("write") or {"ok": True},
            "delete": lambda *_: calls.append("delete") or {"ok": True},
        })
        with self.assertRaisesRegex(RuntimeExecutionError, "does not match"):
            dispatcher.dispatch(context, "tool", "delete", {}, approval_id=approval["approval_id"])
        self.assertEqual(calls, [])

        self.engine.claim_side_effect(approval["approval_id"], run["run_id"], "tool:write")
        with self.assertRaisesRegex(RuntimeExecutionError, "outcome is unknown"):
            dispatcher.dispatch(context, "tool", "write", {}, approval_id=approval["approval_id"], recovered=True)
        self.assertEqual(calls, [])

        second = self.create_runtime_run(reference, "side-effect-ledger-rejected-run")
        self.engine.transition_run(second["run_id"], "running")
        denied = self.engine.request_approval(second["run_id"], {"operation": "tool:write", "scope": "workspace"})
        self.engine.resolve_approval(denied["approval_id"], "denied")
        denied_context = self.service_context(second, reference)
        with self.assertRaisesRegex(RuntimeExecutionError, "not approved"):
            dispatcher.dispatch(denied_context, "tool", "write", {}, approval_id=denied["approval_id"])
        self.assertEqual(calls, [])

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
        reference = self.definition("approval", "1", ["tool:write"])
        responses = iter((
            {
                "calls": [{"kind": "approval", "name": "tool:write", "arguments": {
                    "risk_summary": "Write one file", "scope": "workspace", "timeout_seconds": 5,
                }}],
                "content": "approval-required", "done": False,
            },
            {
                "calls": [{"kind": "tool", "name": "write", "arguments": {"content": "approved"}}],
                "content": "approved-complete", "done": True,
            },
        ))
        model = lambda *_: next(responses)
        backend = OpenDrSaiAgentBackend(model)
        writes: list[str] = []
        dispatcher = RuntimeToolDispatcher(self.engine, tools={
            "write": lambda _context, arguments: writes.append(str(arguments["content"])) or {"written": True},
        })
        service = self.service(backend, dispatcher)
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
            self.assertEqual(writes, ["approved"])
            self.assertEqual(self.engine.get_side_effect(approval_id)["status"], "completed")
            with self.assertRaises(RuntimeExecutionError) as repeated:
                await service.respond_approval(run["run_id"], approval_id, "approved")
            self.assertEqual(repeated.exception.code, "approval_not_found")

        asyncio.run(scenario())

    def test_cancel_wakes_approval_waiter_and_resolves_persisted_request(self) -> None:
        reference = self.definition("approval-cancel", "1", ["shell.execute"])
        backend = OpenDrSaiAgentBackend(lambda *_: {
            "calls": [{"kind": "approval", "name": "shell.execute", "arguments": {
                "risk_summary": "Run a command", "scope": "workspace", "timeout_seconds": 30,
            }}],
            "content": "must-not-complete",
            "done": True,
        })
        service = self.service(backend)
        run = self.create_runtime_run(reference, "approval-cancel-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(run["run_id"], "please continue"))
            pending = []
            for _ in range(100):
                pending = self.engine.list_pending_approvals(run["run_id"])
                if pending:
                    break
                await asyncio.sleep(0.01)
            self.assertEqual(len(pending), 1)
            cancelled = await service.cancel(run["run_id"])
            self.assertEqual(cancelled["status"], "cancelled")
            with self.assertRaises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
            self.assertEqual(caught.exception.code, "run_cancelled")
            self.assertEqual(self.engine.get_approval(pending[0]["approval_id"])["status"], "denied")
            self.assertEqual(self.engine.list_pending_approvals(run["run_id"]), [])

        asyncio.run(scenario())

    def test_double_cancel_interrupts_uncooperative_model_once(self) -> None:
        reference = self.definition("model-cancel", "1", [])

        class BlockingBackend:
            backend_id = "opendrsai"

            def __init__(self):
                self.started = asyncio.Event()
                self.cancel_calls = 0

            async def execute(self, context, definition, prompt, services):
                self.started.set()
                await asyncio.Event().wait()

            async def cancel(self, run_id):
                self.cancel_calls += 1

            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        backend = BlockingBackend()
        service = self.service(backend)
        run = self.create_runtime_run(reference, "model-cancel-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(run["run_id"], "wait forever"))
            await asyncio.wait_for(backend.started.wait(), timeout=1)
            first, second = await asyncio.gather(service.cancel(run["run_id"]), service.cancel(run["run_id"]))
            self.assertEqual(first["status"], "cancelled")
            self.assertEqual(second["status"], "cancelled")
            self.assertEqual(backend.cancel_calls, 1)
            with self.assertRaises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
            self.assertEqual(caught.exception.code, "run_cancelled")
            self.assertEqual(
                [event["type"] for event in self.engine.list_events(run["run_id"])].count("run.cancelled"),
                1,
            )

        asyncio.run(scenario())

    def test_backend_cancel_failure_cannot_block_runtime_convergence(self) -> None:
        reference = self.definition("cancel-hook-failure", "1", [])

        class BrokenCancelBackend:
            backend_id = "opendrsai"

            def __init__(self):
                self.started = asyncio.Event()
                self.cancel_calls = 0

            async def execute(self, context, definition, prompt, services):
                self.started.set()
                await asyncio.Event().wait()

            async def cancel(self, run_id):
                self.cancel_calls += 1
                raise RuntimeError("injected backend cancellation failure")

            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        backend = BrokenCancelBackend()
        service = self.service(backend)
        run = self.create_runtime_run(reference, "cancel-hook-failure-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(run["run_id"], "wait forever"))
            await asyncio.wait_for(backend.started.wait(), timeout=1)
            first, second = await asyncio.gather(
                service.cancel(run["run_id"]), service.cancel(run["run_id"]),
            )
            self.assertEqual(first["status"], "cancelled")
            self.assertEqual(second["status"], "cancelled")
            self.assertEqual(backend.cancel_calls, 1)
            with self.assertRaises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
            self.assertEqual(caught.exception.code, "run_cancelled")
            events = self.engine.list_events(run["run_id"])
            self.assertEqual([event["type"] for event in events].count("run.cancelled"), 1)
            warnings = [event for event in events if event["type"] == "agent.cancel.warning"]
            self.assertEqual(len(warnings), 1)
            self.assertEqual(warnings[0]["data"]["error"]["code"], "backend_cancel_failed")
            self.assertNotIn("injected backend cancellation failure", str(warnings[0]))

        asyncio.run(scenario())

    def test_restart_then_double_cancel_preserves_completed_side_effect_without_reexecution(self) -> None:
        reference = self.definition("restart-cancel", "1", [])
        run = self.create_runtime_run(reference, "restart-cancel-run")
        self.engine.transition_run(run["run_id"], "running")
        side_effect = self.workspace / "completed-before-restart.txt"
        side_effect.write_text("written-once", encoding="utf-8")
        self.engine.append_backend_event(
            run["run_id"],
            "tool.completed",
            {"operation_id": "effect-once", "path": side_effect.name},
            "restart-side-effect-once",
        )

        restarted_engine = engine_module.RuntimeEngine(
            self.root / "engine.sqlite3",
            engine_module.RuntimeEngineIdentity(
                self.registry.identity.runtime_id, self.registry.identity.instance_id,
            ),
            lambda workspace_id: self.registry.get_workspace(workspace_id) is not None,
        )

        class RestartedBackend:
            backend_id = "opendrsai"

            def __init__(self):
                self.cancel_calls = 0
                self.execute_calls = 0

            async def execute(self, context, definition, prompt, services):
                self.execute_calls += 1
                side_effect.write_text("incorrectly-reexecuted", encoding="utf-8")
                return {"content": "must not run"}

            async def cancel(self, run_id): self.cancel_calls += 1
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        backend = RestartedBackend()
        restarted = RuntimeAgentService(
            restarted_engine,
            self.registry,
            self.store,
            RuntimeToolDispatcher(restarted_engine),
            {"opendrsai": backend},
        )

        async def scenario():
            first, second = await asyncio.gather(
                restarted.cancel(run["run_id"]), restarted.cancel(run["run_id"]),
            )
            self.assertEqual(first["status"], "cancelled")
            self.assertEqual(second["status"], "cancelled")

        asyncio.run(scenario())
        self.assertEqual(backend.cancel_calls, 1)
        self.assertEqual(backend.execute_calls, 0)
        self.assertEqual(side_effect.read_text(encoding="utf-8"), "written-once")
        events = restarted_engine.list_events(run["run_id"])
        self.assertEqual([event["type"] for event in events].count("tool.completed"), 1)
        self.assertEqual([event["type"] for event in events].count("run.cancelled"), 1)

        second_restart = engine_module.RuntimeEngine(
            self.root / "engine.sqlite3",
            engine_module.RuntimeEngineIdentity(
                self.registry.identity.runtime_id, self.registry.identity.instance_id,
            ),
            lambda workspace_id: self.registry.get_workspace(workspace_id) is not None,
        )
        self.assertEqual(second_restart.get_run(run["run_id"])["status"], "cancelled")
        self.assertEqual(
            [event["type"] for event in second_restart.list_events(run["run_id"])].count("run.cancelled"),
            1,
        )

    def test_service_close_cancels_active_model_run(self) -> None:
        reference = self.definition("disconnect-cancel", "1", [])

        class ClosingBackend:
            backend_id = "opendrsai"

            def __init__(self):
                self.started = asyncio.Event()
                self.cancelled = False
                self.closed = False

            async def execute(self, context, definition, prompt, services):
                self.started.set()
                await asyncio.Event().wait()

            async def cancel(self, run_id): self.cancelled = True
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": not self.closed}
            async def close(self): self.closed = True

        backend = ClosingBackend()
        service = self.service(backend)
        run = self.create_runtime_run(reference, "disconnect-cancel-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(run["run_id"], "wait forever"))
            await asyncio.wait_for(backend.started.wait(), timeout=1)
            await service.close()
            self.assertTrue(backend.cancelled)
            self.assertTrue(backend.closed)
            with self.assertRaises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
            self.assertEqual(caught.exception.code, "run_cancelled")
            self.assertEqual(self.engine.get_run(run["run_id"])["status"], "cancelled")

        asyncio.run(scenario())

    def test_parent_cancel_converges_active_subagent_run(self) -> None:
        parent_ref = self.definition("parent-cancel", "1", [])
        child_ref = self.definition("child-cancel", "1", [])

        class SubagentBackend:
            backend_id = "opendrsai"

            def __init__(self):
                self.child_started = asyncio.Event()
                self.cancelled_runs: list[str] = []

            async def execute(self, context, definition, prompt, services):
                if definition.asset_id == "parent-cancel":
                    return await services.run_subagent(context, {
                        "kind": "subagent",
                        "name": child_ref,
                        "arguments": {"prompt": "child waits"},
                    })
                self.child_started.set()
                await asyncio.Event().wait()

            async def cancel(self, run_id): self.cancelled_runs.append(run_id)
            async def respond_approval(self, run_id, approval_id, decision): return None
            async def recover(self, run_id): return None
            async def health(self): return {"backend_id": self.backend_id, "available": True}
            async def close(self): return None

        backend = SubagentBackend()
        service = self.service(backend)
        parent = self.create_runtime_run(parent_ref, "parent-subagent-cancel-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(parent["run_id"], "start child"))
            await asyncio.wait_for(backend.child_started.wait(), timeout=1)
            await service.cancel(parent["run_id"])
            with self.assertRaises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=1)
            self.assertEqual(caught.exception.code, "run_cancelled")
            child = next(run for run in self.engine.list_session_runs(parent["session_id"]) if run["parent_run_id"] == parent["run_id"])
            self.assertEqual(child["status"], "cancelled")
            self.assertIn(parent["run_id"], backend.cancelled_runs)
            self.assertIn(child["run_id"], backend.cancelled_runs)
            self.assertEqual(
                [event["type"] for event in self.engine.list_events(parent["run_id"])].count("subagent.cancelled"),
                1,
            )

        asyncio.run(scenario())

    def test_cancel_stops_active_owop_process_without_waiting_for_timeout(self) -> None:
        reference = self.definition("process-cancel", "1", ["shell:*"])
        backend = OpenDrSaiAgentBackend(lambda *_: {
            "calls": [{
                "kind": "shell",
                "name": "execute",
                "arguments": {
                    "command": [sys.executable, "-c", "import time; time.sleep(30)"],
                    "cwd": ".",
                    "timeout_seconds": 60,
                },
            }],
            "done": True,
        })
        service = self.service(backend)
        run = self.create_runtime_run(reference, "process-cancel-run")

        async def scenario():
            execution = asyncio.create_task(service.execute(run["run_id"], "run process"))
            for _ in range(200):
                if any(event["type"] == "tool.started" for event in self.engine.list_events(run["run_id"])):
                    break
                await asyncio.sleep(0.01)
            else:
                self.fail("process Tool did not start")
            started = time.perf_counter()
            await service.cancel(run["run_id"])
            with self.assertRaises(RuntimeExecutionError) as caught:
                await asyncio.wait_for(execution, timeout=2)
            self.assertEqual(caught.exception.code, "run_cancelled")
            self.assertFalse(service.dispatcher.has_active_operations(run["run_id"]))
            self.assertLess(time.perf_counter() - started, 7.0)

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
        self.assertTrue(completed["data"]["operation_id"].startswith("operation-"))
        started = next(event for event in self.engine.list_events(run["run_id"]) if event["type"] == "tool.started")
        self.assertEqual(started["data"]["operation_id"], completed["data"]["operation_id"])
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
        self.assertEqual(len({event["data"]["operation_id"] for event in tool_events}), 3)
        oaep_commands = [
            item for item in self.engine.oaep_snapshot(run["session_id"])["items"]
            if item["type"] == "command_execution"
        ]
        self.assertEqual(len(oaep_commands), 3)
        for item in oaep_commands:
            self.assertEqual(item["content"]["operation_ref"]["operation"], "process.start")
            self.assertEqual(item["content"]["operation_ref"]["workspace_id"], self.workspace_record.workspace_id)
            self.assertEqual(item["content"]["resource_refs"][0]["resource_type"], "process")
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

    def test_owop_process_failure_maps_to_structured_oaep_error(self) -> None:
        reference = self.definition("owop-error", "1", ["shell:*"])
        run = self.create_runtime_run(reference)
        context = self.service_context(run, reference)
        with self.assertRaises(RuntimeExecutionError) as caught:
            RuntimeToolDispatcher(self.engine).dispatch(
                context,
                "shell",
                "missing",
                {"command": [str(self.workspace / "definitely-missing-executable")]},
            )
        self.assertEqual(caught.exception.code, "process_start_failed")
        failed = next(
            event for event in self.engine.list_oaep_events(run["session_id"])
            if event["type"] == "event.item.failed"
        )
        self.assertEqual(failed["data"]["error"]["code"], "process_start_failed")
        self.assertEqual(failed["data"]["error"]["source"], "owop")
        self.assertFalse(failed["data"]["error"]["retryable"])
        self.assertNotIn("traceback", str(failed).lower())

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

    def test_agent_failure_records_safe_code_location_diagnostics(self) -> None:
        reference = self.definition("diagnostic-failure", "1", [])

        def fail(*_args):
            raise ValueError("provider-secret-canary")

        run = self.create_runtime_run(reference, "diagnostic-failure")
        with self.assertRaises(RuntimeExecutionError):
            self.execute(self.service(OpenDrSaiAgentBackend(fail)), run["run_id"], "go")
        failure = next(
            event
            for event in self.engine.list_events(run["run_id"])
            if event["type"] == "agent.failed" and "diagnostic" in event["data"]
        )
        diagnostic = failure["data"]["diagnostic"]
        self.assertTrue(diagnostic["stack"])
        self.assertTrue(any(frame["language"] == "python" and frame["line"] > 0 for frame in diagnostic["stack"]))
        self.assertTrue(any(frame["in_app"] for frame in diagnostic["stack"]))
        self.assertNotIn("provider-secret-canary", json.dumps(diagnostic))
        self.assertNotIn(str(Path.home()), json.dumps(diagnostic))
        session_id = run["session_id"]
        oaep_items = {
            item["id"]: item
            for item in self.engine.oaep_snapshot(session_id)["items"]
        }
        notice = oaep_items[f"error:{run['run_id']}:agent"]
        self.assertEqual(notice["type"], "notice")
        self.assertEqual(notice["status"], "failed")
        self.assertEqual(notice["content"]["code"], "agent_execution_failed")
        self.assertNotIn("provider-secret-canary", json.dumps(notice))
        self.assertNotIn(str(Path.home()), json.dumps(notice))


if __name__ == "__main__":
    unittest.main()
