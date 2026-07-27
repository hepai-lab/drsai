from __future__ import annotations

import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "drsai"
    / "backend"
    / "runtime"
)


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


bindings = load("agent_backend_bindings_under_test", "agent_bindings.py")


class AgentBackendBindingStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name) / "runtime.sqlite3"
        self.store = bindings.AgentBackendBindingStore(self.database)
        self.session_args = {
            "session_id": "session-1",
            "workspace_id": "workspace-a",
            "backend_id": "codex",
            "agent_backend_runtime_id": "runtime-local",
            "workspace_runtime_id": "runtime-local",
            "backend_session_id": "thread-1",
            "backend_version": "0.142.5",
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_bindings_survive_restart_and_idempotent_rebind(self) -> None:
        session = self.store.bind_session(**self.session_args)
        run = self.store.bind_run(
            run_id="run-1",
            session_id=session.session_id,
            workspace_id=session.workspace_id,
            backend_id=session.backend_id,
            agent_backend_runtime_id=session.agent_backend_runtime_id,
            workspace_runtime_id=session.workspace_runtime_id,
            backend_run_id="turn-1",
        )
        self.assertEqual(self.store.bind_session(**self.session_args), session)
        restarted = bindings.AgentBackendBindingStore(self.database)
        self.assertEqual(restarted.get_session("session-1"), session)
        self.assertEqual(restarted.get_run("run-1"), run)
        updated = restarted.update_run_state("run-1", generation=1, status="running")
        self.assertEqual((updated.generation, updated.status), (1, "running"))

    def test_session_and_run_reject_cross_workspace_rebinding(self) -> None:
        session = self.store.bind_session(**self.session_args)
        conflicting = {**self.session_args, "workspace_id": "workspace-b"}
        with self.assertRaises(bindings.AgentBackendBindingError) as caught:
            self.store.bind_session(**conflicting)
        self.assertEqual(caught.exception.code, "agent_backend_session_binding_conflict")

        with self.assertRaises(bindings.AgentBackendBindingError) as caught:
            self.store.bind_run(
                run_id="run-1",
                session_id=session.session_id,
                workspace_id="workspace-b",
                backend_id=session.backend_id,
                agent_backend_runtime_id=session.agent_backend_runtime_id,
                workspace_runtime_id=session.workspace_runtime_id,
                backend_run_id="turn-1",
            )
        self.assertEqual(caught.exception.code, "agent_backend_run_binding_conflict")

    def test_database_constraints_reject_duplicate_backend_identity(self) -> None:
        self.store.bind_session(**self.session_args)
        duplicate = {**self.session_args, "session_id": "session-2"}
        with self.assertRaises(bindings.AgentBackendBindingError) as caught:
            self.store.bind_session(**duplicate)
        self.assertEqual(caught.exception.code, "agent_backend_session_binding_conflict")

        db = sqlite3.connect(self.database)
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute(
                    "UPDATE agent_backend_session_bindings SET workspace_id='workspace-b' WHERE session_id='session-1'"
                )
        finally:
            db.close()

    def test_distributed_binding_is_explicitly_rejected(self) -> None:
        with self.assertRaises(bindings.AgentBackendBindingError) as caught:
            self.store.bind_session(**{**self.session_args, "workspace_runtime_id": "runtime-remote"})
        self.assertEqual(caught.exception.code, "distributed_backend_not_supported")

    def test_confirmed_session_and_run_responses_complete_atomically(self) -> None:
        session_operation = self.store.prepare_operation("session", "session-1", "thread/start", "sha256:session")
        self.assertEqual(session_operation.state, "pending")
        self.store.mark_operation_requesting("session", "session-1")
        self.store.mark_operation_response("session", "session-1", "thread-1")
        session = self.store.complete_session_operation(
            session_id="session-1", workspace_id="workspace-a", backend_id="codex",
            agent_backend_runtime_id="runtime-local", workspace_runtime_id="runtime-local",
            backend_version="0.142.5",
        )
        self.assertEqual(session.backend_session_id, "thread-1")
        self.assertEqual(self.store.get_operation("session", "session-1").state, "bound")

        self.store.prepare_operation("run", "run-1", "turn/start", "sha256:run")
        self.store.mark_operation_requesting("run", "run-1")
        self.store.mark_operation_response("run", "run-1", "turn-1")
        run = self.store.complete_run_operation(
            run_id="run-1", session_id="session-1", workspace_id="workspace-a", backend_id="codex",
            agent_backend_runtime_id="runtime-local", workspace_runtime_id="runtime-local",
            generation=3,
        )
        self.assertEqual((run.backend_run_id, run.generation, run.status), ("turn-1", 3, "running"))
        self.assertEqual(self.store.get_operation("run", "run-1").state, "bound")

    def test_response_received_survives_restart_and_unknown_blocks_duplicate(self) -> None:
        self.store.prepare_operation("session", "session-1", "thread/start", "sha256:session")
        self.store.mark_operation_requesting("session", "session-1")
        self.store.mark_operation_response("session", "session-1", "thread-after-fault")
        restarted = bindings.AgentBackendBindingStore(self.database)
        self.assertEqual(restarted.get_operation("session", "session-1").backend_id, "thread-after-fault")
        completed = restarted.complete_session_operation(
            session_id="session-1", workspace_id="workspace-a", backend_id="codex",
            agent_backend_runtime_id="runtime-local", workspace_runtime_id="runtime-local",
            backend_version="0.142.5",
        )
        self.assertEqual(completed.backend_session_id, "thread-after-fault")

        restarted.prepare_operation("run", "run-unknown", "turn/start", "sha256:unknown")
        restarted.mark_operation_requesting("run", "run-unknown")
        unknown = restarted.mark_operation_unknown("run", "run-unknown", "codex_request_timeout")
        self.assertEqual((unknown.state, unknown.error_code), ("unknown", "codex_request_timeout"))
        with self.assertRaises(bindings.AgentBackendBindingError):
            restarted.mark_operation_requesting("run", "run-unknown")


if __name__ == "__main__":
    unittest.main()
