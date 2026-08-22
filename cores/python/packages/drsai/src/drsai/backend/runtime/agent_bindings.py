"""Durable ownership bindings between Runtime entities and Agent Backends.

Bindings are immutable identity records. Mutable lifecycle state may advance, but
a Session or Run cannot be moved to another Backend, Runtime, or Workspace.
"""

from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgentBackendBindingError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class _ClosingConnection(sqlite3.Connection):
    """Commit or roll back a transaction and release its Windows file handle."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


@dataclass(frozen=True)
class AgentBackendSessionBinding:
    session_id: str
    workspace_id: str
    backend_id: str
    agent_backend_runtime_id: str
    workspace_runtime_id: str
    backend_session_id: str
    backend_version: str
    created_at: str
    backend_model_id: str | None = None
    workspace_fingerprint: str | None = None


@dataclass(frozen=True)
class AgentBackendRunBinding:
    run_id: str
    session_id: str
    workspace_id: str
    backend_id: str
    agent_backend_runtime_id: str
    workspace_runtime_id: str
    backend_run_id: str
    generation: int
    status: str
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class AgentBackendBindingOperation:
    entity_type: str
    entity_id: str
    operation_id: str
    method: str
    request_digest: str
    state: str
    backend_id: str | None
    error_code: str | None
    created_at: str
    updated_at: str


class AgentBackendBindingStore:
    """SQLite store enforcing stable Session/Run ownership."""

    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database,
            timeout=30,
            isolation_level=None,
            factory=_ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS agent_backend_session_bindings (
                  session_id TEXT PRIMARY KEY,
                  workspace_id TEXT NOT NULL,
                  backend_id TEXT NOT NULL,
                  agent_backend_runtime_id TEXT NOT NULL,
                  workspace_runtime_id TEXT NOT NULL,
                  backend_session_id TEXT NOT NULL,
                  backend_version TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(backend_id, agent_backend_runtime_id, backend_session_id),
                  CHECK(agent_backend_runtime_id = workspace_runtime_id)
                );
                CREATE TABLE IF NOT EXISTS agent_backend_run_bindings (
                  run_id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES agent_backend_session_bindings(session_id),
                  workspace_id TEXT NOT NULL,
                  backend_id TEXT NOT NULL,
                  agent_backend_runtime_id TEXT NOT NULL,
                  workspace_runtime_id TEXT NOT NULL,
                  backend_run_id TEXT NOT NULL,
                  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0),
                  status TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  UNIQUE(backend_id, agent_backend_runtime_id, backend_run_id),
                  CHECK(agent_backend_runtime_id = workspace_runtime_id)
                );
                CREATE TRIGGER IF NOT EXISTS agent_backend_session_identity_immutable
                BEFORE UPDATE ON agent_backend_session_bindings
                BEGIN SELECT RAISE(ABORT, 'Agent Backend Session identity is immutable'); END;
                CREATE TRIGGER IF NOT EXISTS agent_backend_run_identity_immutable
                BEFORE UPDATE OF run_id, session_id, workspace_id, backend_id,
                  agent_backend_runtime_id, workspace_runtime_id, backend_run_id
                ON agent_backend_run_bindings
                BEGIN SELECT RAISE(ABORT, 'Agent Backend Run identity is immutable'); END;
                CREATE TABLE IF NOT EXISTS agent_backend_binding_operations (
                  entity_type TEXT NOT NULL CHECK(entity_type IN ('session','run')),
                  entity_id TEXT NOT NULL,
                  operation_id TEXT NOT NULL UNIQUE,
                  method TEXT NOT NULL,
                  request_digest TEXT NOT NULL,
                  state TEXT NOT NULL CHECK(state IN ('pending','requesting','response_received','unknown','bound')),
                  backend_id TEXT,
                  error_code TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(entity_type, entity_id)
                );
                CREATE TABLE IF NOT EXISTS agent_backend_history_watermarks (
                  session_id TEXT PRIMARY KEY REFERENCES agent_backend_session_bindings(session_id) ON DELETE CASCADE,
                  backend_updated_at TEXT,
                  synced_backend_updated_at TEXT,
                  mapping_version TEXT,
                  schema_version INTEGER NOT NULL DEFAULT 1,
                  content_digest TEXT,
                  run_count INTEGER NOT NULL DEFAULT 0,
                  item_count INTEGER NOT NULL DEFAULT 0,
                  warning_count INTEGER NOT NULL DEFAULT 0,
                  synced_at TEXT
                );
                """
            )
            columns = {str(row[1]) for row in db.execute("PRAGMA table_info(agent_backend_session_bindings)")}
            if "backend_model_id" not in columns:
                db.execute("ALTER TABLE agent_backend_session_bindings ADD COLUMN backend_model_id TEXT")
            if "workspace_fingerprint" not in columns:
                db.execute("ALTER TABLE agent_backend_session_bindings ADD COLUMN workspace_fingerprint TEXT")
            # Older schemas rejected every UPDATE. P9 permits one-time
            # adoption of nullable context while keeping identity immutable.
            db.execute("DROP TRIGGER IF EXISTS agent_backend_session_identity_immutable")
            db.execute(
                """CREATE TRIGGER agent_backend_session_identity_immutable
                BEFORE UPDATE OF session_id,workspace_id,backend_id,agent_backend_runtime_id,
                  workspace_runtime_id,backend_session_id,backend_version,created_at
                ON agent_backend_session_bindings
                BEGIN SELECT RAISE(ABORT, 'Agent Backend Session identity is immutable'); END"""
            )

    def update_history_source(self, session_id: str, backend_updated_at: str | None) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT INTO agent_backend_history_watermarks(session_id,backend_updated_at) VALUES(?,?) "
                "ON CONFLICT(session_id) DO UPDATE SET backend_updated_at=excluded.backend_updated_at",
                (session_id, backend_updated_at),
            )

    def get_history_watermark(self, session_id: str) -> dict[str, object] | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM agent_backend_history_watermarks WHERE session_id=?", (session_id,)).fetchone()
        return dict(row) if row is not None else None

    def mark_history_synced(
        self, session_id: str, *, mapping_version: str, content_digest: str,
        run_count: int, item_count: int, warning_count: int,
    ) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE agent_backend_history_watermarks SET "
                "synced_backend_updated_at=backend_updated_at,mapping_version=?,schema_version=1,content_digest=?,"
                "run_count=?,item_count=?,warning_count=?,synced_at=? WHERE session_id=?",
                (mapping_version, content_digest, run_count, item_count, warning_count, _now(), session_id),
            )

    def prepare_operation(self, entity_type: str, entity_id: str, method: str, request_digest: str) -> AgentBackendBindingOperation:
        if entity_type not in {"session", "run"} or not all((entity_id, method, request_digest)):
            raise AgentBackendBindingError("agent_backend_operation_invalid", "Backend binding operation is invalid.")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM agent_backend_binding_operations WHERE entity_type=? AND entity_id=?",
                (entity_type, entity_id),
            ).fetchone()
            if row is not None:
                operation = self._operation(row)
                if operation.method != method or operation.request_digest != request_digest:
                    db.rollback()
                    raise AgentBackendBindingError(
                        "agent_backend_operation_conflict", "Backend entity already has a different binding operation."
                    )
                db.commit()
                return operation
            now = _now()
            db.execute(
                "INSERT INTO agent_backend_binding_operations VALUES(?,?,?,?,?,?,?,?,?,?)",
                (entity_type, entity_id, f"backend-operation-{uuid.uuid4()}", method, request_digest,
                 "pending", None, None, now, now),
            )
            db.commit()
        return self.get_operation(entity_type, entity_id)

    def mark_operation_requesting(self, entity_type: str, entity_id: str) -> AgentBackendBindingOperation:
        with self._lock, self._connect() as db:
            cursor = db.execute(
                "UPDATE agent_backend_binding_operations SET state='requesting', updated_at=? "
                "WHERE entity_type=? AND entity_id=? AND state='pending'",
                (_now(), entity_type, entity_id),
            )
            if cursor.rowcount != 1:
                operation = self.get_operation(entity_type, entity_id)
                if operation.state != "requesting":
                    raise AgentBackendBindingError("agent_backend_operation_state_invalid", "Backend operation cannot start a request.")
        return self.get_operation(entity_type, entity_id)

    def mark_operation_response(self, entity_type: str, entity_id: str, backend_id: str) -> AgentBackendBindingOperation:
        if not backend_id:
            raise AgentBackendBindingError("agent_backend_operation_invalid", "Backend response identity is empty.")
        with self._lock, self._connect() as db:
            row = db.execute(
                "SELECT * FROM agent_backend_binding_operations WHERE entity_type=? AND entity_id=?",
                (entity_type, entity_id),
            ).fetchone()
            if row is None:
                raise KeyError("Backend binding operation not found")
            operation = self._operation(row)
            if operation.backend_id not in {None, backend_id} or operation.state not in {"requesting", "response_received"}:
                raise AgentBackendBindingError("agent_backend_operation_conflict", "Backend response conflicts with binding operation.")
            db.execute(
                "UPDATE agent_backend_binding_operations SET state='response_received', backend_id=?, error_code=NULL, updated_at=? "
                "WHERE entity_type=? AND entity_id=?",
                (backend_id, _now(), entity_type, entity_id),
            )
        return self.get_operation(entity_type, entity_id)

    def mark_operation_unknown(self, entity_type: str, entity_id: str, error_code: str) -> AgentBackendBindingOperation:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE agent_backend_binding_operations SET state='unknown', error_code=?, updated_at=? "
                "WHERE entity_type=? AND entity_id=? AND state IN ('requesting','unknown')",
                (error_code, _now(), entity_type, entity_id),
            )
        return self.get_operation(entity_type, entity_id)

    def reset_operation_pending(self, entity_type: str, entity_id: str, error_code: str) -> AgentBackendBindingOperation:
        with self._lock, self._connect() as db:
            cursor = db.execute(
                "UPDATE agent_backend_binding_operations SET state='pending', error_code=?, updated_at=? "
                "WHERE entity_type=? AND entity_id=? AND state='requesting'",
                (error_code, _now(), entity_type, entity_id),
            )
            if cursor.rowcount != 1:
                raise AgentBackendBindingError("agent_backend_operation_state_invalid", "Backend operation cannot return to pending.")
        return self.get_operation(entity_type, entity_id)

    def get_operation(self, entity_type: str, entity_id: str) -> AgentBackendBindingOperation:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM agent_backend_binding_operations WHERE entity_type=? AND entity_id=?",
                (entity_type, entity_id),
            ).fetchone()
        if row is None:
            raise KeyError("Backend binding operation not found")
        return self._operation(row)

    @staticmethod
    def _validate_colocation(agent_backend_runtime_id: str, workspace_runtime_id: str) -> None:
        if agent_backend_runtime_id != workspace_runtime_id:
            raise AgentBackendBindingError(
                "distributed_backend_not_supported",
                "Agent Backend and Workspace must run in the same Full Agent Runtime.",
            )

    def bind_session(
        self,
        *,
        session_id: str,
        workspace_id: str,
        backend_id: str,
        agent_backend_runtime_id: str,
        workspace_runtime_id: str,
        backend_session_id: str,
        backend_version: str,
        backend_model_id: str | None = None,
        workspace_fingerprint: str | None = None,
    ) -> AgentBackendSessionBinding:
        self._validate_colocation(agent_backend_runtime_id, workspace_runtime_id)
        identity_values = (
            session_id,
            workspace_id,
            backend_id,
            agent_backend_runtime_id,
            workspace_runtime_id,
            backend_session_id,
            backend_version,
        )
        if not all(identity_values):
            raise AgentBackendBindingError("agent_backend_binding_invalid", "Session binding fields must be non-empty.")
        values = (*identity_values, backend_model_id, workspace_fingerprint)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM agent_backend_session_bindings WHERE session_id=?", (session_id,)
            ).fetchone()
            if existing is not None:
                binding = self._session(existing)
                if tuple(asdict(binding)[key] for key in (
                    "session_id", "workspace_id", "backend_id", "agent_backend_runtime_id",
                    "workspace_runtime_id", "backend_session_id", "backend_version",
                    "backend_model_id", "workspace_fingerprint"
                )) != values:
                    db.rollback()
                    raise AgentBackendBindingError(
                        "agent_backend_session_binding_conflict",
                        "Session is already bound to another Backend, Runtime, or Workspace.",
                    )
                db.commit()
                return binding
            created_at = _now()
            try:
                db.execute(
                    "INSERT INTO agent_backend_session_bindings("
                    "session_id,workspace_id,backend_id,agent_backend_runtime_id,workspace_runtime_id,"
                    "backend_session_id,backend_version,created_at,backend_model_id,workspace_fingerprint) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (*identity_values, created_at, backend_model_id, workspace_fingerprint),
                )
            except sqlite3.IntegrityError as exc:
                db.rollback()
                raise AgentBackendBindingError(
                    "agent_backend_session_binding_conflict", "Backend Session identity is already bound."
                ) from exc
            db.commit()
        return self.get_session(session_id)

    def adopt_session_context(
        self, session_id: str, *, backend_model_id: str, workspace_fingerprint: str,
    ) -> AgentBackendSessionBinding:
        if not backend_model_id or not workspace_fingerprint:
            raise AgentBackendBindingError("agent_backend_binding_invalid", "Session context fields must be non-empty.")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM agent_backend_session_bindings WHERE session_id=?", (session_id,)).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Backend Session binding not found")
            current = self._session(row)
            if ((current.backend_model_id and current.backend_model_id != backend_model_id)
                    or (current.workspace_fingerprint and current.workspace_fingerprint != workspace_fingerprint)):
                db.rollback()
                raise AgentBackendBindingError(
                    "agent_backend_session_context_conflict",
                    "Session model or canonical Workspace does not match its persisted binding.",
                )
            db.execute(
                "UPDATE agent_backend_session_bindings SET "
                "backend_model_id=COALESCE(backend_model_id,?), "
                "workspace_fingerprint=COALESCE(workspace_fingerprint,?) WHERE session_id=?",
                (backend_model_id, workspace_fingerprint, session_id),
            )
            db.commit()
        return self.get_session(session_id)

    def complete_session_operation(
        self, *, session_id: str, workspace_id: str, backend_id: str,
        agent_backend_runtime_id: str, workspace_runtime_id: str, backend_version: str,
        backend_model_id: str | None = None, workspace_fingerprint: str | None = None,
    ) -> AgentBackendSessionBinding:
        self._validate_colocation(agent_backend_runtime_id, workspace_runtime_id)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            operation_row = db.execute(
                "SELECT * FROM agent_backend_binding_operations WHERE entity_type='session' AND entity_id=?",
                (session_id,),
            ).fetchone()
            if operation_row is None:
                db.rollback(); raise KeyError("Backend Session operation not found")
            operation = self._operation(operation_row)
            if operation.state not in {"response_received", "bound"} or not operation.backend_id:
                db.rollback()
                raise AgentBackendBindingError("agent_backend_operation_state_invalid", "Session operation has no confirmed response.")
            identity_values = (session_id, workspace_id, backend_id, agent_backend_runtime_id,
                               workspace_runtime_id, operation.backend_id, backend_version)
            values = (*identity_values, backend_model_id, workspace_fingerprint)
            existing = db.execute("SELECT * FROM agent_backend_session_bindings WHERE session_id=?", (session_id,)).fetchone()
            if existing is None:
                try:
                    db.execute(
                        "INSERT INTO agent_backend_session_bindings("
                        "session_id,workspace_id,backend_id,agent_backend_runtime_id,workspace_runtime_id,"
                        "backend_session_id,backend_version,created_at,backend_model_id,workspace_fingerprint) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?)",
                        (*identity_values, _now(), backend_model_id, workspace_fingerprint),
                    )
                except sqlite3.IntegrityError as exc:
                    db.rollback()
                    raise AgentBackendBindingError("agent_backend_session_binding_conflict", "Backend Session identity is already bound.") from exc
            else:
                current = self._session(existing)
                actual = tuple(asdict(current)[key] for key in (
                    "session_id", "workspace_id", "backend_id", "agent_backend_runtime_id",
                    "workspace_runtime_id", "backend_session_id", "backend_version",
                    "backend_model_id", "workspace_fingerprint"))
                if actual != values:
                    db.rollback()
                    raise AgentBackendBindingError("agent_backend_session_binding_conflict", "Session binding conflicts with confirmed response.")
            db.execute(
                "UPDATE agent_backend_binding_operations SET state='bound', updated_at=? WHERE entity_type='session' AND entity_id=?",
                (_now(), session_id),
            )
            row = db.execute("SELECT * FROM agent_backend_session_bindings WHERE session_id=?", (session_id,)).fetchone()
            db.commit()
        return self._session(row)

    def bind_run(
        self,
        *,
        run_id: str,
        session_id: str,
        workspace_id: str,
        backend_id: str,
        agent_backend_runtime_id: str,
        workspace_runtime_id: str,
        backend_run_id: str,
        generation: int = 0,
        status: str = "created",
    ) -> AgentBackendRunBinding:
        self._validate_colocation(agent_backend_runtime_id, workspace_runtime_id)
        if not all((run_id, session_id, workspace_id, backend_id, agent_backend_runtime_id, backend_run_id, status)) or generation < 0:
            raise AgentBackendBindingError("agent_backend_binding_invalid", "Run binding fields are invalid.")
        session = self.get_session(session_id)
        expected = (workspace_id, backend_id, agent_backend_runtime_id, workspace_runtime_id)
        actual = (
            session.workspace_id,
            session.backend_id,
            session.agent_backend_runtime_id,
            session.workspace_runtime_id,
        )
        if actual != expected:
            raise AgentBackendBindingError(
                "agent_backend_run_binding_conflict", "Run binding must inherit its Session ownership."
            )
        identity = (
            run_id, session_id, workspace_id, backend_id, agent_backend_runtime_id,
            workspace_runtime_id, backend_run_id,
        )
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM agent_backend_run_bindings WHERE run_id=?", (run_id,)).fetchone()
            if existing is not None:
                binding = self._run(existing)
                existing_identity = tuple(asdict(binding)[key] for key in (
                    "run_id", "session_id", "workspace_id", "backend_id", "agent_backend_runtime_id",
                    "workspace_runtime_id", "backend_run_id"
                ))
                if existing_identity != identity:
                    db.rollback()
                    raise AgentBackendBindingError(
                        "agent_backend_run_binding_conflict", "Run is already bound to another identity."
                    )
                db.commit()
                return binding
            now = _now()
            try:
                db.execute(
                    "INSERT INTO agent_backend_run_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (*identity, generation, status, now, now),
                )
            except sqlite3.IntegrityError as exc:
                db.rollback()
                raise AgentBackendBindingError(
                    "agent_backend_run_binding_conflict", "Backend Run identity is already bound."
                ) from exc
            db.commit()
        return self.get_run(run_id)

    def complete_run_operation(
        self, *, run_id: str, session_id: str, workspace_id: str, backend_id: str,
        agent_backend_runtime_id: str, workspace_runtime_id: str, generation: int, status: str = "running",
    ) -> AgentBackendRunBinding:
        self._validate_colocation(agent_backend_runtime_id, workspace_runtime_id)
        session = self.get_session(session_id)
        if (session.workspace_id, session.backend_id, session.agent_backend_runtime_id, session.workspace_runtime_id) != (
            workspace_id, backend_id, agent_backend_runtime_id, workspace_runtime_id
        ):
            raise AgentBackendBindingError("agent_backend_run_binding_conflict", "Run binding must inherit Session ownership.")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            operation_row = db.execute(
                "SELECT * FROM agent_backend_binding_operations WHERE entity_type='run' AND entity_id=?", (run_id,)
            ).fetchone()
            if operation_row is None:
                db.rollback(); raise KeyError("Backend Run operation not found")
            operation = self._operation(operation_row)
            if operation.state not in {"response_received", "bound"} or not operation.backend_id:
                db.rollback()
                raise AgentBackendBindingError("agent_backend_operation_state_invalid", "Run operation has no confirmed response.")
            identity = (run_id, session_id, workspace_id, backend_id, agent_backend_runtime_id,
                        workspace_runtime_id, operation.backend_id)
            existing = db.execute("SELECT * FROM agent_backend_run_bindings WHERE run_id=?", (run_id,)).fetchone()
            if existing is None:
                now = _now()
                try:
                    db.execute("INSERT INTO agent_backend_run_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                               (*identity, generation, status, now, now))
                except sqlite3.IntegrityError as exc:
                    db.rollback()
                    raise AgentBackendBindingError("agent_backend_run_binding_conflict", "Backend Run identity is already bound.") from exc
            else:
                current = self._run(existing)
                actual = tuple(asdict(current)[key] for key in (
                    "run_id", "session_id", "workspace_id", "backend_id", "agent_backend_runtime_id",
                    "workspace_runtime_id", "backend_run_id"))
                if actual != identity:
                    db.rollback()
                    raise AgentBackendBindingError("agent_backend_run_binding_conflict", "Run binding conflicts with confirmed response.")
            db.execute(
                "UPDATE agent_backend_binding_operations SET state='bound', updated_at=? WHERE entity_type='run' AND entity_id=?",
                (_now(), run_id),
            )
            row = db.execute("SELECT * FROM agent_backend_run_bindings WHERE run_id=?", (run_id,)).fetchone()
            db.commit()
        return self._run(row)

    def update_run_state(self, run_id: str, *, generation: int, status: str) -> AgentBackendRunBinding:
        if generation < 0 or not status:
            raise AgentBackendBindingError("agent_backend_binding_invalid", "Run state is invalid.")
        with self._lock, self._connect() as db:
            cursor = db.execute(
                "UPDATE agent_backend_run_bindings SET generation=?, status=?, updated_at=? WHERE run_id=?",
                (generation, status, _now(), run_id),
            )
            if cursor.rowcount != 1:
                raise KeyError("Agent Backend Run binding not found")
        return self.get_run(run_id)

    def get_session(self, session_id: str) -> AgentBackendSessionBinding:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM agent_backend_session_bindings WHERE session_id=?", (session_id,)
            ).fetchone()
        if row is None:
            raise KeyError("Agent Backend Session binding not found")
        return self._session(row)

    def find_session_by_backend_id(self, backend_id: str, backend_session_id: str) -> AgentBackendSessionBinding | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM agent_backend_session_bindings WHERE backend_id=? AND backend_session_id=?",
                (backend_id, backend_session_id),
            ).fetchone()
        return self._session(row) if row is not None else None

    def get_run(self, run_id: str) -> AgentBackendRunBinding:
        with self._connect() as db:
            row = db.execute("SELECT * FROM agent_backend_run_bindings WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("Agent Backend Run binding not found")
        return self._run(row)

    def find_run_by_backend_ids(self, backend_session_id: str, backend_run_id: str) -> AgentBackendRunBinding:
        with self._connect() as db:
            row = db.execute(
                """SELECT r.* FROM agent_backend_run_bindings r
                   JOIN agent_backend_session_bindings s ON s.session_id=r.session_id
                   WHERE s.backend_session_id=? AND r.backend_run_id=?""",
                (backend_session_id, backend_run_id),
            ).fetchone()
        if row is None:
            raise KeyError("Agent Backend Run binding not found")
        return self._run(row)

    @staticmethod
    def _session(row: sqlite3.Row) -> AgentBackendSessionBinding:
        return AgentBackendSessionBinding(**dict(row))

    @staticmethod
    def _run(row: sqlite3.Row) -> AgentBackendRunBinding:
        return AgentBackendRunBinding(**dict(row))

    @staticmethod
    def _operation(row: sqlite3.Row) -> AgentBackendBindingOperation:
        return AgentBackendBindingOperation(**dict(row))
