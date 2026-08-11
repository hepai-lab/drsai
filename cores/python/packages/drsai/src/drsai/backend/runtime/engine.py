from __future__ import annotations

import json
import hashlib
import base64
import os
import secrets
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.runtime.security import redact_sensitive
from drsai.backend.runtime.goals import normalize_goal
from drsai.backend.runtime.journal import RuntimeConversationJournal
from drsai.backend.runtime.experiments import RuntimeExperimentStore
from drsai.backend.runtime.replay_planner import ReplayPlanStore
from drsai.backend.runtime.replay_execution import ReplayExecutionStore
from drsai.backend.runtime.run_comparison import RunComparisonStore
from drsai.backend.runtime.oaep import project_event, project_snapshot, safe_error
from drsai.backend.runtime.run_inspection import (
    INSPECTION_SCHEMA_VERSION,
    decode_cursor as decode_inspection_cursor,
    decode_timeline_cursor,
    digest_manifest,
    encode_cursor as encode_inspection_cursor,
    encode_timeline_cursor,
    initial_manifest,
    merge_manifest,
    reproducibility,
    safe_inspection_item,
    safe_manifest,
    text_digest,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from drsai.relay.device_identity import WindowsDpapiProtector
from drsai.relay.security import redact_credentials, redact_secrets


RUN_TRANSITIONS = {
    "queued": {"running", "cancelled", "failed"},
    "running": {"waiting_approval", "completed", "cancelled", "failed"},
    "waiting_approval": {"running", "cancelled", "failed"},
    "completed": set(),
    "cancelled": set(),
    "failed": set(),
}

_OAEP_RUNTIME_COMPAT = {
    "oaep.item.message.delta": "agent.message.delta",
    "oaep.item.reasoning.delta": "agent.item.reasoning.delta",
    "oaep.item.plan.delta": "agent.item.plan.delta",
    "oaep.item.command.delta": "agent.item.command.delta",
    "oaep.item.tool.delta": "agent.item.tool.delta",
    "oaep.item.subtask.delta": "agent.item.subtask.delta",
    "oaep.run.started": "agent.started",
    "oaep.run.completed": "agent.completed",
    "oaep.run.failed": "agent.failed",
    "oaep.run.cancelled": "agent.failed",
    "oaep.run.state": "agent.state",
}


def _session_event_kind(event_type: str) -> str:
    if event_type.startswith("oaep.session."):
        return {
            "oaep.session.archived": "session.archived",
            "oaep.session.deleted": "session.removed",
        }.get(event_type, "session.updated")
    if event_type.startswith("oaep.run."):
        return "run.state.changed"
    if event_type.endswith(".delta") and event_type.startswith("oaep.item."):
        return "conversation.item.delta"
    if event_type.startswith("oaep.item."):
        return "conversation.item.upsert"
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
    if event_type in {"message.delta", "agent.message.delta", "thinking.delta"}:
        return "conversation.item.delta"
    if event_type in {"message.complete", "agent.completed", "message.user"}:
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


def _legacy_agent_event_type(value: Mapping[str, Any]) -> str:
    return str(value.get("type") or value.get("event") or value.get("event_type") or "").strip().lower()


def _legacy_agent_timestamp(value: Mapping[str, Any]) -> str | None:
    raw = value.get("timestamp") or value.get("created_at") or value.get("createdAt")
    return str(raw) if raw else None


def _legacy_agent_item_id(thread_id: str, run_id: str, kind: str, index: int) -> str:
    digest = hashlib.sha256(f"{thread_id}\0{run_id}\0{kind}\0{index}".encode("utf-8")).hexdigest()[:40]
    return f"legacy-desktop-agent-{digest}"


def _timestamp(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


class _CheckpointCipher:
    """Encrypt resumable state; Windows protects the data key with current-user DPAPI."""

    PREFIX = "enc:v1:"

    def __init__(self, database: Path) -> None:
        self.path = database.with_suffix(database.suffix + ".checkpoint-key")

    @staticmethod
    def _protect(key: bytes) -> bytes:
        return WindowsDpapiProtector().protect(key) if os.name == "nt" else key

    @staticmethod
    def _unprotect(stored: bytes) -> bytes:
        return WindowsDpapiProtector().unprotect(stored) if os.name == "nt" else stored

    def _write_keys(self, keys: list[bytes]) -> None:
        payload = {
            "version": 2,
            "keys": [base64.b64encode(self._protect(key)).decode("ascii") for key in keys],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        try:
            temporary.chmod(0o600)
        except OSError:
            pass
        temporary.replace(self.path)

    def _keys(self) -> list[bytes]:
        if self.path.is_file():
            raw = self.path.read_bytes()
            try:
                payload = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError):
                # v1 stored one base64-encoded protected key directly.
                return [self._unprotect(base64.b64decode(raw))]
            if not isinstance(payload, dict) or payload.get("version") != 2:
                raise ValueError("Runtime checkpoint keyring is invalid")
            encoded = payload.get("keys")
            if not isinstance(encoded, list) or not encoded:
                raise ValueError("Runtime checkpoint keyring is empty")
            return [self._unprotect(base64.b64decode(str(value))) for value in encoded]
        key = secrets.token_bytes(32)
        self._write_keys([key])
        return [key]

    def rotate(self) -> None:
        self._write_keys([secrets.token_bytes(32), *self._keys()])

    def prune_rotated_keys(self) -> None:
        self._write_keys([self._keys()[0]])

    def encrypt(self, state: dict[str, Any]) -> str:
        nonce = secrets.token_bytes(12)
        plaintext = json.dumps(state, separators=(",", ":"), sort_keys=True).encode()
        ciphertext = AESGCM(self._keys()[0]).encrypt(nonce, plaintext, b"opendrsai-runtime-checkpoint-v1")
        return self.PREFIX + base64.b64encode(nonce + ciphertext).decode()

    def decrypt(self, value: str) -> dict[str, Any]:
        if not value.startswith(self.PREFIX):
            return json.loads(value)
        encoded = base64.b64decode(value.removeprefix(self.PREFIX))
        plaintext = None
        last_error: Exception | None = None
        for key in self._keys():
            try:
                plaintext = AESGCM(key).decrypt(
                    encoded[:12], encoded[12:], b"opendrsai-runtime-checkpoint-v1"
                )
                break
            except Exception as error:
                last_error = error
        if plaintext is None:
            raise ValueError("Runtime checkpoint cannot be decrypted") from last_error
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
        surface: str = "desktop",
    ):
        self.database = Path(database)
        self._checkpoint_cipher = _CheckpointCipher(self.database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.identity = identity
        self.workspace_exists = workspace_exists
        self.worktree_for_workspace = worktree_for_workspace or (lambda _workspace_id: None)
        from drsai.backend.runtime.mobile_adapter import create_surface_mobile_core

        self.shared_mobile_core = create_surface_mobile_core(surface)
        self._lock = threading.RLock()
        self._inspection_metrics: dict[str, int | float] = {
            "reads": 0,
            "latency_ms_total": 0.0,
            "latency_ms_max": 0.0,
            "incomplete_evidence": 0,
            "projection_violations": 0,
            "response_bytes_max": 0,
        }
        self._initialize()
        with self._connect() as metrics_db:
            metrics_row = metrics_db.execute("SELECT * FROM runtime_inspection_metrics WHERE metric_id=1").fetchone()
        if metrics_row is not None:
            for key in self._inspection_metrics:
                self._inspection_metrics[key] = metrics_row[key]
        from drsai.backend.runtime.observability import RuntimeObservability

        self.observability = RuntimeObservability(self.database)
        self.conversation_journal = RuntimeConversationJournal(
            self.database, self.identity.runtime_id, self.observability
        )
        self.experiments = RuntimeExperimentStore(
            self.database,
            self._checkpoint_cipher.encrypt,
            self._checkpoint_cipher.decrypt,
        )
        self.replay_plans = ReplayPlanStore(
            self.database,
            self.experiments,
            self._checkpoint_cipher.encrypt,
            self._checkpoint_cipher.decrypt,
            lambda run_id: self.get_run_manifest(run_id, safe=False),
            self.inspect_run,
            self.latest_checkpoint,
            self.get_run,
            self.tool_replay_evidence,
        )
        self.replay_executions = ReplayExecutionStore(
            self.database, self.experiments, self.replay_plans,
            self.get_run, self.create_session, self.create_run, self.set_run_input, self.update_run_manifest,
            self.append_event, self.transition_run, self.request_approval,
            self.get_approval,
        )
        self.run_comparisons = RunComparisonStore(
            self.database, self.get_run,
            lambda run_id: self.get_run_manifest(run_id, safe=False),
            self.inspect_run, self.experiments,
        )
        from drsai.backend.runtime.adoptions import RuntimeAdoptionStore
        self.adoptions = RuntimeAdoptionStore(self.database)
        from drsai.backend.runtime.operation_metrics import RuntimeOperationMetrics
        self.operation_metrics = RuntimeOperationMetrics(self.database)
        self._reconcile_conversation_journal()
        self.replay_executions.reconcile_interrupted()
        self.reconcile_terminal_run_manifests()

    def mark_replay_execution_phase(self, run_id: str, phase: str) -> None:
        self.replay_executions.mark_phase(run_id, phase)

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
                  input_resources_json TEXT NOT NULL DEFAULT '[]',
                  correlation_id TEXT, parent_run_id TEXT REFERENCES runtime_runs(run_id),
                  backend_run_id TEXT, backend_run_index INTEGER,
                  created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, cancel_requested_at TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_events (
                  event_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  sequence INTEGER NOT NULL, event_type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
                  backend_event_key TEXT,
                  PRIMARY KEY(run_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS runtime_backend_item_bindings (
                  backend TEXT NOT NULL,
                  backend_session_id TEXT NOT NULL,
                  backend_run_id TEXT NOT NULL,
                  backend_item_id TEXT NOT NULL,
                  runtime_item_id TEXT NOT NULL UNIQUE,
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  item_type TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(backend,backend_session_id,backend_run_id,backend_item_id)
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_backend_item_bindings_run
                  ON runtime_backend_item_bindings(run_id,runtime_item_id);
                CREATE TRIGGER IF NOT EXISTS runtime_events_no_update BEFORE UPDATE ON runtime_events BEGIN SELECT RAISE(ABORT, 'runtime events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_events_no_delete BEFORE DELETE ON runtime_events BEGIN SELECT RAISE(ABORT, 'runtime events are append-only'); END;
                CREATE TABLE IF NOT EXISTS runtime_approvals (
                  approval_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runtime_runs(run_id), status TEXT NOT NULL,
                  request_json TEXT NOT NULL, decision_json TEXT, deadline_at TEXT, created_at TEXT NOT NULL, resolved_at TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_side_effects (
                  effect_id TEXT PRIMARY KEY,
                  approval_id TEXT NOT NULL UNIQUE REFERENCES runtime_approvals(approval_id),
                  run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  idempotency_key TEXT NOT NULL UNIQUE,
                  operation TEXT NOT NULL,
                  request_digest TEXT NOT NULL,
                  status TEXT NOT NULL,
                  result_digest TEXT,
                  error_code TEXT,
                  requested_at TEXT NOT NULL,
                  approved_at TEXT,
                  execution_started_at TEXT,
                  completed_at TEXT,
                  recovered_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_side_effects_run ON runtime_side_effects(run_id,requested_at);
                CREATE TABLE IF NOT EXISTS runtime_checkpoints (
                  checkpoint_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  event_sequence INTEGER NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_goal_revisions (
                  run_id TEXT NOT NULL REFERENCES runtime_runs(run_id), version INTEGER NOT NULL,
                  goal_json TEXT NOT NULL, previous_version INTEGER, created_at TEXT NOT NULL,
                  PRIMARY KEY(run_id,version)
                );
                CREATE TABLE IF NOT EXISTS runtime_goal_confirmations (
                  run_id TEXT NOT NULL REFERENCES runtime_runs(run_id), version INTEGER NOT NULL,
                  confirmed_at TEXT NOT NULL,
                  PRIMARY KEY(run_id,version),
                  FOREIGN KEY(run_id,version) REFERENCES runtime_goal_revisions(run_id,version)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_goal_revisions_no_update BEFORE UPDATE ON runtime_goal_revisions BEGIN SELECT RAISE(ABORT, 'goal revisions are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_goal_revisions_no_delete BEFORE DELETE ON runtime_goal_revisions BEGIN SELECT RAISE(ABORT, 'goal revisions are append-only'); END;
                CREATE TABLE IF NOT EXISTS runtime_tool_replay_evidence (
                  evidence_id TEXT PRIMARY KEY,
                  run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                  call_id TEXT NOT NULL,
                  source_event_id TEXT NOT NULL,
                  evidence_json_encrypted TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(run_id,call_id)
                );
                CREATE TABLE IF NOT EXISTS runtime_run_manifests (
                  run_id TEXT PRIMARY KEY REFERENCES runtime_runs(run_id), schema_version TEXT NOT NULL,
                  manifest_json_encrypted TEXT NOT NULL, safe_summary_json TEXT NOT NULL,
                  manifest_digest TEXT NOT NULL, reproducibility_level TEXT NOT NULL,
                  missing_evidence_json TEXT NOT NULL, created_at TEXT NOT NULL, finalized_at TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_inspection_metrics (
                  metric_id INTEGER PRIMARY KEY CHECK(metric_id=1),
                  reads INTEGER NOT NULL DEFAULT 0,
                  latency_ms_total REAL NOT NULL DEFAULT 0,
                  latency_ms_max REAL NOT NULL DEFAULT 0,
                  incomplete_evidence INTEGER NOT NULL DEFAULT 0,
                  projection_violations INTEGER NOT NULL DEFAULT 0,
                  response_bytes_max INTEGER NOT NULL DEFAULT 0,
                  updated_at TEXT NOT NULL
                );
                INSERT OR IGNORE INTO runtime_inspection_metrics(metric_id,updated_at) VALUES(1,CURRENT_TIMESTAMP);
                CREATE INDEX IF NOT EXISTS idx_runtime_runs_session_status
                  ON runtime_runs(session_id,status,created_at,run_id);
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
            if "input_resources_json" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN input_resources_json TEXT NOT NULL DEFAULT '[]'")
            if "correlation_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN correlation_id TEXT")
            if "parent_run_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN parent_run_id TEXT REFERENCES runtime_runs(run_id)")
            if "backend_run_id" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN backend_run_id TEXT")
            if "backend_run_index" not in columns:
                db.execute("ALTER TABLE runtime_runs ADD COLUMN backend_run_index INTEGER")
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

    def record_tool_replay_evidence(
        self, run_id: str, call_id: str, source_event_id: str,
        arguments: Mapping[str, Any], result: Mapping[str, Any], policy: Mapping[str, Any],
    ) -> None:
        evidence = {
            "call_id": call_id,
            "source_event_id": source_event_id,
            "arguments": dict(arguments),
            "result": dict(result),
            "policy": dict(policy),
        }
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO runtime_tool_replay_evidence VALUES(?,?,?,?,?,?)",
                (f"tool-evidence-{uuid.uuid4()}", run_id, call_id, source_event_id,
                 self._checkpoint_cipher.encrypt(evidence), _now()),
            )

    def tool_replay_evidence(self, run_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT r.evidence_json_encrypted,e.sequence AS source_event_sequence "
                "FROM runtime_tool_replay_evidence AS r "
                "LEFT JOIN runtime_events AS e ON e.event_id=r.source_event_id AND e.run_id=r.run_id "
                "WHERE r.run_id=? ORDER BY r.created_at,r.evidence_id",
                (run_id,),
            ).fetchall()
        return [
            {
                **self._checkpoint_cipher.decrypt(str(row["evidence_json_encrypted"])),
                "source_event_sequence": int(row["source_event_sequence"]) if row["source_event_sequence"] is not None else None,
            }
            for row in rows
        ]

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
                    # Some pre-Journal/partially upgraded databases can retain
                    # canonical OAEP projection rows after the legacy Journal
                    # and sequence tables were removed (for example when the
                    # external upgrader did not enable SQLite foreign keys).
                    # Those rows have no authoritative Event parent and their
                    # old sequence numbers collide with deterministic rebuild.
                    legacy_count = int(db.execute(
                        "SELECT COUNT(*) FROM runtime_session_journal WHERE session_id=?",
                        (session["session_id"],),
                    ).fetchone()[0])
                    if legacy_count == 0:
                        db.execute(
                            "DELETE FROM runtime_oaep_item_event_refs WHERE session_id=?",
                            (session["session_id"],),
                        )
                        db.execute(
                            "DELETE FROM runtime_oaep_events WHERE session_id=?",
                            (session["session_id"],),
                        )
                        db.execute(
                            "DELETE FROM runtime_oaep_items WHERE session_id=?",
                            (session["session_id"],),
                        )
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
                                "text": str(run["input_message"]),
                                "parts": ([{"type": "text", "text": str(run["input_message"])}]
                                          if str(run["input_message"]) else []),
                                "phase": "final",
                                "status": "completed",
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
            message_backfill_runs = {
                str(row["run_id"])
                for row in db.execute(
                    "SELECT DISTINCT e.run_id FROM runtime_events e "
                    "WHERE e.event_type IN ('agent.message.delta','agent.completed') "
                    "AND NOT EXISTS ("
                    "SELECT 1 FROM runtime_conversation_items i "
                    "WHERE i.item_id='assistant:' || e.run_id"
                    ")"
                ).fetchall()
            }
            for event in events:
                dedupe_key = f"runtime-event:{event['event_id']}"
                data = json.loads(str(event["data_json"]))
                if str(event["run_id"]) in message_backfill_runs:
                    changed = self._record_runtime_event_item_in_transaction(
                        db,
                        session_id=str(event["session_id"]),
                        run_id=str(event["run_id"]),
                        event_type=str(event["event_type"]),
                        data=data,
                        created_at=str(event["created_at"]),
                    ) or changed
                if db.execute(
                    "SELECT 1 FROM runtime_session_journal "
                    "WHERE session_id=? AND dedupe_key=? "
                    "UNION ALL "
                    "SELECT 1 FROM runtime_session_journal_compacted_runtime_events "
                    "WHERE session_id=? AND runtime_event_id=? LIMIT 1",
                    (
                        event["session_id"],
                        dedupe_key,
                        event["session_id"],
                        event["event_id"],
                    ),
                ).fetchone() is not None:
                    continue
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
                if _timestamp(str(existing["updated_at"])) > _timestamp(updated):
                    db.rollback()
                    return self._session(existing), False
                normalized_title = title[:240] or "Imported session"
                effective_agent_definition = (
                    agent_definition
                    if agent_definition is not None
                    else existing["agent_definition"]
                )
                effective_backend_id = (
                    backend_id if backend_id is not None else existing["backend_id"]
                )
                changed = any((
                    str(existing["title"]) != normalized_title,
                    bool(existing["archived"]) != bool(archived),
                    str(existing["lifecycle"]) != lifecycle,
                    existing["agent_definition"] != effective_agent_definition,
                    existing["backend_id"] != effective_backend_id,
                ))
                if not changed:
                    # The Desktop catalog may refresh or reformat updated_at
                    # without changing Session business state. Treat timestamp-
                    # only drift as a projection no-op so polling cannot create
                    # an unbounded revision/Journal stream.
                    db.rollback()
                    return self._session(existing), False
                db.execute(
                    "UPDATE runtime_sessions SET title=?, archived=?, lifecycle=?, "
                    "agent_definition=COALESCE(?,agent_definition), backend_id=COALESCE(?,backend_id), "
                    "revision=revision+1, updated_at=? WHERE session_id=?",
                    (normalized_title, int(archived), lifecycle,
                     agent_definition, backend_id, updated, session_id),
                )
                revision = int(existing["revision"]) + 1
                self.conversation_journal.append_event_in_transaction(
                    db,
                    session_id,
                    "session.archived" if archived else "session.updated",
                    {
                        "title": normalized_title,
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
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)
            ).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Session not found")
            current = self._session(row)
            wanted = lifecycle or (
                "archived" if archived is True
                else "active" if archived is False
                else current["lifecycle"]
            )
            if wanted not in {"active", "archived", "removed"}:
                db.rollback()
                raise ValueError("Invalid Session lifecycle")
            if current["lifecycle"] == "removed" and wanted != "removed":
                db.rollback()
                raise ValueError("Removed Session lifecycle is terminal")
            normalized_title = title[:240] if title is not None else current["title"]
            if current["title"] == normalized_title and current["lifecycle"] == wanted:
                db.rollback()
                return current
            removed_at = current["removed_at"] or (_now() if wanted == "removed" else None)
            updated_at = _now()
            db.execute(
                "UPDATE runtime_sessions SET title=?, archived=?, lifecycle=?, revision=revision+1, "
                "removed_at=?, updated_at=? WHERE session_id=?",
                (normalized_title, int(wanted != "active"),
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
                    "title": normalized_title,
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
        manifest_evidence: Mapping[str, Any] | None = None,
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
                    backend_id, status, idempotency_key, input_message, attachment_refs_json, input_resources_json, correlation_id,
                    parent_run_id, created_at, started_at, completed_at, cancel_requested_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, session_id, session["workspace_id"], session["worktree_id"], self.identity.runtime_id,
                    self.identity.instance_id, agent_definition, backend_id, "queued",
                    idempotency_key, "", "[]", "[]", None, parent_run_id, now, None, None, None,
                ),
            )
            manifest = initial_manifest(
                run_id=run_id,
                runtime_id=self.identity.runtime_id,
                instance_id=self.identity.instance_id,
                backend_id=backend_id,
                agent_definition=agent_definition,
                workspace_id=str(session["workspace_id"]),
                worktree_id=(str(session["worktree_id"]) if session["worktree_id"] else None),
            )
            if manifest_evidence:
                manifest = merge_manifest(manifest, manifest_evidence)
            self._store_run_manifest_in_transaction(
                db,
                run_id,
                manifest,
                created_at=now,
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

    def revise_goal(
        self, run_id: str, goal: Mapping[str, Any], *, expected_version: int,
    ) -> dict[str, Any]:
        """Append a Goal revision; a later revision never mutates confirmed history."""
        normalized = normalize_goal(goal)
        now = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute("SELECT status FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if run is None:
                db.rollback()
                raise KeyError("Run not found")
            if str(run["status"]) != "queued":
                db.rollback()
                raise ValueError("Goal can be revised only before Run execution")
            row = db.execute(
                "SELECT g.version,g.goal_json,EXISTS(SELECT 1 FROM runtime_goal_confirmations c WHERE c.run_id=g.run_id AND c.version=g.version) AS confirmed "
                "FROM runtime_goal_revisions g WHERE g.run_id=? ORDER BY g.version DESC LIMIT 1",
                (run_id,),
            ).fetchone()
            current = int(row["version"]) if row is not None else 0
            previous_goal = json.loads(str(row["goal_json"])) if row is not None else None
            previous_confirmed = bool(row["confirmed"]) if row is not None else False
            if current != expected_version:
                db.rollback()
                raise ValueError("Goal revision conflict")
            version = current + 1
            db.execute(
                "INSERT INTO runtime_goal_revisions(run_id,version,goal_json,previous_version,created_at) VALUES(?,?,?,?,?)",
                (run_id, version, json.dumps(normalized, ensure_ascii=False, separators=(",", ":"), sort_keys=True), current or None, now),
            )
            db.commit()
        if current and previous_goal is not None and not previous_confirmed:
            self.append_event(run_id, "goal.superseded", {
                "version": current,
                "superseded_by": version,
                "goal": previous_goal,
            })
        self.append_event(run_id, "goal.revised" if expected_version else "goal.proposed", {
            "version": version,
            "previous_version": current or None,
            "invalidates_goal_version": current or None,
            "invalidates_plan_for_goal_version": current or None,
            "goal": normalized,
        })
        return {"run_id": run_id, "version": version, "goal": normalized, "confirmed": False, "created_at": now}

    def confirm_goal(self, run_id: str, version: int) -> dict[str, Any]:
        now = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            latest = db.execute(
                "SELECT version,goal_json,created_at FROM runtime_goal_revisions WHERE run_id=? ORDER BY version DESC LIMIT 1",
                (run_id,),
            ).fetchone()
            if latest is None:
                db.rollback()
                raise KeyError("Goal not found")
            if int(latest["version"]) != version:
                db.rollback()
                raise ValueError("Only the latest Goal revision can be confirmed")
            inserted = db.execute(
                "INSERT OR IGNORE INTO runtime_goal_confirmations(run_id,version,confirmed_at) VALUES(?,?,?)",
                (run_id, version, now),
            ).rowcount > 0
            confirmed = db.execute(
                "SELECT confirmed_at FROM runtime_goal_confirmations WHERE run_id=? AND version=?",
                (run_id, version),
            ).fetchone()
            db.commit()
        result = {
            "run_id": run_id,
            "version": version,
            "goal": json.loads(str(latest["goal_json"])),
            "confirmed": True,
            "created_at": str(latest["created_at"]),
            "confirmed_at": str(confirmed["confirmed_at"]),
        }
        if inserted:
            self.append_event(run_id, "goal.confirmed", {"version": version, "goal": result["goal"]})
        return result

    def get_current_goal(self, run_id: str) -> dict[str, Any] | None:
        self.get_run(run_id)
        with self._connect() as db:
            row = db.execute(
                "SELECT g.*,c.confirmed_at FROM runtime_goal_revisions g LEFT JOIN runtime_goal_confirmations c "
                "ON c.run_id=g.run_id AND c.version=g.version WHERE g.run_id=? ORDER BY g.version DESC LIMIT 1",
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "run_id": run_id,
            "version": int(row["version"]),
            "goal": json.loads(str(row["goal_json"])),
            "confirmed": row["confirmed_at"] is not None,
            "created_at": str(row["created_at"]),
            **({"confirmed_at": str(row["confirmed_at"])} if row["confirmed_at"] else {}),
        }

    def require_confirmed_goal(self, run_id: str) -> dict[str, Any]:
        current = self.get_current_goal(run_id)
        if current is None or not current["confirmed"]:
            raise ValueError("Run Goal must be confirmed before execution")
        return current

    def import_backend_run(
        self,
        session_id: str,
        backend_id: str,
        backend_run_id: str,
        *,
        status: str = "completed",
        backend_run_index: int | None = None,
        created_at: str | None = None,
        completed_at: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Create the deterministic Runtime Run that owns imported backend history."""
        session = self.get_session(session_id)
        if not backend_id or not backend_run_id:
            raise ValueError("Imported backend Run identity is required")
        terminal = {"completed": "completed", "failed": "failed", "interrupted": "cancelled", "cancelled": "cancelled"}
        runtime_status = terminal.get(status, "completed")
        digest = hashlib.sha256(f"{backend_id}\0{backend_run_id}".encode("utf-8")).hexdigest()[:32]
        run_id = f"run-import-{backend_id}-{digest}"
        idempotency_key = f"import:{backend_id}:{digest}"
        created = created_at or _now()
        completed = completed_at or created
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if existing is not None:
                if str(existing["session_id"]) != session_id or str(existing["backend_id"]) != backend_id:
                    db.rollback()
                    raise ValueError("Imported backend Run identity is already bound elsewhere")
                # Re-import also repairs metadata added by newer Adapters.  In
                # particular, older Codex imports used import time because the
                # native fields are startedAt/completedAt rather than createdAt.
                db.execute(
                    "UPDATE runtime_runs SET backend_run_id=?,backend_run_index=COALESCE(?,backend_run_index),"
                    "created_at=COALESCE(?,created_at),started_at=COALESCE(?,started_at),"
                    "completed_at=COALESCE(?,completed_at) WHERE run_id=?",
                    (backend_run_id, backend_run_index, created_at, created_at, completed_at, run_id),
                )
                db.execute(
                    "UPDATE runtime_runs SET backend_run_id=? WHERE session_id=? AND backend_id=? "
                    "AND backend_run_id IS NULL AND EXISTS(SELECT 1 FROM runtime_events e "
                    "WHERE e.run_id=runtime_runs.run_id AND json_extract(e.data_json,'$.backend_metadata.turn_id')=?)",
                    (backend_run_id, session_id, backend_id, backend_run_id),
                )
                db.commit()
                return self.get_run(run_id), False
            agent_definition = str(session.get("agent_definition") or f"{backend_id}@1")
            db.execute(
                "INSERT INTO runtime_runs(run_id,session_id,workspace_id,worktree_id,runtime_id,instance_id,"
                "agent_definition,backend_id,status,idempotency_key,input_message,attachment_refs_json,input_resources_json,"
                "correlation_id,parent_run_id,backend_run_id,backend_run_index,created_at,started_at,completed_at,cancel_requested_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (run_id, session_id, session["workspace_id"], session.get("worktree_id"),
                 self.identity.runtime_id, self.identity.instance_id, agent_definition, backend_id,
                 runtime_status, idempotency_key, "", "[]", "[]", None, None, backend_run_id, backend_run_index,
                 created, created, completed, None),
            )
            db.execute(
                "UPDATE runtime_runs SET backend_run_id=? WHERE session_id=? AND backend_id=? "
                "AND run_id<>? AND backend_run_id IS NULL AND EXISTS(SELECT 1 FROM runtime_events e "
                "WHERE e.run_id=runtime_runs.run_id AND json_extract(e.data_json,'$.backend_metadata.turn_id')=?)",
                (backend_run_id, session_id, backend_id, run_id, backend_run_id),
            )
            self.conversation_journal.append_event_in_transaction(
                db, session_id, "run.created",
                {"agent_definition": agent_definition, "backend_id": backend_id, "status": "queued", "imported": True},
                run_id=run_id, dedupe_key=f"import-run-created:{run_id}", created_at=created,
            )
            self.conversation_journal.append_event_in_transaction(
                db, session_id, "run.state.changed",
                {"status": runtime_status, "backend_id": backend_id, "backend_run_id": backend_run_id, "imported": True},
                run_id=run_id, dedupe_key=f"import-run-terminal:{run_id}", created_at=completed,
            )
            db.commit()
        self.conversation_journal.notify_committed()
        return self.get_run(run_id), True

    def import_legacy_desktop_agent_run(
        self,
        workspace_id: str,
        thread_id: str,
        legacy_run_id: str,
        events: list[Mapping[str, Any]],
        *,
        title: str = "Imported Agent task",
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        """Import the pre-Runtime Windows Agent journal exactly once.

        Stable Session, Run and Item identities make the operation safe to
        repeat after a crash or on every application startup.  The migration
        intentionally targets the OpenDrSai backend and does not route through
        any external backend Adapter.
        """
        if not thread_id or not legacy_run_id:
            raise ValueError("Legacy Desktop Thread and Run identities are required")
        if len(events) > 500:
            raise ValueError("Legacy Desktop Agent Run exceeds the migration limit")
        session_digest = hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:32]
        session_id = f"session-import-desktop-agent-{session_digest}"
        session, session_created = self.import_session(
            session_id,
            workspace_id,
            title,
            agent_definition="opendrsai@1",
            backend_id="opendrsai",
            created_at=created_at,
            updated_at=updated_at,
        )
        terminal_type = next((
            _legacy_agent_event_type(value)
            for value in reversed(events)
            if _legacy_agent_event_type(value) in {"done", "error", "aborted", "completed", "failed", "cancelled"}
        ), "aborted")
        terminal_status = {
            "done": "completed", "completed": "completed",
            "error": "failed", "failed": "failed",
            "aborted": "cancelled", "cancelled": "cancelled",
        }[terminal_type]
        imported_run, run_created = self.import_backend_run(
            session_id,
            "opendrsai",
            f"legacy-desktop-agent:{legacy_run_id}",
            status=terminal_status,
            created_at=created_at,
            completed_at=updated_at,
        )
        runtime_run_id = str(imported_run["run_id"])
        normalized_items: list[dict[str, Any]] = []
        answer_parts: list[str] = []
        answer_created_at = created_at
        answer_updated_at = updated_at
        for index, raw in enumerate(events):
            if not isinstance(raw, Mapping):
                continue
            event_type = _legacy_agent_event_type(raw)
            timestamp = _legacy_agent_timestamp(raw) or updated_at or created_at
            if event_type in {"chunk", "message", "delta"}:
                text = str(raw.get("content") or raw.get("text") or raw.get("delta") or "")
                if text:
                    answer_parts.append(text)
                    answer_created_at = answer_created_at or timestamp
                    answer_updated_at = timestamp or answer_updated_at
                continue
            item_kind: str | None = None
            payload: dict[str, Any] = {}
            if event_type == "status":
                item_kind = "error"
                payload = {
                    "level": "info", "code": "legacy_agent_status",
                    "message": str(raw.get("content") or raw.get("message") or "Agent status updated"),
                    "status": "completed", "mapping_version": "desktop-agent-journal/1",
                    "backend": "opendrsai",
                }
            elif event_type in {"file_event", "file"}:
                file_event = raw.get("fileEvent") or raw.get("file_event") or {}
                file_event = dict(file_event) if isinstance(file_event, Mapping) else {}
                action = str(file_event.get("action") or "modify")
                path = str(file_event.get("path") or file_event.get("targetPath") or "")
                if action == "artifact":
                    item_kind = "artifact"
                    payload = {
                        "artifact_id": _legacy_agent_item_id(thread_id, legacy_run_id, "artifact", index),
                        "artifact_type": "file", "name": str(file_event.get("name") or Path(path).name or "Artifact"),
                        "path": path, "sha256": file_event.get("hash"), "summary": "Imported Agent artifact",
                    }
                else:
                    item_kind = "file_change"
                    payload = {"summary": "Imported Agent file change", "changes": [{"path": path, "operation": action}]}
                payload.update({"status": "completed", "mapping_version": "desktop-agent-journal/1", "backend": "opendrsai"})
            elif event_type in {"plan_adjustment", "plan"}:
                adjustment = raw.get("planAdjustment") or raw.get("plan_adjustment") or {}
                adjustment = dict(adjustment) if isinstance(adjustment, Mapping) else {}
                item_kind = "plan"
                payload = {
                    "text": str(adjustment.get("replacementStepTitle") or adjustment.get("replacement_step_title") or raw.get("content") or "Plan updated"),
                    "explanation": str(adjustment.get("reason") or "Imported Agent plan"),
                    "steps": [], "status": "completed", "mapping_version": "desktop-agent-journal/1",
                    "backend": "opendrsai",
                }
            if item_kind is None:
                continue
            item_id = _legacy_agent_item_id(thread_id, legacy_run_id, item_kind, index)
            normalized_items.append({
                "item_id": item_id, "kind": item_kind, "role": None, "revision": 1,
                "source_client": "runtime", "source_message_id": f"legacy-desktop-agent:{legacy_run_id}:{index}",
                "payload": payload, "run_id": runtime_run_id, "event_kind": "conversation.item.upsert",
                "created_at": timestamp, "updated_at": timestamp,
            })
        if answer_parts:
            answer_id = _legacy_agent_item_id(thread_id, legacy_run_id, "message", 0)
            normalized_items.append({
                "item_id": answer_id, "kind": "message", "role": "assistant", "revision": 1,
                "source_client": "runtime", "source_message_id": f"legacy-desktop-agent:{legacy_run_id}:answer",
                "payload": {
                    "text": "".join(answer_parts), "phase": "final", "status": terminal_status,
                    "mapping_version": "desktop-agent-journal/1", "backend": "opendrsai",
                },
                "run_id": runtime_run_id, "event_kind": "conversation.item.upsert",
                "created_at": answer_created_at, "updated_at": answer_updated_at,
            })
        item_result = self.record_conversation_items(session_id, normalized_items)
        snapshot = self.oaep_snapshot(session_id)
        return {
            "session_id": session_id,
            "run_id": runtime_run_id,
            "session_created": session_created,
            "run_created": run_created,
            "items_created": item_result["created"],
            "items_total": item_result["total"],
            "terminal_status": terminal_status,
            "oaep_item_count": len(snapshot.get("items") or []),
        }

    def list_session_runs(self, session_id: str) -> list[dict[str, Any]]:
        """Return the durable backend bindings for one Runtime Session."""
        self.get_session(session_id)
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM runtime_runs WHERE session_id=? ORDER BY created_at, run_id",
                (session_id,),
            ).fetchall()
        return [self._run(row) for row in rows]

    def list_session_runs_page(
        self,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int = 100,
        status: str | None = None,
    ) -> dict[str, Any]:
        self.get_session(session_id)
        after = decode_inspection_cursor(cursor)
        bounded = max(1, min(int(limit), 500))
        parameters: list[Any] = [session_id, after]
        where = "session_id=? AND rowid>?"
        if status:
            if status not in {"queued", "running", "waiting_approval", "completed", "failed", "cancelled"}:
                raise ValueError("Invalid Run status filter")
            where += " AND status=?"
            parameters.append(status)
        parameters.append(bounded + 1)
        with self._connect() as db:
            rows = db.execute(
                f"SELECT rowid AS inspection_rowid,* FROM runtime_runs WHERE {where} "
                "ORDER BY rowid LIMIT ?",
                parameters,
            ).fetchall()
        page = rows[:bounded]
        data = []
        for row in page:
            record = self._run(row)
            record["manifest"] = self.get_run_manifest(str(row["run_id"]), safe=True)
            data.append(record)
        return {
            "schema_version": INSPECTION_SCHEMA_VERSION,
            "object": "list",
            "data": data,
            "next_cursor": encode_inspection_cursor(int(page[-1]["inspection_rowid"])) if len(rows) > bounded else None,
            "has_more": len(rows) > bounded,
        }

    def _store_run_manifest_in_transaction(
        self,
        db: sqlite3.Connection,
        run_id: str,
        manifest: Mapping[str, Any],
        *,
        created_at: str | None = None,
        finalized_at: str | None = None,
    ) -> dict[str, Any]:
        normalized = json.loads(json.dumps(dict(manifest), ensure_ascii=False))
        level, missing = reproducibility(normalized)
        digest = digest_manifest(normalized)
        public = safe_manifest(normalized)
        created = created_at or _now()
        db.execute(
            "INSERT INTO runtime_run_manifests("
            "run_id,schema_version,manifest_json_encrypted,safe_summary_json,manifest_digest,"
            "reproducibility_level,missing_evidence_json,created_at,finalized_at"
            ") VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET "
            "manifest_json_encrypted=excluded.manifest_json_encrypted,"
            "safe_summary_json=excluded.safe_summary_json,manifest_digest=excluded.manifest_digest,"
            "reproducibility_level=excluded.reproducibility_level,"
            "missing_evidence_json=excluded.missing_evidence_json,"
            "finalized_at=COALESCE(runtime_run_manifests.finalized_at,excluded.finalized_at)",
            (
                run_id,
                str(normalized.get("schema_version") or "opendrsai.run-manifest/1"),
                self._checkpoint_cipher.encrypt(normalized),
                json.dumps(public, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                digest,
                level,
                json.dumps(missing, separators=(",", ":")),
                created,
                finalized_at,
            ),
        )
        return {"digest": digest, "level": level, "missing_evidence": missing}

    def _merge_run_manifest_in_transaction(
        self,
        db: sqlite3.Connection,
        run_id: str,
        evidence: Mapping[str, Any],
        *,
        finalize: bool = False,
    ) -> dict[str, Any]:
        row = db.execute("SELECT * FROM runtime_run_manifests WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            run = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if run is None:
                raise KeyError("Run not found")
            base = initial_manifest(
                run_id=run_id,
                runtime_id=str(run["runtime_id"]),
                instance_id=str(run["instance_id"]),
                backend_id=str(run["backend_id"]),
                agent_definition=str(run["agent_definition"]),
                workspace_id=str(run["workspace_id"]),
                worktree_id=str(run["worktree_id"]) if run["worktree_id"] else None,
            )
            created_at = str(run["created_at"])
        else:
            base = self._checkpoint_cipher.decrypt(str(row["manifest_json_encrypted"]))
            created_at = str(row["created_at"])
            if row["finalized_at"] is not None:
                candidate = merge_manifest(base, evidence)
                if digest_manifest(candidate) != str(row["manifest_digest"]):
                    raise ValueError("Finalized Run manifest is immutable")
                return {
                    "digest": str(row["manifest_digest"]),
                    "level": str(row["reproducibility_level"]),
                    "missing_evidence": json.loads(str(row["missing_evidence_json"])),
                }
        merged = merge_manifest(base, evidence)
        return self._store_run_manifest_in_transaction(
            db,
            run_id,
            merged,
            created_at=created_at,
            finalized_at=_now() if finalize else None,
        )

    def update_run_manifest(
        self, run_id: str, evidence: Mapping[str, Any], *, finalize: bool = False,
    ) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            result = self._merge_run_manifest_in_transaction(db, run_id, evidence, finalize=finalize)
            db.commit()
        return result

    def _terminal_outcome_evidence_in_transaction(
        self, db: sqlite3.Connection, run_id: str,
    ) -> dict[str, Any]:
        """Build a content-safe terminal summary from the canonical Item projection."""
        rows = db.execute(
            "SELECT envelope_json FROM runtime_oaep_items WHERE run_id=? ORDER BY run_sequence,item_id",
            (run_id,),
        ).fetchall()
        counts: dict[str, int] = {}
        usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        artifacts: list[dict[str, Any]] = []
        result: dict[str, Any] | None = None
        for row in rows:
            try:
                item = json.loads(str(row["envelope_json"]))
            except (TypeError, json.JSONDecodeError):
                continue
            item_type = str(item.get("type") or "notice")
            counts[item_type] = counts.get(item_type, 0) + 1
            content = item.get("content") if isinstance(item.get("content"), dict) else {}
            item_usage = content.get("usage") if isinstance(content.get("usage"), dict) else {}
            for canonical, aliases in {
                "input_tokens": ("input_tokens", "prompt_tokens"),
                "output_tokens": ("output_tokens", "completion_tokens"),
                "total_tokens": ("total_tokens",),
            }.items():
                for alias in aliases:
                    value = item_usage.get(alias)
                    if isinstance(value, (int, float)) and value >= 0:
                        usage[canonical] += int(value)
                        break
            if item_type == "artifact":
                artifacts.append({
                    key: safe_inspection_item({key: content[key]}).get(key)
                    for key in ("artifact_id", "name", "mime_type", "sha256", "resource_refs")
                    if key in content
                })
            if item_type == "message" and content.get("role") == "assistant":
                text = content.get("text")
                if isinstance(text, str):
                    result = {"sha256": text_digest(text), "length": len(text)}
        if usage["total_tokens"] == 0:
            usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
        # Some backends publish aggregate usage directly into the manifest
        # instead of attaching it to an OAEP Item.  Terminal sealing must add
        # projection-derived evidence without erasing that already-recorded
        # aggregate evidence.
        if usage["input_tokens"] == 0 and usage["output_tokens"] == 0:
            manifest_row = db.execute(
                "SELECT manifest_json_encrypted FROM runtime_run_manifests WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if manifest_row is not None:
                current_manifest = self._checkpoint_cipher.decrypt(
                    str(manifest_row["manifest_json_encrypted"]),
                )
                current_outcome = (
                    current_manifest.get("outcome")
                    if isinstance(current_manifest.get("outcome"), dict)
                    else {}
                )
                current_usage = (
                    current_outcome.get("usage")
                    if isinstance(current_outcome.get("usage"), dict)
                    else {}
                )
                input_tokens = current_usage.get("input_tokens", current_usage.get("prompt_tokens"))
                output_tokens = current_usage.get("output_tokens", current_usage.get("completion_tokens"))
                total_tokens = current_usage.get("total_tokens")
                if isinstance(input_tokens, (int, float)) and input_tokens >= 0:
                    usage["input_tokens"] = int(input_tokens)
                if isinstance(output_tokens, (int, float)) and output_tokens >= 0:
                    usage["output_tokens"] = int(output_tokens)
                if isinstance(total_tokens, (int, float)) and total_tokens >= 0:
                    usage["total_tokens"] = int(total_tokens)
                elif usage["total_tokens"] == 0:
                    usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
        return {
            "counts_by_item_type": counts,
            "usage": usage,
            "artifacts": artifacts,
            **({"result": result} if result else {}),
        }

    def get_run_manifest(self, run_id: str, *, safe: bool = True) -> dict[str, Any]:
        run = self.get_run(run_id)
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM runtime_run_manifests WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                manifest = initial_manifest(
                    run_id=run_id,
                    runtime_id=str(run["runtime_id"]),
                    instance_id=str(run["instance_id"]),
                    backend_id=str(run["backend_id"]),
                    agent_definition=str(run["agent_definition"]),
                    workspace_id=str(run["workspace_id"]),
                    worktree_id=str(run["worktree_id"]) if run.get("worktree_id") else None,
                )
                level, missing = reproducibility(manifest)
                full_digest = digest_manifest(manifest)
                public = safe_manifest(manifest)
                return {
                    "schema_version": str(manifest.get("schema_version") or "opendrsai.run-manifest/1"),
                    "run_id": run_id,
                    "manifest": public if safe else manifest,
                    "manifest_digest": full_digest,
                    "safe_manifest_digest": digest_manifest(public),
                    "reproducibility_level": level,
                    "missing_evidence": missing,
                    "created_at": str(run["created_at"]),
                    "finalized_at": None,
                    "repair_required": True,
                }
        try:
            full_manifest = self._checkpoint_cipher.decrypt(str(row["manifest_json_encrypted"]))
            if digest_manifest(full_manifest) != str(row["manifest_digest"]):
                raise ValueError("Run manifest digest mismatch")
            manifest = json.loads(str(row["safe_summary_json"])) if safe else full_manifest
            level = str(row["reproducibility_level"])
            missing = json.loads(str(row["missing_evidence_json"]))
        except Exception:
            manifest, level, missing = {}, "unavailable", ["manifest.corrupt"]
        return {
            "schema_version": str(row["schema_version"]),
            "run_id": run_id,
            "manifest": manifest,
            "manifest_digest": str(row["manifest_digest"]),
            "safe_manifest_digest": digest_manifest(manifest),
            "reproducibility_level": level,
            "missing_evidence": missing,
            "created_at": str(row["created_at"]),
            "finalized_at": str(row["finalized_at"]) if row["finalized_at"] else None,
        }

    def reconcile_terminal_run_manifests(self) -> int:
        """Seal terminal evidence outside read requests after crash/recovery."""
        repaired = 0
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute(
                "SELECT r.* FROM runtime_runs AS r LEFT JOIN runtime_run_manifests AS m "
                "ON m.run_id=r.run_id WHERE r.status IN ('completed','failed','cancelled') "
                "AND (m.run_id IS NULL OR m.finalized_at IS NULL) ORDER BY r.created_at,r.run_id"
            ).fetchall()
            for run in rows:
                run_id = str(run["run_id"])
                self._merge_run_manifest_in_transaction(
                    db,
                    run_id,
                    {
                        "outcome": {
                            **self._terminal_outcome_evidence_in_transaction(db, run_id),
                            "status": str(run["status"]),
                            "completed_at": run["completed_at"] or _now(),
                        },
                    },
                    finalize=True,
                )
                repaired += 1
            db.commit()
        return repaired

    def set_run_input(
        self,
        run_id: str,
        message: str,
        *,
        attachment_refs: list[str] | None = None,
        input_resources: list[Mapping[str, Any]] | None = None,
        correlation_id: str | None = None,
        source_client: str = "runtime",
        source_message_id: str | None = None,
        model: str | None = None,
        evidence: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        run = self.get_run(run_id)
        safe_message = str(redact_sensitive(redact_secrets(message)))
        from drsai.backend.runtime.input_resources import normalize_input_resources, serializable_input_resources
        normalized_resources = normalize_input_resources(input_resources or [])
        encoded = json.dumps(redact_sensitive(attachment_refs or []), separators=(",", ":"))
        encoded_resources = json.dumps(
            serializable_input_resources(normalized_resources), ensure_ascii=False, separators=(",", ":"),
        )
        # A Run owns exactly one immutable user input. HTTP retries and
        # recoverable capability configuration may enter this method again,
        # but they must never revise the user Item or rebind request-scoped
        # metadata such as a new correlation ID to revision 1.
        if str(run.get("input_message") or ""):
            if (
                str(run["input_message"]) != safe_message
                or json.dumps(run.get("attachment_refs") or [], separators=(",", ":")) != encoded
                or json.dumps(
                    run.get("input_resources") or [], ensure_ascii=False, separators=(",", ":"),
                ) != encoded_resources
            ):
                raise ValueError("Runtime Run input is immutable")
            return run
        manifest_evidence = dict(evidence or {})
        supplied_input = manifest_evidence.get("input")
        manifest_evidence["input"] = {
            **(dict(supplied_input) if isinstance(supplied_input, Mapping) else {}),
            "sha256": text_digest(message),
            "length": len(message),
        }
        supplied_model = manifest_evidence.get("model")
        supplied_model = dict(supplied_model) if isinstance(supplied_model, Mapping) else {}
        if model:
            manifest_evidence["model"] = {
                "id": model,
                "provider": str(run["backend_id"]),
                **supplied_model,
            }
        declarations = manifest_evidence.get("evidence_declarations")
        manifest_evidence["evidence_declarations"] = {
            "attachments_recorded": True,
            **(dict(declarations) if isinstance(declarations, Mapping) else {}),
        }
        manifest_evidence.setdefault(
            "attachments",
            [{"ref": ref, "ref_sha256": text_digest(ref)} for ref in (attachment_refs or [])],
        )
        already_bound = False
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute(
                "SELECT input_message,attachment_refs_json,input_resources_json FROM runtime_runs WHERE run_id=?",
                (run_id,),
            ).fetchone()
            if current is None:
                raise KeyError("Run not found")
            if str(current["input_message"] or ""):
                if (
                    str(current["input_message"]) != safe_message
                    or str(current["attachment_refs_json"]) != encoded
                    or str(current["input_resources_json"]) != encoded_resources
                ):
                    raise ValueError("Runtime Run input is immutable")
                already_bound = True
                journal_created = False
            else:
                db.execute(
                    "UPDATE runtime_runs SET input_message=?, attachment_refs_json=?, input_resources_json=?, "
                    "correlation_id=COALESCE(correlation_id,?) WHERE run_id=?",
                    (safe_message, encoded, encoded_resources, correlation_id, run_id),
                )
                self._merge_run_manifest_in_transaction(
                    db,
                    run_id,
                    manifest_evidence,
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
                        "text": safe_message,
                        "parts": [{"type": "text", "text": safe_message}] if safe_message else [],
                        "phase": "final",
                        "status": "completed",
                        "attachment_refs": json.loads(encoded),
                        "input_resources": [
                            {
                                "resource_id": value["resource_id"], "kind": value["kind"],
                                "name": value["name"], "status": value["status"],
                            }
                            for value in normalized_resources
                        ],
                        "correlation_id": correlation_id,
                    },
                    run_id=run_id,
                    created_at=str(run["created_at"]),
                )
            db.commit()
        if already_bound:
            return self.get_run(run_id)
        if journal_created:
            self.conversation_journal.notify_committed()
        return self.get_run(run_id)

    def inspect_run(
        self,
        run_id: str,
        *,
        timeline_cursor: str | None = None,
        limit: int = 100,
        item_type: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        inspection_started = time.perf_counter()
        allowed_types = {
            "message", "reasoning", "plan", "command_execution", "file_change",
            "tool_call", "artifact", "interaction", "subtask", "notice",
        }
        allowed_statuses = {"pending", "running", "waiting", "completed", "failed", "cancelled"}
        if item_type and item_type not in allowed_types:
            raise ValueError("Invalid Run inspection item type filter")
        if status and status not in allowed_statuses:
            raise ValueError("Invalid Run inspection item status filter")
        run = self.get_run(run_id)
        # Projection reconciliation is a startup/write-path responsibility.
        # Inspection must remain read-only and must not rescan an entire Session
        # before every bounded page read.
        bounded = max(1, min(int(limit), 500))
        after_sequence, after_item_id = decode_timeline_cursor(timeline_cursor)
        page, has_more = self.conversation_journal.oaep_run_items_page(
            str(run["session_id"]),
            run_id,
            after_sequence=after_sequence,
            after_item_id=after_item_id,
            limit=bounded,
            item_type=item_type,
            status=status,
            ensure_projection=False,
        )
        aggregate = self.conversation_journal.oaep_run_inspection_summary(
            str(run["session_id"]), run_id, ensure_projection=False,
        )
        counts = dict(aggregate["counts_by_item_type"])
        statuses = dict(aggregate["counts_by_status"])
        usage = dict(aggregate["usage"])
        error_summary: dict[str, Any] | None = None
        error_item = aggregate.get("error_item")
        if isinstance(error_item, dict):
            content = error_item.get("content") if isinstance(error_item.get("content"), dict) else {}
            error = content.get("error") if isinstance(content.get("error"), dict) else {}
            message = error.get("message") or content.get("message") or content.get("summary")
            if message and str(message) != "[REDACTED]":
                error_summary = {
                    "code": str(error.get("code") or content.get("code") or "run.item_failed")[:120],
                    "message": redact_credentials(str(message)),
                    "retryable": bool(error.get("retryable", False)),
                }
        manifest_view = self.get_run_manifest(run_id, safe=True)
        manifest_payload = manifest_view.get("manifest") if isinstance(manifest_view.get("manifest"), dict) else {}
        outcome = manifest_payload.get("outcome") if isinstance(manifest_payload.get("outcome"), dict) else {}
        outcome_usage = outcome.get("usage") if isinstance(outcome.get("usage"), dict) else {}
        for canonical, aliases in {
            "input_tokens": ("input_tokens", "prompt_tokens"),
            "output_tokens": ("output_tokens", "completion_tokens"),
            "total_tokens": ("total_tokens",),
        }.items():
            if usage[canonical]:
                continue
            for alias in aliases:
                value = outcome_usage.get(alias)
                if isinstance(value, (int, float)) and value >= 0:
                    usage[canonical] = int(value)
                    break
        if error_summary is None and isinstance(outcome.get("error"), dict):
            outcome_error = outcome["error"]
            message = outcome_error.get("message")
            if message:
                error_summary = {
                    "code": str(outcome_error.get("code") or "run.failed")[:120],
                    "message": redact_credentials(str(message)),
                    "retryable": bool(outcome_error.get("retryable", False)),
                }
        if usage["total_tokens"] == 0:
            usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
        item_event_refs = self.conversation_journal.oaep_item_event_refs(
            str(run["session_id"]), run_id, [str(item.get("id") or "") for item in page],
        )
        public_page = []
        for item in page:
            public_page.append({
                **safe_inspection_item(item),
                "event_refs": item_event_refs.get(str(item.get("id") or ""), []),
            })
        started = _timestamp(run.get("started_at") or run.get("created_at"))
        ended = _timestamp(run.get("completed_at")) or _timestamp(_now())
        response = {
            "schema_version": INSPECTION_SCHEMA_VERSION,
            "run": redact_sensitive(run),
            "summary": {
                "duration_ms": max(0, round((ended - started) * 1000)) if started else None,
                "counts_by_item_type": counts,
                "counts_by_status": statuses,
                "error": error_summary,
                "usage": usage,
                "artifact_count": counts.get("artifact", 0),
                "warning_count": int(aggregate["warning_count"]),
            },
            "timeline": public_page,
            "manifest": manifest_view,
            "page": {
                "next_cursor": (
                    encode_timeline_cursor(
                        int(page[-1].get("sequence") or 0), str(page[-1].get("id") or ""),
                    )
                    if has_more and page else None
                ),
                "has_more": has_more,
            },
        }
        latency_ms = (time.perf_counter() - inspection_started) * 1000
        response_bytes = len(json.dumps(response, ensure_ascii=False).encode("utf-8"))
        with self._lock:
            self._inspection_metrics["reads"] = int(self._inspection_metrics["reads"]) + 1
            self._inspection_metrics["latency_ms_total"] = float(self._inspection_metrics["latency_ms_total"]) + latency_ms
            self._inspection_metrics["latency_ms_max"] = max(float(self._inspection_metrics["latency_ms_max"]), latency_ms)
            self._inspection_metrics["response_bytes_max"] = max(int(self._inspection_metrics["response_bytes_max"]), response_bytes)
            if manifest_view["reproducibility_level"] != "exact":
                self._inspection_metrics["incomplete_evidence"] = int(self._inspection_metrics["incomplete_evidence"]) + 1
            self._persist_inspection_metrics()
        return response

    def locate_run_item(
        self,
        run_id: str,
        item_id: str,
        *,
        item_type: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        """Return a cursor that loads the requested Item on the next page."""
        run = self.get_run(run_id)
        item, predecessor = self.conversation_journal.oaep_run_item_predecessor(
            str(run["session_id"]), run_id, item_id, item_type=item_type, status=status,
        )
        return {
            "schema_version": INSPECTION_SCHEMA_VERSION,
            "run_id": run_id,
            "item_id": str(item.get("id") or item_id),
            "item_sequence": int(item.get("sequence") or 0),
            "timeline_cursor": (
                encode_timeline_cursor(predecessor[0], predecessor[1])
                if predecessor else None
            ),
        }

    def inspection_metrics(self) -> dict[str, int | float]:
        """Content-free observability for Inspection latency and evidence health."""
        with self._lock:
            metrics = dict(self._inspection_metrics)
        reads = int(metrics["reads"])
        metrics["latency_ms_average"] = float(metrics["latency_ms_total"]) / reads if reads else 0.0
        return metrics

    def record_projection_violation(self) -> None:
        with self._lock:
            self._inspection_metrics["projection_violations"] = int(self._inspection_metrics["projection_violations"]) + 1
            self._persist_inspection_metrics()

    def _persist_inspection_metrics(self) -> None:
        metrics = self._inspection_metrics
        with self._connect() as db:
            db.execute(
                "UPDATE runtime_inspection_metrics SET reads=?,latency_ms_total=?,latency_ms_max=?,"
                "incomplete_evidence=?,projection_violations=?,response_bytes_max=?,updated_at=? WHERE metric_id=1",
                (int(metrics["reads"]), float(metrics["latency_ms_total"]), float(metrics["latency_ms_max"]),
                 int(metrics["incomplete_evidence"]), int(metrics["projection_violations"]),
                 int(metrics["response_bytes_max"]), _now()),
            )

    def rotate_evidence_encryption_key(self) -> dict[str, int]:
        """Atomically re-encrypt manifests/checkpoints with a new protected key.

        The keyring temporarily retains the previous key, so a crash on either
        side of the SQLite commit remains recoverable. It is pruned only after
        every encrypted row has committed successfully.
        """
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            manifests = db.execute(
                "SELECT run_id,manifest_json_encrypted FROM runtime_run_manifests"
            ).fetchall()
            checkpoints = db.execute(
                "SELECT checkpoint_id,state_json FROM runtime_checkpoints"
            ).fetchall()
            manifest_plaintext = [
                (str(row["run_id"]), self._checkpoint_cipher.decrypt(str(row["manifest_json_encrypted"])))
                for row in manifests
            ]
            checkpoint_plaintext = [
                (str(row["checkpoint_id"]), self._checkpoint_cipher.decrypt(str(row["state_json"])))
                for row in checkpoints
            ]
            self._checkpoint_cipher.rotate()
            try:
                db.executemany(
                    "UPDATE runtime_run_manifests SET manifest_json_encrypted=? WHERE run_id=?",
                    [(self._checkpoint_cipher.encrypt(value), row_id) for row_id, value in manifest_plaintext],
                )
                db.executemany(
                    "UPDATE runtime_checkpoints SET state_json=? WHERE checkpoint_id=?",
                    [(self._checkpoint_cipher.encrypt(value), row_id) for row_id, value in checkpoint_plaintext],
                )
                db.commit()
            except Exception:
                db.rollback()
                raise
        self._checkpoint_cipher.prune_rotated_keys()
        return {"manifests": len(manifest_plaintext), "checkpoints": len(checkpoint_plaintext)}

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

    def oaep_snapshot(
        self,
        session_id: str,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        session = self.get_session(session_id)
        if limit is None and cursor is None:
            # Internal callers retain the complete projection contract. Public
            # mobile routes always provide a bounded limit.
            conversation = self.conversation_snapshot(session_id)
            return project_snapshot(
                session,
                self.list_session_runs(session_id),
                {
                    **conversation,
                    "items": self.conversation_journal.oaep_items(
                        session_id,
                        through_sequence=int(conversation["snapshot_sequence"]),
                    ),
                },
            )
        bounded = max(1, min(int(limit or 100), 500))
        before_sequence: int | None = None
        before_item_id = ""
        if cursor:
            try:
                cursor_state = self._checkpoint_cipher.decrypt(cursor)
                if cursor_state.get("kind") != "oaep-snapshot-window/1" or cursor_state.get("session_id") != session_id:
                    raise ValueError
                waterline = int(cursor_state["snapshot_sequence"])
                before_sequence = int(cursor_state["before_sequence"])
                before_item_id = str(cursor_state["before_item_id"])
                checkpoint = {
                    "checkpoint_sequence": waterline,
                    "snapshot_hash": str(cursor_state["snapshot_hash"]),
                    "item_count": int(cursor_state["item_count"]),
                }
            except Exception as exc:
                raise ValueError("Invalid OAEP Snapshot cursor") from exc
        else:
            waterline = self.conversation_journal.snapshot_waterline(session_id)
            checkpoint = self.conversation_journal.oaep_checkpoint(
                session_id, through_sequence=waterline,
            )
            if int(checkpoint["checkpoint_sequence"]) != waterline:
                raise RuntimeError("OAEP Snapshot checkpoint waterline changed")
        items, continuation = self.conversation_journal.oaep_items_window(
            session_id,
            through_sequence=waterline,
            before_sequence=before_sequence,
            before_item_id=before_item_id,
            limit=bounded,
        )
        run_ids = {str(item.get("run_id") or "") for item in items}
        runs = [run for run in self.list_session_runs(session_id) if str(run["run_id"]) in run_ids]
        result = project_snapshot(
            session,
            runs,
            {"snapshot_sequence": waterline, "items": items},
        )
        next_cursor = None
        if continuation is not None:
            next_cursor = self._checkpoint_cipher.encrypt({
                "kind": "oaep-snapshot-window/1",
                "session_id": session_id,
                "snapshot_sequence": waterline,
                "before_sequence": continuation[0],
                "before_item_id": continuation[1],
                "snapshot_hash": checkpoint["snapshot_hash"],
                "item_count": checkpoint["item_count"],
            })
        result["checkpoint"] = {
            "sequence": waterline,
            "snapshot_hash": checkpoint["snapshot_hash"],
            "item_count": checkpoint["item_count"],
        }
        result["window"] = {
            "limit": bounded,
            "has_more": next_cursor is not None,
            "next_cursor": next_cursor,
        }
        return result

    def list_oaep_events(
        self,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        self.get_session(session_id)
        return self.conversation_journal.replay_oaep(
            session_id, after_sequence=after_sequence, limit=limit
        )

    def wait_oaep_events(
        self,
        session_id: str,
        *,
        after_sequence: int,
        timeout: float = 15.0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        self.get_session(session_id)
        return self.conversation_journal.wait_for_oaep_events(
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

    def record_conversation_items(
        self, session_id: str, items: list[Mapping[str, Any]], *, max_items: int = 20_000,
    ) -> dict[str, int]:
        """Persist an imported history page in one atomic journal transaction."""
        if len(items) > max_items:
            raise ValueError("Conversation Item import exceeds the Runtime limit")
        created_count = 0
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for value in items:
                _, _, created = self.conversation_journal.upsert_item_in_transaction(
                    db, session_id,
                    item_id=str(value["item_id"]), kind=str(value["kind"]), role=value.get("role"),
                    revision=int(value.get("revision") or 1), source_client=str(value.get("source_client") or "runtime"),
                    payload=dict(value.get("payload") or {}), run_id=str(value["run_id"]) if value.get("run_id") else None,
                    source_message_id=str(value["source_message_id"]) if value.get("source_message_id") else None,
                    event_kind=str(value["event_kind"]) if value.get("event_kind") else None,
                    created_at=str(value["created_at"]) if value.get("created_at") else None,
                    updated_at=str(value["updated_at"]) if value.get("updated_at") else None,
                )
                created_count += int(created)
            db.commit()
        if created_count:
            self.conversation_journal.notify_committed()
        return {"created": created_count, "total": len(items)}

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

    @staticmethod
    def _safe_error_summary(error: Mapping[str, Any]) -> dict[str, Any]:
        projected = safe_error(dict(error))
        return {
            "code": str(projected.get("code") or "run.failed")[:120],
            "message": str(projected.get("message") or "Run failed.")[:500],
            "retryable": bool(error.get("retryable", False)),
            **({"path": projected["path"]} if projected.get("path") else {}),
        }

    def _finalize_active_run_items_in_transaction(
        self,
        db: sqlite3.Connection,
        *,
        session_id: str,
        run_id: str,
        terminal_status: str,
        updated_at: str,
    ) -> None:
        rows = db.execute(
            "SELECT i.*,o.envelope_json FROM runtime_conversation_items AS i "
            "JOIN runtime_oaep_items AS o ON o.item_id=i.item_id "
            "WHERE i.run_id=? ORDER BY o.run_sequence,i.item_id",
            (run_id,),
        ).fetchall()
        item_status = "completed" if terminal_status == "completed" else terminal_status
        for item in rows:
            envelope = json.loads(str(item["envelope_json"]))
            if envelope.get("status") in {"completed", "failed", "cancelled"}:
                continue
            payload = json.loads(str(item["payload_json"]))
            payload["status"] = item_status
            self.conversation_journal.upsert_item_in_transaction(
                db,
                session_id,
                item_id=str(item["item_id"]),
                kind=str(item["item_kind"]),
                role=str(item["role"]) if item["role"] else None,
                revision=int(item["revision"]) + 1,
                source_client=str(item["source_client"]),
                source_message_id=str(item["source_message_id"]) if item["source_message_id"] else None,
                payload=payload,
                run_id=run_id,
                updated_at=updated_at,
            )

    @staticmethod
    def _run_state_payload(
        status: str,
        *,
        reason: str | None = None,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"status": status}
        if reason:
            payload["reason"] = reason
        if error:
            payload["error"] = RuntimeEngine._safe_error_summary(error)
        return payload

    def transition_run(
        self,
        run_id: str,
        status: str,
        *,
        reason: str | None = None,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            if row is None:
                db.rollback(); raise KeyError("Run not found")
            if status not in RUN_TRANSITIONS.get(row["status"], set()):
                db.rollback(); raise ValueError(f"Illegal Run transition: {row['status']} -> {status}")
            started = row["started_at"] or (_now() if status == "running" else None)
            completed = _now() if status in {"completed", "cancelled", "failed"} else None
            if completed:
                self._finalize_active_run_items_in_transaction(
                    db,
                    session_id=str(row["session_id"]),
                    run_id=run_id,
                    terminal_status=status,
                    updated_at=completed,
                )
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
                self._run_state_payload(status, reason=reason, error=error),
                run_id=run_id,
                dedupe_key=f"runtime-event:{runtime_event_id}",
                created_at=event_created,
            )
            if status in {"completed", "cancelled", "failed"}:
                self._merge_run_manifest_in_transaction(
                    db,
                    run_id,
                    {
                        "outcome": {
                            **self._terminal_outcome_evidence_in_transaction(db, run_id),
                            "status": status,
                            "completed_at": completed,
                            **({"reason": reason} if reason else {}),
                            **({"error": self._safe_error_summary(error)} if error else {}),
                        }
                    },
                    finalize=True,
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
            self._finalize_active_run_items_in_transaction(
                db,
                session_id=str(row["session_id"]),
                run_id=run_id,
                terminal_status="cancelled",
                updated_at=now,
            )
            update = db.execute(
                "UPDATE runtime_runs SET status='cancelled', cancel_requested_at=COALESCE(cancel_requested_at,?), "
                "completed_at=? WHERE run_id=? AND status IN ('queued','running','waiting_approval')",
                (now, now, run_id),
            )
            if update.rowcount != 1:
                current = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
                db.commit()
                return self._run(current)
            pending_approvals = db.execute(
                "SELECT approval_id FROM runtime_approvals WHERE run_id=? AND status='pending' ORDER BY created_at",
                (run_id,),
            ).fetchall()
            if pending_approvals:
                db.execute(
                    "UPDATE runtime_approvals SET status='denied',decision_json=?,resolved_at=? "
                    "WHERE run_id=? AND status='pending'",
                    (json.dumps({"reason": "run_cancelled"}, separators=(",", ":")), now, run_id),
                )
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
                    self._run_state_payload(
                        event_type.removeprefix("run."),
                        reason="user_requested" if event_type == "run.cancelled" else "cancel_requested",
                    ),
                    run_id=run_id,
                    dedupe_key=f"runtime-event:{event_id}",
                    created_at=now,
                )
            for approval in pending_approvals:
                approval_id = str(approval["approval_id"])
                sequence += 1
                event_id = f"event-{uuid.uuid4()}"
                detail = {"approval_id": approval_id, "reason": "run_cancelled"}
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,"
                    "backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
                    (event_id, run_id, sequence, "approval.denied", json.dumps(detail, separators=(",", ":"), sort_keys=True), now),
                )
                self.conversation_journal.append_event_in_transaction(
                    db,
                    str(row["session_id"]),
                    "approval.decided",
                    {"approval_id": approval_id, "decision": "denied", "detail": {"reason": "run_cancelled"}},
                    run_id=run_id,
                    dedupe_key=f"runtime-event:{event_id}",
                    created_at=now,
                )
            row = db.execute("SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)).fetchone()
            self._merge_run_manifest_in_transaction(
                db,
                run_id,
                {"outcome": {
                    **self._terminal_outcome_evidence_in_transaction(db, run_id),
                    "status": "cancelled", "completed_at": now, "reason": "user_requested",
                }},
                finalize=True,
            )
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
                    self._run_state_payload("cancel_requested", reason="user_requested"),
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
        # Canonical OAEP Run events update the Run/session state through their
        # journal envelope. They are never assistant message completions.
        if event_type.startswith("oaep.run."):
            return False
        canonical_oaep_item_event = event_type.startswith("oaep.item.")
        native_oaep_message_delta = event_type == "oaep.item.message.delta"
        if event_type.startswith("oaep.item.") and not event_type.endswith(".delta"):
            event_type = "agent.item." + event_type.removeprefix("oaep.item.")
        else:
            event_type = _OAEP_RUNTIME_COMPAT.get(event_type, event_type)
        item_kind: str
        role: str | None
        item_id: str
        message_delta_events = {"message.delta", "agent.message.delta"}
        message_complete_events = {"message.complete", "agent.completed"}
        if native_oaep_message_delta:
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(metadata.get("item_id") or data.get("item_id") or "default")
            item_kind, role, item_id = "message", "assistant", f"codex:{run_id}:{identity}"
        elif event_type in message_delta_events or event_type in message_complete_events:
            item_kind, role, item_id = "message", "assistant", f"assistant:{run_id}"
        elif event_type == "thinking.delta":
            item_kind, role, item_id = "reasoning", "assistant", f"reasoning:{run_id}"
        elif event_type == "agent.item.command.delta":
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(metadata.get("item_id") or data.get("item_id") or "default")
            item_kind, role, item_id = "tool", "tool", f"codex:{run_id}:{identity}"
        elif event_type == "agent.item.reasoning.delta":
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(metadata.get("item_id") or data.get("item_id") or "default")
            item_kind, role, item_id = "reasoning", "assistant", f"codex:{run_id}:{identity}"
        elif event_type == "agent.item.plan.delta":
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(metadata.get("item_id") or data.get("item_id") or "plan")
            item_kind, role, item_id = "plan", "assistant", f"codex:{run_id}:{identity}"
        elif event_type == "agent.item.subtask.delta":
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(metadata.get("item_id") or data.get("item_id") or "subtask")
            item_kind, role, item_id = "subtask", None, f"codex:{run_id}:{identity}"
        elif event_type == "agent.item.tool.delta":
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(metadata.get("item_id") or data.get("item_id") or "tool")
            item_kind, role, item_id = "tool", "tool", f"codex:{run_id}:{identity}"
        elif event_type.startswith("agent.item."):
            item = data.get("item") if isinstance(data.get("item"), dict) else {}
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            identity = str(
                metadata.get("item_id")
                or item.get("id")
                or data.get("item_id")
                or "default"
            )
            codex_item_type = event_type.rsplit(".", 1)[-1]
            if codex_item_type == "message":
                candidate_role = item.get("role")
                item_kind = "message"
                role = candidate_role if candidate_role in {"user", "assistant", "system"} else "assistant"
            elif codex_item_type == "reasoning":
                item_kind, role = "reasoning", "assistant"
            elif codex_item_type == "plan":
                item_kind, role = "plan", "assistant"
            elif codex_item_type == "command":
                item_kind, role = "tool", "tool"
            elif codex_item_type == "file_change":
                item_kind, role = "file_change", None
            elif codex_item_type == "tool":
                item_kind, role = "tool", "tool"
            elif codex_item_type == "subtask":
                item_kind, role = "subtask", None
            else:
                item_kind, role = "error", None
            item_id = f"codex:{run_id}:{identity}"
        elif event_type == "agent.failed":
            item_kind, role, item_id = "error", None, f"error:{run_id}:agent"
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
        elif event_type in {"goal.proposed", "goal.revised", "goal.confirmed", "goal.superseded"}:
            item_kind, role, item_id = "approval", None, f"goal:{run_id}:v{int(data.get('version') or 0)}"
            goal = data.get("goal") if isinstance(data.get("goal"), dict) else {}
            defaults = goal.get("defaults") if isinstance(goal.get("defaults"), dict) else {}
            default_sources = goal.get("default_sources") if isinstance(goal.get("default_sources"), dict) else {}
            goal_prompt = "\n".join([
                f"Goal: {str(goal.get('objective') or '')}",
                "Materials: " + (", ".join(str(value) for value in goal.get("materials", [])) or "None supplied"),
                "Outputs: " + (", ".join(str(value) for value in goal.get("outputs", [])) or "Not specified"),
                "Constraints: " + (", ".join(str(value) for value in goal.get("constraints", [])) or "None supplied"),
                "Defaults: " + ", ".join(
                    f"{key}={defaults.get(key, '')} (source: {default_sources.get(key, 'unspecified')})"
                    for key in ("language", "length", "citation_style", "format")
                ),
            ])
            data = {
                **data,
                "interaction_type": "confirmation",
                "prompt": goal_prompt,
                "request": {"operation": "goal.confirm", "goal": goal, "version": data.get("version")},
                "status": "completed" if event_type in {"goal.confirmed", "goal.superseded"} else "waiting",
                **({"decision": {"value": "confirmed"}} if event_type == "goal.confirmed" else {}),
                **({"decision": {"value": "superseded", "superseded_by": data.get("superseded_by")}} if event_type == "goal.superseded" else {}),
            }
        else:
            return False

        if canonical_oaep_item_event:
            metadata = data.get("backend_metadata") if isinstance(data.get("backend_metadata"), dict) else {}
            backend = str(data.get("backend") or "unknown")
            backend_session_id = str(metadata.get("thread_id") or "")
            backend_run_id = str(metadata.get("turn_id") or "")
            backend_item_id = str(metadata.get("item_id") or "")
            backend_item_type = str(metadata.get("item_type") or item_kind)
            item_id = self._resolve_backend_item_binding_in_transaction(
                db,
                backend=backend,
                backend_session_id=backend_session_id,
                backend_run_id=backend_run_id,
                backend_item_id=backend_item_id,
                runtime_session_id=session_id,
                runtime_run_id=run_id,
                item_type=backend_item_type,
                created_at=created_at,
            )

        existing = db.execute(
            "SELECT revision,payload_json FROM runtime_conversation_items WHERE item_id=?",
            (item_id,),
        ).fetchone()
        revision = int(existing["revision"]) + 1 if existing is not None else 1
        prior = json.loads(str(existing["payload_json"])) if existing is not None else {}
        payload = {**prior, **data, "event_type": event_type}
        if event_type == "agent.item.command.delta":
            delta = str(data.get("content") or data.get("text") or data.get("delta") or data.get("output") or "")
            payload = {**prior, **data, "event_type": event_type}
            payload["delta"] = delta
            payload["output"] = f"{prior.get('output', '')}{delta}"
            payload["status"] = "running"
            if data.get("stream"):
                payload["stream"] = data["stream"]
        elif event_type == "agent.item.reasoning.delta":
            delta = str(data.get("content") or data.get("text") or data.get("delta") or "")
            payload = {**prior, **data, "event_type": event_type}
            payload["delta"] = delta
            payload["text"] = f"{prior.get('text', '')}{delta}"
            payload["status"] = "running"
        elif event_type == "agent.item.plan.delta":
            delta = str(data.get("content") or data.get("text") or data.get("delta") or "")
            payload = {**prior, **data, "event_type": event_type}
            payload["delta"] = delta
            payload["text"] = f"{prior.get('text', '')}{delta}"
            payload["status"] = "running"
        elif event_type == "agent.item.subtask.delta":
            delta = str(data.get("content") or data.get("text") or data.get("delta") or "")
            payload = {**prior, **data, "event_type": event_type}
            payload["delta"] = delta
            payload["summary"] = f"{prior.get('summary', '')}{delta}"
            payload["status"] = "running"
        elif event_type == "agent.item.tool.delta":
            delta = str(data.get("content") or data.get("text") or data.get("delta") or "")
            payload = {**prior, **data, "event_type": event_type}
            payload["delta"] = delta
            payload["result"] = f"{prior.get('result', '')}{delta}"
            payload["status"] = "running"
        elif event_type.startswith("agent.item."):
            item = data.get("item") if isinstance(data.get("item"), dict) else {}
            phase = str(data.get("phase") or "").lower()
            payload = {**prior, **item, **data, "event_type": event_type}
            if data.get("oaep_phase") in {"commentary", "final"}:
                payload["phase"] = data["oaep_phase"]
            if payload.get("summary"):
                payload["display_command"] = payload["summary"]
            elif "command" in item and "display_command" not in payload:
                payload["display_command"] = item["command"]
            if "exitCode" in item and "exit_code" not in payload:
                payload["exit_code"] = item["exitCode"]
            if event_type.endswith(".file_change"):
                change_path = item.get("path") or item.get("relativePath")
                payload["changes"] = item.get("changes") if isinstance(item.get("changes"), list) else (
                    [{"path": change_path, "operation": item.get("operation") or "modify"}]
                    if change_path else []
                )
                payload["summary"] = item.get("summary") or item.get("description") or change_path or ""
            if event_type.endswith(".unknown"):
                payload["level"] = "warning"
                payload["code"] = "codex_item_unknown"
                payload["message"] = str(data.get("method") or item.get("type") or "Unknown Codex item")
            payload["status"] = phase if phase in {"completed", "failed", "cancelled"} else "running"
        elif event_type == "agent.failed":
            error = data.get("error") if isinstance(data.get("error"), dict) else {}
            message = str(error.get("message") or data.get("message") or "Agent execution failed.")
            if message == "[REDACTED]":
                redacted_details = error.get("redacted_details")
                if not isinstance(redacted_details, dict):
                    redacted_details = data.get("redacted_details")
                detail = error.get("detail")
                if not isinstance(detail, dict):
                    detail = data.get("detail")
                safe_reason = (
                    redacted_details.get("reason") if isinstance(redacted_details, dict) else None
                ) or (detail.get("reason") if isinstance(detail, dict) else None)
                if safe_reason:
                    message = f"Agent execution failed: {safe_reason}"
            payload = {
                "event_type": event_type,
                "level": "error",
                "code": str(error.get("code") or data.get("code") or "agent_execution_failed"),
                "message": message,
                "details": {
                    "retryable": bool(error.get("retryable") or data.get("retryable")),
                },
                "status": "failed",
            }
        if native_oaep_message_delta or event_type in message_delta_events or event_type == "thinking.delta":
            delta = str(data.get("text") or data.get("content") or data.get("delta") or "")
            payload["delta"] = delta
            payload["text"] = f"{prior.get('text', '')}{delta}"
            # OAEP message projection prefers ``content`` over ``text``. Keep
            # the canonical Item's content cumulative while the Event still
            # carries the single append delta.
            if native_oaep_message_delta or event_type in message_delta_events:
                payload["content"] = payload["text"]
            payload["status"] = "streaming"
        elif event_type in message_complete_events:
            final = str(data.get("text") or data.get("content") or "")
            payload["text"] = final or str(prior.get("text") or "")
            payload["status"] = "completed"
        elif event_type.startswith("tool."):
            arguments = data.get("arguments") if isinstance(data.get("arguments"), dict) else (
                data.get("args") if isinstance(data.get("args"), dict) else {}
            )
            command = data.get("command") or data.get("cmd") or arguments.get("command") or arguments.get("cmd")
            if command is not None and payload.get("command") is None:
                payload["command"] = command if isinstance(command, list) else [str(command)]
            if command is not None and not payload.get("display_command"):
                payload["display_command"] = " ".join(command) if isinstance(command, list) else str(command)
            if arguments and not isinstance(payload.get("arguments"), dict):
                payload["arguments"] = arguments
            if "result" not in payload and "output" in data:
                payload["result"] = data.get("output")
            payload["status"] = (
                "completed"
                if event_type in {"tool.complete", "tool.completed"}
                else ("failed" if event_type == "tool.failed" else "running")
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
                if native_oaep_message_delta
                or event_type in message_delta_events
                or event_type == "thinking.delta"
                or event_type in {
                    "agent.item.command.delta", "agent.item.reasoning.delta",
                    "agent.item.plan.delta", "agent.item.subtask.delta", "agent.item.tool.delta",
                }
                else None
            ),
            updated_at=created_at,
        )
        return True

    def _resolve_backend_item_binding_in_transaction(
        self,
        db: sqlite3.Connection,
        *,
        backend: str,
        backend_session_id: str,
        backend_run_id: str,
        backend_item_id: str,
        runtime_session_id: str,
        runtime_run_id: str,
        item_type: str,
        created_at: str,
    ) -> str:
        if not all((backend, backend_session_id, backend_run_id, backend_item_id, item_type)):
            raise ValueError("Canonical Backend Item binding is incomplete")
        row = db.execute(
            "SELECT * FROM runtime_backend_item_bindings WHERE backend=? AND backend_session_id=? "
            "AND backend_run_id=? AND backend_item_id=?",
            (backend, backend_session_id, backend_run_id, backend_item_id),
        ).fetchone()
        if row is not None:
            actual = (
                str(row["session_id"]), str(row["run_id"]), str(row["item_type"]),
            )
            expected = (runtime_session_id, runtime_run_id, item_type)
            if actual != expected:
                raise ValueError("Backend Item binding is already assigned to different Runtime semantics")
            db.execute(
                "UPDATE runtime_backend_item_bindings SET updated_at=? WHERE runtime_item_id=?",
                (created_at, str(row["runtime_item_id"])),
            )
            return str(row["runtime_item_id"])
        runtime_item_id = f"{backend}:{runtime_run_id}:{backend_item_id}"
        db.execute(
            "INSERT INTO runtime_backend_item_bindings(backend,backend_session_id,backend_run_id,backend_item_id,"
            "runtime_item_id,session_id,run_id,item_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                backend, backend_session_id, backend_run_id, backend_item_id,
                runtime_item_id, runtime_session_id, runtime_run_id, item_type,
                created_at, created_at,
            ),
        )
        return runtime_item_id

    def get_backend_item_bindings(self, run_id: str) -> list[dict[str, Any]]:
        self.get_run(run_id)
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM runtime_backend_item_bindings WHERE run_id=? ORDER BY created_at,runtime_item_id",
                (run_id,),
            ).fetchall()
        return [dict(row) for row in rows]

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
            canonical_item_event = event_type.startswith("oaep.item.")
            if not canonical_item_event:
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
            item_created = self._record_runtime_event_item_in_transaction(
                db,
                session_id=str(run["session_id"]),
                run_id=run_id,
                event_type=event_type,
                data=safe_data,
                created_at=created,
            )
            row = db.execute("SELECT * FROM runtime_events WHERE event_id=?", (event_id,)).fetchone()
            db.commit()
        if not canonical_item_event or item_created:
            self.conversation_journal.notify_committed()
        return self._event(row)

    def append_normalized_event(
        self,
        run_id: str,
        event: "NormalizedAgentEvent",
        audit: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Persist normalized semantics canonically, then write a legacy projection."""
        from drsai.backend.runtime.normalized_writer import (
            normalized_canonical_item,
            normalized_runtime_write,
        )
        from drsai.backend.runtime.normalized_events import NormalizedEventKind

        session_lifecycle = {
            NormalizedEventKind.SESSION_ARCHIVED: "archived",
            NormalizedEventKind.SESSION_UNARCHIVED: "active",
            NormalizedEventKind.SESSION_DELETED: "removed",
        }.get(event.kind)
        event_type, data, dedupe_key = normalized_runtime_write(event)
        compatibility_data = redact_sensitive({**dict(audit or {}), **data})
        created = _now()
        journal_created = False
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing_event = db.execute(
                "SELECT * FROM runtime_events WHERE run_id=? AND backend_event_key=?",
                (run_id, dedupe_key),
            ).fetchone()
            if existing_event is not None:
                db.commit()
                return self._event(existing_event)
            run = db.execute(
                "SELECT session_id FROM runtime_runs WHERE run_id=?", (run_id,),
            ).fetchone()
            if run is None:
                db.rollback()
                raise KeyError("Run not found")
            session_id = str(run["session_id"])

            # Apply a normalized Session lifecycle transition in this same
            # transaction. Calling update_session() here used to emit a first
            # journal event before the normalized event below, which made a
            # single backend notification appear twice in OAEP.
            if session_lifecycle is not None:
                current_session = db.execute(
                    "SELECT title,lifecycle,revision,removed_at FROM runtime_sessions WHERE session_id=?",
                    (session_id,),
                ).fetchone()
                if current_session is None:
                    db.rollback()
                    raise KeyError("Session not found")
                current_lifecycle = str(current_session["lifecycle"])
                if current_lifecycle == "removed" and session_lifecycle != "removed":
                    db.rollback()
                    raise ValueError("Removed Session lifecycle is terminal")
                revision = int(current_session["revision"])
                if current_lifecycle != session_lifecycle:
                    revision += 1
                    removed_at = (
                        str(current_session["removed_at"])
                        if current_session["removed_at"]
                        else created if session_lifecycle == "removed" else None
                    )
                    db.execute(
                        "UPDATE runtime_sessions SET archived=?, lifecycle=?, revision=?, "
                        "removed_at=?, updated_at=? WHERE session_id=?",
                        (
                            int(session_lifecycle != "active"),
                            session_lifecycle,
                            revision,
                            removed_at,
                            created,
                            session_id,
                        ),
                    )
                compatibility_data = {
                    **compatibility_data,
                    "title": str(current_session["title"]),
                    "lifecycle": session_lifecycle,
                    "revision": revision,
                }

            if event.item_type is not None:
                runtime_item_id = self._resolve_backend_item_binding_in_transaction(
                    db,
                    backend=event.backend,
                    backend_session_id=event.binding.session_id,
                    backend_run_id=str(event.binding.run_id or ""),
                    backend_item_id=str(event.binding.item_id or ""),
                    runtime_session_id=session_id,
                    runtime_run_id=run_id,
                    item_type=event.item_type.value,
                    created_at=created,
                )
                existing_item = db.execute(
                    "SELECT revision,payload_json FROM runtime_conversation_items WHERE item_id=?",
                    (runtime_item_id,),
                ).fetchone()
                prior = json.loads(str(existing_item["payload_json"])) if existing_item is not None else None
                kind, role, payload, item_event_kind = normalized_canonical_item(
                    event,
                    prior,
                    dict(audit or {}),
                )
                revision = int(existing_item["revision"]) + 1 if existing_item is not None else 1
                _item, _journal_event, journal_created = self.conversation_journal.upsert_item_in_transaction(
                    db,
                    session_id,
                    item_id=runtime_item_id,
                    kind=kind,
                    role=role,
                    revision=revision,
                    source_client="runtime",
                    payload=payload,
                    run_id=run_id,
                    event_kind=item_event_kind,
                    updated_at=created,
                )
            else:
                session_event_kind, session_payload = self._normalized_lifecycle_projection(event, compatibility_data)
                _journal_event, journal_created = self.conversation_journal.append_event_in_transaction(
                    db,
                    session_id,
                    session_event_kind,
                    session_payload,
                    run_id=run_id if event.binding.run_id else None,
                    dedupe_key=f"normalized:{run_id}:{dedupe_key}",
                    created_at=created,
                )

            sequence = int(db.execute(
                "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?", (run_id,),
            ).fetchone()[0])
            event_id = f"event-{uuid.uuid4()}"
            db.execute(
                "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) "
                "VALUES(?,?,?,?,?,?,?)",
                (
                    event_id, run_id, sequence, event_type,
                    json.dumps(compatibility_data, separators=(",", ":"), sort_keys=True),
                    created, dedupe_key,
                ),
            )
            row = db.execute("SELECT * FROM runtime_events WHERE event_id=?", (event_id,)).fetchone()
            db.commit()
        if journal_created:
            self.conversation_journal.notify_committed()
        return self._event(row)

    @staticmethod
    def _normalized_lifecycle_projection(
        event: "NormalizedAgentEvent",
        data: dict[str, Any],
    ) -> tuple[str, dict[str, Any]]:
        """Map non-Item normalized state directly to a Session journal event."""
        from drsai.backend.runtime.normalized_events import NormalizedEventKind

        if event.kind == NormalizedEventKind.SESSION_ARCHIVED:
            return "session.archived", data
        if event.kind == NormalizedEventKind.SESSION_DELETED:
            return "session.removed", data
        if event.kind in {
            NormalizedEventKind.SESSION_CREATED,
            NormalizedEventKind.SESSION_UPDATED,
            NormalizedEventKind.SESSION_UNARCHIVED,
        }:
            return "session.updated", data
        status = {
            NormalizedEventKind.RUN_STARTED: "running",
            NormalizedEventKind.RUN_WAITING: "waiting",
            NormalizedEventKind.RUN_RESUMED: "running",
            NormalizedEventKind.RUN_COMPLETED: "completed",
            NormalizedEventKind.RUN_FAILED: "failed",
            NormalizedEventKind.RUN_CANCELLED: "cancelled",
        }.get(event.kind)
        if status is None:
            raise ValueError(f"Unsupported normalized lifecycle: {event.kind.value}")
        return "run.state.changed", {
            **data,
            "status": status,
            "reason": "resumed" if event.kind == NormalizedEventKind.RUN_RESUMED else "backend",
        }

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
            existing_by_key: dict[str, sqlite3.Row] = {}
            created_by_key: dict[str, dict[str, Any]] = {}
            requested_keys = list(dict.fromkeys(key for _, _, key in events))
            for offset in range(0, len(requested_keys), 500):
                keys = requested_keys[offset:offset + 500]
                placeholders = ",".join("?" for _ in keys)
                rows = db.execute(
                    f"SELECT * FROM runtime_events WHERE run_id=? AND backend_event_key IN ({placeholders})",
                    (run_id, *keys),
                ).fetchall()
                existing_by_key.update({str(row["backend_event_key"]): row for row in rows})
            if events and all(event_type in {"message.delta", "agent.message.delta"} for event_type, _, _ in events):
                inserted_rows: list[tuple[Any, ...]] = []
                created_values: dict[str, dict[str, Any]] = {}
                created_order: list[dict[str, Any]] = []
                for event_type, data, backend_event_key in events:
                    existing = existing_by_key.get(backend_event_key)
                    if existing is not None:
                        results.append(self._event(existing))
                        continue
                    if backend_event_key in created_values:
                        results.append(dict(created_values[backend_event_key]))
                        continue
                    sequence += 1
                    event_id, created = f"event-{uuid.uuid4()}", _now()
                    safe_data = redact_sensitive(data)
                    inserted_rows.append((
                        event_id, run_id, sequence, event_type,
                        json.dumps(safe_data, separators=(",", ":"), sort_keys=True), created, backend_event_key,
                    ))
                    result = {"event_id": event_id, "run_id": run_id, "sequence": sequence, "type": event_type,
                              "data": safe_data, "created_at": created, "backend_event_key": backend_event_key}
                    created_values[backend_event_key] = result
                    created_order.append(result)
                    results.append(result)
                if inserted_rows:
                    db.executemany(
                        "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) "
                        "VALUES(?,?,?,?,?,?,?)",
                        inserted_rows,
                    )
                chunks: list[str] = []
                chunk_chars = 0
                chunk_created_at: str | None = None
                for result in created_order:
                    data = result["data"]
                    value = str(data.get("text") or data.get("content") or data.get("delta") or "")
                    chunks.append(value)
                    chunk_chars += len(value)
                    chunk_created_at = str(result["created_at"])
                    if chunk_chars < 64 * 1024:
                        continue
                    self._record_runtime_event_item_in_transaction(
                        db, session_id=str(run["session_id"]), run_id=run_id,
                        event_type="agent.message.delta", data={"content": "".join(chunks)},
                        created_at=chunk_created_at,
                    )
                    chunks, chunk_chars = [], 0
                if chunks:
                    self._record_runtime_event_item_in_transaction(
                        db, session_id=str(run["session_id"]), run_id=run_id,
                        event_type="agent.message.delta", data={"content": "".join(chunks)},
                        created_at=chunk_created_at or _now(),
                    )
                db.commit()
                if created_order:
                    self.conversation_journal.notify_committed()
                return results
            pending_message_delta_parts: list[str] = []
            pending_message_delta_chars = 0
            pending_message_created_at: str | None = None

            def flush_pending_message_delta() -> None:
                nonlocal pending_message_delta_parts, pending_message_delta_chars, pending_message_created_at, journal_created
                if not pending_message_delta_parts:
                    return
                pending_message_delta = "".join(pending_message_delta_parts)
                self._record_runtime_event_item_in_transaction(
                    db,
                    session_id=str(run["session_id"]),
                    run_id=run_id,
                    event_type="agent.message.delta",
                    data={"content": pending_message_delta},
                    created_at=pending_message_created_at or _now(),
                )
                journal_created = True
                pending_message_delta_parts = []
                pending_message_delta_chars = 0
                pending_message_created_at = None

            for event_type, data, backend_event_key in events:
                if backend_event_key in created_by_key:
                    results.append(dict(created_by_key[backend_event_key]))
                    continue
                existing = existing_by_key.get(backend_event_key)
                if existing is not None:
                    results.append(self._event(existing)); continue
                sequence += 1
                event_id, created = f"event-{uuid.uuid4()}", _now()
                safe_data = redact_sensitive(data)
                db.execute(
                    "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,created_at,backend_event_key) VALUES(?,?,?,?,?,?,?)",
                    (event_id, run_id, sequence, event_type, json.dumps(safe_data, separators=(",", ":"), sort_keys=True), created, backend_event_key),
                )
                if event_type in {"message.delta", "agent.message.delta"}:
                    # The raw Runtime Event remains append-only below. OAEP's
                    # Session journal receives bounded coalesced Item deltas;
                    # copying every token event into both logs makes long
                    # answers quadratic without adding public semantics.
                    created_in_journal = False
                    delta_text = str(
                        safe_data.get("text")
                        or safe_data.get("content")
                        or safe_data.get("delta")
                        or ""
                    )
                    pending_message_delta_parts.append(delta_text)
                    pending_message_delta_chars += len(delta_text)
                    pending_message_created_at = created
                    if pending_message_delta_chars >= 64 * 1024:
                        flush_pending_message_delta()
                else:
                    flush_pending_message_delta()
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
                created_result = {"event_id": event_id, "run_id": run_id, "sequence": sequence, "type": event_type,
                                  "data": safe_data, "created_at": created, "backend_event_key": backend_event_key}
                created_by_key[backend_event_key] = created_result
                results.append(created_result)
            flush_pending_message_delta()
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
            operation = str(safe_request.get("operation") or "").strip()
            if operation:
                request_digest = "sha256:" + hashlib.sha256(
                    json.dumps(safe_request, separators=(",", ":"), sort_keys=True).encode("utf-8")
                ).hexdigest()
                db.execute(
                    "INSERT INTO runtime_side_effects("
                    "effect_id,approval_id,run_id,idempotency_key,operation,request_digest,status,requested_at"
                    ") VALUES(?,?,?,?,?,?,?,?)",
                    (
                        f"effect-{uuid.uuid4()}", approval_id, run_id,
                        f"side-effect:{approval_id}", operation, request_digest, "requested", created,
                    ),
                )
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

    @staticmethod
    def _side_effect(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "effect_id": row["effect_id"], "approval_id": row["approval_id"],
            "run_id": row["run_id"], "idempotency_key": row["idempotency_key"],
            "operation": row["operation"], "request_digest": row["request_digest"],
            "status": row["status"], "result_digest": row["result_digest"],
            "error_code": row["error_code"], "requested_at": row["requested_at"],
            "approved_at": row["approved_at"], "execution_started_at": row["execution_started_at"],
            "completed_at": row["completed_at"], "recovered_at": row["recovered_at"],
        }

    def get_side_effect(self, approval_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_side_effects WHERE approval_id=?", (approval_id,)).fetchone()
        if row is None:
            raise KeyError("Side effect not found")
        return self._side_effect(row)

    def list_side_effects(self, run_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM runtime_side_effects WHERE run_id=? ORDER BY requested_at,effect_id", (run_id,),
            ).fetchall()
        return [self._side_effect(row) for row in rows]

    def claim_side_effect(self, approval_id: str, run_id: str, operation: str, *, recovered: bool = False) -> dict[str, Any]:
        claimed_at = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM runtime_side_effects WHERE approval_id=?", (approval_id,)).fetchone()
            if row is None:
                db.rollback()
                raise KeyError("Side effect not found")
            if str(row["run_id"]) != run_id or str(row["operation"]) != operation:
                db.rollback()
                raise ValueError("Side effect approval does not match this operation")
            if str(row["status"]) == "completed":
                db.rollback()
                raise ValueError("Side effect idempotency key already completed")
            if str(row["status"]) == "executing":
                db.rollback()
                raise ValueError("Side effect outcome is unknown after interruption")
            if str(row["status"]) != "approved":
                db.rollback()
                raise ValueError("Side effect is not approved for execution")
            updated = db.execute(
                "UPDATE runtime_side_effects SET status='executing',execution_started_at=?,recovered_at=? "
                "WHERE approval_id=? AND status='approved'",
                (claimed_at, claimed_at if recovered else row["recovered_at"], approval_id),
            )
            if updated.rowcount != 1:
                db.rollback()
                raise ValueError("Side effect could not be claimed")
            db.commit()
        return self.get_side_effect(approval_id)

    def complete_side_effect(self, approval_id: str, result: Mapping[str, Any]) -> dict[str, Any]:
        completed_at = _now()
        result_digest = "sha256:" + hashlib.sha256(
            json.dumps(redact_sensitive(dict(result)), separators=(",", ":"), sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()
        with self._lock, self._connect() as db:
            updated = db.execute(
                "UPDATE runtime_side_effects SET status='completed',result_digest=?,completed_at=? "
                "WHERE approval_id=? AND status='executing'",
                (result_digest, completed_at, approval_id),
            )
            if updated.rowcount != 1:
                raise ValueError("Side effect is not executing")
            db.commit()
        return self.get_side_effect(approval_id)

    def fail_side_effect(self, approval_id: str, error_code: str) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            updated = db.execute(
                "UPDATE runtime_side_effects SET status='failed',error_code=?,completed_at=? "
                "WHERE approval_id=? AND status='executing'",
                (str(error_code)[:128], _now(), approval_id),
            )
            if updated.rowcount != 1:
                raise ValueError("Side effect is not executing")
            db.commit()
        return self.get_side_effect(approval_id)

    def resolve_approval(
        self, approval_id: str, decision: str, detail: dict[str, Any] | None = None,
        *, resume_on_denied: bool = False,
    ) -> dict[str, Any]:
        if decision not in {"approved", "denied", "cancelled", "expired", "disconnected", "timeout"}:
            raise ValueError("Approval decision is invalid")
        target = (
            "running"
            if decision == "approved" or (decision in {"denied", "cancelled", "disconnected"} and resume_on_denied)
            else "cancelled"
            if decision in {"denied", "cancelled"}
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
            db.execute(
                "UPDATE runtime_side_effects SET status=?,approved_at=? "
                "WHERE approval_id=? AND status='requested'",
                ("approved" if decision == "approved" else "rejected", resolved_at if decision == "approved" else None, approval_id),
            )
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
                        if target != "running"
                        else {"status": target, "reason": "approval_resolved"}
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
            if target in {"cancelled", "failed"}:
                self._finalize_active_run_items_in_transaction(
                    db,
                    session_id=str(row["session_id"]),
                    run_id=str(row["run_id"]),
                    terminal_status=target,
                    updated_at=resolved_at,
                )
                self._merge_run_manifest_in_transaction(
                    db,
                    str(row["run_id"]),
                    {
                        "outcome": {
                            **self._terminal_outcome_evidence_in_transaction(db, str(row["run_id"])),
                            "status": target,
                            "completed_at": resolved_at,
                            "reason": f"approval_{decision}",
                        }
                    },
                    finalize=True,
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
            self.resolve_approval(str(row["approval_id"]), "expired", {"reason": "deadline_elapsed"})
        query = "SELECT approval_id FROM runtime_approvals WHERE status='pending'"
        args: tuple[Any, ...] = ()
        if run_id is not None:
            query += " AND run_id=?"
            args = (run_id,)
        query += " ORDER BY created_at"
        with self._connect() as db:
            rows = db.execute(query, args).fetchall()
        return [self.get_approval(str(row["approval_id"])) for row in rows]

    def list_run_approvals(self, run_id: str) -> list[dict[str, Any]]:
        """Return immutable approval history used to reconnect a restarted backend."""
        self.get_run(run_id)
        with self._connect() as db:
            rows = db.execute(
                "SELECT approval_id FROM runtime_approvals WHERE run_id=? ORDER BY created_at,approval_id",
                (run_id,),
            ).fetchall()
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
        if "input_resources_json" in row.keys():
            result["input_resources"] = json.loads(str(row["input_resources_json"] or "[]"))
        return result

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        event_type = str(row["event_type"])
        if event_type.startswith("oaep.item.") and not event_type.endswith(".delta"):
            event_type = "agent.item." + event_type.removeprefix("oaep.item.")
        else:
            event_type = _OAEP_RUNTIME_COMPAT.get(event_type, event_type)
        result = {"event_id": row["event_id"], "run_id": row["run_id"], "sequence": row["sequence"],
                  "type": event_type, "data": json.loads(row["data_json"]), "created_at": row["created_at"]}
        if "backend_event_key" in row.keys() and row["backend_event_key"] is not None:
            result["backend_event_key"] = row["backend_event_key"]
        return result
