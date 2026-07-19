"""Codex App Server implementation of the Codex Adapter client contract."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.agent_backend_bindings import (
    AgentBackendBindingError,
    AgentBackendBindingOperation,
    AgentBackendBindingStore,
    AgentBackendRunBinding,
    AgentBackendSessionBinding,
)
from drsai.backend.agent_runtime import (
    AgentDefinition,
    AgentExecutionServices,
    RuntimeExecutionError,
    RuntimeRunContext,
)
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient
from drsai.backend.codex_adapter.models import CodexModelCatalog
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.codex_adapter.security import CodexAccountManager
from drsai.backend.codex_adapter.security import CodexApprovalBridge


_AMBIGUOUS_ERRORS = frozenset({
    "codex_request_timeout", "codex_connection_eof", "codex_reader_failed",
    "codex_json_invalid", "codex_message_invalid", "codex_response_invalid",
})
_TERMINAL = frozenset({"completed", "failed", "interrupted"})
_BACKEND_CONFIG_FIELDS = frozenset({"personality", "approvalPolicy", "sandbox", "reasoningEffort"})


def _digest(value: Mapping[str, Any]) -> str:
    data = json.dumps(dict(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


class CodexAgentBackendClient:
    """Maps Runtime Session/Run identities to Codex Thread/Turn identities."""

    def __init__(
        self,
        rpc: CodexJSONRPCClient,
        bindings: AgentBackendBindingStore,
        *,
        fault_injector: Callable[[str], None] | None = None,
        runtime_state: Any | None = None,
        approval_bridge: CodexApprovalBridge | None = None,
    ):
        self.rpc = rpc
        self.bindings = bindings
        self.models = CodexModelCatalog(rpc)
        self.accounts = CodexAccountManager(rpc)
        self.event_mapper = CodexEventMapper()
        self.fault_injector = fault_injector or (lambda _point: None)
        self.runtime_state = runtime_state
        self.approval_bridge = approval_bridge
        self._cancelled_runs: set[str] = set()
        self._entity_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._resumed_generation: dict[str, int] = {}
        self._closed = False

    async def account_status(self, *, refresh: bool = False) -> Mapping[str, Any]:
        await self.rpc.connect()
        return await self.accounts.status(refresh=refresh)

    async def account_login_start(self, login_type: str = "chatgpt") -> Mapping[str, Any]:
        await self.rpc.connect()
        return await self.accounts.login_start(login_type)

    async def account_login_cancel(self, login_id: str) -> None:
        await self.rpc.connect()
        await self.accounts.login_cancel(login_id)

    async def account_logout(self) -> None:
        await self.rpc.connect()
        await self.accounts.logout()

    async def execute_turn(
        self, context: RuntimeRunContext, definition: AgentDefinition, prompt: str,
        services: AgentExecutionServices,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeExecutionError("codex_backend_closed", "Codex Agent Backend client is closed.")
        await self.rpc.connect()
        if not self.models.models:
            await self.models.refresh()
        model = self.models.select(definition.model or "")
        config = self._backend_config(definition)
        if self.approval_bridge:
            self.approval_bridge.attach_context(context)
        try:
            async with self._entity_locks[f"session:{context.session_id}"]:
                session = await self._ensure_session(context, definition, model.model_id, config)
            async with self._entity_locks[f"run:{context.run_id}"]:
                return await self._execute_run(context, definition, prompt, services, session, model.model_id, config)
        finally:
            if self.approval_bridge:
                self.approval_bridge.detach_context(context.run_id)

    async def _ensure_session(
        self, context: RuntimeRunContext, definition: AgentDefinition, model: str, config: Mapping[str, Any],
    ) -> AgentBackendSessionBinding:
        try:
            binding = self.bindings.get_session(context.session_id)
            self._validate_session(binding, context)
            await self._resume_if_needed(binding, context)
            return binding
        except KeyError:
            pass
        request = {
            "cwd": str(context.workspace_path), "model": model,
            "developerInstructions": definition.instructions,
            **{key: value for key, value in config.items() if key in {"personality", "approvalPolicy", "sandbox"}},
        }
        operation = self.bindings.prepare_operation("session", context.session_id, "thread/start", _digest(request))
        if operation.state == "bound":
            binding = self.bindings.get_session(context.session_id)
            self._validate_session(binding, context)
            return binding
        if operation.state == "response_received":
            return self._complete_session(context)
        if operation.state in {"requesting", "unknown"}:
            if operation.state == "requesting":
                self.bindings.mark_operation_unknown("session", context.session_id, "runtime_restarted_during_request")
            raise self._unknown_binding("Session", context.session_id)
        self.fault_injector("before_thread_request")
        self.bindings.mark_operation_requesting("session", context.session_id)
        try:
            result = await self.rpc.request("thread/start", request)
            thread_id = self._response_id(result, "thread")
            self.bindings.mark_operation_response("session", context.session_id, thread_id)
        except RuntimeExecutionError as exc:
            self._settle_failed_operation("session", context.session_id, exc)
            raise
        self.fault_injector("after_thread_response_before_bind")
        binding = self._complete_session(context)
        self._resumed_generation[context.session_id] = self.rpc._generation
        return binding

    async def _execute_run(
        self, context: RuntimeRunContext, definition: AgentDefinition, prompt: str,
        services: AgentExecutionServices, session: AgentBackendSessionBinding,
        model: str, config: Mapping[str, Any],
    ) -> dict[str, Any]:
        try:
            existing = self.bindings.get_run(context.run_id)
            self._validate_run(existing, context, session)
            if existing.status in _TERMINAL:
                raise RuntimeExecutionError("codex_turn_already_terminal", "Codex Turn is already terminal.")
            if existing.status == "unknown":
                raise self._unknown_binding("Run", context.run_id)
        except KeyError:
            existing = None
        request = {
            "threadId": session.backend_session_id,
            "input": [{"type": "text", "text": prompt}],
            "model": model,
        }
        if config.get("reasoningEffort"):
            request["effort"] = config["reasoningEffort"]
        operation = self.bindings.prepare_operation("run", context.run_id, "turn/start", _digest(request))
        if operation.state == "bound":
            run_binding = self.bindings.get_run(context.run_id)
            turn_id = run_binding.backend_run_id
        elif operation.state == "response_received":
            run_binding = self._complete_run(context, session)
            turn_id = run_binding.backend_run_id
        elif operation.state in {"requesting", "unknown"}:
            if operation.state == "requesting":
                self.bindings.mark_operation_unknown("run", context.run_id, "runtime_restarted_during_request")
            raise self._unknown_binding("Run", context.run_id)
        else:
            turn_future: asyncio.Future = asyncio.get_running_loop().create_future()
            pending_notifications: list[Mapping[str, Any]] = []
            turn_identity: dict[str, str | None] = {"id": None}

            async def receive(message: Mapping[str, Any]) -> None:
                params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
                turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
                notification_turn = str(params.get("turnId") or turn.get("id") or "")
                if turn_identity["id"] is None:
                    pending_notifications.append(message)
                    return
                if notification_turn and notification_turn != turn_identity["id"]:
                    return
                self.event_mapper.handle(context, services, message)
                if str(message.get("method") or "") == "turn/completed" and not turn_future.done():
                    turn_future.set_result(dict(params))

            unsubscribe = self.rpc.on_route(receive, thread_id=session.backend_session_id)
            self.fault_injector("before_turn_request")
            self.bindings.mark_operation_requesting("run", context.run_id)
            try:
                result = await self.rpc.request("turn/start", request, timeout=60)
                turn_id = self._response_id(result, "turn")
                turn_identity["id"] = turn_id
                self.bindings.mark_operation_response("run", context.run_id, turn_id)
                self.fault_injector("after_turn_response_before_bind")
                run_binding = self._complete_run(context, session)
                services.emit_backend(context, "agent.started", {
                    "backend": "codex", "backend_metadata": {"thread_id": session.backend_session_id, "turn_id": turn_id}
                }, f"codex:{turn_id}:turn/started")
                for notification in pending_notifications:
                    await receive(notification)
                terminal = await turn_future
            except RuntimeExecutionError as exc:
                self._settle_failed_operation("run", context.run_id, exc)
                unsubscribe()
                raise
            except Exception:
                unsubscribe()
                raise
            unsubscribe()
            return self._terminal_result(context, services, run_binding, terminal)
        raise RuntimeExecutionError(
            "codex_turn_recovery_required",
            "A bound Codex Turn must be recovered before it can be executed again.",
            retryable=True,
            detail={"run_id": context.run_id, "turn_id": turn_id},
        )

    def _terminal_result(
        self, context: RuntimeRunContext, services: AgentExecutionServices,
        binding: AgentBackendRunBinding, terminal: Mapping[str, Any],
    ) -> dict[str, Any]:
        turn = terminal.get("turn") if isinstance(terminal.get("turn"), Mapping) else terminal
        status = str(turn.get("status") or "failed")
        if status not in _TERMINAL:
            status = "failed"
        self.bindings.update_run_state(context.run_id, generation=self.rpc._generation, status=status)
        metadata = {"thread_id": self.bindings.get_session(context.session_id).backend_session_id,
                    "turn_id": binding.backend_run_id}
        if status == "completed":
            services.emit_backend(context, "agent.completed", {"backend": "codex", "backend_metadata": metadata},
                                  f"codex:{binding.backend_run_id}:turn/completed")
            return {"status": "completed", "backend": "codex", "backend_metadata": metadata}
        if status == "interrupted":
            raise RuntimeExecutionError("run_cancelled", "Codex Turn was interrupted.", detail={"backend_metadata": metadata})
        error = turn.get("error") if isinstance(turn.get("error"), Mapping) else {}
        raise RuntimeExecutionError("codex_turn_failed", str(error.get("message") or "Codex Turn failed."),
                                    detail={"backend_metadata": metadata})

    async def interrupt_turn(self, run_id: str) -> None:
        if run_id in self._cancelled_runs:
            return
        run = self.bindings.get_run(run_id)
        if run.status in _TERMINAL:
            self._cancelled_runs.add(run_id)
            return
        session = self.bindings.get_session(run.session_id)
        if self.approval_bridge:
            await self.approval_bridge.cancel_run(run_id)
        try:
            await self.rpc.request("turn/interrupt", {"threadId": session.backend_session_id, "turnId": run.backend_run_id})
        except RuntimeExecutionError as exc:
            # A Turn can reach a terminal backend state between Runtime's
            # cancel request and App Server's interrupt handling. Cancellation
            # remains idempotent in that narrow race; every other RPC failure
            # must still fail closed.
            if exc.code != "codex_jsonrpc_error" or "no active turn" not in str(exc).lower():
                raise
        self._cancelled_runs.add(run_id)

    async def archive_session(self, session_id: str, *, archived: bool) -> None:
        """Mirror an OpenDrSai session archive transition to its Codex Thread."""
        await self.rpc.connect()
        session = self.bindings.get_session(session_id)
        await self.rpc.request("thread/archive" if archived else "thread/unarchive", {"threadId": session.backend_session_id})

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        if self.approval_bridge is None:
            raise RuntimeExecutionError("approval_bridge_not_ready", "Codex Approval Bridge is not configured.")
        await self.approval_bridge.respond(run_id, approval_id, decision)

    async def recover_turn(self, run_id: str) -> None:
        await self.rpc.connect()
        try:
            run = self.bindings.get_run(run_id)
        except KeyError as exc:
            try:
                operation = self.bindings.get_operation("run", run_id)
            except KeyError:
                raise RuntimeExecutionError("codex_turn_recovery_missing", "Codex Run has no recovery binding.") from exc
            if operation.state == "unknown":
                self._converge_runtime(run_id, "backend_interrupted")
                return
            raise RuntimeExecutionError("codex_turn_recovery_missing", "Codex Run has no confirmed Turn identity.") from exc
        session = self.bindings.get_session(run.session_id)
        await self.rpc.request("thread/resume", {"threadId": session.backend_session_id})
        if self.runtime_state is not None:
            runtime_run = self.runtime_state.get_run(run_id)
            if runtime_run.get("cancel_requested_at"):
                await self.rpc.request("turn/interrupt", {
                    "threadId": session.backend_session_id, "turnId": run.backend_run_id,
                })
        result = await self.rpc.request("thread/read", {"threadId": session.backend_session_id, "includeTurns": True})
        thread = result.get("thread") if isinstance(result, Mapping) and isinstance(result.get("thread"), Mapping) else {}
        turns = thread.get("turns") if isinstance(thread.get("turns"), list) else []
        match = next((item for item in turns if isinstance(item, Mapping) and item.get("id") == run.backend_run_id), None)
        status = str(match.get("status") or "unknown") if match is not None else "backend_interrupted"
        if status not in _TERMINAL:
            status = "backend_interrupted"
        self.bindings.update_run_state(run_id, generation=self.rpc._generation, status=status)
        self._converge_runtime(run_id, status)

    async def health(self) -> Mapping[str, Any]:
        health = await self.rpc.supervisor.health()
        if not health.get("available") and health.get("reason") == "not_running":
            try:
                binary = self.rpc.supervisor.binary_provider.resolve()
                health = {
                    **health, "available": True, "reason": "ready_not_started",
                    "version": binary.version, "release_safe": binary.release_safe,
                }
            except RuntimeExecutionError as exc:
                health = {**health, "available": False, "reason": exc.code, "retryable": exc.retryable}
        return {**health, "connection_state": self.rpc._state}

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self.rpc.close()

    def _converge_runtime(self, run_id: str, backend_status: str) -> None:
        if self.runtime_state is None:
            return
        run = self.runtime_state.get_run(run_id)
        if run["status"] in {"completed", "failed", "cancelled"}:
            return
        target = {"completed": "completed", "failed": "failed", "interrupted": "cancelled"}.get(
            backend_status, "failed"
        )
        self.runtime_state.append_event(run_id, "agent.recovered", {
            "backend": "codex", "backend_status": backend_status,
            "policy": "fail_backend_interrupted" if backend_status == "backend_interrupted" else "converge_terminal",
        })
        self.runtime_state.transition_run(run_id, target)

    async def _resume_if_needed(self, binding: AgentBackendSessionBinding, context: RuntimeRunContext) -> None:
        if self._resumed_generation.get(context.session_id) == self.rpc._generation:
            return
        result = await self.rpc.request("thread/resume", {
            "threadId": binding.backend_session_id, "cwd": str(context.workspace_path)
        })
        returned = self._response_id(result, "thread")
        if returned != binding.backend_session_id:
            raise RuntimeExecutionError("codex_thread_identity_mismatch", "Codex resumed a different Thread identity.")
        self._resumed_generation[context.session_id] = self.rpc._generation

    def _complete_session(self, context: RuntimeRunContext) -> AgentBackendSessionBinding:
        try:
            version = self.rpc.supervisor.binary.version if self.rpc.supervisor.binary else None
            return self.bindings.complete_session_operation(
                session_id=context.session_id, workspace_id=context.workspace_id, backend_id="codex",
                agent_backend_runtime_id=str(context.agent_backend_runtime_id),
                workspace_runtime_id=str(context.workspace_runtime_id), backend_version=version or "development",
            )
        except AgentBackendBindingError as exc:
            raise RuntimeExecutionError(exc.code, str(exc)) from exc

    def _complete_run(self, context: RuntimeRunContext, session: AgentBackendSessionBinding) -> AgentBackendRunBinding:
        try:
            return self.bindings.complete_run_operation(
                run_id=context.run_id, session_id=session.session_id, workspace_id=context.workspace_id,
                backend_id="codex", agent_backend_runtime_id=str(context.agent_backend_runtime_id),
                workspace_runtime_id=str(context.workspace_runtime_id), generation=self.rpc._generation,
            )
        except AgentBackendBindingError as exc:
            raise RuntimeExecutionError(exc.code, str(exc)) from exc

    def _settle_failed_operation(self, entity_type: str, entity_id: str, error: RuntimeExecutionError) -> None:
        if error.code in _AMBIGUOUS_ERRORS:
            self.bindings.mark_operation_unknown(entity_type, entity_id, error.code)
        else:
            self.bindings.reset_operation_pending(entity_type, entity_id, error.code)

    @staticmethod
    def _response_id(result: Any, key: str) -> str:
        value = result.get(key) if isinstance(result, Mapping) else None
        identity = value.get("id") if isinstance(value, Mapping) else None
        if not isinstance(identity, str) or not identity:
            raise RuntimeExecutionError("codex_response_invalid", f"Codex {key} response did not contain an id.")
        return identity

    @staticmethod
    def _backend_config(definition: AgentDefinition) -> dict[str, Any]:
        value = definition.raw.get("backend_config", {})
        if not isinstance(value, Mapping):
            raise RuntimeExecutionError("codex_backend_config_invalid", "Codex backend_config must be an object.")
        unknown = sorted(set(value) - _BACKEND_CONFIG_FIELDS)
        if unknown or "cwd" in value:
            raise RuntimeExecutionError("codex_capability_unsupported", "Agent Definition contains unsupported Codex fields.",
                                        detail={"fields": unknown or ["cwd"]})
        if value.get("approvalPolicy") in {"never", "bypass", "untrusted"}:
            raise RuntimeExecutionError(
                "codex_approval_policy_unsafe",
                "Codex Approval Bridge cannot be bypassed by Agent Definition.",
            )
        if value.get("sandbox") in {"danger-full-access", "disabled", "none"}:
            raise RuntimeExecutionError(
                "codex_sandbox_policy_unsafe",
                "Codex workspace safety policy cannot be disabled by Agent Definition.",
            )
        return dict(value)

    @staticmethod
    def _validate_session(binding: AgentBackendSessionBinding, context: RuntimeRunContext) -> None:
        if (binding.workspace_id, binding.backend_id, binding.agent_backend_runtime_id, binding.workspace_runtime_id) != (
            context.workspace_id, "codex", context.agent_backend_runtime_id, context.workspace_runtime_id
        ):
            raise RuntimeExecutionError("agent_backend_session_binding_conflict", "Codex Session binding does not match Run Context.")

    @staticmethod
    def _validate_run(binding: AgentBackendRunBinding, context: RuntimeRunContext, session: AgentBackendSessionBinding) -> None:
        if (binding.session_id, binding.workspace_id, binding.backend_id) != (session.session_id, context.workspace_id, "codex"):
            raise RuntimeExecutionError("agent_backend_run_binding_conflict", "Codex Run binding does not match Run Context.")

    @staticmethod
    def _unknown_binding(kind: str, identity: str) -> RuntimeExecutionError:
        return RuntimeExecutionError(
            "codex_binding_unknown", f"Codex {kind} creation outcome is unknown and must be reconciled before retry.",
            retryable=True, detail={"identity": identity},
        )
