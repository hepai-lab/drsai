"""Codex account, permission, approval, cancel, and audit bridges."""

from __future__ import annotations

import asyncio
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from drsai.backend.runtime.agent_bindings import AgentBackendBindingStore
from drsai.backend.runtime.agent import RuntimeExecutionError, RuntimeRunContext
from drsai.backend.runtime.error_contract import error_category
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient


_SECRET_KEY = re.compile(r"(?:token|secret|password|cookie|authorization|api.?key|credential|userCode|authUrl)", re.I)
_APPROVAL_METHODS = {
    "item/commandExecution/requestApproval": "command",
    "item/fileChange/requestApproval": "file_change",
    "item/permissions/requestApproval": "permissions",
}
_REQUIRED_PERMISSIONS = {
    "command": frozenset({"process:execute", "process:*", "shell:*"}),
    "file_change": frozenset({"workspace:write", "files:write", "files:*"}),
    "permissions": frozenset({"permissions:grant"}),
}


class CodexAccountManager:
    def __init__(self, rpc: CodexJSONRPCClient):
        self.rpc = rpc

    async def status(self, *, refresh: bool = False) -> dict[str, Any]:
        try:
            result = await self.rpc.request("account/read", {"refreshToken": bool(refresh)})
        except RuntimeExecutionError as exc:
            category = error_category(exc.code)
            state = "unavailable" if category in {"transport", "runtime", "backend"} else "unknown"
            return {
                "state": state, "logged_in": False, "auth_mode": None, "email": None, "plan_type": None,
                "credential_source": None, "requires_openai_auth": True,
                "reason": exc.code, "retryable": exc.retryable,
            }
        account = result.get("account") if isinstance(result, Mapping) and isinstance(result.get("account"), Mapping) else None
        auth_type = str(account.get("type")) if account and account.get("type") else None
        return {
            "state": "signed_in" if account is not None else "signed_out",
            "logged_in": account is not None,
            "auth_mode": auth_type,
            "email": str(account.get("email")) if account and account.get("email") else None,
            "plan_type": str(account.get("planType")) if account and account.get("planType") else None,
            "credential_source": str(account.get("credentialSource")) if account and account.get("credentialSource") else None,
            "requires_openai_auth": bool(result.get("requiresOpenaiAuth")) if isinstance(result, Mapping) else True,
            "reason": None,
        }

    async def login_start(self, login_type: str = "chatgpt") -> dict[str, Any]:
        if login_type not in {"chatgpt", "chatgptDeviceCode"}:
            raise RuntimeExecutionError("codex_login_type_invalid", "Only managed ChatGPT login flows are exposed.")
        result = await self.rpc.request("account/login/start", {"type": login_type})
        if not isinstance(result, Mapping):
            raise RuntimeExecutionError("codex_login_response_invalid", "Codex login response is invalid.")
        allowed = {"type", "loginId", "authUrl", "verificationUrl", "userCode"}
        return {key: value for key, value in result.items() if key in allowed}

    async def login_cancel(self, login_id: str) -> None:
        await self.rpc.request("account/login/cancel", {"loginId": login_id})

    async def logout(self) -> None:
        await self.rpc.request("account/logout", {})


@dataclass
class _PendingApproval:
    approval_id: str
    run_id: str
    backend_key: str
    future: asyncio.Future
    waiters: int = 0
    response_decision: str | None = None


