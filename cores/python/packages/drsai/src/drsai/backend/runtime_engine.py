from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


RUN_TRANSITIONS = {
    "queued": {"running", "cancelled", "failed"},
    "running": {"waiting_approval", "completed", "cancelled", "failed"},
    "waiting_approval": {"running", "cancelled", "failed"},
    "completed": set(),
    "cancelled": set(),
    "failed": set(),
}


class _ClosingConnection(sqlite3.Connection):
    """A transaction context that also releases the OS file handle on exit."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class RuntimeEngineIdentity:
    runtime_id: str
    instance_id: str


class RuntimeEngine:
    """Durable Session/Run/Event state owned by one Agent Runtime."""

    def __init__(
        self,
        database: Path,
        identity: RuntimeEngineIdentity,
        workspace_exists: Callable[[str], bool],
        worktree_for_workspace: Callable[[str], str | None] | None = None,
    ):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.identity = identity
        self.workspace_exists = workspace_exists
        self.worktree_for_workspace = worktree_for_workspace or (lambda _workspace_id: None)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=_ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_sessions (
                  session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, worktree_id TEXT, title TEXT NOT NULL,
                  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_sessions_workspace ON runtime_sessions(workspace_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS runtime_runs (
                  run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  workspace_id TEXT NOT NULL, worktree_id TEXT, runtime_id TEXT NOT NULL, instance_id TEXT NOT NULL,
                  agent_definition TEXT NOT NULL, backend_id TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
                  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, cancel_requested_at TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_events (
                  event_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  sequence INTEGER NOT NULL, event_type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
                  backend_event_key TEXT,
                  PRIMARY KEY(run_id, sequence)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_events_no_update BEFORE UPDATE ON runtime_events BEGIN SELECT RAISE(ABORT, 'runtime events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_events_no_delete BEFORE DELETE ON runtime_events BEGIN SELECT RAISE(ABORT, 'runtime events are append-only'); END;
                CREATE TABLE IF NOT EXISTS runtime_approvals (
                  approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runtime_runs(run_id), status TEXT NOT NULL,
                  request_json TEXT NOT NULL, decision_json TEXT, deadline_at TEXT, created_at TEXT NOT NULL, resolved_at TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_checkpoints (
                  checkpoint_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  event_sequence INTEGER NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL
                );
                """
            )
            columns = {str(row["name"]) for row in db.execute("PRAGMA table_info(runtime_runs)").fetchall()}
            session_columns = {str(row["name"]) for row in db.execute("PRAGMA table_info(runtime_sessions)").fetchall()}
            if "worktree_id" not in session_columns:
                db.execute("ALTER TABLE runtime_sessions ADD COLUMN worktree_id TEXT")
            if "worktree_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN worktree_id TEXT")
            if "backend_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN backend_id TEXT NOT NULL DEFAULT 'opendrsai'")
            event_columns = {str(row["name"]) for row in db.execute("PRAGMA table_info(runtime_events)").fetchall()}
            if "backend_event_key" not in event_columns:
                db.execute("ALTER TABLE runtime_events ADD COLUMN backend_event_key TEXT")
            workspace_rows = db.execute(
                "SELECT workspace_id FROM runtime_sessions WHERE worktree_id IS NULL "
                "UNION SELECT workspace_id FROM runtime_runs WHERE worktree_id IS NULL"
            ).fetchall()
            for workspace_row in workspace_rows:
                workspace_id = str(workspace_row["workspace_id"])
                worktree_id = self.worktree_for_workspace(workspace_id)
                if worktree_id:
                    db.execute("UPDATE runtime_sessions SET worktree_id=? WHERE workspace_id=? AND worktree_id IS NULL", (worktree_id, workspace_id))
                    db.execute("UPDATE runtime_runs SET worktree_id=? WHERE workspace_id=? AND worktree_id IS NULL", (worktree_id, workspace_id))
            db.executescript(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_events_backend_key
                  ON runtime_events(run_id, backend_event_key) WHERE backend_event_key IS NOT NULL;
                DROP TRIGGER IF EXISTS runtime_runs_identity_immutable;
                CREATE TRIGGER runtime_runs_identity_immutable
                BEFORE UPDATE OF session_id, workspace_id, worktree_id, runtime_id, instance_id, agent_definition, backend_id
                ON runtime_runs
                BEGIN SELECT RAISE(ABORT, 'Runtime Run ownership is immutable'); END;
                """
            )

    def create_session(self, workspace_id: str, title: str = "New session") -> dict[str, Any]:
        if not workspace_id or not self.workspace_exists(workspace_id):
            raise KeyError("Unknown or closed Workspace")
        now = _now()
        session_id = f"session-{uuid.uuid4()}"
        worktree_id = self.worktree_for_workspace(workspace_id)
        with self._connect() as db:
            db.execute(
                "INSERT INTO runtime_sessions(session_id,workspace_id,worktree_id,title,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (session_id, workspace_id, worktree_id, title[:240] or "New session", 0, now, now),
            )
        return self.get_session(session_id)

    def import_session(self, session_id: str, workspace_id: str, title: str = "Imported session") -> tuple[dict[str, Any], bool]:
        """Idempotently import a legacy Session with a deterministic identity."""
        if not session_id or not self.workspace_exists(workspace_id):
            raise KeyError("Unknown or closed Workspace")
        now = _now()
        worktree_id = self.worktree_for_workspace(workspace_id)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)).fetchone()
            if existing is not None:
                if str(existing["workspace_id"]) != workspace_id:
                    db.rollback()
                    raise ValueError("Imported Session identity is already bound to another Workspace")
                db.commit()
                return self._session(existing), False
            db.execute(
                "INSERT INTO runtime_sessions(session_id,workspace_id,worktree_id,title,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (session_id, workspace_id, worktree_id, title[:240] or "Imported session", 0, now, now),
            )
            db.commit()
        return self.get_session(session_id), True

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise KeyError("Session not found")
        return self._session(row)

    def list_sessions(self, workspace_id: str, *, offset: int = 0, limit: int = 50, archived: bool | None = False) -> dict[str, Any]:
        where = "workspace_id=?" + ("" if archived is None else " AND archived=?")
        args: list[Any] = [workspace_id] + ([] if archived is None else [int(archived)])
        with self._connect() as db:
            total = db.execute(f"SELECT COUNT(*) FROM runtime_sessions WHERE {where}", args).fetchone()[0]
            rows = db.execute(f"SELECT * FROM runtime_sessions WHERE {where} ORDER BY updated_at DESC LIMIT ? OFFSET ?", [*args, max(1, min(limit, 200)), max(0, offset)]).fetchall()
        return {"object": "list", "data": [self._session(row) for row in rows], "total": total, "offset": max(0, offset)}

    def active_workspace_resources(self, workspace_id: str) -> list[dict[str, Any]]:
        """Return resources that make destructive Workspace removal unsafe."""
        with self._connect() as db:
            sessions = db.execute(
                "SELECT session_id, title FROM runtime_sessions WHERE workspace_id=? AND archived=0 ORDER BY created_at",
                (workspace_id,),
            ).fetchall()
            runs = db.execute(
                "SELECT run_id, session_id, status FROM runtime_runs "
                "WHERE workspace_id=? AND status IN ('queued','running','waiting_approval') ORDER BY created_at",
                (workspace_id,),
            ).fetchall()
        return [
            {"kind": "session", "id": str(row["session_id"]), "title": str(row["title"])}
            for row in sessions
        ] + [
            {"kind": "run", "id": str(row["run_id"]), "session_id": str(row["session_id"]), "status": str(row["status"])}
            for row in runs
        ]

    def update_session(self, session_id: str, *, title: str | None = None, archived: bool | None = None) -> dict[str, Any]:
        current = self.get_session(session_id)
        with self._connect() as db:
            db.execute("UPDATE runtime_sessions SET title=?, archived=?, updated_at=? WHERE session_id=?", (title[:240] if title is not None else current["title"], int(archived if archived is not None else current["archived"]), _now(), session_id))
        return self.get_session(session_id)

    def create_run(
        self,
        session_id: str,
        agent_definition: str,
        idempotency_key: str,
        backend_id: str = "opendrsai",
    ) -> tuple[dict[str, Any], bool]:
        session = self.get_session(session_id)
        if not idempotency_key or len(idempotency_key) > 200:
            raise ValueError("A valid Idempotency-Key is required")
        if not backend_id or len(backend_id) > 128:
            raise ValueError("A valid Agent Backend id is required")
        now = _now()
        run_id = f"run-{uuid.uuid4()}"
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM runtime_runs WHERE idempotency_key=?", (idempotency_key,)).fetchone()
            if existing is not None:
                expected = (session_id, session["workspace_id"], session["worktree_id"], agent_definition, backend_id)
                actual = (
                    str(existing["session_id"]),
                    str(existing["workspace_id"]),
                    str(existing["worktree_id"]) if existing["worktree_id"] is not None else None,
                    str(existing["agent_definition"]),
                    str(existing["backend_id"]),
                )
                if actual != expected:
                    db.rollback()
                    raise ValueError("Idempotency-Key is already bound to another Run identity")
                db.commit()
                return self._run(existing), False
            db.execute(
                """INSERT INTO runtime_runs(
                    run_id, session_id, workspace_id, worktree_id, runtime_id, instance_id, agent_definition,
                    backend_id, status, idempotency_key, created_at, started_at, completed_at, cancel_requested_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, session_id, session["workspace_id"], session["worktree_id"], self.identity.runtime_id,
                    self.identity.instance_id, agent_definition, backend_id, "queued",
                    idempotency_key, now, None, None, None,
                ),
            )
            db.commit()
        self.append_event(run_id, "run.created", {"agent_definition": agent_definition, "backend_id": backend_id})
        return self.get_run(run_id), True

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("Run not found")
        return self._run(row)

    def transition_run(self, run_id: str, status: str) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                db.rollback(); raise KeyError("Run not found")
            if status not in RUN_TRANSITIONS.get(row["status"], set()):
                db.rollback(); raise ValueError(f"Illegal Run transition: {row['status']} -> {status}")
            started = row["started_at"] or (_now() if status == "running" else None)
            completed = _now() if status in {"completed", "cancelled", "failed"} else None
            db.execute("UPDATE runtime_runs SET status=?, started_at=?, completed_at=? WHERE run_id=?", (status, started, completed, run_id))
            db.commit()
        self.append_event(run_id, f"run.{status}", {})
        return self.get_run(run_id)

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        run = self.get_run(run_id)
        if run["status"] in {"completed", "cancelled", "failed"}:
            return run
        self.mark_cancel_requested(run_id)
        return self.transition_run(run_id, "cancelled")

    def mark_cancel_requested(self, run_id: str) -> dict[str, Any]:
        run = self.get_run(run_id)
        if run["cancel_requested_at"] is not None:
            return run
        with self._connect() as db:
            db.execute("UPDATE runtime_runs SET cancel_requested_at=? WHERE run_id=?", (_now(), run_id))
        self.append_event(run_id, "run.cancel_requested", {})
        return self.get_run(run_id)

    def append_event(self, run_id: str, event_type: str, data: dict[str, Any]) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone() is None:
                db.rollback(); raise KeyError("Run not found")
            sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?", (run_id,)).fetchone()[0]
            event_id, created = f"event-{uuid.uuid4()}", _now()
            db.execute(
                "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
                (event_id, run_id, sequence, event_type, json.dumps(data, separators=(",", ":"), sort_keys=True), created),
            )
            db.commit()
        return {"event_id": event_id, "run_id": run_id, "sequence": sequence, "type": event_type, "data": data, "created_at": created}

    def append_backend_event(self, run_id: str, event_type: str, data: dict[str, Any], backend_event_key: str) -> dict[str, Any]:
        if not backend_event_key or len(backend_event_key) > 500:
            raise ValueError("A valid Backend Event key is required")
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM runtime_events WHERE run_id=? AND backend_event_key=?",
                (run_id, backend_event_key),
            ).fetchone()
            if existing is not None:
                db.commit()
                return self._event(existing)
            if db.execute("SELECT 1 FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone() is None:
                db.rollback(); raise KeyError("Run not found")
            sequence = db.execute(
                "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?", (run_id,)
            ).fetchone()[0]
            event_id, created = f"event-{uuid.uuid4()}", _now()
            db.execute(
                "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,?)",
                (event_id, run_id, sequence, event_type,
                 json.dumps(data, separators=(",", ":"), sort_keys=True), created, backend_event_key),
            )
            row = db.execute("SELECT * FROM runtime_events WHERE event_id=?", (event_id,)).fetchone()
            db.commit()
        return self._event(row)

    def append_backend_events(self, run_id: str, events: list[tuple[str, dict[str, Any], str]]) -> list[dict[str, Any]]:
        """Persist a pressure batch in one transaction while preserving Backend-key idempotency."""
        if len(events) > 20_000:
            raise ValueError("Backend Event batch exceeds the Runtime limit")
        if any(not key or len(key) > 500 for _, _, key in events):
            raise ValueError("A valid Backend Event key is required")
        results: list[dict[str, Any]] = []
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone() is None:
                db.rollback(); raise KeyError("Run not found")
            sequence = int(db.execute("SELECT COALESCE(MAX(sequence),0) FROM runtime_events WHERE run_id=?", (run_id,)).fetchone()[0])
            for event_type, data, backend_event_key in events:
                existing = db.execute(
                    "SELECT * FROM runtime_events WHERE run_id=? AND backend_event_key=?", (run_id, backend_event_key),
                ).fetchone()
                if existing is not None:
                    results.append(self._event(existing)); continue
                sequence += 1
                event_id, created = f"event-{uuid.uuid4()}", _now()
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,?)",
                    (event_id, run_id, sequence, event_type, json.dumps(data, separators=(",", ":"), sort_keys=True), created, backend_event_key),
                )
                results.append({"event_id": event_id, "run_id": run_id, "sequence": sequence, "type": event_type,
                                "data": data, "created_at": created, "backend_event_key": backend_event_key})
            db.commit()
        return results

    def list_events(self, run_id: str, after_sequence: int = 0, limit: int = 500) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM runtime_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?", (run_id, max(0, after_sequence), max(1, min(limit, 2000)))).fetchall()
        return [self._event(row) for row in rows]

    def request_approval(self, run_id: str, request: dict[str, Any], deadline_at: str | None = None) -> dict[str, Any]:
        if self.get_run(run_id)["status"] != "running":
            raise ValueError("Only a running Run can wait for approval")
        approval_id, created = f"approval-{uuid.uuid4()}", _now()
        with self._connect() as db:
            db.execute("INSERT INTO runtime_approvals VALUES(?,?,?,?,?,?,?,?)", (approval_id, run_id, "pending", json.dumps(request), None, deadline_at, created, None))
        self.transition_run(run_id, "waiting_approval")
        return self.get_approval(approval_id)

    def get_approval(self, approval_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_approvals WHERE approval_id=?", (approval_id,)).fetchone()
        if row is None:
            raise KeyError("Approval not found")
        return {"approval_id": row["approval_id"], "run_id": row["run_id"], "status": row["status"], "request": json.loads(row["request_json"]), "decision": json.loads(row["decision_json"]) if row["decision_json"] else None, "deadline_at": row["deadline_at"], "created_at": row["created_at"], "resolved_at": row["resolved_at"]}

    def resolve_approval(
        self, approval_id: str, decision: str, detail: dict[str, Any] | None = None,
        *, resume_on_denied: bool = False,
    ) -> dict[str, Any]:
        approval = self.get_approval(approval_id)
        if approval["status"] != "pending" or decision not in {"approved", "denied", "timeout"}:
            raise ValueError("Approval decision is invalid")
        with self._connect() as db:
            db.execute("UPDATE runtime_approvals SET status=?, decision_json=?, resolved_at=? WHERE approval_id=?", (decision, json.dumps(detail or {}), _now(), approval_id))
        self.transition_run(
            approval["run_id"],
            "running" if decision == "approved" or (decision == "denied" and resume_on_denied)
            else "cancelled" if decision == "denied" else "failed",
        )
        self.append_event(approval["run_id"], f"approval.{decision}", {"approval_id": approval_id, **(detail or {})})
        return self.get_approval(approval_id)

    def list_pending_approvals(self, run_id: str | None = None) -> list[dict[str, Any]]:
        now = _now()
        with self._connect() as db:
            expired = db.execute(
                "SELECT approval_id FROM runtime_approvals WHERE status='pending' AND deadline_at IS NOT NULL AND deadline_at<=?",
                (now,),
            ).fetchall()
        for row in expired:
            self.resolve_approval(str(row["approval_id"]), "timeout", {"reason": "deadline_elapsed"})
        query = "SELECT approval_id FROM runtime_approvals WHERE status='pending'"
        args: tuple[Any, ...] = ()
        if run_id is not None:
            query += " AND run_id=?"
            args = (run_id,)
        query += " ORDER BY created_at"
        with self._connect() as db:
            rows = db.execute(query, args).fetchall()
        return [self.get_approval(str(row["approval_id"])) for row in rows]

    def save_checkpoint(self, run_id: str, state: dict[str, Any]) -> dict[str, Any]:
        self.get_run(run_id)
        events = self.list_events(run_id)
        checkpoint_id, created = f"checkpoint-{uuid.uuid4()}", _now()
        sequence = events[-1]["sequence"] if events else 0
        with self._connect() as db:
            db.execute("INSERT INTO runtime_checkpoints VALUES(?,?,?,?,?)", (checkpoint_id, run_id, sequence, json.dumps(state, separators=(",", ":"), sort_keys=True), created))
        return {"checkpoint_id": checkpoint_id, "run_id": run_id, "event_sequence": sequence, "state": state, "created_at": created}

    def latest_checkpoint(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_checkpoints WHERE run_id=? ORDER BY created_at DESC LIMIT 1", (run_id,)).fetchone()
        if row is None:
            return None
        return {"checkpoint_id": row["checkpoint_id"], "run_id": row["run_id"], "event_sequence": row["event_sequence"], "state": json.loads(row["state_json"]), "created_at": row["created_at"]}

    @staticmethod
    def _session(row: sqlite3.Row) -> dict[str, Any]:
        return {"session_id": row["session_id"], "workspace_id": row["workspace_id"], "worktree_id": row["worktree_id"], "title": row["title"], "archived": bool(row["archived"]), "created_at": row["created_at"], "updated_at": row["updated_at"]}

    @staticmethod
    def _run(row: sqlite3.Row) -> dict[str, Any]:
        return dict(row)

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        result = {"event_id": row["event_id"], "run_id": row["run_id"], "sequence": row["sequence"],
                  "type": row["event_type"], "data": json.loads(row["data_json"]), "created_at": row["created_at"]}
        if "backend_event_key" in row.keys() and row["backend_event_key"] is not None:
            result["backend_event_key"] = row["backend_event_key"]
        return result
