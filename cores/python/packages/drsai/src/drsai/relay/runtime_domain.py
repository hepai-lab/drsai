from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from threading import RLock
from typing import Any, Callable
from uuid import uuid4

from .models import RelayEvent
from .models import ResourceLifecycle
from .registry import RelayRegistryError
from .streaming import RelayEventStore


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


@dataclass(frozen=True)
class AuditEntry:
    audit_id: str
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    action: str
    subject: str
    timestamp: datetime
    correlation_id: str
    approval_id: str | None = None


@dataclass(frozen=True)
class AgentDefinition:
    definition_id: str
    version: str
    display_name: str
    backend_id: str
    backend_health: str
    capabilities: frozenset[str]


@dataclass
class Session:
    runtime_id: str
    workspace_id: str
    session_id: str
    title: str
    agent_definition_id: str
    agent_definition_version: str
    backend_id: str
    updated_at: datetime
    lifecycle: ResourceLifecycle = ResourceLifecycle.ACTIVE
    last_run_status: str | None = None


@dataclass
class Run:
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    backend_id: str
    status: RunStatus
    correlation_id: str
    created_at: datetime
    retry_of: str | None = None
    message: str = ""
    attachment_refs: tuple[str, ...] = ()


@dataclass
class Approval:
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    approval_id: str
    agent_definition_id: str
    backend_id: str
    operation: str
    risk_summary: str
    scope: str
    expires_at: datetime
    correlation_id: str
    status: ApprovalStatus = ApprovalStatus.PENDING


