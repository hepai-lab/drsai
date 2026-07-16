from __future__ import annotations

import asyncio
import inspect
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from drsai.backend.agent_runtime import (
    AgentDefinitionStore,
    OpenDrSaiAgentBackend,
    RuntimeAgentService,
    RuntimeExecutionError,
    RuntimeToolDispatcher,
)
from drsai.backend.codex_adapter import CodexAdapter
from drsai.backend.runtime_engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime_registry import RuntimeRegistry


class TestBackend:
    backend_id = "test"

    async def execute(self, context, definition, prompt, services): return {"backend": self.backend_id}
    async def cancel(self, run_id): return None
    async def respond_approval(self, run_id, approval_id, decision): return None
    async def recover(self, run_id): return None
    async def health(self): return {"backend_id": self.backend_id, "available": True}
    async def close(self): return None


class FakeCodexClient:
    def __init__(self, *, available: bool = True, reason: str | None = None):
        self.available = available
        self.reason = reason
        self.execute_count = 0
        self.close_count = 0
        self.cancelled: list[str] = []
        self.approvals: list[tuple[str, str, str]] = []
        self.recovered: list[str] = []
        self.account_calls: list[tuple[str, Any]] = []

    async def execute_turn(self, context, definition, prompt, services):
        await asyncio.sleep(0)
        if not self.available:
            raise RuntimeExecutionError(
                "codex_backend_unavailable", "Codex App Server connection is closed.", retryable=True
            )
        self.execute_count += 1
        return {
            "backend": "codex",
            "workspace_id": context.workspace_id,
            "runtime_id": context.runtime_id,
            "prompt": prompt,
        }

    async def interrupt_turn(self, run_id): self.cancelled.append(run_id)
    async def respond_approval(self, run_id, approval_id, decision): self.approvals.append((run_id, approval_id, decision))
    async def recover_turn(self, run_id): self.recovered.append(run_id)
    async def health(self): return {"available": self.available, "reason": None if self.available else (self.reason or "connection_closed")}
    async def close(self): self.close_count += 1
    async def account_status(self, *, refresh=False):
        self.account_calls.append(("status", refresh))
        return {"logged_in": True, "auth_mode": "chatgpt", "email": "user@example.com"}
    async def account_login_start(self, login_type="chatgpt"):
        self.account_calls.append(("login", login_type))
        return {"type": login_type, "loginId": "login-1", "verificationUrl": "https://example.test"}
    async def account_login_cancel(self, login_id): self.account_calls.append(("cancel_login", login_id))
    async def account_logout(self): self.account_calls.append(("logout", None))


class AgentBackendContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.registry = RuntimeRegistry(self.root / "registry.sqlite3")
        self.workspace_record = self.registry.open_workspace(str(self.workspace))
        self.engine = RuntimeEngine(
            self.root / "engine.sqlite3",
            RuntimeEngineIdentity(self.registry.identity.runtime_id, self.registry.identity.instance_id),
            lambda workspace_id: self.registry.get_workspace(workspace_id) is not None,
        )
        self.assets = self.root / "assets"
        self.store = AgentDefinitionStore(self.assets, allowed_backends=("opendrsai", "codex", "test"))
        self.session = self.engine.create_session(self.workspace_record.workspace_id, "contract")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def definition(self, asset_id: str, backend: str) -> str:
        path = self.assets / asset_id / "1.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            "id": asset_id,
            "version": "1",
            "backend": backend,
            "instructions": "contract test",
            "permissions": [],
        }), encoding="utf-8")
        return f"{asset_id}@1"

    def create_run(self, reference: str, key: str) -> dict[str, Any]:
        record, _ = self.engine.create_run(
            self.session["session_id"], reference, key, self.store.load(reference).backend
        )
        return record

    def service(self, open_backend, codex_backend, **extra):
        return RuntimeAgentService(
            self.engine,
            self.registry,
            self.store,
            RuntimeToolDispatcher(self.engine),
            {"opendrsai": open_backend, "codex": codex_backend, **extra},
        )

    def test_all_backend_implementations_have_async_contract(self) -> None:
        methods = ("execute", "cancel", "respond_approval", "recover", "health", "close")
        for implementation in (OpenDrSaiAgentBackend, CodexAdapter, TestBackend):
            with self.subTest(implementation=implementation.__name__):
                for method in methods:
                    self.assertTrue(inspect.iscoroutinefunction(getattr(implementation, method)), method)

    def test_codex_adapter_lifecycle_methods_delegate_and_close_idempotently(self) -> None:
        client = FakeCodexClient()
        adapter = CodexAdapter(client)

        async def exercise():
            await adapter.cancel("run-1")
            await adapter.respond_approval("run-1", "approval-1", "accept")
            await adapter.recover("run-1")
            before = await adapter.health()
            await adapter.close()
            await adapter.close()
            after = await adapter.health()
            return before, after

        before, after = asyncio.run(exercise())
        self.assertTrue(before["available"])
        self.assertEqual(after["reason"], "closed")
        self.assertEqual(client.cancelled, ["run-1"])
        self.assertEqual(client.approvals, [("run-1", "approval-1", "accept")])
        self.assertEqual(client.recovered, ["run-1"])
        self.assertEqual(client.close_count, 1)
        with self.assertRaises(RuntimeExecutionError) as caught:
            asyncio.run(CodexAdapter(client).respond_approval("run-1", "approval-1", "invalid"))
        self.assertEqual(caught.exception.code, "approval_decision_invalid")

    def test_codex_account_actions_route_through_runtime_without_credentials(self) -> None:
        client = FakeCodexClient()
        service = self.service(OpenDrSaiAgentBackend(lambda *_: {"done": True}), CodexAdapter(client))

        async def exercise():
            status = await service.backend_account_status("codex", refresh=True)
            login = await service.backend_account_login_start("codex", "chatgptDeviceCode")
            await service.backend_account_login_cancel("codex", "login-1")
            await service.backend_account_logout("codex")
            return status, login

        status, login = asyncio.run(exercise())
        self.assertEqual(status["auth_mode"], "chatgpt")
        self.assertEqual(login["loginId"], "login-1")
        self.assertNotIn("token", json.dumps({"status": status, "login": login}).lower())
        self.assertEqual(client.account_calls, [
            ("status", True), ("login", "chatgptDeviceCode"),
            ("cancel_login", "login-1"), ("logout", None),
        ])
        with self.assertRaises(RuntimeExecutionError) as caught:
            asyncio.run(service.backend_account_status("opendrsai"))
        self.assertEqual(caught.exception.code, "backend_account_unsupported")

    def test_router_selects_exact_backend_without_changing_workspace(self) -> None:
        open_calls: list[str] = []
        open_backend = OpenDrSaiAgentBackend(
            lambda prompt, *_: open_calls.append(prompt) or {"content": "open", "done": True}
        )
        client = FakeCodexClient()
        service = self.service(open_backend, CodexAdapter(client))
        open_run = self.create_run(self.definition("open", "opendrsai"), "open-run")
        codex_run = self.create_run(self.definition("codex", "codex"), "codex-run")

        async def execute_both():
            return await asyncio.gather(
                service.execute(open_run["run_id"], "open prompt"),
                service.execute(codex_run["run_id"], "codex prompt"),
            )

        open_result, codex_result = asyncio.run(execute_both())
        self.assertEqual(open_result["result"]["content"], "open")
        self.assertEqual(codex_result["result"]["backend"], "codex")
        self.assertEqual(open_calls, ["open prompt"])
        self.assertEqual(client.execute_count, 1)
        self.assertEqual(open_result["context"]["workspace_id"], codex_result["context"]["workspace_id"])

    def test_codex_failure_never_falls_back_to_opendrsai(self) -> None:
        open_calls: list[str] = []
        open_backend = OpenDrSaiAgentBackend(
            lambda prompt, *_: open_calls.append(prompt) or {"content": "must-not-run", "done": True}
        )
        service = self.service(open_backend, CodexAdapter(FakeCodexClient(available=False)))
        run = self.create_run(self.definition("codex-failure", "codex"), "codex-failure")
        with self.assertRaises(RuntimeExecutionError) as caught:
            asyncio.run(service.execute(run["run_id"], "codex only"))
        self.assertEqual(caught.exception.code, "codex_backend_unavailable")
        self.assertEqual(open_calls, [])
        self.assertEqual(self.engine.get_run(run["run_id"])["status"], "failed")

    def test_codex_terminal_errors_map_to_runtime_terminal_state_and_timestamps(self) -> None:
        class InterruptedClient(FakeCodexClient):
            async def execute_turn(self, context, definition, prompt, services):
                raise RuntimeExecutionError("run_cancelled", "Codex Turn was interrupted.")

        service = self.service(
            OpenDrSaiAgentBackend(lambda *_: (_ for _ in ()).throw(AssertionError("fallback"))),
            CodexAdapter(InterruptedClient()),
        )
        run = self.create_run(self.definition("codex-interrupted", "codex"), "codex-interrupted")
        with self.assertRaises(RuntimeExecutionError) as caught:
            asyncio.run(service.execute(run["run_id"], "interrupt me"))
        self.assertEqual(caught.exception.code, "run_cancelled")
        stored = self.engine.get_run(run["run_id"])
        self.assertEqual(stored["status"], "cancelled")
        self.assertIsNotNone(stored["started_at"])
        self.assertIsNotNone(stored["completed_at"])
        self.assertTrue(any(event["type"] == "run.cancelled" for event in self.engine.list_events(run["run_id"])))

    def test_twenty_concurrent_runs_share_one_adapter_and_close_once(self) -> None:
        client = FakeCodexClient()
        adapter = CodexAdapter(client)
        service = self.service(OpenDrSaiAgentBackend(lambda *_: {"done": True}), adapter)
        reference = self.definition("codex-concurrent", "codex")
        runs = [self.create_run(reference, f"concurrent-{index}") for index in range(20)]

        async def execute_all():
            await asyncio.gather(*(service.execute(run["run_id"], str(index)) for index, run in enumerate(runs)))
            await service.close()
            await service.close()

        asyncio.run(execute_all())
        self.assertEqual(client.execute_count, 20)
        self.assertEqual(client.close_count, 1)
        self.assertTrue(all(self.engine.get_run(run["run_id"])["status"] == "completed" for run in runs))

    def test_cancel_requested_persists_connection_loss_then_recovers_idempotently(self) -> None:
        class FailingCancelClient(FakeCodexClient):
            async def interrupt_turn(self, run_id):
                raise RuntimeExecutionError("codex_connection_eof", "connection lost", retryable=True)

        reference = self.definition("codex-cancel-recovery", "codex")
        run = self.create_run(reference, "cancel-recovery")
        self.engine.transition_run(run["run_id"], "running")
        failing = self.service(OpenDrSaiAgentBackend(lambda *_: {"done": True}), CodexAdapter(FailingCancelClient()))
        with self.assertRaises(RuntimeExecutionError) as caught:
            asyncio.run(failing.cancel(run["run_id"]))
        self.assertEqual(caught.exception.code, "codex_connection_eof")
        pending = self.engine.get_run(run["run_id"])
        self.assertEqual(pending["status"], "running")
        self.assertIsNotNone(pending["cancel_requested_at"])

        recovered_client = FakeCodexClient()
        recovered = self.service(OpenDrSaiAgentBackend(lambda *_: {"done": True}), CodexAdapter(recovered_client))
        first = asyncio.run(recovered.cancel(run["run_id"]))
        second = asyncio.run(recovered.cancel(run["run_id"]))
        self.assertEqual(first["status"], "cancelled")
        self.assertEqual(second["status"], "cancelled")
        self.assertEqual(recovered_client.cancelled, [run["run_id"]])

    def test_codex_capability_reports_available_missing_incompatible_and_not_logged_in(self) -> None:
        async def get_health(adapter):
            return await adapter.health()

        fixtures = [
            (CodexAdapter(FakeCodexClient()), True, None),
            (CodexAdapter(), False, "not_configured"),
            (CodexAdapter(FakeCodexClient(available=False, reason="version_incompatible")), False, "version_incompatible"),
            (CodexAdapter(FakeCodexClient(available=False, reason="not_logged_in")), False, "not_logged_in"),
        ]
        for adapter, available, reason in fixtures:
            with self.subTest(reason=reason):
                health = asyncio.run(get_health(adapter))
                self.assertEqual(health["backend_id"], "codex")
                self.assertEqual(health["available"], available)
                self.assertEqual(health["reason"], reason)


if __name__ == "__main__":
    unittest.main()
