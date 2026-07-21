"""Agent Backend adapter for a Runtime-owned Codex App Server client."""

from __future__ import annotations

from typing import Any, Mapping, Protocol

from drsai.backend.agent_runtime import (
    AgentDefinition,
    AgentExecutionServices,
    RuntimeExecutionError,
    RuntimeRunContext,
)


class CodexAppServerClient(Protocol):
    async def execute_turn(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: AgentExecutionServices,
    ) -> dict[str, Any]: ...

    async def interrupt_turn(self, run_id: str) -> None: ...
    async def archive_session(self, session_id: str, *, archived: bool) -> None: ...
    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None: ...
    async def recover_turn(self, run_id: str) -> None: ...
    async def health(self) -> Mapping[str, Any]: ...
    async def close(self) -> None: ...
    async def account_status(self, *, refresh: bool = False) -> Mapping[str, Any]: ...
    async def account_login_start(self, login_type: str = "chatgpt") -> Mapping[str, Any]: ...
    async def account_login_cancel(self, login_id: str) -> None: ...
    async def account_logout(self) -> None: ...


class CodexAdapter:
    """The only OpenDrSai-to-Codex semantic translation boundary."""

    backend_id = "codex"

    def __init__(self, client: CodexAppServerClient | None = None):
        self._client = client
        self._closed = False

    def _require_client(self) -> CodexAppServerClient:
        if self._closed:
            raise RuntimeExecutionError("agent_backend_closed", "Codex Agent Backend is closed.")
        if self._client is None:
            raise RuntimeExecutionError(
                "codex_backend_unavailable",
                "Codex App Server is not configured on this Runtime.",
                retryable=False,
                detail={"reason": "not_configured"},
            )
        return self._client

    async def execute(
        self,
        context: RuntimeRunContext,
        definition: AgentDefinition,
        prompt: str,
        services: AgentExecutionServices,
    ) -> dict[str, Any]:
        return await self._require_client().execute_turn(context, definition, prompt, services)

    async def cancel(self, run_id: str) -> None:
        await self._require_client().interrupt_turn(run_id)

    async def archive_session(self, session_id: str, *, archived: bool) -> None:
        await self._require_client().archive_session(session_id, archived=archived)

    async def respond_approval(self, run_id: str, approval_id: str, decision: str) -> None:
        if decision not in {"accept", "acceptForSession", "decline", "cancel"}:
            raise RuntimeExecutionError("approval_decision_invalid", "Approval decision is invalid.")
        await self._require_client().respond_approval(run_id, approval_id, decision)

    async def recover(self, run_id: str) -> None:
        await self._require_client().recover_turn(run_id)

    async def health(self) -> Mapping[str, Any]:
        if self._closed:
            return {"backend_id": self.backend_id, "available": False, "reason": "closed"}
        if self._client is None:
            return {"backend_id": self.backend_id, "available": False, "reason": "not_configured"}
        result = dict(await self._client.health())
        return {"backend_id": self.backend_id, **result}

    async def account_status(self, *, refresh: bool = False) -> Mapping[str, Any]:
        return await self._require_client().account_status(refresh=refresh)

    async def account_login_start(self, login_type: str = "chatgpt") -> Mapping[str, Any]:
        return await self._require_client().account_login_start(login_type)

    async def account_login_cancel(self, login_id: str) -> None:
        await self._require_client().account_login_cancel(login_id)

    async def account_logout(self) -> None:
        await self._require_client().account_logout()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._client is not None:
            await self._client.close()