class RuntimeAuthority:
    """Reference Full Runtime authority used by Relay contract/E2E tests."""

    def __init__(self, runtime_id: str, owop_handler: Callable[[str, str, dict[str, Any]], dict[str, Any]] | None = None) -> None:
        self.runtime_id = runtime_id
        self._lock = RLock()
        self.agent_definitions: dict[tuple[str, str], AgentDefinition] = {}
        self.sessions: dict[str, Session] = {}
        self.session_subjects: dict[str, str] = {}
        self.runs: dict[str, Run] = {}
        self.run_subjects: dict[str, str] = {}
        self.approvals: dict[str, Approval] = {}
        self.permissions: dict[tuple[str, str], set[str]] = {}
        self.idempotency: dict[tuple[str, str, str], Any] = {}
        self.events = RelayEventStore()
        self.audit: tuple[AuditEntry, ...] = ()
        self.owop_handler = owop_handler

    def add_agent_definition(self, definition: AgentDefinition) -> None:
        if definition.version == "latest":
            raise RelayRegistryError("agent_version_invalid", "Agent Definition version must be exact")
        self.agent_definitions[(definition.definition_id, definition.version)] = definition

    def list_agent_definitions(self) -> list[AgentDefinition]:
        return sorted(self.agent_definitions.values(), key=lambda item: (item.definition_id, item.version))

    def create_session(self, subject: str, workspace_id: str, *, title: str, definition_id: str,
                       definition_version: str, idempotency_key: str) -> Session:
        key = (subject, "session.create", idempotency_key)
        if key in self.idempotency:
            return self.idempotency[key]
        definition = self.agent_definitions.get((definition_id, definition_version))
        if definition is None or definition_version == "latest":
            raise RelayRegistryError("agent_definition_not_found", "Exact Agent Definition was not found")
        if definition.backend_health != "healthy":
            raise RelayRegistryError("backend_unavailable", "Selected Backend is not healthy", retryable=True)
        session = Session(self.runtime_id, workspace_id, f"ses_{uuid4().hex}", title, definition_id,
                          definition_version, definition.backend_id, datetime.now(UTC))
        self.sessions[session.session_id] = session
        self.session_subjects[session.session_id] = subject
        self.idempotency[key] = session
        return session

    def list_sessions(self, workspace_id: str, *, cursor: str | None = None, limit: int = 20,
                      query: str | None = None) -> tuple[list[Session], str | None]:
        rows = [item for item in self.sessions.values()
                if item.workspace_id == workspace_id and item.lifecycle == ResourceLifecycle.ACTIVE]
        if query:
            rows = [item for item in rows if query.casefold() in item.title.casefold()]
        rows.sort(key=lambda item: item.updated_at, reverse=True)
        start = int(cursor or 0)
        end = min(start + limit, len(rows))
        return rows[start:end], str(end) if end < len(rows) else None

    def list_sessions_for_subject(self, subject: str, workspace_id: str, *, cursor: str | None = None,
                                  limit: int = 20, query: str | None = None):
        # Runtime access is granted by the Relay association. Session ownership
        # must not hide existing Windows sessions from an associated Mobile
        # client; subject remains audit/idempotency metadata only.
        return self.list_sessions(workspace_id, cursor=cursor, limit=limit, query=query)

    def authorize_session(self, subject: str, workspace_id: str, session_id: str) -> None:
        session = self._session(workspace_id, session_id)
        if session.lifecycle != ResourceLifecycle.ACTIVE:
            raise RelayRegistryError("session_forbidden", "Session is not active")

    def idempotency_result(self, subject: str, operation: str, idempotency_key: str) -> Any:
        if operation not in {"session.create", "run.create"}:
            raise RelayRegistryError("idempotency_operation_invalid", "Unsupported idempotency operation")
        result = self.idempotency.get((subject, operation, idempotency_key))
        if result is None:
            raise RelayRegistryError("idempotency_result_not_found", "Idempotency result is not available", retryable=True)
        return result

    def create_run(self, subject: str, workspace_id: str, session_id: str, *, message: str,
                   attachment_refs: list[str], idempotency_key: str, correlation_id: str,
                   retry_of: str | None = None) -> Run:
        key = (subject, "run.create", idempotency_key)
        if key in self.idempotency:
            return self.idempotency[key]
        session = self._session(workspace_id, session_id)
        self.authorize_session(subject, workspace_id, session_id)
        if not message.strip() and not attachment_refs:
            raise RelayRegistryError("run_input_empty", "Run requires text or attachment reference")
        if any("/" in ref or "\\" in ref or ref.startswith("file:") for ref in attachment_refs):
            raise RelayRegistryError("attachment_reference_invalid", "Local paths are forbidden")
        run = Run(self.runtime_id, workspace_id, session_id, f"run_{uuid4().hex}", session.backend_id,
                  RunStatus.QUEUED, correlation_id, datetime.now(UTC), retry_of, message, tuple(attachment_refs))
        self.runs[run.run_id] = run
        self.run_subjects[run.run_id] = subject
        self.idempotency[key] = run
        session.last_run_status, session.updated_at = run.status, datetime.now(UTC)
        self._append_audit(run, "run.created", subject, correlation_id)
        self.append_event(run.run_id, "run.queued", {"status": "queued"})
        return run

    def list_runs(self, workspace_id: str, session_id: str, *, cursor: str | None = None,
                  limit: int = 20) -> tuple[list[Run], str | None]:
        self._session(workspace_id, session_id)
        rows = [item for item in self.runs.values()
                if item.workspace_id == workspace_id and item.session_id == session_id]
        rows.sort(key=lambda item: item.created_at)
        start = int(cursor or 0)
        end = min(start + limit, len(rows))
        return rows[start:end], str(end) if end < len(rows) else None

    def list_runs_for_subject(self, subject: str, workspace_id: str, session_id: str, *,
                              cursor: str | None = None, limit: int = 20):
        self.authorize_session(subject, workspace_id, session_id)
        rows = [item for item in self.runs.values() if item.workspace_id == workspace_id
                and item.session_id == session_id]
        rows.sort(key=lambda item: item.created_at)
        start, end = int(cursor or 0), min(int(cursor or 0) + limit, len(rows))
        return rows[start:end], str(end) if end < len(rows) else None

    def conversation_for_subject(
        self,
        subject: str,
        workspace_id: str,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
    ) -> tuple[list[dict[str, Any]], str | None]:
        self.authorize_session(subject, workspace_id, session_id)
        items: list[dict[str, Any]] = []
        runs, _ = self.list_runs(workspace_id, session_id, limit=max(1, len(self.runs)))
        for run in runs:
            if run.message:
                items.append({
                    "item_id": f"user:{run.run_id}",
                    "sequence": 0,
                    "kind": "message.user",
                    "timestamp": run.created_at.isoformat(),
                    "payload": {"content": run.message, "run_id": run.run_id},
                })
            events, _ = self.list_events(run.run_id, after_sequence=0, limit=500)
            for event in events:
                items.append({
                    "item_id": event.event_id,
                    "sequence": 0,
                    "kind": event.kind,
                    "timestamp": event.timestamp.isoformat(),
                    "payload": {**event.payload, "run_id": run.run_id},
                })
        # Runtime Run order plus per-Run Event sequence is authoritative.
        # Wall-clock timestamps may have coarse resolution and are not a safe
        # ordering key across persisted/replayed events.
        for sequence, item in enumerate(items, 1):
            item["sequence"] = sequence
        start = max(0, int(cursor or 0))
        end = min(start + limit, len(items))
        return items[start:end], str(end) if end < len(items) else None

    def authorize_run(self, subject: str, run_id: str) -> None:
        run = self._run(run_id)
        self.authorize_session(subject, run.workspace_id, run.session_id)

    def append_event(self, run_id: str, kind: str, payload: dict[str, Any]) -> RelayEvent:
        run = self._run(run_id)
        existing, _ = self.events.after(self.runtime_id, run_id, 0, 500)
        event = RelayEvent(event_id=f"evt_{uuid4().hex}", sequence=len(existing) + 1,
                           runtime_id=self.runtime_id, workspace_id=run.workspace_id,
                           session_id=run.session_id, run_id=run.run_id, kind=kind, payload=payload)
        self.events.append(event)
        status = payload.get("status")
        if status in RunStatus._value2member_map_:
            run.status = RunStatus(status)
            self.sessions[run.session_id].last_run_status = run.status
        return event

    def cancel_run(self, workspace_id: str, run_id: str) -> Run:
        run = self._run(run_id)
        if run.workspace_id != workspace_id:
            raise RelayRegistryError("run_scope_mismatch", "Run belongs to another Workspace")
        if run.status == RunStatus.CANCELLED:
            return run
        if run.status in (RunStatus.COMPLETED, RunStatus.FAILED):
            return run
        self._append_audit(run, "run.cancelled", "system", run.correlation_id)
        self.append_event(run_id, "run.cancelled", {"status": "cancelled"})
        return run

    def request_approval(self, subject: str, run_id: str, *, operation: str, risk_summary: str,
                         scope: str, correlation_id: str, ttl_seconds: int = 300) -> Approval:
        run = self._run(run_id)
        if operation not in self.permissions.get((subject, run.workspace_id), set()):
            raise RelayRegistryError("runtime_permission_denied", "Permission denied before approval")
        session = self.sessions[run.session_id]
        approval = Approval(self.runtime_id, run.workspace_id, run.session_id, run.run_id,
                            f"apr_{uuid4().hex}", session.agent_definition_id, run.backend_id,
                            operation, risk_summary[:512], scope[:256], datetime.now(UTC) + timedelta(seconds=ttl_seconds),
                            correlation_id)
        self.approvals[approval.approval_id] = approval
        self._append_audit(run, "approval.requested", subject, correlation_id, approval.approval_id)
        self.append_event(run_id, "approval.requested", {"approval_id": approval.approval_id, "status": "waiting_approval"})
        return approval

    def decide_approval(
        self, subject: str, approval_id: str, decision: str, idempotency_key: str | None = None
    ) -> Approval:
        replay_key = (subject, "approval.decide", idempotency_key) if idempotency_key else None
        if replay_key is not None and replay_key in self.idempotency:
            prior_approval_id, prior_decision, prior_result = self.idempotency[replay_key]
            if prior_approval_id != approval_id or prior_decision != decision:
                raise RelayRegistryError("idempotency_conflict", "Idempotency key was reused with another decision")
            return prior_result
        approval = self.approvals.get(approval_id)
        if approval is None:
            raise RelayRegistryError("approval_not_found", "Approval was not found")
        self.authorize_run(subject, approval.run_id)
        if approval.expires_at <= datetime.now(UTC) and approval.status == ApprovalStatus.PENDING:
            approval.status = ApprovalStatus.EXPIRED
        wanted = {"approve": ApprovalStatus.APPROVED, "deny": ApprovalStatus.DENIED,
                  "cancel": ApprovalStatus.CANCELLED}.get(decision)
        if wanted is None:
            raise RelayRegistryError("approval_decision_invalid", "Invalid approval decision")
        if approval.status != ApprovalStatus.PENDING:
            return approval
        if approval.operation not in self.permissions.get((subject, approval.workspace_id), set()):
            raise RelayRegistryError("runtime_permission_denied", "Permission changed before decision")
        approval.status = wanted
        self._append_audit(self._run(approval.run_id), f"approval.{wanted.value}", subject,
                           approval.correlation_id, approval_id)
        self.append_event(approval.run_id, "approval.resolved", {"approval_id": approval_id, "decision": wanted.value})
        if replay_key is not None:
            self.idempotency[replay_key] = (approval_id, decision, approval)
        return approval

    def pending_approvals(self, workspace_id: str) -> list[Approval]:
        now = datetime.now(UTC)
        for item in self.approvals.values():
            if item.status == ApprovalStatus.PENDING and item.expires_at <= now:
                item.status = ApprovalStatus.EXPIRED
        return [item for item in self.approvals.values() if item.workspace_id == workspace_id and item.status == ApprovalStatus.PENDING]

    def pending_approvals_for_subject(self, subject: str, workspace_id: str) -> list[Approval]:
        return [item for item in self.pending_approvals(workspace_id)
                if self.sessions[item.session_id].lifecycle == ResourceLifecycle.ACTIVE]

    def audit_entries(self, workspace_id: str, run_id: str | None = None) -> tuple[AuditEntry, ...]:
        return tuple(item for item in self.audit
                     if item.workspace_id == workspace_id and (run_id is None or item.run_id == run_id))

    def audit_entries_for_subject(self, subject: str, workspace_id: str,
                                  run_id: str | None = None) -> tuple[AuditEntry, ...]:
        if run_id is not None:
            self.authorize_run(subject, run_id)
        return self.audit_entries(workspace_id, run_id)

    def execute_owop(self, workspace_id: str, operation: str, params: dict[str, Any]) -> dict[str, Any]:
        allowed = {"workspace.describe", "files.list", "files.stat", "files.read", "search.query",
                   "git.status", "git.diff", "git.file_at_ref", "artifact.metadata", "artifact.chunk"}
        if operation not in allowed:
            raise RelayRegistryError("owop_operation_forbidden", "OWOP operation is not allowed on Android")
        if self.owop_handler is None:
            raise RelayRegistryError("owop_unavailable", "Runtime OWOP binding is unavailable", retryable=True)
        return self.owop_handler(workspace_id, operation, dict(params))

    def _append_audit(self, run: Run, action: str, subject: str, correlation_id: str,
                      approval_id: str | None = None) -> None:
        self.audit = (*self.audit, AuditEntry(
            audit_id=f"aud_{uuid4().hex}", runtime_id=self.runtime_id, workspace_id=run.workspace_id,
            session_id=run.session_id, run_id=run.run_id, action=action, subject=subject,
            timestamp=datetime.now(UTC), correlation_id=correlation_id, approval_id=approval_id,
        ))

    def _session(self, workspace_id: str, session_id: str) -> Session:
        session = self.sessions.get(session_id)
        if session is None or session.workspace_id != workspace_id:
            raise RelayRegistryError("session_not_found", "Session was not found in this Workspace")
        return session

    def get_session(self, workspace_id: str, session_id: str) -> Session:
        return self._session(workspace_id, session_id)

    def _run(self, run_id: str) -> Run:
        run = self.runs.get(run_id)
        if run is None:
            raise RelayRegistryError("run_not_found", "Run was not found")
        return run

    def get_run(self, run_id: str) -> Run:
        return self._run(run_id)

    def list_events(self, run_id: str, *, after_sequence: int = 0, limit: int = 500):
        return self.events.after(self.runtime_id, run_id, after_sequence, limit)
