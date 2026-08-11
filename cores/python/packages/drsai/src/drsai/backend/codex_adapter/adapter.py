"""Agent Backend adapter for a Runtime-owned Codex App Server client."""

from __future__ import annotations

from typing import Any, Mapping, Protocol, Sequence

from drsai.backend.runtime.agent import (
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
    async def restart_backend(self) -> Mapping[str, Any]: ...
    async def discover_sessions(self, workspace_path: str) -> list[Mapping[str, Any]]: ...
    async def bind_imported_session(self, session_id: str, workspace_id: str, runtime_id: str, backend_session_id: str, *, backend_version: str | None = None, backend_updated_at: str | None = None) -> None: ...
    async def read_imported_session_history(self, session_id: str) -> list[Mapping[str, Any]]: ...
    def history_capability(self) -> Mapping[str, Any]: ...
    async def read_normalized_history(self, session_id: str, *, cursor: str | None = None, limit: int = 100) -> Mapping[str, Any]: ...
    def plan_history_migration(self, session_id: str, history: Sequence[Mapping[str, Any]], existing_items: Sequence[Mapping[str, Any]], existing_events: Sequence[Mapping[str, Any]], *, mapping_version: str, reasons: Sequence[str]) -> Mapping[str, Any]: ...
    async def history_sync_watermark(self, session_id: str) -> Mapping[str, Any] | None: ...
    async def mark_history_synced(self, session_id: str, **values: Any) -> None: ...
    async def session_binding_status(self, session_id: str) -> Mapping[str, Any]: ...
    async def model_catalog(self, *, refresh: bool = False) -> Mapping[str, Any]: ...


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
        if decision not in {"approved", "denied", "cancelled"}:
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

    async def restart_backend(self) -> Mapping[str, Any]:
        return await self._require_client().restart_backend()

    async def discover_sessions(self, workspace_path: str) -> list[Mapping[str, Any]]:
        return await self._require_client().discover_sessions(workspace_path)

    async def bind_imported_session(self, session_id: str, workspace_id: str, runtime_id: str, backend_session_id: str, *, backend_version: str | None = None, backend_updated_at: str | None = None) -> None:
        await self._require_client().bind_imported_session(
            session_id, workspace_id, runtime_id, backend_session_id,
            backend_version=backend_version, backend_updated_at=backend_updated_at,
        )

    async def read_imported_session_history(self, session_id: str) -> list[Mapping[str, Any]]:
        return await self._require_client().read_imported_session_history(session_id)

    def history_capability(self) -> Mapping[str, Any]:
        operation = getattr(self._require_client(), "history_capability", None)
        if operation is not None:
            return dict(operation())
        from drsai.backend.codex_adapter.version import CODEX_ADAPTER_MAPPING_VERSION
        from drsai.backend.runtime.history import HistoryCapability
        return HistoryCapability(mapping_version=CODEX_ADAPTER_MAPPING_VERSION).as_dict()

    async def read_normalized_history(
        self, session_id: str, *, cursor: str | None = None, limit: int = 100,
    ) -> Mapping[str, Any]:
        client = self._require_client()
        operation = getattr(client, "read_normalized_history", None)
        if operation is not None:
            return dict(await operation(session_id, cursor=cursor, limit=limit))
        if cursor:
            raise RuntimeExecutionError("history_cursor_expired", "Legacy history provider cannot continue this cursor.")
        from drsai.backend.codex_adapter.version import CODEX_ADAPTER_MAPPING_VERSION
        turns = list(await client.read_imported_session_history(session_id))
        return {"turns": turns, "next_cursor": None, "estimated_total": len(turns),
                "truncated": False, "mapping_version": CODEX_ADAPTER_MAPPING_VERSION}

    def plan_history_migration(
        self, session_id: str, history: Sequence[Mapping[str, Any]],
        existing_items: Sequence[Mapping[str, Any]], existing_events: Sequence[Mapping[str, Any]],
        *, mapping_version: str, reasons: Sequence[str],
    ) -> Mapping[str, Any]:
        operation = getattr(self._require_client(), "plan_history_migration", None)
        if operation is not None:
            return dict(operation(
                session_id, list(history), list(existing_items), list(existing_events),
                mapping_version=mapping_version, reasons=list(reasons),
            ))
        if not reasons:
            return {"mode": "skipped", "mapping_version": mapping_version, "affected_items": 0,
                    "reasons": {}, "content_redacted": True, "triggers": []}
        from drsai.backend.codex_adapter.history_migration import codex_history_migration_dry_run
        return {**codex_history_migration_dry_run(
            session_id, history, existing_items, existing_events, mapping_version=mapping_version,
        ), "triggers": list(reasons)}

    async def history_sync_watermark(self, session_id: str) -> Mapping[str, Any] | None:
        operation = getattr(self._require_client(), "history_sync_watermark", None)
        return await operation(session_id) if operation is not None else None

    async def mark_history_synced(self, session_id: str, **values: Any) -> None:
        operation = getattr(self._require_client(), "mark_history_synced", None)
        if operation is not None:
            await operation(session_id, **values)

    async def session_binding_status(self, session_id: str) -> Mapping[str, Any]:
        return await self._require_client().session_binding_status(session_id)

    async def model_catalog(self, *, refresh: bool = False) -> Mapping[str, Any]:
        return await self._require_client().model_catalog(refresh=refresh)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._client is not None:
            await self._client.close()