class CodexApprovalBridge:
    def __init__(
        self,
        rpc: CodexJSONRPCClient,
        runtime_state: Any,
        bindings: AgentBackendBindingStore,
        *,
        timeout_seconds: float = 300,
        audit_context: Callable[[str], Mapping[str, Any]] | None = None,
    ):
        self.rpc = rpc
        self.runtime_state = runtime_state
        self.bindings = bindings
        self.timeout_seconds = timeout_seconds
        self.audit_context = audit_context or (lambda _run_id: {"principal": "runtime-user"})
        self.contexts: dict[str, RuntimeRunContext] = {}
        self.pending: dict[str, _PendingApproval] = {}
        self.pending_by_backend_key: dict[str, _PendingApproval] = {}
        self.resolved_by_backend_key: OrderedDict[str, tuple[str, str, float]] = OrderedDict()
        self._singleflight_lock = asyncio.Lock()
        for method in _APPROVAL_METHODS:
            rpc.handle_server_request(method, self._handler(method))

    def attach_context(self, context: RuntimeRunContext) -> None:
        self.contexts[context.run_id] = context

    def detach_context(self, run_id: str) -> None:
        self.contexts.pop(run_id, None)

    def _handler(self, method: str):
        async def handle(message: Mapping[str, Any]) -> Mapping[str, Any]:
            return await self.handle_request(method, message)
        return handle

    async def handle_request(self, method: str, message: Mapping[str, Any]) -> Mapping[str, Any]:
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        thread_id, turn_id = str(params.get("threadId") or ""), str(params.get("turnId") or "")
        try:
            binding = self.bindings.find_run_by_backend_ids(thread_id, turn_id)
        except KeyError as exc:
            raise RuntimeExecutionError("codex_approval_binding_missing", "Approval does not map to a Runtime Run.") from exc
        run_id = binding.run_id
        operation = _APPROVAL_METHODS[method]
        context = self.contexts.get(run_id)
        granted = context.permissions if context else frozenset()
        required = _REQUIRED_PERMISSIONS[operation]
        if not required.intersection(granted):
            self._audit(run_id, "audit.codex.approval.permission_denied", method, params, {
                "operation": operation, "required_any": sorted(required), "approval_created": False,
            })
            return {"decision": "decline"} if operation != "permissions" else {"permissions": []}
        generation = int(getattr(self.rpc, "generation", 0) or 0)
        backend_key = f"g{generation}:{method}:{thread_id}:{turn_id}:{params.get('itemId') or message.get('id')}"
        async with self._singleflight_lock:
            now = time.monotonic()
            while self.resolved_by_backend_key:
                oldest_key, oldest = next(iter(self.resolved_by_backend_key.items()))
                if now - oldest[2] <= 60:
                    break
                self.resolved_by_backend_key.pop(oldest_key, None)
            cached = self.resolved_by_backend_key.get(backend_key)
            if cached is not None and cached[0] == run_id and now - cached[2] <= 60:
                self.resolved_by_backend_key.move_to_end(backend_key)
                return self._native_response(operation, cached[1], params)
            pending = self.pending_by_backend_key.get(backend_key)
            if pending is None:
                approval = self.runtime_state.request_approval(run_id, {
                    "backend": "codex", "backend_approval_key": backend_key, "method": method,
                    "operation": operation, "params": self._safe(params), "transport_generation": generation,
                })
                approval_id = approval["approval_id"]
                pending = _PendingApproval(
                    approval_id, run_id, backend_key, asyncio.get_running_loop().create_future(),
                )
                self.pending[approval_id] = pending
                self.pending_by_backend_key[backend_key] = pending
                self._audit(run_id, "audit.codex.approval.requested", method, params, {
                    "approval_id": approval_id, "operation": operation, "approval_created": True,
                    "transport_generation": generation,
                })
            elif pending.run_id != run_id:
                raise RuntimeExecutionError(
                    "codex_approval_identity_conflict",
                    "Approval identity was reused by another Run.",
                )
            pending.waiters += 1
            approval_id = pending.approval_id
        try:
            decision = await asyncio.wait_for(asyncio.shield(pending.future), timeout=self.timeout_seconds)
        except asyncio.TimeoutError:
            await self._resolve_once(
                pending, "cancel", "expired", "audit.codex.approval.expired", method, params,
                {"reason": "codex_approval_timeout"},
            )
            decision = "cancel"
        finally:
            async with self._singleflight_lock:
                pending.waiters = max(0, pending.waiters - 1)
                if pending.waiters == 0 and pending.future.done():
                    self.resolved_by_backend_key[backend_key] = (
                        pending.run_id, str(pending.response_decision or decision), time.monotonic(),
                    )
                    self.resolved_by_backend_key.move_to_end(backend_key)
                    while len(self.resolved_by_backend_key) > 256:
                        self.resolved_by_backend_key.popitem(last=False)
                    self.pending.pop(approval_id, None)
                    self.pending_by_backend_key.pop(backend_key, None)
        return self._native_response(operation, decision, params)

    @staticmethod
    def _native_response(operation: str, decision: str, params: Mapping[str, Any]) -> Mapping[str, Any]:
        if operation == "permissions":
            requested = params.get("permissions") if isinstance(params.get("permissions"), list) else []
            return {"permissions": requested if decision in {"accept", "acceptForSession"} else [],
                    **({"scope": "session"} if decision == "acceptForSession" else {})}
        return {"decision": decision}

    async def respond(self, run_id: str, approval_id: str, decision: str) -> None:
        if decision not in {"accept", "acceptForSession", "decline", "cancel"}:
            raise RuntimeExecutionError("approval_decision_invalid", "Codex approval decision is invalid.")
        approval = self.runtime_state.get_approval(approval_id)
        if approval["run_id"] != run_id:
            raise RuntimeExecutionError("approval_run_mismatch", "Approval does not belong to this Run.")
        engine_decision = "approved" if decision in {"accept", "acceptForSession"} else (
            "cancelled" if decision == "cancel" else "denied"
        )
        pending = self.pending.get(approval_id)
        if pending is None or approval["status"] != "pending":
            return
        request = approval["request"]
        await self._resolve_once(
            pending, decision, engine_decision, f"audit.codex.approval.{engine_decision}",
            str(request.get("method") or "approval"),
            request.get("params") if isinstance(request.get("params"), Mapping) else {},
            {"codex_decision": decision},
        )

    async def _resolve_once(
        self, pending: _PendingApproval, native_decision: str, engine_decision: str,
        audit_event: str, method: str, params: Mapping[str, Any], detail: Mapping[str, Any],
    ) -> None:
        async with self._singleflight_lock:
            if pending.future.done():
                return
            approval = self.runtime_state.get_approval(pending.approval_id)
            if approval["status"] == "pending":
                self.runtime_state.resolve_approval(
                    pending.approval_id, engine_decision, dict(detail), resume_on_denied=True,
                )
            pending.response_decision = native_decision
            pending.future.set_result(native_decision)
            self._audit(pending.run_id, audit_event, method, params, {
                "approval_id": pending.approval_id, "decision": native_decision,
            })

    def recover_orphaned_pending(self) -> int:
        recovered = 0
        for approval in self.runtime_state.list_pending_approvals():
            if approval.get("request", {}).get("backend") != "codex":
                continue
            self.runtime_state.resolve_approval(
                approval["approval_id"], "expired", {"reason": "runtime_restarted_with_pending_codex_approval"},
                resume_on_denied=True,
            )
            self.runtime_state.append_event(approval["run_id"], "approval.recovered", {
                "approval_id": approval["approval_id"], "policy": "fail_closed_timeout",
            })
            recovered += 1
        return recovered

    async def cancel_run(self, run_id: str) -> None:
        for pending in list({value.approval_id: value for value in self.pending.values()}.values()):
            if pending.run_id == run_id:
                await self.respond(run_id, pending.approval_id, "cancel")

    async def disconnect_run(self, run_id: str) -> None:
        """Fail closed when the transport generation owning an approval is lost."""
        for pending in list({value.approval_id: value for value in self.pending.values()}.values()):
            if pending.run_id != run_id:
                continue
            approval = self.runtime_state.get_approval(pending.approval_id)
            request = approval.get("request") if isinstance(approval.get("request"), Mapping) else {}
            await self._resolve_once(
                pending, "cancel", "disconnected", "audit.codex.approval.disconnected",
                str(request.get("method") or "approval"),
                request.get("params") if isinstance(request.get("params"), Mapping) else {},
                {"reason": "codex_transport_generation_lost"},
            )

    def diagnostics(self) -> dict[str, int]:
        return {
            "contexts": len(self.contexts), "pending": len(self.pending),
            "pending_backend_keys": len(self.pending_by_backend_key),
            "resolved_decisions": len(self.resolved_by_backend_key),
            "maximum_resolved_decisions": 256, "resolved_decision_ttl_seconds": 60,
        }

    def _audit(
        self, run_id: str, event_type: str, method: str, params: Mapping[str, Any], extra: Mapping[str, Any],
    ) -> None:
        run = self.runtime_state.get_run(run_id)
        binding = self.bindings.get_run(run_id)
        context = dict(self.audit_context(run_id))
        payload = {
            "principal": context.get("principal", "runtime-user"),
            "runtime_id": run["runtime_id"], "workspace_id": run["workspace_id"],
            "session_id": run["session_id"], "run_id": run_id, "backend": "codex",
            "turn_id": binding.backend_run_id, "operation": method,
            "correlation_id": context.get("correlation_id") or f"codex:{binding.backend_run_id}",
            "request": self._safe(params), **dict(extra),
        }
        self.runtime_state.append_event(run_id, event_type, payload)

    @classmethod
    def _safe(cls, value: Any, key: str = "") -> Any:
        if _SECRET_KEY.search(key):
            return "[REDACTED]"
        if isinstance(value, Mapping):
            return {str(child_key): cls._safe(child, str(child_key)) for child_key, child in value.items()}
        if isinstance(value, list):
            return [cls._safe(child) for child in value[:100]]
        if isinstance(value, str):
            return value[:4000]
        return value if isinstance(value, (int, float, bool, type(None))) else str(type(value).__name__)
