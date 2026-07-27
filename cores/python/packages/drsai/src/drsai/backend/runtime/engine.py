from __future__ import annotations

import json
import base64
import os
import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from drsai.backend.runtime.security import redact_sensitive
from drsai.backend.runtime.journal import RuntimeConversationJournal
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from drsai.relay.device_identity import WindowsDpapiProtector
from drsai.relay.security import redact_secrets


RUN_TRANSITIONS = {
    "queued": {"running", "cancelled", "failed"},
    "running": {"waiting_approval", "completed", "cancelled", "failed"},
    "waiting_approval": {"running", "cancelled", "failed"},
    "completed": set(),
    "cancelled": set(),
    "failed": set(),
}


def _session_event_kind(event_type: str) -> str:
    if event_type == "run.created":
        return "run.created"
    if event_type.startswith("run."):
        return "run.state.changed"
    if event_type.startswith("tool."):
        return "tool.state.changed"
    if event_type == "approval.requested":
        return "approval.created"
    if event_type.startswith("approval."):
        return "approval.decided"
    if event_type == "artifact.created":
        return "artifact.created"
    if event_type in {"message.delta", "thinking.delta"}:
        return "conversation.item.delta"
    if event_type in {"message.complete", "message.user"}:
        return "conversation.item.upsert"
    return "session.updated"


