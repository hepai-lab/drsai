from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
import asyncio
from typing import Any, Protocol
from urllib.parse import quote
from uuid import uuid4

import aiohttp

from drsai.backend.runtime.agent import AgentDefinitionStore, RuntimeExecutionError
from drsai.relay.security import redact_secrets


class GatewayControlError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code, self.retryable = code, retryable


class GatewayTransport(Protocol):
    async def request(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                      headers: dict[str, str] | None = None) -> Any: ...


class AiohttpGatewayTransport:
    """Loopback-only transport used inside the registered Windows Runtime host."""

    def __init__(self, base_url: str, instance_token: str) -> None:
        if not base_url.startswith("http://127.0.0.1:"):
            raise ValueError("gateway_control_requires_loopback")
        self.base_url = base_url.rstrip("/")
        self.instance_token = instance_token

    async def request(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                      headers: dict[str, str] | None = None) -> Any:
        status, result = await self.proxy(method, path, body=body, headers=headers)
        if status >= 400:
            detail = result.get("detail", result) if isinstance(result, dict) else {}
            if not isinstance(detail, dict):
                detail = {"message": str(detail)}
            raise GatewayControlError(str(detail.get("code") or f"runtime_http_{status}"),
                                      str(detail.get("message") or "Runtime request failed"),
                                      retryable=status >= 500)
        return result

    async def proxy(self, method: str, path: str, *, body: dict[str, Any] | None = None,
                    headers: dict[str, str] | None = None) -> tuple[int, Any]:
        values = {"X-OpenDrSai-Gateway-Token": self.instance_token, **(headers or {})}
        timeout = aiohttp.ClientTimeout(total=120)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(method, f"{self.base_url}{path}", json=body, headers=values) as response:
                try:
                    result = await response.json()
                except (aiohttp.ContentTypeError, json.JSONDecodeError) as exc:
                    raise GatewayControlError("runtime_response_invalid", "Runtime returned an invalid response") from exc
                return response.status, result


@dataclass(frozen=True)
class _SessionBinding:
    session_id: str
    subject: str
    workspace_id: str
    definition_id: str
    definition_version: str
    backend_id: str
    idempotency_key: str


