"""Codex App Server implementation of the Codex Adapter client contract."""

from __future__ import annotations

import asyncio
import base64
import os
import hashlib
import json
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.runtime.agent_bindings import (
    AgentBackendBindingError,
    AgentBackendBindingOperation,
    AgentBackendBindingStore,
    AgentBackendRunBinding,
    AgentBackendSessionBinding,
)
from drsai.backend.runtime.agent import (
    AgentDefinition,
    AgentExecutionServices,
    RuntimeExecutionError,
    RuntimeRunContext,
)
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient
from drsai.backend.codex_adapter.models import CodexModelCatalog
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.codex_adapter.native_decoder import CodexNativeEventDecoder
from drsai.backend.runtime.input_resources import codex_input_items
from drsai.backend.runtime.turn_coordinator import EntityLockRegistry, SessionTurnCoordinator
from drsai.backend.runtime.normalized_events import BackendBinding, NormalizedAgentEvent, NormalizedEventKind
from drsai.backend.codex_adapter.run_finalizer import CodexRunFinalizer
from drsai.backend.codex_adapter.security import CodexAccountManager
from drsai.backend.codex_adapter.security import CodexApprovalBridge
from drsai.backend.codex_adapter.stable_contract import (
    CONTRACT_DIGEST,
    GENERATED_BASELINE,
    CodexCompatibility,
    compatibility_for_identity,
    compatibility_for_version,
)
from drsai.backend.codex_adapter.version import CODEX_ADAPTER_MAPPING_VERSION
_AMBIGUOUS_ERRORS = frozenset({
    "codex_request_timeout", "codex_connection_eof", "codex_reader_failed",
    "codex_json_invalid", "codex_message_invalid", "codex_response_invalid", "codex_turn_terminal_timeout",
})


def _codex_timestamp(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, (int, float)) and value > 0:
        seconds = float(value) / 1000 if value > 10_000_000_000 else float(value)
        try:
            return datetime.fromtimestamp(seconds, timezone.utc).isoformat()
        except (OSError, OverflowError, ValueError):
            return None
    return None