class _ClosingConnection(sqlite3.Connection):
    """A transaction context that also releases the OS file handle on exit."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _CheckpointCipher:
    """Encrypt resumable state; Windows protects the data key with current-user DPAPI."""

    PREFIX = "enc:v1:"

    def __init__(self, database: Path) -> None:
        self.path = database.with_suffix(database.suffix + ".checkpoint-key")

    def _key(self) -> bytes:
        if self.path.is_file():
            stored = base64.b64decode(self.path.read_bytes())
            return WindowsDpapiProtector().unprotect(stored) if os.name == "nt" else stored
        key = secrets.token_bytes(32)
        stored = WindowsDpapiProtector().protect(key) if os.name == "nt" else key
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_bytes(base64.b64encode(stored))
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        temporary.replace(self.path)
        return key

    def encrypt(self, state: dict[str, Any]) -> str:
        nonce = secrets.token_bytes(12)
        plaintext = json.dumps(state, separators=(",", ":"), sort_keys=True).encode()
        ciphertext = AESGCM(self._key()).encrypt(nonce, plaintext, b"opendrsai-runtime-checkpoint-v1")
        return self.PREFIX + base64.b64encode(nonce + ciphertext).decode()

    def decrypt(self, value: str) -> dict[str, Any]:
        if not value.startswith(self.PREFIX):
            return json.loads(value)
        encoded = base64.b64decode(value.removeprefix(self.PREFIX))
        plaintext = AESGCM(self._key()).decrypt(
            encoded[:12], encoded[12:], b"opendrsai-runtime-checkpoint-v1"
        )
        result = json.loads(plaintext)
        if not isinstance(result, dict):
            raise ValueError("Runtime checkpoint state is invalid")
        return result


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
        self._checkpoint_cipher = _CheckpointCipher(self.database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.identity = identity
        self.workspace_exists = workspace_exists
        self.worktree_for_workspace = worktree_for_workspace or (lambda _workspace_id: None)
        self._lock = threading.RLock()
        self._initialize()
        self.conversation_journal = RuntimeConversationJournal(
            self.database, self.identity.runtime_id
        )
        self._reconcile_conversation_journal()

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
                  archived INTEGER NOT NULL DEFAULT 0, lifecycle TEXT NOT NULL DEFAULT 'active',
                  revision INTEGER NOT NULL DEFAULT 1, agent_definition TEXT, backend_id TEXT,
                  removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_sessions_workspace ON runtime_sessions(workspace_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS runtime_runs (
                  run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  workspace_id TEXT NOT NULL, worktree_id TEXT, runtime_id TEXT NOT NULL, instance_id TEXT NOT NULL,
                  agent_definition TEXT NOT NULL, backend_id TEXT NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
                  input_message TEXT NOT NULL DEFAULT '', attachment_refs_json TEXT NOT NULL DEFAULT '[]',
                  correlation_id TEXT, parent_run_id TEXT REFERENCES runtime_runs(run_id),
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
            if "lifecycle" not in session_columns:
                db.execute("ALTER TABLE runtime_sessions ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'")
            if "revision" not in session_columns:
                db.execute("ALTER TABLE runtime_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
            if "agent_definition" not in session_columns:
                db.execute("ALTER TABLE runtime_sessions ADD COLUMN agent_definition TEXT")
            if "backend_id" not in session_columns:
                db.execute("ALTER TABLE runtime_sessions ADD COLUMN backend_id TEXT")
            if "removed_at" not in session_columns:
                db.execute("ALTER TABLE runtime_sessions ADD COLUMN removed_at TEXT")
            db.execute(
                "UPDATE runtime_sessions SET lifecycle=CASE WHEN archived=0 THEN 'active' ELSE 'archived' END "
                "WHERE lifecycle IS NULL OR lifecycle NOT IN ('active','archived','removed') "
                "OR (lifecycle='active' AND archived<>0)"
            )
            if "worktree_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN worktree_id TEXT")
            if "backend_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN backend_id TEXT NOT NULL DEFAULT 'opendrsai'")
            if "input_message" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN input_message TEXT NOT NULL DEFAULT ''")
            if "attachment_refs_json" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN attachment_refs_json TEXT NOT NULL DEFAULT '[]'")
            if "correlation_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN correlation_id TEXT")
            if "parent_run_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN parent_run_id TEXT REFERENCES runtime_runs(run_id)")
            db.execute(
                "UPDATE runtime_sessions SET agent_definition=("
                "SELECT agent_definition FROM runtime_runs WHERE runtime_runs.session_id=runtime_sessions.session_id "
                "ORDER BY created_at DESC, run_id DESC LIMIT 1"
                "), backend_id=("
                "SELECT backend_id FROM runtime_runs WHERE runtime_runs.session_id=runtime_sessions.session_id "
                "ORDER BY created_at DESC, run_id DESC LIMIT 1"
                ") WHERE agent_definition IS NULL"
            )
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
                BEFORE UPDATE OF session_id, workspace_id, worktree_id, runtime_id, instance_id,
                                 agent_definition, backend_id, parent_run_id
                ON runtime_runs
                BEGIN SELECT RAISE(ABORT, 'Runtime Run ownership is immutable'); END;
                """
            )

    def _reconcile_conversation_journal(self) -> None:
        """Idempotently import pre-Journal Runtime facts during an upgrade."""
        changed = False
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            sessions = db.execute(
                "SELECT * FROM runtime_sessions ORDER BY created_at,session_id"
            ).fetchall()
            for session in sessions:
                state = db.execute(
                    "SELECT 1 FROM runtime_session_sequences WHERE session_id=?",
                    (session["session_id"],),
                ).fetchone()
                if state is None:
                    _, created = self.conversation_journal.append_event_in_transaction(
                        db,
                        str(session["session_id"]),
                        (
                            "session.removed"
                            if str(session["lifecycle"]) == "removed"
                            else "session.archived"
                            if str(session["lifecycle"]) == "archived"
                            else "session.updated"
                        ),
                        {
                            "title": str(session["title"]),
                            "lifecycle": str(session["lifecycle"]),
                            "revision": int(session["revision"]),
                            "migrated": True,
                        },
                        dedupe_key=f"legacy-session:{session['session_id']}",
                        created_at=str(session["updated_at"]),
                    )
                    changed = changed or created

            runs = db.execute(
                "SELECT * FROM runtime_runs ORDER BY created_at,run_id"
            ).fetchall()
            for run in runs:
                if str(run["input_message"] or ""):
                    item_exists = db.execute(
                        "SELECT 1 FROM runtime_conversation_items WHERE item_id=?",
                        (f"user:{run['run_id']}",),
                    ).fetchone()
                    if item_exists is None:
                        _, _, created = self.conversation_journal.upsert_item_in_transaction(
                            db,
                            str(run["session_id"]),
                            item_id=f"user:{run['run_id']}",
                            kind="message",
                            role="user",
                            revision=1,
                            source_client="runtime",
                            source_message_id=f"legacy:{run['run_id']}",
                            payload={
                                "content": str(run["input_message"]),
                                "attachment_refs": json.loads(
                                    str(run["attachment_refs_json"] or "[]")
                                ),
                                "correlation_id": run["correlation_id"],
                            },
                            run_id=str(run["run_id"]),
                            created_at=str(run["created_at"]),
                        )
                        changed = changed or created

            events = db.execute(
                "SELECT e.*,r.session_id FROM runtime_events e "
                "JOIN runtime_runs r ON r.run_id=e.run_id "
                "ORDER BY r.created_at,r.run_id,e.sequence"
            ).fetchall()
            for event in events:
                dedupe_key = f"runtime-event:{event['event_id']}"
                if db.execute(
                    "SELECT 1 FROM runtime_session_journal "
                    "WHERE session_id=? AND dedupe_key=?",
                    (event["session_id"], dedupe_key),
                ).fetchone() is not None:
                    continue
                data = json.loads(str(event["data_json"]))
                _, created = self.conversation_journal.append_event_in_transaction(
                    db,
                    str(event["session_id"]),
                    _session_event_kind(str(event["event_type"])),
                    {
                        "runtime_event_id": str(event["event_id"]),
                        "type": str(event["event_type"]),
                        "data": data,
                        **(
                            {"backend_event_key": str(event["backend_event_key"])}
                            if event["backend_event_key"] is not None
                            else {}
                        ),
                        "migrated": True,
                    },
                    run_id=str(event["run_id"]),
                    dedupe_key=dedupe_key,
                    created_at=str(event["created_at"]),
                )
                changed = changed or created
            db.commit()
        if changed:
            self.conversation_journal.notify_committed()

    def create_session(
        self,
        workspace_id: str,
        title: str = "New session",
        *,
        agent_definition: str | None = None,
        backend_id: str | None = None,
    ) -> dict[str, Any]:
        if not workspace_id or not self.workspace_exists(workspace_id):
            raise KeyError("Unknown or closed Workspace")
        now = _now()
        session_id = f"session-{uuid.uuid4()}"
        worktree_id = self.worktree_for_workspace(workspace_id)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO runtime_sessions(session_id,workspace_id,worktree_id,title,archived,lifecycle,"
                "revision,agent_definition,backend_id,removed_at,created_at,updated_at) "
                "VALUES(?,?,?,?,0,'active',1,?,?,NULL,?,?)",
                (session_id, workspace_id, worktree_id, title[:240] or "New session",
                 agent_definition, backend_id, now, now),
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                session_id,
                "session.updated",
                {
                    "title": title[:240] or "New session",
                    "lifecycle": "active",
                    "revision": 1,
                },
                dedupe_key=f"session-created:{session_id}",
                created_at=now,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return self.get_session(session_id)

    def import_session(
        self,
        session_id: str,
        workspace_id: str,
        title: str = "Imported session",
        *,
        agent_definition: str | None = None,
        backend_id: str | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
        archived: bool = False,
    ) -> tuple[dict[str, Any], bool]:
        """Idempotently import a legacy Session with a deterministic identity."""
        if not session_id or not self.workspace_exists(workspace_id):
            raise KeyError("Unknown or closed Workspace")
        now = _now()
        created = created_at or now
        updated = updated_at or created
        lifecycle = "archived" if archived else "active"
        worktree_id = self.worktree_for_workspace(workspace_id)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)).fetchone()
            if existing is not None:
                if str(existing["workspace_id"]) != workspace_id:
                    db.rollback()
                    raise ValueError("Imported Session identity is already bound to another Workspace")
                db.execute(
                    "UPDATE runtime_sessions SET title=?, archived=?, lifecycle=?, "
                    "agent_definition=COALESCE(?,agent_definition), backend_id=COALESCE(?,backend_id), "
                    "revision=revision+1, updated_at=? WHERE session_id=?",
                    (title[:240] or "Imported session", int(archived), lifecycle,
                     agent_definition, backend_id, updated, session_id),
                )
                revision = int(existing["revision"]) + 1
                self.conversation_journal.append_event_in_transaction(
                    db,
                    session_id,
                    "session.archived" if archived else "session.updated",
                    {
                        "title": title[:240] or "Imported session",
                        "lifecycle": lifecycle,
                        "revision": revision,
                        "imported": True,
                    },
                    dedupe_key=f"session-revision:{session_id}:{revision}",
                    created_at=updated,
                )
                db.commit()
                self.conversation_journal.notify_committed()
                return self.get_session(session_id), False
            db.execute(
                "INSERT INTO runtime_sessions(session_id,workspace_id,worktree_id,title,archived,lifecycle,"
                "revision,agent_definition,backend_id,removed_at,created_at,updated_at) "
                "VALUES(?,?,?,?,?,?,1,?,?,NULL,?,?)",
                (session_id, workspace_id, worktree_id, title[:240] or "Imported session",
                 int(archived), lifecycle, agent_definition, backend_id, created, updated),
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                session_id,
                "session.archived" if archived else "session.updated",
                {
                    "title": title[:240] or "Imported session",
                    "lifecycle": lifecycle,
                    "revision": 1,
                    "imported": True,
                },
                dedupe_key=f"session-created:{session_id}",
                created_at=updated,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return self.get_session(session_id), True

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise KeyError("Session not found")
        return self._session(row)

    def list_sessions(self, workspace_id: str, *, offset: int = 0, limit: int = 50, archived: bool | None = False) -> dict[str, Any]:
        if not workspace_id or not self.workspace_exists(workspace_id):
            raise KeyError("Unknown or closed Workspace")
        where = "workspace_id=?"
        args: list[Any] = [workspace_id]
        if archived is False:
            where += " AND lifecycle='active'"
        elif archived is True:
            where += " AND lifecycle='archived'"
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

    def update_session(
        self,
        session_id: str,
        *,
        title: str | None = None,
        archived: bool | None = None,
        lifecycle: str | None = None,
    ) -> dict[str, Any]:
        current = self.get_session(session_id)
        wanted = lifecycle or (
            "archived" if archived is True else "active" if archived is False else current["lifecycle"]
        )
        if wanted not in {"active", "archived", "removed"}:
            raise ValueError("Invalid Session lifecycle")
        if current["lifecycle"] == "removed" and wanted != "removed":
            raise ValueError("Removed Session lifecycle is terminal")
        removed_at = current["removed_at"] or (_now() if wanted == "removed" else None)
        updated_at = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE runtime_sessions SET title=?, archived=?, lifecycle=?, revision=revision+1, "
                "removed_at=?, updated_at=? WHERE session_id=?",
                (title[:240] if title is not None else current["title"], int(wanted != "active"),
                 wanted, removed_at, updated_at, session_id),
            )
            revision = int(current["revision"]) + 1
            event_kind = (
                "session.removed"
                if wanted == "removed"
                else "session.archived"
                if wanted == "archived"
                else "session.updated"
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                session_id,
                event_kind,
                {
                    "title": title[:240] if title is not None else current["title"],
                    "lifecycle": wanted,
                    "revision": revision,
                },
                dedupe_key=f"session-revision:{session_id}:{revision}",
                created_at=updated_at,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return self.get_session(session_id)

    def remove_session(self, session_id: str) -> dict[str, Any]:
        return self.update_session(session_id, lifecycle="removed")

    def create_run(
        self,
        session_id: str,
        agent_definition: str,
        idempotency_key: str,
        backend_id: str = "opendrsai",
        parent_run_id: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        session = self.get_session(session_id)
        if session["lifecycle"] != "active":
            raise ValueError("Run requires an active Session")
        parent = self.get_run(parent_run_id) if parent_run_id else None
        if parent is not None and str(parent["session_id"]) != session_id:
            raise ValueError("Subagent parent Run belongs to another Session")
        if parent is None and session["agent_definition"] and session["agent_definition"] != agent_definition:
            raise ValueError("Session is bound to another Agent Definition")
        if parent is None and session["backend_id"] and session["backend_id"] != backend_id:
            raise ValueError("Session is bound to another Agent Backend")
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
                expected = (
                    session_id, session["workspace_id"], session["worktree_id"],
                    agent_definition, backend_id, parent_run_id,
                )
                actual = (
                    str(existing["session_id"]),
                    str(existing["workspace_id"]),
                    str(existing["worktree_id"]) if existing["worktree_id"] is not None else None,
                    str(existing["agent_definition"]),
                    str(existing["backend_id"]),
                    str(existing["parent_run_id"]) if existing["parent_run_id"] is not None else None,
                )
                if actual != expected:
                    db.rollback()
                    raise ValueError("Idempotency-Key is already bound to another Run identity")
                db.commit()
                return self._run(existing), False
            if parent is None:
                db.execute(
                    "UPDATE runtime_sessions SET agent_definition=COALESCE(agent_definition,?), "
                    "backend_id=COALESCE(backend_id,?), revision=revision+1, updated_at=? WHERE session_id=?",
                    (agent_definition, backend_id, now, session_id),
                )
            db.execute(
                """INSERT INTO runtime_runs(
                    run_id, session_id, workspace_id, worktree_id, runtime_id, instance_id, agent_definition,
                    backend_id, status, idempotency_key, input_message, attachment_refs_json, correlation_id,
                    parent_run_id, created_at, started_at, completed_at, cancel_requested_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, session_id, session["workspace_id"], session["worktree_id"], self.identity.runtime_id,
                    self.identity.instance_id, agent_definition, backend_id, "queued",
                    idempotency_key, "", "[]", None, parent_run_id, now, None, None, None,
                ),
            )
            run_event_id = f"event-{uuid.uuid4()}"
            db.execute(
                "INSERT INTO runtime_events("
                "event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key"
                ") VALUES(?,?,?,?,?,?,NULL)",
                (
                    run_event_id,
                    run_id,
                    1,
                    "run.created",
                    json.dumps(
                        {
                            "agent_definition": agent_definition,
                            "backend_id": backend_id,
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    now,
                ),
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                session_id,
                "run.created",
                {
                    "agent_definition": agent_definition,
                    "backend_id": backend_id,
                    "status": "queued",
                },
                run_id=run_id,
                dedupe_key=f"runtime-event:{run_event_id}",
                created_at=now,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return self.get_run(run_id), True

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError("Run not found")
        return self._run(row)

    def list_session_runs(self, session_id: str) -> list[dict[str, Any]]:
        """Return the durable backend bindings for one Runtime Session."""
        self.get_session(session_id)
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM runtime_runs WHERE session_id=? ORDER BY created_at, run_id",
                (session_id,),
            ).fetchall()
        return [self._run(row) for row in rows]

    def set_run_input(
        self,
        run_id: str,
        message: str,
        *,
        attachment_refs: list[str] | None = None,
        correlation_id: str | None = None,
        source_client: str = "runtime",
        source_message_id: str | None = None,
    ) -> dict[str, Any]:
        run = self.get_run(run_id)
        safe_message = str(redact_sensitive(redact_secrets(message)))
        encoded = json.dumps(redact_sensitive(attachment_refs or []), separators=(",", ":"))
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE runtime_runs SET input_message=?, attachment_refs_json=?, "
                "correlation_id=COALESCE(correlation_id,?) WHERE run_id=?",
                (safe_message, encoded, correlation_id, run_id),
            )
            _, _, journal_created = self.conversation_journal.upsert_item_in_transaction(
                db,
                str(run["session_id"]),
                item_id=f"user:{run_id}",
                kind="message",
                role="user",
                revision=1,
                source_client=source_client,
                source_message_id=source_message_id,
                payload={
                    "content": safe_message,
                    "attachment_refs": json.loads(encoded),
                    "correlation_id": correlation_id,
                },
                run_id=run_id,
                created_at=str(run["created_at"]),
            )
            db.commit()
        if journal_created:
            self.conversation_journal.notify_committed()
        return self.get_run(run_id)

    @staticmethod
    def _encode_conversation_cursor(key: tuple[str, str, int]) -> str:
        raw = json.dumps(key, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    @staticmethod
    def _decode_conversation_cursor(cursor: str | None) -> tuple[str, str, int] | None:
        if not cursor:
            return None
        try:
            raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            value = json.loads(raw)
            if not isinstance(value, list) or len(value) != 3:
                raise ValueError
            return str(value[0]), str(value[1]), int(value[2])
        except Exception as exc:
            raise ValueError("Invalid Conversation cursor") from exc

    def conversation_snapshot(self, session_id: str) -> dict[str, Any]:
        """Return the Journal projection and its transactionally consistent waterline."""
        self.get_session(session_id)
        return self.conversation_journal.snapshot(session_id)

    def list_session_events(
        self,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        self.get_session(session_id)
        return self.conversation_journal.replay(
            session_id,
            after_sequence=after_sequence,
            limit=limit,
        )

    def wait_session_events(
        self,
        session_id: str,
        *,
        after_sequence: int,
        timeout: float = 15.0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        self.get_session(session_id)
        return self.conversation_journal.wait_for_events(
            session_id,
            after_sequence=after_sequence,
            timeout=timeout,
            limit=limit,
        )

    def record_conversation_item(
        self,
        session_id: str,
        *,
        item_id: str,
        kind: str,
        role: str | None,
        revision: int,
        source_client: str,
        payload: dict[str, Any],
        run_id: str | None = None,
        source_message_id: str | None = None,
        event_kind: str | None = None,
    ) -> dict[str, Any]:
        item, event, created = self.conversation_journal.upsert_item(
            session_id,
            item_id=item_id,
            kind=kind,
            role=role,
            revision=revision,
            source_client=source_client,
            payload=payload,
            run_id=run_id,
            source_message_id=source_message_id,
            event_kind=event_kind,
        )
        return {"item": item, "event": event, "created": created}

    def list_conversation(
        self,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        self.get_session(session_id)
        if not 1 <= limit <= 500:
            raise ValueError("Conversation limit must be between 1 and 500")
        after = self._decode_conversation_cursor(cursor)
        with self._connect() as db:
            rows = db.execute(
                """
                WITH items AS (
                    SELECT 'user:' || run_id AS item_id, created_at AS run_created_at, run_id,
                           0 AS local_sequence, 'message.user' AS kind, created_at AS timestamp,
                           json_object('content', input_message, 'run_id', run_id) AS payload_json
                    FROM runtime_runs
                    WHERE session_id=? AND input_message<>''
                    UNION ALL
                    SELECT e.event_id AS item_id, r.created_at AS run_created_at, r.run_id,
                           e.sequence AS local_sequence, e.event_type AS kind, e.created_at AS timestamp,
                           json_set(e.data_json, '$.run_id', r.run_id) AS payload_json
                    FROM runtime_events e
                    JOIN runtime_runs r ON r.run_id=e.run_id
                    WHERE r.session_id=?
                ),
                numbered AS (
                    SELECT *,
                           ROW_NUMBER() OVER (
                               ORDER BY run_created_at, run_id, local_sequence
                           ) AS global_sequence
                    FROM items
                )
                SELECT item_id, run_created_at, run_id, local_sequence, kind, timestamp,
                       payload_json, global_sequence
                FROM numbered
                WHERE (? IS NULL OR (run_created_at, run_id, local_sequence) > (?, ?, ?))
                ORDER BY run_created_at, run_id, local_sequence
                LIMIT ?
                """,
                (
                    session_id, session_id,
                    after[0] if after else None,
                    after[0] if after else "", after[1] if after else "", after[2] if after else -1,
                    limit + 1,
                ),
            ).fetchall()
        page = rows[:limit]
        items = [{
            "item_id": str(row["item_id"]),
            "sequence": int(row["global_sequence"]),
            "kind": str(row["kind"]),
            "timestamp": str(row["timestamp"]),
            "payload": json.loads(str(row["payload_json"])),
        } for row in page]
        next_cursor = None
        if len(rows) > limit and page:
            last = page[-1]
            next_cursor = self._encode_conversation_cursor(
                (str(last["run_created_at"]), str(last["run_id"]), int(last["local_sequence"]))
            )
        return {"object": "list", "data": items, "next_cursor": next_cursor}

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
            event_created = _now()
            sequence = int(db.execute(
                "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?",
                (run_id,),
            ).fetchone()[0])
            runtime_event_id = f"event-{uuid.uuid4()}"
            db.execute(
                "INSERT INTO runtime_events("
                "event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key"
                ") VALUES(?,?,?,?,?,?,NULL)",
                (
                    runtime_event_id,
                    run_id,
                    sequence,
                    f"run.{status}",
                    "{}",
                    event_created,
                ),
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                str(row["session_id"]),
                "run.state.changed",
                {"status": status},
                run_id=run_id,
                dedupe_key=f"runtime-event:{runtime_event_id}",
                created_at=event_created,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return self.get_run(run_id)

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        now = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Run not found")
            if str(row["status"]) in {"completed", "cancelled", "failed"}:
                db.commit()
                return self._run(row)
            first_request = row["cancel_requested_at"] is None
            update = db.execute(
                "UPDATE runtime_runs SET status='cancelled', cancel_requested_at=COALESCE(cancel_requested_at,?), "
                "completed_at=? WHERE run_id=? AND status IN ('queued','running','waiting_approval')",
                (now, now, run_id),
            )
            if update.rowcount != 1:
                current = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
                db.commit()
                return self._run(current)
            sequence = int(db.execute(
                "SELECT COALESCE(MAX(sequence),0) FROM runtime_events WHERE run_id=?",
                (run_id,),
            ).fetchone()[0])
            event_types = ["run.cancelled"]
            if first_request:
                event_types.insert(0, "run.cancel_requested")
            for event_type in event_types:
                sequence += 1
                event_id = f"event-{uuid.uuid4()}"
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,"
                    "backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
                    (
                        event_id,
                        run_id,
                        sequence,
                        event_type,
                        "{}",
                        now,
                    ),
                )
                self.conversation_journal.append_event_in_transaction(
                    db,
                    str(row["session_id"]),
                    "run.state.changed",
                    {"status": event_type.removeprefix("run.")},
                    run_id=run_id,
                    dedupe_key=f"runtime-event:{event_id}",
                    created_at=now,
                )
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            db.commit()
        self.conversation_journal.notify_committed()
        return self._run(row)

    def mark_cancel_requested(self, run_id: str) -> dict[str, Any]:
        now = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Run not found")
            if row["cancel_requested_at"] is not None:
                db.commit()
                return self._run(row)
            update = db.execute(
                "UPDATE runtime_runs SET cancel_requested_at=? "
                "WHERE run_id=? AND cancel_requested_at IS NULL",
                (now, run_id),
            )
            if update.rowcount == 1:
                sequence = int(db.execute(
                    "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?",
                    (run_id,),
                ).fetchone()[0])
                event_id = f"event-{uuid.uuid4()}"
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,"
                    "backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
                    (event_id, run_id, sequence, "run.cancel_requested", "{}", now),
                )
                self.conversation_journal.append_event_in_transaction(
                    db,
                    str(row["session_id"]),
                    "run.state.changed",
                    {"status": "cancel_requested"},
                    run_id=run_id,
                    dedupe_key=f"runtime-event:{event_id}",
                    created_at=now,
                )
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            db.commit()
        if update.rowcount == 1:
            self.conversation_journal.notify_committed()
        return self._run(row)

    def _record_runtime_event_item_in_transaction(
        self,
        db: sqlite3.Connection,
        *,
        session_id: str,
        run_id: str,
        event_type: str,
        data: dict[str, Any],
        created_at: str,
    ) -> bool:
        item_kind: str
        role: str | None
        item_id: str
        if event_type in {"message.delta", "message.complete"}:
            item_kind, role, item_id = "message", "assistant", f"assistant:{run_id}"
        elif event_type == "thinking.delta":
            item_kind, role, item_id = "reasoning", "assistant", f"reasoning:{run_id}"
        elif event_type.startswith("tool."):
            identity = str(
                data.get("tool_id")
                or data.get("call_id")
                or data.get("id")
                or data.get("name")
                or "default"
            )
            item_kind, role, item_id = "tool", "tool", f"tool:{run_id}:{identity}"
        elif event_type == "artifact.created":
            identity = str(data.get("artifact_id") or data.get("id") or uuid.uuid4())
            item_kind, role, item_id = "artifact", None, f"artifact:{identity}"
        else:
            return False

        existing = db.execute(
            "SELECT revision,payload_json FROM runtime_conversation_items WHERE item_id=?",
            (item_id,),
        ).fetchone()
        revision = int(existing["revision"]) + 1 if existing is not None else 1
        prior = json.loads(str(existing["payload_json"])) if existing is not None else {}
        payload = {**prior, **data, "event_type": event_type}
        if event_type in {"message.delta", "thinking.delta"}:
            delta = str(data.get("text") or data.get("content") or data.get("delta") or "")
            payload["text"] = f"{prior.get('text', '')}{delta}"
            payload["status"] = "streaming"
        elif event_type == "message.complete":
            final = str(data.get("text") or data.get("content") or "")
            payload["text"] = final or str(prior.get("text") or "")
            payload["status"] = "completed"
        elif event_type.startswith("tool."):
            payload["status"] = (
                "completed"
                if event_type in {"tool.complete", "tool.completed"}
                else "running"
            )
        self.conversation_journal.upsert_item_in_transaction(
            db,
            session_id,
            item_id=item_id,
            kind=item_kind,
            role=role,
            revision=revision,
            source_client="runtime",
            payload=payload,
            run_id=run_id,
            event_kind=(
                "conversation.item.delta"
                if event_type in {"message.delta", "thinking.delta"}
                else None
            ),
            updated_at=created_at,
        )
        return True

    def append_event(self, run_id: str, event_type: str, data: dict[str, Any]) -> dict[str, Any]:
        safe_data = redact_sensitive(data)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute(
                "SELECT session_id FROM runtime_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run is None:
                db.rollback(); raise KeyError("Run not found")
            sequence = db.execute("SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?", (run_id,)).fetchone()[0]
            event_id, created = f"event-{uuid.uuid4()}", _now()
            db.execute(
                "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
                (event_id, run_id, sequence, event_type, json.dumps(safe_data, separators=(",", ":"), sort_keys=True), created),
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                str(run["session_id"]),
                _session_event_kind(event_type),
                {"runtime_event_id": event_id, "type": event_type, "data": safe_data},
                run_id=run_id,
                dedupe_key=f"runtime-event:{event_id}",
                created_at=created,
            )
            self._record_runtime_event_item_in_transaction(
                db,
                session_id=str(run["session_id"]),
                run_id=run_id,
                event_type=event_type,
                data=safe_data,
                created_at=created,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return {"event_id": event_id, "run_id": run_id, "sequence": sequence, "type": event_type, "data": safe_data, "created_at": created}

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
            run = db.execute(
                "SELECT session_id FROM runtime_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run is None:
                db.rollback(); raise KeyError("Run not found")
            sequence = db.execute(
                "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?", (run_id,)
            ).fetchone()[0]
            event_id, created = f"event-{uuid.uuid4()}", _now()
            safe_data = redact_sensitive(data)
            db.execute(
                "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,?)",
                (event_id, run_id, sequence, event_type,
                 json.dumps(safe_data, separators=(",", ":"), sort_keys=True), created, backend_event_key),
            )
            self.conversation_journal.append_event_in_transaction(
                db,
                str(run["session_id"]),
                _session_event_kind(event_type),
                {
                    "runtime_event_id": event_id,
                    "type": event_type,
                    "data": safe_data,
                    "backend_event_key": backend_event_key,
                },
                run_id=run_id,
                dedupe_key=f"backend-event:{run_id}:{backend_event_key}",
                created_at=created,
            )
            self._record_runtime_event_item_in_transaction(
                db,
                session_id=str(run["session_id"]),
                run_id=run_id,
                event_type=event_type,
                data=safe_data,
                created_at=created,
            )
            row = db.execute("SELECT * FROM runtime_events WHERE event_id=?", (event_id,)).fetchone()
            db.commit()
        self.conversation_journal.notify_committed()
        return self._event(row)

    def append_backend_events(self, run_id: str, events: list[tuple[str, dict[str, Any], str]]) -> list[dict[str, Any]]:
        """Persist a pressure batch in one transaction while preserving Backend-key idempotency."""
        if len(events) > 20_000:
            raise ValueError("Backend Event batch exceeds the Runtime limit")
        if any(not key or len(key) > 500 for _, _, key in events):
            raise ValueError("A valid Backend Event key is required")
        results: list[dict[str, Any]] = []
        journal_created = False
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute(
                "SELECT session_id FROM runtime_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run is None:
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
                safe_data = redact_sensitive(data)
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,?)",
                    (event_id, run_id, sequence, event_type, json.dumps(safe_data, separators=(",", ":"), sort_keys=True), created, backend_event_key),
                )
                _, created_in_journal = self.conversation_journal.append_event_in_transaction(
                    db,
                    str(run["session_id"]),
                    _session_event_kind(event_type),
                    {
                        "runtime_event_id": event_id,
                        "type": event_type,
                        "data": safe_data,
                        "backend_event_key": backend_event_key,
                    },
                    run_id=run_id,
                    dedupe_key=f"backend-event:{run_id}:{backend_event_key}",
                    created_at=created,
                )
                self._record_runtime_event_item_in_transaction(
                    db,
                    session_id=str(run["session_id"]),
                    run_id=run_id,
                    event_type=event_type,
                    data=safe_data,
                    created_at=created,
                )
                journal_created = journal_created or created_in_journal
                results.append({"event_id": event_id, "run_id": run_id, "sequence": sequence, "type": event_type,
                                "data": safe_data, "created_at": created, "backend_event_key": backend_event_key})
            db.commit()
        if journal_created:
            self.conversation_journal.notify_committed()
        return results

    def list_events(self, run_id: str, after_sequence: int = 0, limit: int = 500) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM runtime_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?", (run_id, max(0, after_sequence), max(1, min(limit, 2000)))).fetchall()
        return [self._event(row) for row in rows]

    def request_approval(self, run_id: str, request: dict[str, Any], deadline_at: str | None = None) -> dict[str, Any]:
        approval_id, created = f"approval-{uuid.uuid4()}", _now()
        safe_request = redact_sensitive(request)
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute(
                "SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if run is None:
                db.rollback()
                raise KeyError("Run not found")
            if str(run["status"]) != "running":
                db.rollback()
                raise ValueError("Only a running Run can wait for approval")
            db.execute("INSERT INTO runtime_approvals VALUES(?,?,?,?,?,?,?,?)", (
                approval_id, run_id, "pending",
                json.dumps(safe_request, separators=(",", ":"), sort_keys=True),
                None, deadline_at, created, None,
            ))
            db.execute(
                "UPDATE runtime_runs SET status='waiting_approval' WHERE run_id=?",
                (run_id,),
            )
            sequence = int(db.execute(
                "SELECT COALESCE(MAX(sequence),0) FROM runtime_events WHERE run_id=?",
                (run_id,),
            ).fetchone()[0])
            for event_type, event_data, session_kind, session_payload in (
                (
                    "run.waiting_approval",
                    {},
                    "run.state.changed",
                    {"status": "waiting_approval"},
                ),
                (
                    "approval.requested",
                    {"approval_id": approval_id},
                    "approval.created",
                    {
                        "approval_id": approval_id,
                        "request": safe_request,
                        "deadline_at": deadline_at,
                    },
                ),
            ):
                sequence += 1
                event_id = f"event-{uuid.uuid4()}"
                db.execute(
                    "INSERT INTO runtime_events("
                    "event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key"
                    ") VALUES(?,?,?,?,?,?,NULL)",
                    (
                        event_id,
                        run_id,
                        sequence,
                        event_type,
                        json.dumps(
                            event_data, separators=(",", ":"), sort_keys=True
                        ),
                        created,
                    ),
                )
                self.conversation_journal.append_event_in_transaction(
                    db,
                    str(run["session_id"]),
                    session_kind,
                    session_payload,
                    run_id=run_id,
                    dedupe_key=f"runtime-event:{event_id}",
                    created_at=created,
                )
            self.conversation_journal.upsert_item_in_transaction(
                db,
                str(run["session_id"]),
                item_id=f"approval:{approval_id}",
                kind="approval",
                role=None,
                revision=1,
                source_client="runtime",
                payload={
                    "approval_id": approval_id,
                    "status": "pending",
                    "request": safe_request,
                    "deadline_at": deadline_at,
                },
                run_id=run_id,
                created_at=created,
            )
            db.commit()
        self.conversation_journal.notify_committed()
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
        if decision not in {"approved", "denied", "timeout"}:
            raise ValueError("Approval decision is invalid")
        target = (
            "running"
            if decision == "approved" or (decision == "denied" and resume_on_denied)
            else "cancelled"
            if decision == "denied"
            else "failed"
        )
        resolved_at = _now()
        event_detail = {"approval_id": approval_id, **(detail or {})}
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT a.*, r.status AS run_status, r.started_at AS run_started_at, "
                "r.session_id AS session_id "
                "FROM runtime_approvals a JOIN runtime_runs r ON r.run_id=a.run_id "
                "WHERE a.approval_id=?",
                (approval_id,),
            ).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Approval not found")
            if str(row["status"]) != "pending" or str(row["run_status"]) != "waiting_approval":
                stored_detail = json.loads(row["decision_json"]) if row["decision_json"] else {}
                stable_key = (detail or {}).get("idempotency_key")
                if (
                    stable_key
                    and str(row["status"]) == decision
                    and stored_detail.get("idempotency_key") == stable_key
                ):
                    db.rollback()
                    return self.get_approval(approval_id)
                db.rollback()
                raise ValueError("Approval decision is invalid")
            approval_update = db.execute(
                "UPDATE runtime_approvals SET status=?, decision_json=?, resolved_at=? "
                "WHERE approval_id=? AND status='pending'",
                (decision, json.dumps(detail or {}), resolved_at, approval_id),
            )
            if approval_update.rowcount != 1:
                db.rollback()
                raise ValueError("Approval decision is invalid")
            completed_at = resolved_at if target in {"completed", "cancelled", "failed"} else None
            run_update = db.execute(
                "UPDATE runtime_runs SET status=?, started_at=?, completed_at=? "
                "WHERE run_id=? AND status='waiting_approval'",
                (target, row["run_started_at"] or resolved_at, completed_at, row["run_id"]),
            )
            if run_update.rowcount != 1:
                db.rollback()
                raise ValueError("Approval decision is invalid")
            sequence = int(db.execute(
                "SELECT COALESCE(MAX(sequence),0) FROM runtime_events WHERE run_id=?",
                (row["run_id"],),
            ).fetchone()[0])
            for event_type, data in (
                (f"run.{target}", {}),
                (f"approval.{decision}", event_detail),
            ):
                sequence += 1
                event_id = f"event-{uuid.uuid4()}"
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,"
                    "backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
                    (
                        event_id,
                        row["run_id"],
                        sequence,
                        event_type,
                        json.dumps(data, separators=(",", ":"), sort_keys=True),
                        resolved_at,
                    ),
                )
                self.conversation_journal.append_event_in_transaction(
                    db,
                    str(row["session_id"]),
                    (
                        "approval.decided"
                        if event_type.startswith("approval.")
                        else "run.state.changed"
                    ),
                    (
                        {
                            "approval_id": approval_id,
                            "decision": decision,
                            "detail": detail or {},
                        }
                        if event_type.startswith("approval.")
                        else {"status": target}
                    ),
                    run_id=str(row["run_id"]),
                    dedupe_key=f"runtime-event:{event_id}",
                    created_at=resolved_at,
                )
            self.conversation_journal.upsert_item_in_transaction(
                db,
                str(row["session_id"]),
                item_id=f"approval:{approval_id}",
                kind="approval",
                role=None,
                revision=2,
                source_client="runtime",
                payload={
                    "approval_id": approval_id,
                    "status": decision,
                    "request": json.loads(str(row["request_json"])),
                    "decision": detail or {},
                    "deadline_at": row["deadline_at"],
                },
                run_id=str(row["run_id"]),
                updated_at=resolved_at,
            )
            db.commit()
        self.conversation_journal.notify_committed()
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
            db.execute("INSERT INTO runtime_checkpoints VALUES(?,?,?,?,?)", (
                checkpoint_id, run_id, sequence, self._checkpoint_cipher.encrypt(state), created
            ))
        return {"checkpoint_id": checkpoint_id, "run_id": run_id, "event_sequence": sequence, "state": state, "created_at": created}

    def latest_checkpoint(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_checkpoints WHERE run_id=? ORDER BY created_at DESC LIMIT 1", (run_id,)).fetchone()
        if row is None:
            return None
        return {
            "checkpoint_id": row["checkpoint_id"],
            "run_id": row["run_id"],
            "event_sequence": row["event_sequence"],
            "state": self._checkpoint_cipher.decrypt(str(row["state_json"])),
            "created_at": row["created_at"],
        }

    @staticmethod
    def _session(row: sqlite3.Row) -> dict[str, Any]:
        lifecycle = str(row["lifecycle"]) if "lifecycle" in row.keys() else (
            "archived" if bool(row["archived"]) else "active"
        )
        return {
            "session_id": row["session_id"], "workspace_id": row["workspace_id"],
            "worktree_id": row["worktree_id"], "title": row["title"],
            "archived": lifecycle != "active", "lifecycle": lifecycle,
            "revision": int(row["revision"]) if "revision" in row.keys() else 1,
            "agent_definition": row["agent_definition"] if "agent_definition" in row.keys() else None,
            "backend_id": row["backend_id"] if "backend_id" in row.keys() else None,
            "removed_at": row["removed_at"] if "removed_at" in row.keys() else None,
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }

    @staticmethod
    def _run(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        if "attachment_refs_json" in row.keys():
            result["attachment_refs"] = json.loads(str(row["attachment_refs_json"] or "[]"))
        return result

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        result = {"event_id": row["event_id"], "run_id": row["run_id"], "sequence": row["sequence"],
                  "type": row["event_type"], "data": json.loads(row["data_json"]), "created_at": row["created_at"]}
        if "backend_event_key" in row.keys() and row["backend_event_key"] is not None:
            result["backend_event_key"] = row["backend_event_key"]
        return result