class GatewayRuntimeControlHandler:
    """Maps Relay operations to the real Full Runtime owned by apps/desktop/windows."""

    def __init__(self, runtime_id: str, transport: GatewayTransport, state_dir: Path) -> None:
        self.runtime_id, self.transport = runtime_id, transport
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.database = self.state_dir / "relay-control.sqlite3"
        self.definitions = AgentDefinitionStore(self.state_dir.parent / "assets" / "agents")
        self._execution_tasks: set[asyncio.Task[Any]] = set()
        self.execution_failures: dict[str, str] = {}
        self._relay_event_cursors: dict[str, int] = {}
        self._relay_session_event_cursors: dict[str, int] = {}
        self._relay_terminal_runs: set[str] = set()
        self._approval_decision_lock = asyncio.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript("""
              CREATE TABLE IF NOT EXISTS relay_sessions(
                session_id TEXT PRIMARY KEY, subject TEXT NOT NULL, workspace_id TEXT NOT NULL,
                definition_id TEXT NOT NULL, definition_version TEXT NOT NULL, backend_id TEXT NOT NULL,
                idempotency_key TEXT NOT NULL, UNIQUE(subject,idempotency_key)
              );
              CREATE TABLE IF NOT EXISTS relay_runs(
                run_id TEXT PRIMARY KEY, subject TEXT NOT NULL, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
                correlation_id TEXT NOT NULL, message TEXT NOT NULL, attachment_refs_json TEXT NOT NULL,
                retry_of TEXT, idempotency_key TEXT NOT NULL, UNIQUE(subject,idempotency_key)
              );
              CREATE TABLE IF NOT EXISTS relay_approval_decisions(
                subject TEXT NOT NULL, idempotency_key TEXT NOT NULL, approval_id TEXT NOT NULL,
                decision TEXT NOT NULL, result_json TEXT NOT NULL,
                PRIMARY KEY(subject,idempotency_key)
              );
            """)

    async def __call__(self, operation: str, arguments: dict[str, Any]) -> Any:
        args, kwargs = arguments.get("args", []), arguments.get("kwargs", {})
        if not isinstance(args, list) or not isinstance(kwargs, dict) or operation.startswith("_"):
            raise GatewayControlError("runtime_request_invalid", "Runtime control arguments are invalid")
        method = getattr(self, operation, None)
        if method is None or operation not in {
            "list_agent_definitions", "list_sessions", "list_sessions_for_subject", "create_session", "get_session",
            "authorize_session", "list_runs", "list_runs_for_subject", "authorize_run",
            "conversation_for_subject", "conversation_snapshot_for_subject",
            "session_events_for_subject",
            "idempotency_result", "create_run", "get_run", "list_events", "cancel_run",
            "pending_approvals", "pending_approvals_for_subject", "audit_entries", "audit_entries_for_subject",
            "execute_owop", "decide_approval",
        }:
            raise GatewayControlError("runtime_operation_unsupported", "Runtime operation is unsupported")
        return await method(*args, **kwargs)

    async def handle_http_request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        correlation_id: str,
    ) -> tuple[int, Any]:
        """Proxy HAI's frozen HTTP-over-WSS frame to the loopback Runtime."""
        normalized_method = method.upper()
        if normalized_method not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
            raise GatewayControlError("runtime_method_invalid", "Runtime proxy method is invalid")
        if not path.startswith("/v1/") or "://" in path or "#" in path:
            raise GatewayControlError("runtime_path_invalid", "Runtime proxy path is invalid")
        proxy = getattr(self.transport, "proxy", None)
        if proxy is None:
            raise GatewayControlError("runtime_http_proxy_unsupported", "Runtime HTTP proxy is unavailable")
        status, result = await proxy(
            normalized_method,
            path,
            body=body,
            headers={"X-Correlation-ID": correlation_id},
        )
        if (
            status < 400
            and normalized_method == "GET"
            and path.partition("?")[0] == "/v1/workspaces"
            and isinstance(result, dict)
            and isinstance(result.get("data"), list)
        ):
            rows: list[dict[str, Any]] = []
            for item in result["data"]:
                if not isinstance(item, dict) or not item.get("workspace_id"):
                    continue
                workspace_id = str(item["workspace_id"])
                raw_path = str(item.get("path") or "")
                rows.append({
                    "runtime_id": self.runtime_id,
                    "workspace_id": workspace_id,
                    "display_name": str(item.get("display_name") or Path(raw_path).name or workspace_id),
                    "lifecycle": item.get("lifecycle") or (
                        "active" if item.get("open", True) else "archived"
                    ),
                    "revision": int(item.get("revision") or 1),
                    "updated_at": (
                        item.get("updated_at")
                        or item.get("last_opened_at")
                        or item.get("created_at")
                    ),
                })
            result = {"data": rows, "next_cursor": result.get("next_cursor")}
        return status, result

    async def list_agent_definitions(self) -> list[dict[str, Any]]:
        capabilities = await self.transport.request("GET", "/v1/capabilities")
        health = capabilities.get("agent_backends", {})
        rows: list[dict[str, Any]] = []
        root = self.definitions.root
        for path in sorted(root.glob("*/*.json")) if root.exists() else ():
            try:
                definition = self.definitions.load(f"{path.parent.name}@{path.stem}")
            except RuntimeExecutionError:
                continue
            backend = health.get(definition.backend, {})
            rows.append({
                "definition_id": definition.asset_id, "version": definition.version,
                "display_name": str(definition.raw.get("name") or definition.asset_id),
                "backend_id": definition.backend,
                "backend_health": "healthy" if backend.get("available") else "unavailable",
                "capabilities": sorted(definition.permissions),
            })
        return rows

    async def published_workspaces(self) -> list[dict[str, Any]]:
        page = await self.transport.request("GET", "/v1/workspaces?include_closed=true")
        return [{
            "runtime_id": self.runtime_id,
            "workspace_id": str(item["workspace_id"]),
            "display_name": Path(str(item["path"])).name or str(item["workspace_id"]),
            "lifecycle": item.get("lifecycle") or ("active" if item.get("open", True) else "archived"),
            "revision": int(item.get("revision") or 1),
            "updated_at": item.get("updated_at") or item.get("last_opened_at") or item.get("created_at"),
        } for item in page.get("data", [])]

    async def relay_events(self) -> list[dict[str, Any]]:
        """Poll authoritative Runtime events for HAI's bounded SSE replay buffer."""
        forwarded: list[dict[str, Any]] = []
        for workspace in await self.published_workspaces():
            if workspace["lifecycle"] != "active":
                continue
            workspace_id = str(workspace["workspace_id"])
            sessions = await self.transport.request(
                "GET",
                f"/v1/sessions?workspace_id={quote(workspace_id, safe='')}&offset=0&limit=200",
            )
            for session in sessions.get("data", []):
                session_id = str(session["session_id"])
                runs = await self.transport.request(
                    "GET",
                    f"/v1/sessions/{quote(session_id, safe='')}/runs?offset=0&limit=200",
                )
                for run in runs.get("data", []):
                    run_id = str(run["run_id"])
                    if run_id in self._relay_terminal_runs:
                        continue
                    after = self._relay_event_cursors.get(run_id, 0)
                    events = await self.transport.request(
                        "GET",
                        f"/v1/runs/{quote(run_id, safe='')}/events?after_sequence={after}&limit=2000",
                    )
                    binding = self._run_binding_optional(run_id, run)
                    projected = [
                        self._event_projection(item, binding, run_id)
                        for item in events.get("data", [])
                    ]
                    if projected:
                        self._relay_event_cursors[run_id] = int(projected[-1]["sequence"])
                        forwarded.extend(projected)
                    if (
                        str(run.get("status")) in {"completed", "failed", "cancelled"}
                        and len(projected) < 2000
                    ):
                        self._relay_terminal_runs.add(run_id)
        return forwarded

    async def relay_session_events(self) -> list[dict[str, Any]]:
        """Poll authoritative Session Journal events for Relay fan-out/replay."""
        forwarded: list[dict[str, Any]] = []
        for workspace in await self.published_workspaces():
            if workspace["lifecycle"] != "active":
                continue
            workspace_id = str(workspace["workspace_id"])
            sessions = await self.transport.request(
                "GET",
                f"/v1/sessions?workspace_id={quote(workspace_id, safe='')}&offset=0&limit=200",
            )
            for session in sessions.get("data", []):
                session_id = str(session["session_id"])
                after = self._relay_session_event_cursors.get(session_id, 0)
                try:
                    page = await self.transport.request(
                        "GET",
                        f"/v1/sessions/{quote(session_id, safe='')}/events"
                        f"?after_sequence={after}&limit=2000",
                    )
                except GatewayControlError as exc:
                    if exc.code != "cursor_expired":
                        raise
                    snapshot = await self.transport.request(
                        "GET",
                        f"/v1/sessions/{quote(session_id, safe='')}/conversation-snapshot",
                    )
                    self._relay_session_event_cursors[session_id] = int(
                        snapshot["snapshot_sequence"]
                    )
                    continue
                events = page.get("data", [])
                if events:
                    self._relay_session_event_cursors[session_id] = int(
                        events[-1]["session_sequence"]
                    )
                    forwarded.extend(events)
        return forwarded

    async def create_session(self, subject: str, workspace_id: str, *, title: str, definition_id: str,
                             definition_version: str, idempotency_key: str) -> dict[str, Any]:
        existing = self._binding_by_idempotency("relay_sessions", subject, idempotency_key)
        if existing:
            return await self.get_session(workspace_id, str(existing["session_id"]))
        definition = self.definitions.load(f"{definition_id}@{definition_version}")
        capabilities = await self.transport.request("GET", "/v1/capabilities")
        if not capabilities.get("agent_backends", {}).get(definition.backend, {}).get("available"):
            raise GatewayControlError("backend_unavailable", "Selected Backend is not healthy", retryable=True)
        item = await self.transport.request(
            "POST",
            "/v1/sessions",
            body={
                "workspace_id": workspace_id,
                "title": title,
                "agent_definition": f"{definition_id}@{definition_version}",
                "backend_id": definition.backend,
            },
        )
        with self._connect() as db:
            db.execute("INSERT INTO relay_sessions VALUES(?,?,?,?,?,?,?)", (
                item["session_id"], subject, workspace_id, definition_id, definition_version,
                definition.backend, idempotency_key,
            ))
        return self._session(item, self._binding(str(item["session_id"])))

    async def get_session(self, workspace_id: str, session_id: str) -> dict[str, Any]:
        item = await self.transport.request("GET", f"/v1/sessions/{session_id}")
        if str(item["workspace_id"]) != workspace_id:
            raise GatewayControlError("session_not_found", "Session was not found in this Workspace")
        return self._session(item, self._binding_optional(session_id))

    async def authorize_session(self, subject: str, workspace_id: str, session_id: str) -> None:
        item = await self.transport.request("GET", f"/v1/sessions/{session_id}")
        if str(item["workspace_id"]) != workspace_id or bool(item.get("archived")):
            raise GatewayControlError("session_forbidden", "Session is not authorized")

    async def list_sessions_for_subject(self, subject: str, workspace_id: str, *, cursor: str | None = None,
                                        limit: int = 20, query: str | None = None):
        # The Full Runtime Session store is authoritative. A Runtime association
        # grants visibility to its active Sessions, including Sessions created
        # earlier by Windows; relay_sessions is only creation/idempotency metadata.
        return await self.list_sessions(workspace_id, cursor=cursor, limit=limit, query=query)

    async def list_sessions(self, workspace_id: str, *, cursor: str | None = None, limit: int = 20,
                            query: str | None = None):
        offset = max(0, int(cursor or 0))
        page = await self.transport.request("GET", f"/v1/sessions?workspace_id={workspace_id}&offset={offset}&limit={limit}")
        mapped = []
        for item in page.get("data", []):
            if not query or query.casefold() in str(item.get("title", "")).casefold():
                mapped.append(self._session(item, self._binding_optional(str(item["session_id"]))))
        consumed = offset + len(page.get("data", []))
        return [mapped, str(consumed) if consumed < int(page.get("total", consumed)) else None]

    async def create_run(self, subject: str, workspace_id: str, session_id: str, *, message: str,
                         attachment_refs: list[str], idempotency_key: str, correlation_id: str,
                         retry_of: str | None = None, _authorization: str | None = None) -> dict[str, Any]:
        existing = self._binding_by_idempotency("relay_runs", subject, idempotency_key)
        if existing:
            return await self.get_run(str(existing["run_id"]))
        session = await self.transport.request("GET", f"/v1/sessions/{session_id}")
        binding = await self._ensure_session_binding(subject, session)
        if binding.workspace_id != workspace_id:
            raise GatewayControlError("session_not_found", "Session was not found in this Workspace")
        reference = f"{binding.definition_id}@{binding.definition_version}"
        item = await self.transport.request("POST", f"/v1/sessions/{session_id}/runs",
                                            body={"agent_definition": reference},
                                            headers={"Idempotency-Key": idempotency_key})
        with self._connect() as db:
            db.execute("INSERT INTO relay_runs VALUES(?,?,?,?,?,?,?,?,?)", (
                item["run_id"], subject, workspace_id, session_id, correlation_id, redact_secrets(message),
                json.dumps(attachment_refs), retry_of, idempotency_key,
            ))
        task = asyncio.create_task(self._execute_run(
            str(item["run_id"]), message, subject, correlation_id, _authorization))
        self._execution_tasks.add(task)
        task.add_done_callback(self._execution_tasks.discard)
        return await self.get_run(str(item["run_id"]))

    async def _execute_run(self, run_id: str, message: str, subject: str, correlation_id: str,
                           authorization: str | None) -> None:
        try:
            headers = {"X-Correlation-ID": correlation_id}
            if authorization and authorization.startswith("Bearer "):
                headers.update({"Authorization": authorization, "X-OpenDrSai-Auth-Mode": "oidc"})
            await self.transport.request("POST", f"/v1/runs/{run_id}/execute",
                                         body={
                                             "prompt": message,
                                             "user_id": subject,
                                             "metadata": {
                                                 "attachment_refs": self._run_binding(run_id)["attachment_refs"],
                                                 "source_client": "android",
                                                 "source_message_id": (
                                                     "android:"
                                                     + str(self._run_binding(run_id)["idempotency_key"])
                                                 ),
                                             },
                                         },
                                         headers=headers)
        except Exception as exc:
            # Keep a bounded diagnostic projection for health/acceptance. The
            # Full Runtime remains authoritative for the Run's durable status.
            self.execution_failures[run_id] = f"{type(exc).__name__}: {exc}"[:1000]
            if len(self.execution_failures) > 100:
                self.execution_failures.pop(next(iter(self.execution_failures)))
            return

    async def get_run(self, run_id: str) -> dict[str, Any]:
        item = await self.transport.request("GET", f"/v1/runs/{run_id}")
        return self._run(item, self._run_binding_optional(run_id, item))

    async def list_runs(self, workspace_id: str, session_id: str, *, cursor: str | None = None, limit: int = 20):
        # Runtime has an authoritative point lookup; Relay metadata indexes only IDs it created.
        offset = max(0, int(cursor or 0))
        with self._connect() as db:
            rows = db.execute("SELECT run_id FROM relay_runs WHERE workspace_id=? AND session_id=? ORDER BY rowid LIMIT ? OFFSET ?",
                              (workspace_id, session_id, limit + 1, offset)).fetchall()
        items = [await self.get_run(str(row["run_id"])) for row in rows[:limit]]
        return [items, str(offset + limit) if len(rows) > limit else None]

    async def list_runs_for_subject(self, subject: str, workspace_id: str, session_id: str, *,
                                    cursor: str | None = None, limit: int = 20):
        await self.authorize_session(subject, workspace_id, session_id)
        offset = max(0, int(cursor or 0))
        page = await self.transport.request(
            "GET", f"/v1/sessions/{session_id}/runs?offset={offset}&limit={limit}")
        rows = [self._run(item, self._run_binding_optional(str(item["run_id"]), item))
                for item in page.get("data", [])]
        consumed = offset + len(rows)
        return [rows, str(consumed) if consumed < int(page.get("total", consumed)) else None]

    async def authorize_run(self, subject: str, run_id: str) -> None:
        item = await self.transport.request("GET", f"/v1/runs/{run_id}")
        await self.authorize_session(subject, str(item["workspace_id"]), str(item["session_id"]))

    async def conversation_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
    ):
        await self.authorize_session(subject, workspace_id, session_id)
        query = f"?limit={limit}"
        if cursor:
            query += f"&cursor={quote(cursor, safe='')}"
        page = await self.transport.request(
            "GET",
            f"/v1/sessions/{session_id}/conversation{query}",
        )
        items: list[dict[str, Any]] = []
        for raw in page.get("data", []):
            kind = str(raw["kind"])
            payload = dict(raw.get("payload", {}))
            if kind == "agent.message.delta":
                kind = "message.delta"
                payload["delta"] = str(payload.get("delta", payload.get("content", "")))
            elif kind == "tool.completed":
                kind = "tool.finished"
            items.append({
                "item_id": str(raw["item_id"]),
                "sequence": int(raw["sequence"]),
                "kind": kind,
                "timestamp": str(raw["timestamp"]),
                "payload": payload,
            })
        return [items, page.get("next_cursor")]

    async def conversation_snapshot_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
    ) -> dict[str, Any]:
        await self.authorize_session(subject, workspace_id, session_id)
        return await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/conversation-snapshot",
        )

    async def session_events_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> dict[str, Any]:
        await self.authorize_session(subject, workspace_id, session_id)
        return await self.transport.request(
            "GET",
            f"/v1/sessions/{quote(session_id, safe='')}/events"
            f"?after_sequence={max(0, int(after_sequence))}"
            f"&limit={max(1, min(2000, int(limit)))}",
        )

    async def idempotency_result(self, subject: str, operation: str, idempotency_key: str) -> dict[str, Any]:
        table = {"session.create": "relay_sessions", "run.create": "relay_runs"}.get(operation)
        if table is None:
            raise GatewayControlError("idempotency_operation_invalid", "Idempotency operation is invalid")
        row = self._binding_by_idempotency(table, subject, idempotency_key)
        if row is None:
            raise GatewayControlError("idempotency_result_not_found", "Idempotency result was not found")
        return await (self.get_run(str(row["run_id"])) if table == "relay_runs"
                      else self.get_session(str(row["workspace_id"]), str(row["session_id"])))

    async def list_events(self, run_id: str, *, after_sequence: int = 0, limit: int = 500):
        item = await self.transport.request("GET", f"/v1/runs/{run_id}")
        run = self._run_binding_optional(run_id, item)
        page = await self.transport.request("GET", f"/v1/runs/{run_id}/events?after_sequence={after_sequence}&limit={limit}")
        items = [self._event_projection(item, run, run_id) for item in page.get("data", [])]
        return [items, str(items[-1]["sequence"]) if len(items) == limit else None]

    def _event_projection(self, item: dict[str, Any], run: dict[str, Any], run_id: str) -> dict[str, Any]:
        kind = str(item["type"])
        payload = dict(item.get("data", {}))
        if kind == "agent.message.delta":
            kind = "message.delta"
            payload = {**payload, "delta": str(payload.get("delta", payload.get("content", "")))}
        elif kind == "tool.completed":
            kind = "tool.finished"
        return {
            "event_id": item["event_id"], "sequence": item["sequence"], "runtime_id": self.runtime_id,
            "workspace_id": run["workspace_id"], "session_id": run["session_id"], "run_id": run_id,
            "kind": kind, "timestamp": item["created_at"], "payload": payload,
        }

    async def cancel_run(self, workspace_id: str, run_id: str) -> dict[str, Any]:
        binding = self._run_binding(run_id)
        if binding["workspace_id"] != workspace_id:
            raise GatewayControlError("run_scope_mismatch", "Run belongs to another Workspace")
        await self.transport.request("POST", f"/v1/runs/{run_id}/cancel", body={})
        return await self.get_run(run_id)

    async def pending_approvals(self, workspace_id: str) -> list[dict[str, Any]]:
        page = await self.transport.request("GET", "/v1/approvals?status=pending")
        rows = page.get("data", page if isinstance(page, list) else [])
        return [self._approval(item) for item in rows
                if self._run_binding(str(item["run_id"]))["workspace_id"] == workspace_id]

    async def pending_approvals_for_subject(self, subject: str, workspace_id: str) -> list[dict[str, Any]]:
        return [item for item in await self.pending_approvals(workspace_id)
                if self._run_binding(item["run_id"])["subject"] == subject]

    async def decide_approval(
        self, subject: str, approval_id: str, decision: str, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        mapped = {"approve": "approved", "deny": "denied", "cancel": "denied"}.get(decision)
        if mapped is None:
            raise GatewayControlError("approval_decision_invalid", "Invalid approval decision")
        stable_key = idempotency_key or f"legacy:{approval_id}:{decision}"
        async with self._approval_decision_lock:
            with self._connect() as db:
                prior = db.execute(
                    "SELECT * FROM relay_approval_decisions WHERE subject=? AND idempotency_key=?",
                    (subject, stable_key),
                ).fetchone()
            if prior is not None:
                if str(prior["approval_id"]) != approval_id or str(prior["decision"]) != decision:
                    raise GatewayControlError("idempotency_conflict", "Idempotency key was reused with another decision")
                return json.loads(str(prior["result_json"]))
            page = await self.transport.request("GET", "/v1/approvals?status=pending")
            candidates = page.get("data", page if isinstance(page, list) else [])
            candidate = next((item for item in candidates if str(item.get("approval_id")) == approval_id), None)
            if candidate is None:
                try:
                    candidate = await self.transport.request("GET", f"/v1/approvals/{approval_id}")
                except GatewayControlError as exc:
                    if exc.code == "runtime_http_404":
                        raise GatewayControlError("approval_not_found", "Approval is no longer pending") from exc
                    raise
            await self.authorize_run(subject, str(candidate["run_id"]))
            detail = {"subject": subject, "idempotency_key": stable_key}
            item = await self.transport.request(
                "POST", f"/v1/approvals/{approval_id}/decision",
                body={"decision": mapped, "detail": detail},
            )
            try:
                await self.transport.request(
                    "POST", f"/v1/runs/{item['run_id']}/approvals/{approval_id}/decision",
                    body={"decision": mapped, "detail": detail},
                )
            except GatewayControlError as exc:
                if exc.code not in {"approval_not_found", "approval_not_supported"}:
                    raise
            result = self._approval(item)
            with self._connect() as db:
                db.execute(
                    "INSERT INTO relay_approval_decisions VALUES(?,?,?,?,?)",
                    (subject, stable_key, approval_id, decision, json.dumps(result, separators=(",", ":"))),
                )
            return result

    async def audit_entries(self, workspace_id: str, run_id: str | None = None) -> list[dict[str, Any]]:
        run_ids = [run_id] if run_id else self._workspace_run_ids(workspace_id)
        entries = []
        for current in run_ids:
            events, _ = await self.list_events(current, limit=500)
            binding = self._run_binding(current)
            for event in events:
                if event["kind"] in {"run.created", "run.cancelled", "approval.requested", "approval.approved", "approval.denied"}:
                    entries.append({
                        "audit_id": f"audit:{event['event_id']}", "runtime_id": self.runtime_id,
                        "workspace_id": workspace_id, "session_id": binding["session_id"], "run_id": current,
                        "action": event["kind"], "subject": binding["subject"],
                        "timestamp": event["timestamp"],
                        "correlation_id": binding["correlation_id"],
                        "approval_id": event["payload"].get("approval_id"),
                    })
        return entries

    async def audit_entries_for_subject(self, subject: str, workspace_id: str,
                                        run_id: str | None = None) -> list[dict[str, Any]]:
        if run_id is not None:
            await self.authorize_run(subject, run_id)
        return [item for item in await self.audit_entries(workspace_id, run_id)
                if self._run_binding(item["run_id"])["subject"] == subject]

    async def execute_owop(self, workspace_id: str, operation: str, params: dict[str, Any]) -> dict[str, Any]:
        allowed = {"workspace.describe", "files.list", "files.stat", "files.read", "search.query",
                   "git.status", "git.diff", "git.file_at_ref", "artifact.metadata", "artifact.chunk"}
        if operation not in allowed:
            raise GatewayControlError("owop_operation_forbidden", "OWOP operation is not allowed on Android")
        request_id, correlation_id = str(uuid4()), str(uuid4())
        response = await self.transport.request("POST", "/v1/owop", body={
            "version": "1.0", "request_id": request_id, "correlation_id": correlation_id,
            "workspace_id": workspace_id, "operation": operation, "params": params,
            # Relay is the outer transport; once inside this Full Runtime the
            # authoritative Workspace adapter is the Runtime's local binding.
            "binding": {"kind": "in_process"},
        })
        if response.get("ok") is not True:
            error = response.get("error", {})
            raise GatewayControlError(str(error.get("code") or "owop_failed"), str(error.get("message") or "OWOP failed"))
        result = response.get("result", {})
        if operation == "files.list":
            if isinstance(result.get("items"), list):
                return result
            entries = result.get("entries", [])
            return {"items": [{
                "token": str(item.get("path", "")), "relative_path": str(item.get("path", "")),
                "type": str(item.get("kind", "file")), "size": item.get("size"), "modified_at": None,
                "git_status": None, "truncated": False,
            } for item in entries], "next_cursor": result.get("cursor"), "truncated": False,
                    "ignored_hint": ".git, .drsai, node_modules and __pycache__ are hidden"}
        if operation == "search.query":
            matches = result.get("matches", [])
            return {"items": [{"token": str(item.get("path", "")), "relative_path": str(item.get("path", "")),
                                "type": "file", "size": None, "modified_at": None, "git_status": None,
                                "truncated": False} for item in matches],
                    "next_cursor": result.get("cursor"), "truncated": False}
        return result

    def _binding(self, session_id: str) -> _SessionBinding:
        with self._connect() as db:
            row = db.execute("SELECT * FROM relay_sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise GatewayControlError("session_not_found", "Session was not created through this Relay")
        return _SessionBinding(**dict(row))

    def _binding_optional(self, session_id: str) -> _SessionBinding | None:
        try:
            return self._binding(session_id)
        except GatewayControlError as exc:
            if exc.code != "session_not_found":
                raise
            return None

    async def _ensure_session_binding(self, subject: str, item: dict[str, Any]) -> _SessionBinding:
        session_id = str(item["session_id"])
        existing = self._binding_optional(session_id)
        if existing is not None:
            return existing
        definitions = await self.list_agent_definitions()
        healthy = [row for row in definitions if row["backend_health"] == "healthy"]
        reference = str(item.get("agent_definition") or "")
        backend_id = str(item.get("backend_id") or "")
        selected = None
        if "@" in reference:
            definition_id, definition_version = reference.rsplit("@", 1)
            selected = next(
                (
                    row for row in healthy
                    if row["definition_id"] == definition_id
                    and row["version"] == definition_version
                    and (not backend_id or row["backend_id"] == backend_id)
                ),
                None,
            )
            if selected is None:
                raise GatewayControlError(
                    "session_agent_definition_unavailable",
                    "Session Agent Definition is unavailable or unhealthy",
                    retryable=True,
                )
        else:
            # Legacy Sessions created before authoritative Agent metadata can
            # migrate only when the choice is unambiguous. Prefer the
            # Runtime-owned backend binding when it exists; unrelated healthy
            # backends must not make an otherwise exact migration ambiguous.
            candidates = [
                row for row in healthy
                if not backend_id or row["backend_id"] == backend_id
            ]
            if len(candidates) == 1:
                selected = candidates[0]
            else:
                raise GatewayControlError(
                    "session_agent_definition_required",
                    "Existing Session has no unambiguous healthy Agent Definition",
                )
        binding = _SessionBinding(
            session_id=session_id,
            subject=subject,
            workspace_id=str(item["workspace_id"]),
            definition_id=str(selected["definition_id"]),
            definition_version=str(selected["version"]),
            backend_id=str(selected["backend_id"]),
            idempotency_key=f"discovered:{session_id}",
        )
        with self._connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO relay_sessions VALUES(?,?,?,?,?,?,?)",
                (
                    binding.session_id, binding.subject, binding.workspace_id,
                    binding.definition_id, binding.definition_version,
                    binding.backend_id, binding.idempotency_key,
                ),
            )
        return self._binding(session_id)

    def _run_binding(self, run_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM relay_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise GatewayControlError("run_not_found", "Run was not created through this Relay")
        result = dict(row)
        result["attachment_refs"] = json.loads(result.pop("attachment_refs_json"))
        return result

    def _run_binding_optional(self, run_id: str, item: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._run_binding(run_id)
        except GatewayControlError as exc:
            if exc.code != "run_not_found":
                raise
            return {
                "run_id": run_id,
                "subject": "runtime",
                "workspace_id": str(item["workspace_id"]),
                "session_id": str(item["session_id"]),
                "correlation_id": str(item.get("correlation_id") or f"runtime:{run_id}"),
                "message": str(item.get("input_message") or ""),
                "attachment_refs": (
                    json.loads(str(item.get("attachment_refs_json") or "[]"))
                    if not isinstance(item.get("attachment_refs"), list)
                    else item["attachment_refs"]
                ),
                "retry_of": None,
                "idempotency_key": str(item.get("idempotency_key") or f"runtime:{run_id}"),
            }

    def _binding_by_idempotency(self, table: str, subject: str, key: str):
        with self._connect() as db:
            return db.execute(f"SELECT * FROM {table} WHERE subject=? AND idempotency_key=?", (subject, key)).fetchone()

    def _workspace_run_ids(self, workspace_id: str) -> list[str]:
        with self._connect() as db:
            return [str(row[0]) for row in db.execute("SELECT run_id FROM relay_runs WHERE workspace_id=?", (workspace_id,))]

    def _session(self, item: dict[str, Any], binding: _SessionBinding | None) -> dict[str, Any]:
        reference = str(item.get("agent_definition") or "")
        definition_id, definition_version = ("", "")
        if "@" in reference:
            definition_id, definition_version = reference.rsplit("@", 1)
        return {"runtime_id": self.runtime_id, "workspace_id": str(item["workspace_id"]),
                "session_id": str(item["session_id"]), "title": item["title"],
                "agent_definition_id": binding.definition_id if binding else definition_id,
                "agent_definition_version": binding.definition_version if binding else definition_version,
                "backend_id": binding.backend_id if binding else str(item.get("backend_id") or ""),
                "updated_at": item["updated_at"],
                "lifecycle": str(item.get("lifecycle") or ("archived" if item.get("archived") else "active")),
                "last_run_status": None}

    def _run(self, item: dict[str, Any], binding: dict[str, Any]) -> dict[str, Any]:
        return {"runtime_id": self.runtime_id, "workspace_id": binding["workspace_id"],
                "session_id": binding["session_id"], "run_id": item["run_id"], "backend_id": item["backend_id"],
                "status": item["status"], "correlation_id": binding["correlation_id"],
                "created_at": item["created_at"], "retry_of": binding["retry_of"], "message": binding["message"],
                "attachment_refs": binding["attachment_refs"]}

    def _approval(self, item: dict[str, Any]) -> dict[str, Any]:
        run = self._run_binding(str(item["run_id"]))
        request = item.get("request", {})
        binding = self._binding(str(run["session_id"]))
        return {"runtime_id": self.runtime_id, "workspace_id": run["workspace_id"],
                "session_id": run["session_id"], "run_id": item["run_id"], "approval_id": item["approval_id"],
                "agent_definition_id": binding.definition_id, "backend_id": binding.backend_id,
                "operation": str(request.get("operation") or request.get("tool") or "runtime.operation"),
                "risk_summary": str(request.get("risk_summary") or request.get("reason") or "Review required"),
                "scope": str(request.get("scope") or "workspace"), "expires_at": item.get("deadline_at") or "",
                "correlation_id": run["correlation_id"], "status": item["status"]}
