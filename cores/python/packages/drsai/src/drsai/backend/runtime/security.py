"""Runtime-local identity, authorization, approval, audit and path security."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping


class SecurityError(PermissionError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ApprovalRequired(SecurityError):
    def __init__(self, approval_id: str):
        super().__init__("approval_required", "This sensitive Runtime operation requires approval.")
        self.approval_id = approval_id


@dataclass(frozen=True)
class RuntimePrincipal:
    principal_id: str
    organization_id: str
    session_id: str
    expires_at: int

    @classmethod
    def from_platform_auth(cls, context: Any) -> "RuntimePrincipal":
        if not context or not context.subject or not context.organization_id or not context.session_id:
            raise SecurityError("principal_claims_invalid", "User, organization and session claims are required.")
        if int(context.expires_at) <= int(time.time()):
            raise SecurityError("principal_expired", "Runtime Principal identity expired.")
        return cls(str(context.subject), str(context.organization_id), str(context.session_id), int(context.expires_at))


@dataclass(frozen=True)
class OperationContext:
    principal_id: str
    runtime_id: str
    workspace_id: str
    session_id: str
    run_id: str
    tool_id: str
    correlation_id: str
    host_id: str = ""
    worktree_id: str = ""
    terminal_id: str = ""
    operation_id: str = ""

    def as_dict(self) -> dict[str, str]:
        values = {
            "principal_id": self.principal_id,
            "runtime_id": self.runtime_id,
            "workspace_id": self.workspace_id,
            "session_id": self.session_id,
            "run_id": self.run_id,
            "tool_id": self.tool_id,
            "correlation_id": self.correlation_id,
        }
        if not all(values.values()):
            raise SecurityError("audit_context_incomplete", "Sensitive operation audit context is incomplete.")
        values.update({
            "host_id": self.host_id,
            "worktree_id": self.worktree_id,
            "terminal_id": self.terminal_id,
            "operation_id": self.operation_id,
        })
        return values


ROLE_ACTIONS = {
    "owner": frozenset({"workspace.read", "file.write", "git.write", "git.push", "worktree.write", "pty.execute", "shell.execute", "run.execute", "workspace.restore", "permission.manage"}),
    "editor": frozenset({"workspace.read", "file.write", "git.write", "git.push", "worktree.write", "pty.execute", "shell.execute", "run.execute", "workspace.restore"}),
    "viewer": frozenset({"workspace.read"}),
    "denied": frozenset(),
}

SENSITIVE_ACTIONS = frozenset({"file.write", "git.push", "worktree.write", "pty.execute", "workspace.restore", "shell.execute"})


class WorkspacePermissionStore:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS workspace_permissions(workspace_id TEXT NOT NULL, principal_id TEXT NOT NULL, role TEXT NOT NULL, updated_at REAL NOT NULL, PRIMARY KEY(workspace_id, principal_id))")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database, timeout=30)

    def set_role(self, workspace_id: str, principal_id: str, role: str) -> None:
        if role not in ROLE_ACTIONS or not workspace_id or not principal_id:
            raise ValueError("Invalid Workspace role")
        with self._connect() as db:
            db.execute("INSERT INTO workspace_permissions VALUES(?,?,?,?) ON CONFLICT(workspace_id,principal_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at", (workspace_id, principal_id, role, time.time()))

    def role(self, workspace_id: str, principal_id: str) -> str:
        with self._connect() as db:
            row = db.execute("SELECT role FROM workspace_permissions WHERE workspace_id=? AND principal_id=?", (workspace_id, principal_id)).fetchone()
        return str(row[0]) if row else "denied"

    def allowed(self, workspace_id: str, principal_id: str, action: str) -> bool:
        return action in ROLE_ACTIONS[self.role(workspace_id, principal_id)]


class ApprovalRegistry:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.request_count = 0
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS security_approvals(
                approval_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                action TEXT NOT NULL, resource_hash TEXT NOT NULL, status TEXT NOT NULL,
                created_at REAL NOT NULL, resolved_at REAL, consumed_at REAL
            )""")

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    @staticmethod
    def _resource_hash(resource: Mapping[str, Any]) -> str:
        return hashlib.sha256(json.dumps(redact_sensitive(resource), sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def request(self, principal_id: str, workspace_id: str, action: str, resource: Mapping[str, Any]) -> str:
        approval_id = f"security-approval-{uuid.uuid4()}"
        with self._connect() as db:
            db.execute("INSERT INTO security_approvals VALUES(?,?,?,?,?,'pending',?,NULL,NULL)", (approval_id, principal_id, workspace_id, action, self._resource_hash(resource), time.time()))
        self.request_count += 1
        return approval_id

    def decide(self, approval_id: str, decision: str) -> None:
        if decision not in {"approved", "denied"}:
            raise ValueError("Invalid approval decision")
        with self._connect() as db:
            changed = db.execute("UPDATE security_approvals SET status=?,resolved_at=? WHERE approval_id=? AND status='pending'", (decision, time.time(), approval_id)).rowcount
        if changed != 1:
            raise SecurityError("approval_invalid", "Approval is missing or already resolved.")

    def get(self, approval_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM security_approvals WHERE approval_id=?", (approval_id,)).fetchone()
        if not row:
            raise SecurityError("approval_invalid", "Approval is missing.")
        return dict(row)

    def consume(self, approval_id: str, principal_id: str, workspace_id: str, action: str, resource: Mapping[str, Any]) -> None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM security_approvals WHERE approval_id=?", (approval_id,)).fetchone()
            if not row or row["status"] != "approved" or row["consumed_at"] is not None:
                raise SecurityError("approval_not_approved", "Approval is not approved or was already used.")
            expected = (principal_id, workspace_id, action, self._resource_hash(resource))
            actual = (row["principal_id"], row["workspace_id"], row["action"], row["resource_hash"])
            if actual != expected:
                raise SecurityError("approval_scope_mismatch", "Approval does not match this operation.")
            db.execute("UPDATE security_approvals SET consumed_at=? WHERE approval_id=?", (time.time(), approval_id))


class AuditLog:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_audit(
                  audit_id TEXT PRIMARY KEY, event TEXT NOT NULL, context_json TEXT NOT NULL,
                  detail_json TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS runtime_audit_no_update BEFORE UPDATE ON runtime_audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_audit_no_delete BEFORE DELETE ON runtime_audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
            """)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.database, timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def record(self, event: str, context: OperationContext, detail: Mapping[str, Any] | None = None) -> dict[str, Any]:
        audit_id, created = f"audit-{uuid.uuid4()}", time.time()
        context_value = context.as_dict()
        detail_value = redact_sensitive(dict(detail or {}))
        with self._connect() as db:
            db.execute("INSERT INTO runtime_audit VALUES(?,?,?,?,?)", (audit_id, event, json.dumps(context_value, sort_keys=True), json.dumps(detail_value, sort_keys=True), created))
        return {"audit_id": audit_id, "event": event, "context": context_value, "detail": detail_value, "created_at": created}

    def list(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM runtime_audit ORDER BY created_at,audit_id").fetchall()
        return [{"audit_id": row["audit_id"], "event": row["event"], "context": json.loads(row["context_json"]), "detail": json.loads(row["detail_json"]), "created_at": row["created_at"]} for row in rows]


class RuntimeSecurity:
    def __init__(self, permissions: WorkspacePermissionStore, approvals: ApprovalRegistry, audit: AuditLog):
        self.permissions = permissions
        self.approvals = approvals
        self.audit = audit

    def authorize(
        self,
        principal: RuntimePrincipal,
        action: str,
        context: OperationContext,
        resource: Mapping[str, Any] | None = None,
        approval_id: str | None = None,
    ) -> None:
        if context.principal_id != principal.principal_id or context.workspace_id == "":
            raise SecurityError("principal_context_mismatch", "Runtime Principal does not match operation context.")
        if principal.expires_at <= int(time.time()):
            raise SecurityError("principal_expired", "Runtime Principal identity expired.")
        payload = dict(resource or {})
        if not self.permissions.allowed(context.workspace_id, principal.principal_id, action):
            self.audit.record("permission.denied", context, {"action": action})
            raise SecurityError("permission_denied", "Workspace permission denied.")
        self.audit.record("permission.granted", context, {"action": action, "role": self.permissions.role(context.workspace_id, principal.principal_id)})
        if action in SENSITIVE_ACTIONS:
            if not approval_id:
                requested = self.approvals.request(principal.principal_id, context.workspace_id, action, payload)
                self.audit.record("approval.requested", context, {"action": action, "approval_id": requested, "resource": payload})
                raise ApprovalRequired(requested)
            self.approvals.consume(approval_id, principal.principal_id, context.workspace_id, action, payload)
            self.audit.record("approval.consumed", context, {"action": action, "approval_id": approval_id})
        self.audit.record("operation.authorized", context, {"action": action, "resource": payload})


_SENSITIVE_KEY = re.compile(
    r"(?:token|password|secret|private.?key|authorization|api.?key|credential|"
    r"file.?content|message|prompt|command|arguments)",
    re.I,
)
_BEARER = re.compile(r"(?i)Bearer\s+[A-Za-z0-9._~+/=-]+")
_PRIVATE_KEY = re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", re.S)
_INLINE_CREDENTIAL = re.compile(r"(?i)\b(token|password|secret|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+")


def redact_sensitive(value: Any, key: str = "") -> Any:
    if _SENSITIVE_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        items = list(value.items())[:100]
        result = {str(child_key): redact_sensitive(child, str(child_key)) for child_key, child in items}
        if len(value) > len(items):
            result["_truncated_fields"] = len(value) - len(items)
        return result
    if isinstance(value, (list, tuple)):
        items = list(value)[:100]
        result = [redact_sensitive(item) for item in items]
        if len(value) > len(items):
            result.append(f"[TRUNCATED {len(value) - len(items)} ITEMS]")
        return result
    if isinstance(value, str):
        redacted = _PRIVATE_KEY.sub("[REDACTED PRIVATE KEY]", _BEARER.sub("Bearer [REDACTED]", value))
        redacted = _INLINE_CREDENTIAL.sub(lambda match: f"{match.group(1)}=[REDACTED]", redacted)
        return redacted if len(redacted) <= 4096 else f"{redacted[:4096]}[TRUNCATED {len(redacted) - 4096} CHARS]"
    return value


class SecureWorkspaceFS:
    """Descriptor-relative no-follow operations that resist symlink swaps."""

    def __init__(self, root: Path):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("Workspace root must be a directory")

    @staticmethod
    def _parts(relative: str) -> tuple[str, ...]:
        path = PurePosixPath(relative.replace("\\", "/"))
        if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
            raise SecurityError("workspace_path_invalid", "Workspace path must be relative and cannot traverse parents.")
        return path.parts

    def _parent(self, relative: str) -> tuple[int, str]:
        parts = self._parts(relative)
        descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in parts[:-1]:
                next_descriptor = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                os.close(descriptor)
                descriptor = next_descriptor
            return descriptor, parts[-1]
        except Exception:
            os.close(descriptor)
            raise

    def read_bytes(self, relative: str, max_bytes: int | None = None) -> bytes:
        try:
            parent, name = self._parent(relative)
        except SecurityError:
            raise
        except OSError as exc:
            raise SecurityError("workspace_path_rejected", "Workspace file cannot be followed or opened.") from exc
        try:
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
            try:
                with os.fdopen(descriptor, "rb", closefd=False) as handle:
                    return handle.read() if max_bytes is None else handle.read(max_bytes)
            finally:
                os.close(descriptor)
        except OSError as exc:
            raise SecurityError("workspace_path_rejected", "Workspace file cannot be followed or opened.") from exc
        finally:
            os.close(parent)

    def atomic_write(self, relative: str, content: bytes, *, before_replace: Callable[[], None] | None = None) -> None:
        try:
            parent, name = self._parent(relative)
        except SecurityError:
            raise
        except OSError as exc:
            raise SecurityError("workspace_write_denied", "Workspace write was rejected by path or OS permissions.") from exc
        temporary = f".{name}.opendrsai-{uuid.uuid4().hex}.tmp"
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            try:
                with os.fdopen(descriptor, "wb", closefd=False) as handle:
                    handle.write(content)
                    handle.flush()
                    os.fsync(descriptor)
            finally:
                os.close(descriptor)
            if before_replace:
                before_replace()
            os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
        except OSError as exc:
            try:
                os.unlink(temporary, dir_fd=parent)
            except OSError:
                pass
            raise SecurityError("workspace_write_denied", "Workspace write was rejected by path or OS permissions.") from exc
        finally:
            os.close(parent)