def _codex_turn_timing(turn: Mapping[str, Any]) -> tuple[str | None, str | None, int | None]:
    """Normalize current and legacy Codex Turn timing without inventing import time."""
    started_at = _codex_timestamp(
        turn.get("startedAt") or turn.get("started_at")
        or turn.get("createdAt") or turn.get("created_at")
    )
    completed_at = _codex_timestamp(turn.get("completedAt") or turn.get("completed_at"))
    raw_duration = turn.get("durationMs") if turn.get("durationMs") is not None else turn.get("duration_ms")
    duration_ms = int(raw_duration) if isinstance(raw_duration, (int, float)) and raw_duration >= 0 else None
    if duration_ms is not None and started_at and not completed_at:
        completed_at = (datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                        + timedelta(milliseconds=duration_ms)).isoformat()
    elif duration_ms is not None and completed_at and not started_at:
        started_at = (datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                      - timedelta(milliseconds=duration_ms)).isoformat()
    return started_at, completed_at, duration_ms
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
        turn_terminal_timeout: float = 60 * 60,
        turn_coordinator: SessionTurnCoordinator | None = None,
        lifecycle_writer_release_timeout: float = 1.0,
    ):
        self.rpc = rpc
        self.bindings = bindings
        self.models = CodexModelCatalog(rpc)
        self.accounts = CodexAccountManager(rpc)
        self.event_mapper = CodexEventMapper()
        self.run_finalizer = CodexRunFinalizer(self.event_mapper)
        self.fault_injector = fault_injector or (lambda _point: None)
        self.runtime_state = runtime_state
        self.approval_bridge = approval_bridge
        self.turn_terminal_timeout = max(0.01, float(turn_terminal_timeout))
        self.turn_coordinator = turn_coordinator or SessionTurnCoordinator()
        self.lifecycle_writer_release_timeout = max(0.05, float(lifecycle_writer_release_timeout))
        self._cancelled_runs: set[str] = set()
        self._entity_locks = EntityLockRegistry()
        self._resumed_generation: OrderedDict[str, int] = OrderedDict()
        self._maximum_resumed_sessions = 256
        self._active_turns: dict[str, asyncio.Future] = {}
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
        binary = self.rpc.active_binary
        backend_version = str(binary.version) if binary is not None and getattr(binary, "version", None) else ""
        compatibility = compatibility_for_identity(
            backend_version, getattr(binary, "schema_digest", None),
        ) if backend_version else CodexCompatibility.BLOCKED
        if compatibility is CodexCompatibility.BLOCKED:
            raise RuntimeExecutionError(
                "codex_contract_incompatible",
                "Codex App Server version is not covered by the reviewed OpenDrSai stable contract.",
                retryable=False,
                detail={"backend_version": backend_version or "unknown",
                        "reviewed_baseline": GENERATED_BASELINE["codexVersion"]},
            )
        if not self.models.is_current(self.rpc.generation):
            await self.models.refresh(generation=self.rpc.generation)
        account = await self.accounts.status()
        account_state = str(account.get("state") or ("signed_in" if account.get("logged_in") else "signed_out"))
        if account_state == "signed_out":
            raise RuntimeExecutionError(
                "codex_authentication_required",
                "Codex requires ChatGPT authentication before a Turn can be created.",
                retryable=True,
            )
        if account_state != "signed_in":
            raise RuntimeExecutionError(
                "codex_account_unavailable",
                "Codex account state could not be verified.",
                retryable=True,
                detail={"reason": account.get("reason") or account_state},
            )
        try:
            existing_session = self.bindings.get_session(context.session_id)
        except KeyError:
            existing_session = None
        bound_model = existing_session.backend_model_id if existing_session is not None else None
        if context.model_override_requested and bound_model and definition.model != bound_model:
            raise RuntimeExecutionError(
                "codex_session_model_mismatch",
                "This task is already bound to a different model. Create a new task to use the selected model.",
                retryable=False,
                detail={"bound_model": bound_model, "requested_model": definition.model},
            )
        # A model stored on the generic Agent Definition is not necessarily a
        # Codex model (the Runtime also has an OpenDrSai-wide default Provider).
        # Only an explicit Run override may select a new Codex model. New
        # sessions otherwise use App Server's advertised default, while an
        # existing session always keeps its immutable backend binding.
        requested_model = definition.model if context.model_override_requested else None
        model = self.models.select(str(bound_model or requested_model or ""))
        config = self._backend_config(definition)
        if self.approval_bridge:
            self.approval_bridge.attach_context(context)
        try:
            async with self._entity_locks.hold(f"session:{context.session_id}"):
                session = await self._ensure_session(context, definition, model.model_id, config)
            def queued(position: int) -> None:
                services.emit_normalized(context, NormalizedAgentEvent(
                    kind=NormalizedEventKind.RUN_WAITING,
                    backend="codex",
                    binding=BackendBinding(session.backend_session_id, context.run_id),
                    dedupe_key=f"codex:{context.run_id}:queue:waiting",
                    payload={"reason": "turn_queue", "queue_position": position},
                ))

            def resumed() -> None:
                services.emit_normalized(context, NormalizedAgentEvent(
                    kind=NormalizedEventKind.RUN_RESUMED,
                    backend="codex",
                    binding=BackendBinding(session.backend_session_id, context.run_id),
                    dedupe_key=f"codex:{context.run_id}:queue:resumed",
                    payload={"reason": "turn_queue_ready"},
                ))

            async with self.turn_coordinator.turn(
                session.backend_session_id,
                context.run_id,
                request_bytes=len(prompt.encode("utf-8")),
                on_queued=queued,
                on_resumed=resumed,
            ):
                async with self._entity_locks.hold(f"run:{context.run_id}"):
                    return await self._execute_run(context, definition, prompt, services, session, model.model_id, config)
        finally:
            if self.approval_bridge:
                self.approval_bridge.detach_context(context.run_id)

    async def _ensure_session(
        self, context: RuntimeRunContext, definition: AgentDefinition, model: str, config: Mapping[str, Any],
    ) -> AgentBackendSessionBinding:
        try:
            binding = self.bindings.get_session(context.session_id)
            if not binding.backend_model_id or not binding.workspace_fingerprint:
                try:
                    binding = self.bindings.adopt_session_context(
                        context.session_id, backend_model_id=model,
                        workspace_fingerprint=self._workspace_fingerprint(context.workspace_path),
                    )
                except AgentBackendBindingError as exc:
                    raise RuntimeExecutionError(exc.code, str(exc), retryable=False) from exc
            self._validate_session(binding, context, model)
            await self._resume_if_needed(binding, context)
            return binding
        except KeyError:
            pass
        request = {
            "cwd": str(context.workspace_path), "model": model,
            "developerInstructions": definition.instructions,
            # OpenDrSai owns the user interaction and audit trail. Never let a
            # host-level Codex auto-review setting bypass Approval Bridge.
            "approvalsReviewer": "user",
            **{key: value for key, value in config.items() if key in {"personality", "approvalPolicy", "sandbox"}},
        }
        operation = self.bindings.prepare_operation("session", context.session_id, "thread/start", _digest(request))
        if operation.state == "bound":
            binding = self.bindings.get_session(context.session_id)
            self._validate_session(binding, context, model)
            return binding
        if operation.state == "response_received":
            return self._complete_session(context, model)
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
        binding = self._complete_session(context, model)
        self._mark_session_resumed(context.session_id)
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
        try:
            input_items = codex_input_items(
                prompt, context.input_resources, workspace_path=context.workspace_path,
            )
        except (OSError, ValueError) as exc:
            raise RuntimeExecutionError(
                "input_resource_unavailable",
                "One or more input resources can no longer be read safely. Reattach them and retry.",
                retryable=True,
                detail={"reason": type(exc).__name__},
            ) from exc
        request = {
            "threadId": session.backend_session_id,
            "input": input_items,
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
            delta_flush_tasks: dict[tuple[str, str], asyncio.Task[None]] = {}

            def schedule_delta_flush(turn_id: str, item_id: str) -> None:
                key = (turn_id, item_id)
                current = delta_flush_tasks.get(key)
                if current is not None and not current.done():
                    return

                async def flush_after_max_wait() -> None:
                    try:
                        await asyncio.sleep(self.event_mapper.max_wait_ms / 1000)
                        self.event_mapper.flush_item(context, services, turn_id, item_id)
                    finally:
                        delta_flush_tasks.pop(key, None)

                delta_flush_tasks[key] = asyncio.create_task(flush_after_max_wait())

            async def receive(message: Mapping[str, Any]) -> None:
                params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
                turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
                notification_turn = str(params.get("turnId") or turn.get("id") or "")
                if turn_identity["id"] is None:
                    pending_notifications.append(message)
                    return
                if notification_turn and notification_turn != turn_identity["id"]:
                    return
                if turn_future.done():
                    return
                try:
                    flush_hint = self.event_mapper.handle(context, services, message)
                except Exception as error:
                    self.event_mapper.record_mapping_error(error)
                    if not turn_future.done():
                        turn_future.set_exception(RuntimeExecutionError(
                            "codex_mapping_failed",
                            "Codex emitted an event that could not be mapped safely.",
                            retryable=False,
                            detail={"run_id": context.run_id, "event": str(message.get("method") or "unknown")[:120]},
                        ))
                    return
                if flush_hint is not None and flush_hint.backend_run_id and flush_hint.backend_item_id:
                    schedule_delta_flush(flush_hint.backend_run_id, flush_hint.backend_item_id)
                if str(message.get("method") or "") == "turn/completed" and not turn_future.done():
                    turn_future.set_result(dict(params))

            async def connection_failed(error: RuntimeExecutionError) -> None:
                if self.approval_bridge:
                    await self.approval_bridge.disconnect_run(context.run_id)
                if not turn_future.done():
                    turn_future.set_exception(error)

            unsubscribe = self.rpc.on_route(receive, thread_id=session.backend_session_id)
            unsubscribe_failure = self.rpc.on_connection_failure(connection_failed)
            finalize_outcome = "failed"
            flush_policy = "flush"
            try:
                self.fault_injector("before_turn_request")
                self.bindings.mark_operation_requesting("run", context.run_id)
                result = await self.rpc.request("turn/start", request, timeout=60)
                turn_id = self._response_id(result, "turn")
                turn_identity["id"] = turn_id
                self.bindings.mark_operation_response("run", context.run_id, turn_id)
                self.fault_injector("after_turn_response_before_bind")
                run_binding = self._complete_run(context, session)
                self._active_turns[context.run_id] = turn_future
                for notification in pending_notifications:
                    await receive(notification)
                try:
                    terminal = await asyncio.wait_for(
                        asyncio.shield(turn_future), timeout=self.turn_terminal_timeout,
                    )
                    terminal_turn = terminal.get("turn") if isinstance(terminal.get("turn"), Mapping) else terminal
                    finalize_outcome = str(terminal_turn.get("status") or "failed")
                except asyncio.TimeoutError as timeout_error:
                    raise RuntimeExecutionError(
                        "codex_turn_terminal_timeout",
                        "Codex Turn did not publish a terminal state before the recovery deadline.",
                        retryable=True,
                        detail={"run_id": context.run_id, "turn_id": turn_identity["id"]},
                    ) from timeout_error
            except RuntimeExecutionError as exc:
                finalize_outcome = {
                    "run_cancelled": "interrupted",
                    "codex_turn_terminal_timeout": "timeout",
                    "codex_connection_eof": "disconnect",
                    "codex_reader_failed": "disconnect",
                    "codex_mapping_failed": "mapping_failed",
                }.get(exc.code, "failed")
                if exc.code == "codex_mapping_failed":
                    flush_policy = "discard"
                if not turn_identity["id"]:
                    self._settle_failed_operation("run", context.run_id, exc)
                if exc.code in _AMBIGUOUS_ERRORS and turn_identity["id"]:
                    try:
                        await self.recover_turn(context.run_id)
                        recovered = self.bindings.get_run(context.run_id)
                    except RuntimeExecutionError as recovery_error:
                        raise RuntimeExecutionError(
                            "codex_turn_recovery_required",
                            "Codex disconnected while the Turn result was being confirmed.",
                            retryable=True,
                            detail={"run_id": context.run_id, "turn_id": turn_identity["id"],
                                    "cause": exc.code, "recovery": recovery_error.code},
                        ) from recovery_error
                    if recovered.status not in _TERMINAL:
                        raise RuntimeExecutionError(
                            "codex_turn_recovery_required",
                            "Codex disconnected and the Turn is not in a confirmed terminal state.",
                            retryable=True,
                            detail={"run_id": context.run_id, "turn_id": turn_identity["id"],
                                    "cause": exc.code, "recovery": recovered.status},
                        )
                    finalize_outcome = recovered.status
                    return self._terminal_result(
                        context, services, recovered, {"turn": {"status": recovered.status}},
                    )
                raise
            finally:
                def release_run_state() -> None:
                    self._active_turns.pop(context.run_id, None)
                    self._cancelled_runs.discard(context.run_id)

                await self.run_finalizer.finalize(
                    context,
                    services,
                    outcome=finalize_outcome,
                    backend_turn_id=str(turn_identity["id"] or ""),
                    flush_policy=flush_policy,
                    tasks=tuple(delta_flush_tasks.values()),
                    unsubscribe=(unsubscribe, unsubscribe_failure),
                    approval_bridge=self.approval_bridge,
                    release=release_run_state,
                )
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
        self.bindings.update_run_state(context.run_id, generation=self.rpc.generation, status=status)
        metadata = {"thread_id": self.bindings.get_session(context.session_id).backend_session_id,
                    "turn_id": binding.backend_run_id}
        if status == "completed":
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
        active = self._active_turns.get(run_id)
        if active is not None and not active.done():
            active.set_exception(RuntimeExecutionError("run_cancelled", "Codex Turn was cancelled."))

    async def archive_session(self, session_id: str, *, archived: bool) -> None:
        """Mirror an OpenDrSai session archive transition to its Codex Thread."""
        await self.rpc.connect()
        session = self.bindings.get_session(session_id)
        method = "thread/archive" if archived else "thread/unarchive"
        deadline = asyncio.get_running_loop().time() + self.lifecycle_writer_release_timeout
        delay = 0.05
        generation_rotated = False
        async with self._entity_locks.hold(f"session:{session_id}"):
            if archived and self._resumed_generation.get(session_id) == self.rpc.generation:
                # Current Codex versions retain an exclusive writer while a
                # Thread is loaded by this App Server connection. Release that
                # writer explicitly before archive, then force the next Turn
                # to resume the same authoritative Thread binding.
                await self.rpc.request("thread/unsubscribe", {"threadId": session.backend_session_id})
                self._resumed_generation.pop(session_id, None)
            while True:
                try:
                    await self.rpc.request(method, {"threadId": session.backend_session_id})
                    return
                except RuntimeExecutionError as exc:
                    active_writer = (
                        exc.code == "codex_jsonrpc_error"
                        and "active writer" in str(exc).lower()
                    )
                    remaining = deadline - asyncio.get_running_loop().time()
                    if not active_writer:
                        raise
                    if remaining <= 0:
                        if archived and not generation_rotated and not self._active_turns:
                            # App Server has no per-Thread unload operation.
                            # When an idle process retains the rollout writer
                            # after unsubscribe, rotate the process generation
                            # so archive can safely move the transcript. Never
                            # do this while another Session has an active Turn.
                            await self.rpc.reconnect()
                            self._resumed_generation.clear()
                            generation_rotated = True
                            deadline = (asyncio.get_running_loop().time()
                                        + self.lifecycle_writer_release_timeout)
                            delay = 0.05
                            continue
                        raise RuntimeExecutionError(
                            "codex_session_busy",
                            "This task is still finishing its current response. Wait a moment, then try again.",
                            retryable=True,
                            detail={"operation": method, "thread_id": session.backend_session_id},
                        ) from exc
                    await asyncio.sleep(min(delay, remaining))
                    delay = min(0.5, delay * 2)

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        if self.approval_bridge is None:
            raise RuntimeExecutionError("approval_bridge_not_ready", "Codex Approval Bridge is not configured.")
        native = {"approved": "accept", "denied": "decline", "cancelled": "cancel"}.get(decision)
        if native is None:
            raise RuntimeExecutionError("approval_decision_invalid", "Approval decision is invalid.")
        await self.approval_bridge.respond(run_id, approval_id, native)

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
        self.bindings.update_run_state(run_id, generation=self.rpc.generation, status=status)
        self._converge_runtime(run_id, status)

    async def health(self) -> Mapping[str, Any]:
        health = await self.rpc.health()
        if not health.get("available") and health.get("reason") == "not_running":
            try:
                binary = self.rpc.resolve_binary()
                health = {
                    **health, "available": True, "reason": "ready_not_started",
                    "version": binary.version, "release_safe": binary.release_safe,
                }
            except RuntimeExecutionError as exc:
                health = {**health, "available": False, "reason": exc.code, "retryable": exc.retryable}
        backend_version = str(health.get("version") or "")
        active_binary = self.rpc.active_binary
        schema_digest = getattr(active_binary, "schema_digest", None) if active_binary is not None else None
        compatibility = compatibility_for_identity(
            backend_version, schema_digest,
        ) if backend_version else CodexCompatibility.BLOCKED
        # Development may deliberately point CODEX_BIN at a protocol fixture.
        # It remains non-release-safe and execute_turn still enforces the real
        # Codex Contract before starting a Turn.
        contract_available = bool(health.get("available")) and (
            compatibility is not CodexCompatibility.BLOCKED or health.get("release_safe") is False
        )
        installed = bool(health.get("available"))
        model_catalog = self.models.capability(current_generation=self.rpc.generation)
        transport_state = "ready" if health.get("available") and health.get("reason") != "ready_not_started" else (
            "stopped" if health.get("reason") == "ready_not_started" else "fault"
        )
        installed_state = "ready" if installed else (
            "missing" if health.get("reason") in {"codex_not_installed", "not_installed", "not_configured"} else "unknown"
        )
        contract_state = "ready" if contract_available else (
            "blocked" if health.get("available") else "unknown"
        )
        models = model_catalog.get("models") if isinstance(model_catalog.get("models"), list) else []
        visible_models = [model for model in models if isinstance(model, Mapping) and not model.get("hidden")]
        model_state = "stale" if model_catalog.get("stale") else ("ready" if visible_models else "empty")
        blockers = []
        if installed_state != "ready":
            blockers.append("installed")
        if transport_state == "fault":
            blockers.append("transport")
        if contract_state != "ready":
            blockers.append("contract")
        if model_state != "ready":
            blockers.append("models")
        return {
            **health,
            "available": contract_available,
            "installed": installed,
            "contract_compatible": contract_available,
            "reason": (health.get("reason") if contract_available else
                       ("codex_contract_incompatible" if health.get("available") else health.get("reason"))),
            "connection_state": self.rpc.state,
            "app_server_state": "running" if health.get("available") and health.get("reason") != "ready_not_started" else "stopped",
            "transport": str(health.get("transport") or "local-process"),
            "adapter_version": CODEX_ADAPTER_MAPPING_VERSION,
            "contract": {
                "version": 2,
                "digest": CONTRACT_DIGEST,
                "baseline_codex_version": GENERATED_BASELINE["codexVersion"],
                "actual_codex_version": backend_version or None,
                "actual_schema_digest": schema_digest,
                "compatibility": compatibility.value,
            },
            "model_catalog": model_catalog,
            "readiness": {
                "refreshed_at": datetime.now(timezone.utc).isoformat(),
                "transport": {"state": transport_state, "reason": health.get("reason")},
                "installed": {"state": installed_state, "reason": health.get("reason") if installed_state != "ready" else None},
                "contract": {"state": contract_state, "reason": None if contract_state == "ready" else "codex_contract_incompatible"},
                "account": {"state": "unknown", "reason": "not_probed"},
                "models": {"state": model_state, "reason": model_catalog.get("error")},
                "executable": {"state": "unknown", "reason": "account_not_probed", "blockers": blockers},
            },
            "run_finalizer": self.run_finalizer.diagnostics(),
            "turn_coordinator": self.turn_coordinator.diagnostics(),
            "entity_locks": self._entity_locks.diagnostics(),
            "resumed_session_cache": {"entries": len(self._resumed_generation),
                                      "maximum_entries": self._maximum_resumed_sessions},
            "cancelled_runs": {"entries": len(self._cancelled_runs)},
            "approval_bridge": self.approval_bridge.diagnostics() if self.approval_bridge else None,
            "oaep_metrics": self.event_mapper.diagnostics_snapshot(),
        }

    async def restart_backend(self) -> Mapping[str, Any]:
        initialized = await self.rpc.reconnect()
        health = await self.health()
        return {
            **health,
            "restarted": True,
            "protocol_version": initialized.get("protocolVersion") if isinstance(initialized, Mapping) else None,
        }

    async def session_binding_status(self, session_id: str) -> Mapping[str, Any]:
        """Return the Runtime-owned continuation state without contacting UI heuristics."""
        try:
            binding = self.bindings.get_session(session_id)
            return {
                "session_id": session_id,
                "backend_id": "codex",
                "backend": "codex",
                "state": "bound",
                "backend_session_id": binding.backend_session_id,
                "thread_id": binding.backend_session_id,
                "backend_version": binding.backend_version,
                "backend_model_id": binding.backend_model_id,
                "model_id": binding.backend_model_id,
                "workspace_fingerprint": binding.workspace_fingerprint,
                "available_actions": ["continue", "archive", "new_task"],
            }
        except KeyError:
            pass
        try:
            operation = self.bindings.get_operation("session", session_id)
        except KeyError:
            return {
                "session_id": session_id, "backend_id": "codex", "backend": "codex",
                "state": "unbound", "available_actions": ["bind", "new_task"],
            }
        if operation.error_code == "agent_backend_session_binding_conflict":
            state = "conflict"
        elif operation.state in {"requesting", "response_received", "unknown"}:
            state = "recovery-required"
        else:
            state = "unbound"
        return {
            "session_id": session_id,
            "backend_id": "codex",
            "backend": "codex",
            "state": state,
            "operation_state": operation.state,
            "reason": operation.error_code,
            "available_actions": (
                ["recover", "new_task"] if state == "recovery-required"
                else ["sync", "new_task"] if state == "conflict"
                else ["bind", "new_task"]
            ),
        }

    async def model_catalog(self, *, refresh: bool = False) -> Mapping[str, Any]:
        await self.rpc.connect()
        binary = self.rpc.active_binary
        backend_version = str(binary.version) if binary is not None and getattr(binary, "version", None) else ""
        if not backend_version or compatibility_for_version(backend_version) is CodexCompatibility.BLOCKED:
            raise RuntimeExecutionError(
                "codex_contract_incompatible",
                "Codex App Server version is not covered by the reviewed stable contract.",
                retryable=False,
            )
        if refresh or not self.models.is_current(self.rpc.generation):
            await self.models.refresh(generation=self.rpc.generation, force=refresh)
        return self.models.capability(current_generation=self.rpc.generation)

    async def discover_sessions(self, workspace_path: str) -> list[Mapping[str, Any]]:
        await self.rpc.connect()
        expected = os.path.normcase(str(Path(workspace_path).resolve(strict=False)))
        discovered: dict[str, dict[str, Any]] = {}
        for archived in (False, True):
            cursor: str | None = None
            for _ in range(100):
                params: dict[str, Any] = {
                    "limit": 100,
                    "archived": archived,
                    # App Server performs the first filter; the normalized
                    # comparison below remains a fail-closed trust boundary.
                    "cwd": str(Path(workspace_path).resolve(strict=False)),
                }
                if cursor:
                    params["cursor"] = cursor
                response = await self.rpc.request("thread/list", params)
                rows = response.get("data") if isinstance(response, Mapping) else None
                if not isinstance(rows, list):
                    rows = response.get("threads") if isinstance(response, Mapping) else []
                for raw in rows if isinstance(rows, list) else []:
                    if not isinstance(raw, Mapping):
                        continue
                    thread_id = str(raw.get("id") or "").strip()
                    cwd = str(raw.get("cwd") or raw.get("workdir") or "").strip()
                    if not thread_id or not cwd:
                        continue
                    try:
                        actual = os.path.normcase(str(Path(cwd).resolve(strict=False)))
                    except OSError:
                        continue
                    if actual != expected:
                        continue
                    title = str(raw.get("name") or raw.get("title") or "Codex session").strip()[:240] or "Codex session"
                    discovered[thread_id] = {
                        "backend_session_id": thread_id,
                        "title": title,
                        "archived": archived,
                        "created_at": _codex_timestamp(raw.get("createdAt") or raw.get("created_at")),
                        "updated_at": _codex_timestamp(raw.get("updatedAt") or raw.get("updated_at")),
                    }
                next_cursor = response.get("nextCursor") if isinstance(response, Mapping) else None
                cursor = str(next_cursor).strip() if next_cursor else None
                if not cursor:
                    break
        return sorted(discovered.values(), key=lambda item: str(item.get("updated_at") or ""), reverse=True)

    async def bind_imported_session(
        self, session_id: str, workspace_id: str, runtime_id: str, backend_session_id: str,
        *, backend_version: str | None = None, backend_updated_at: str | None = None,
    ) -> None:
        existing = self.bindings.find_session_by_backend_id("codex", backend_session_id)
        if existing is not None:
            if existing.session_id != session_id or existing.workspace_id != workspace_id:
                raise RuntimeExecutionError("codex_import_binding_conflict", "Codex Thread is already bound to another Session or Workspace.")
            self.bindings.update_history_source(session_id, backend_updated_at)
            return
        if backend_version is None:
            health = await self.health()
            backend_version = str(health.get("version") or "unknown")
        self.bindings.bind_session(
            session_id=session_id,
            workspace_id=workspace_id,
            backend_id="codex",
            agent_backend_runtime_id=runtime_id,
            workspace_runtime_id=runtime_id,
            backend_session_id=backend_session_id,
            backend_version=backend_version,
        )
        self.bindings.update_history_source(session_id, backend_updated_at)

    async def history_sync_watermark(self, session_id: str) -> Mapping[str, Any] | None:
        return self.bindings.get_history_watermark(session_id)

    async def mark_history_synced(self, session_id: str, **values: Any) -> None:
        self.bindings.mark_history_synced(session_id, **values)

    def history_capability(self) -> Mapping[str, Any]:
        from drsai.backend.runtime.history import HistoryCapability
        return HistoryCapability(
            mapping_version=CODEX_ADAPTER_MAPPING_VERSION,
            page_size=100,
            maximum_page_size=500,
            native_pagination=False,
            recent_first=True,
        ).as_dict()

    def plan_history_migration(
        self, session_id: str, history: list[Mapping[str, Any]],
        existing_items: list[Mapping[str, Any]], existing_events: list[Mapping[str, Any]],
        *, mapping_version: str, reasons: list[str],
    ) -> Mapping[str, Any]:
        from drsai.backend.codex_adapter.history_migration import codex_history_migration_dry_run
        if not reasons:
            return {
                "mode": "skipped", "mapping_version": mapping_version,
                "affected_items": 0, "reasons": {}, "content_redacted": True,
            }
        result = codex_history_migration_dry_run(
            session_id, history, existing_items, existing_events,
            mapping_version=mapping_version,
        )
        return {**result, "triggers": list(reasons)}

    async def read_normalized_history(
        self, session_id: str, *, cursor: str | None = None, limit: int = 100,
    ) -> Mapping[str, Any]:
        history = await self._read_all_normalized_history(session_id)
        binding = self.bindings.get_session(session_id)
        digest = hashlib.sha256(json.dumps(history, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
        before = len(history)
        if cursor:
            try:
                decoded = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode("utf-8"))
                if decoded.get("v") != 1 or decoded.get("thread") != binding.backend_session_id \
                        or decoded.get("mapping") != CODEX_ADAPTER_MAPPING_VERSION or decoded.get("digest") != digest:
                    raise ValueError
                before = int(decoded["before"])
            except Exception as exc:
                raise RuntimeExecutionError("history_cursor_expired", "History changed while older content was loading.") from exc
        bounded = max(1, min(int(limit), 500))
        start = max(0, before - bounded)
        turns = history[start:before]
        next_cursor = None
        if start > 0:
            payload = {"v": 1, "thread": binding.backend_session_id, "mapping": CODEX_ADAPTER_MAPPING_VERSION,
                       "digest": digest, "before": start}
            next_cursor = base64.urlsafe_b64encode(
                json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).decode("ascii").rstrip("=")
        return {
            "turns": turns, "next_cursor": next_cursor, "estimated_total": len(history),
            "truncated": next_cursor is not None, "mapping_version": CODEX_ADAPTER_MAPPING_VERSION,
            "order": "chronological_within_recent_window",
        }

    async def read_imported_session_history(self, session_id: str) -> list[Mapping[str, Any]]:
        """Read a Codex Thread as bounded, normalized historical Turns."""
        return list(await self._read_all_normalized_history(session_id))

    async def _read_all_normalized_history(self, session_id: str) -> list[Mapping[str, Any]]:
        binding = self.bindings.get_session(session_id)
        backend_session_id = binding.backend_session_id
        await self.rpc.connect()
        result = await self.rpc.request(
            "thread/read", {"threadId": backend_session_id, "includeTurns": True}
        )
        thread = result.get("thread") if isinstance(result, Mapping) and isinstance(result.get("thread"), Mapping) else {}
        turns = thread.get("turns") if isinstance(thread.get("turns"), list) else []
        # Only historical reprojection enables the narrowly scoped repair for
        # pre-OAEP serialized message-parts. Live text remains literal.
        decoder = CodexNativeEventDecoder(history_mode=True)
        history: list[Mapping[str, Any]] = []
        for turn_index, raw_turn in enumerate(turns[:10_000]):
            if not isinstance(raw_turn, Mapping):
                continue
            turn_id = str(raw_turn.get("id") or f"turn-{turn_index}")
            started_at, completed_at, duration_ms = _codex_turn_timing(raw_turn)
            raw_items = raw_turn.get("items") if isinstance(raw_turn.get("items"), list) else []
            items: list[dict[str, Any]] = []
            for item_index, raw_item in enumerate(raw_items[:20_000]):
                if not isinstance(raw_item, Mapping):
                    continue
                native_item = dict(raw_item)
                native_item.setdefault("id", f"item-{turn_index}-{item_index}-{hashlib.sha256(json.dumps(native_item, sort_keys=True, default=str).encode()).hexdigest()[:16]}")
                decoded = decoder.decode({
                    "method": "item/completed",
                    "params": {"threadId": backend_session_id, "turnId": turn_id, "item": native_item},
                })
                if decoded is None or decoded.item_type is None:
                    continue
                payload = dict(decoded.payload)
                payload["status"] = str(payload.get("status") or "completed")
                items.append({
                    "item_id": str(native_item["id"]),
                    "kind": decoded.item_type.value,
                    "role": payload.get("role"),
                    "status": payload["status"],
                    "payload": payload,
                })
            history.append({
                "backend_run_id": turn_id,
                "backend_run_index": turn_index,
                "status": str(raw_turn.get("status") or "completed"),
                "created_at": started_at,
                "completed_at": completed_at,
                "duration_ms": duration_ms,
                "items": items,
            })
        return history

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
        if self._resumed_generation.get(context.session_id) == self.rpc.generation:
            return
        result = await self.rpc.request("thread/resume", {
            "threadId": binding.backend_session_id, "cwd": str(context.workspace_path),
            "approvalsReviewer": "user",
        })
        returned = self._response_id(result, "thread")
        if returned != binding.backend_session_id:
            raise RuntimeExecutionError("codex_thread_identity_mismatch", "Codex resumed a different Thread identity.")
        self._mark_session_resumed(context.session_id)

    def _mark_session_resumed(self, session_id: str) -> None:
        self._resumed_generation.pop(session_id, None)
        self._resumed_generation[session_id] = self.rpc.generation
        while len(self._resumed_generation) > self._maximum_resumed_sessions:
            self._resumed_generation.popitem(last=False)

    def _complete_session(self, context: RuntimeRunContext, model: str) -> AgentBackendSessionBinding:
        try:
            version = self.rpc.active_binary.version if self.rpc.active_binary else None
            return self.bindings.complete_session_operation(
                session_id=context.session_id, workspace_id=context.workspace_id, backend_id="codex",
                agent_backend_runtime_id=str(context.agent_backend_runtime_id),
                workspace_runtime_id=str(context.workspace_runtime_id), backend_version=version or "development",
                backend_model_id=model, workspace_fingerprint=self._workspace_fingerprint(context.workspace_path),
            )
        except AgentBackendBindingError as exc:
            raise RuntimeExecutionError(exc.code, str(exc)) from exc

    def _complete_run(self, context: RuntimeRunContext, session: AgentBackendSessionBinding) -> AgentBackendRunBinding:
        try:
            return self.bindings.complete_run_operation(
                run_id=context.run_id, session_id=session.session_id, workspace_id=context.workspace_id,
                backend_id="codex", agent_backend_runtime_id=str(context.agent_backend_runtime_id),
                workspace_runtime_id=str(context.workspace_runtime_id), generation=self.rpc.generation,
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

    @classmethod
    def _validate_session(cls, binding: AgentBackendSessionBinding, context: RuntimeRunContext, model: str) -> None:
        if (binding.workspace_id, binding.backend_id, binding.agent_backend_runtime_id, binding.workspace_runtime_id) != (
            context.workspace_id, "codex", context.agent_backend_runtime_id, context.workspace_runtime_id
        ):
            raise RuntimeExecutionError("agent_backend_session_binding_conflict", "Codex Session binding does not match Run Context.")
        if binding.backend_model_id and binding.backend_model_id != model:
            raise RuntimeExecutionError(
                "codex_session_model_mismatch",
                "This Codex Session is bound to a different model; create a new task or explicitly migrate it.",
                retryable=False,
                detail={"bound_model": binding.backend_model_id, "requested_model": model},
            )
        fingerprint = cls._workspace_fingerprint(context.workspace_path)
        if binding.workspace_fingerprint and binding.workspace_fingerprint != fingerprint:
            raise RuntimeExecutionError(
                "codex_session_workspace_mismatch",
                "This Codex Session belongs to a different canonical Workspace.",
                retryable=False,
            )

    @staticmethod
    def _workspace_fingerprint(path: Path) -> str:
        canonical = os.path.normcase(str(path.resolve(strict=False)))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

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
