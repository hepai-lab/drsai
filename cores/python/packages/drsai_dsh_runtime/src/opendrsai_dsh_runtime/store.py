"""Standalone authority store for Control operations and native bindings."""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class RuntimeStoreError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


_TERMINAL_RUN_STATES = frozenset({"completed", "failed", "cancelled"})
_ACTIVE_RUN_STATES = frozenset({"queued", "starting", "running", "waiting", "outcome_unknown"})
_RUN_TRANSITIONS = {
    "queued": frozenset({"starting", "running", "failed", "cancelled", "outcome_unknown"}),
    "starting": frozenset({"running", "waiting", "failed", "cancelled", "outcome_unknown"}),
    "running": frozenset({"waiting", "completed", "failed", "cancelled", "outcome_unknown"}),
    "waiting": frozenset({"running", "failed", "cancelled", "outcome_unknown"}),
    "outcome_unknown": frozenset({"running", "completed", "failed", "cancelled"}),
}
_OPERATION_TRANSITIONS = {
    "prepared": frozenset({"sent", "completed", "outcome_unknown"}),
    "sent": frozenset({"acknowledged", "completed", "outcome_unknown"}),
    "acknowledged": frozenset({"completed", "outcome_unknown"}),
    "outcome_unknown": frozenset({"acknowledged", "completed"}),
}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return None if row is None else dict(row)


class RuntimeAuthorityStore:
    """SQLite authority owned solely by one DSH OAEP Runtime Bridge."""

    def __init__(self, path: Path):
        self.path = path.expanduser().resolve(strict=False)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys = ON")
        self._db.execute("PRAGMA journal_mode = WAL")
        self._migrate()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _migrate(self) -> None:
        # sqlite3.executescript owns its transaction boundary in autocommit
        # mode. Business mutations below use explicit BEGIN IMMEDIATE.
        with self._lock:
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO runtime_meta(key, value) VALUES ('schema_version', '1');

                CREATE TABLE IF NOT EXISTS runtime_sessions (
                    session_id TEXT PRIMARY KEY,
                    workspace_id TEXT NOT NULL,
                    workspace_fingerprint TEXT NOT NULL,
                    native_profile TEXT NOT NULL,
                    mapping_version TEXT NOT NULL,
                    owner_profile TEXT NOT NULL,
                    title TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runtime_runs (
                    run_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                    input_digest TEXT NOT NULL,
                    status TEXT NOT NULL,
                    terminal_reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS runtime_runs_session_idx
                    ON runtime_runs(session_id, created_at);

                CREATE TABLE IF NOT EXISTS native_session_bindings (
                    session_id TEXT PRIMARY KEY REFERENCES runtime_sessions(session_id),
                    native_session_id TEXT NOT NULL UNIQUE,
                    native_runtime_version TEXT NOT NULL,
                    native_contract_sha256 TEXT NOT NULL,
                    generation INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS native_run_bindings (
                    run_id TEXT PRIMARY KEY REFERENCES runtime_runs(run_id),
                    native_session_id TEXT NOT NULL,
                    native_message_id TEXT NOT NULL,
                    native_turn_id TEXT,
                    generation INTEGER NOT NULL,
                    source_waterline TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(native_session_id, native_message_id),
                    UNIQUE(native_session_id, native_turn_id)
                );

                CREATE TABLE IF NOT EXISTS native_item_bindings (
                    item_id TEXT NOT NULL,
                    run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                    native_kind TEXT NOT NULL,
                    native_item_id TEXT NOT NULL,
                    generation INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(run_id, native_kind, native_item_id)
                );

                CREATE TABLE IF NOT EXISTS native_session_waterlines (
                    native_session_id TEXT PRIMARY KEY,
                    last_source_sequence INTEGER NOT NULL CHECK(last_source_sequence >= -1),
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS native_open_turns (
                    native_session_id TEXT PRIMARY KEY,
                    native_turn_id TEXT NOT NULL,
                    generation INTEGER NOT NULL,
                    start_source_sequence INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS runtime_approvals (
                    approval_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                    run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                    item_id TEXT NOT NULL UNIQUE,
                    native_call_id TEXT,
                    tool_name TEXT NOT NULL,
                    reason TEXT,
                    state TEXT NOT NULL,
                    outcome TEXT,
                    generation INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS runtime_approvals_run_idx
                    ON runtime_approvals(run_id, state, created_at);

                CREATE TABLE IF NOT EXISTS control_operations (
                    operation_id TEXT PRIMARY KEY,
                    operation_kind TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    request_digest TEXT NOT NULL,
                    session_id TEXT,
                    run_id TEXT,
                    state TEXT NOT NULL,
                    generation INTEGER NOT NULL,
                    native_request_id TEXT,
                    result_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS control_operations_state_idx
                    ON control_operations(state, updated_at);

                CREATE TABLE IF NOT EXISTS oaep_session_sequences (
                    session_id TEXT PRIMARY KEY REFERENCES runtime_sessions(session_id),
                    last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence >= 0)
                );

                CREATE TABLE IF NOT EXISTS oaep_events (
                    session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                    sequence INTEGER NOT NULL CHECK(sequence >= 1),
                    event_id TEXT NOT NULL UNIQUE,
                    run_id TEXT,
                    item_id TEXT,
                    event_type TEXT NOT NULL,
                    dedupe_key TEXT NOT NULL,
                    payload_digest TEXT NOT NULL,
                    event_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(session_id, sequence),
                    UNIQUE(session_id, dedupe_key)
                );
                CREATE INDEX IF NOT EXISTS oaep_events_replay_idx
                    ON oaep_events(session_id, sequence);

                CREATE TABLE IF NOT EXISTS oaep_retention (
                    session_id TEXT PRIMARY KEY REFERENCES runtime_sessions(session_id),
                    expired_through INTEGER NOT NULL DEFAULT 0 CHECK(expired_through >= 0)
                );

                CREATE TABLE IF NOT EXISTS oaep_items (
                    item_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                    run_id TEXT NOT NULL REFERENCES runtime_runs(run_id),
                    item_type TEXT NOT NULL,
                    item_status TEXT NOT NULL,
                    item_sequence INTEGER NOT NULL CHECK(item_sequence >= 1),
                    revision INTEGER NOT NULL CHECK(revision >= 1),
                    event_sequence INTEGER NOT NULL CHECK(event_sequence >= 1),
                    item_json TEXT NOT NULL,
                    UNIQUE(run_id, item_sequence)
                );
                CREATE INDEX IF NOT EXISTS oaep_items_session_idx
                    ON oaep_items(session_id, run_id, item_sequence);
                """
            )
            version = self._db.execute(
                "SELECT value FROM runtime_meta WHERE key='schema_version'"
            ).fetchone()
            if version is None or version[0] != "1":
                raise RuntimeStoreError("store_schema_incompatible", "Runtime authority store schema is incompatible")
            columns = {row["name"] for row in self._db.execute("PRAGMA table_info(runtime_sessions)").fetchall()}
            if "title" not in columns:
                self._db.execute("ALTER TABLE runtime_sessions ADD COLUMN title TEXT")

    class _Transaction:
        def __init__(self, outer: "RuntimeAuthorityStore"):
            self.outer = outer

        def __enter__(self) -> None:
            self.outer._db.execute("BEGIN IMMEDIATE")

        def __exit__(self, exc_type, exc, traceback) -> None:
            self.outer._db.execute("COMMIT" if exc_type is None else "ROLLBACK")

    def _transaction(self) -> "RuntimeAuthorityStore._Transaction":
        return self._Transaction(self)

    def create_session(
        self,
        *,
        workspace_id: str,
        workspace_fingerprint: str,
        native_profile: str,
        mapping_version: str,
        owner_profile: str = "bridge",
        session_id: str | None = None,
    ) -> dict[str, Any]:
        if not all((workspace_id, workspace_fingerprint, native_profile, mapping_version)):
            raise RuntimeStoreError("session_invalid", "Session identity fields must be non-empty")
        if owner_profile != "bridge":
            raise RuntimeStoreError("session_owner_invalid", "P1 only supports bridge-owned Sessions")
        identity = session_id or f"session-{uuid.uuid4().hex}"
        now = _now()
        with self._lock, self._transaction():
            try:
                self._db.execute(
                    "INSERT INTO runtime_sessions(session_id,workspace_id,workspace_fingerprint,native_profile,"
                    "mapping_version,owner_profile,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                    (identity, workspace_id, workspace_fingerprint, native_profile, mapping_version,
                     owner_profile, "active", now, now),
                )
            except sqlite3.IntegrityError as exc:
                raise RuntimeStoreError("session_conflict", "Session identity already exists") from exc
        return self.require_session(identity)

    def require_session(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("session_not_found", "Session was not found")
        return value

    def update_session_title(self, session_id: str, title: str) -> dict[str, Any]:
        if not isinstance(title, str) or not title or len(title) > 1000:
            raise RuntimeStoreError("session_title_invalid", "Session title is invalid")
        with self._lock, self._transaction():
            if self._db.execute(
                "UPDATE runtime_sessions SET title=?,updated_at=? WHERE session_id=?",
                (title, _now(), session_id),
            ).rowcount != 1:
                raise RuntimeStoreError("session_not_found", "Session was not found")
        return self.require_session(session_id)

    def archive_session(self, session_id: str) -> dict[str, Any]:
        placeholders = ",".join("?" for _ in _ACTIVE_RUN_STATES)
        with self._lock, self._transaction():
            session = _row(self._db.execute(
                "SELECT * FROM runtime_sessions WHERE session_id=?", (session_id,)
            ).fetchone())
            if session is None:
                raise RuntimeStoreError("session_not_found", "Session was not found")
            if session["status"] == "archived":
                return session
            if session["status"] != "active":
                raise RuntimeStoreError("session_archive_invalid", "Session cannot be archived")
            active = self._db.execute(
                f"SELECT run_id FROM runtime_runs WHERE session_id=? AND status IN ({placeholders}) LIMIT 1",
                (session_id, *sorted(_ACTIVE_RUN_STATES)),
            ).fetchone()
            if active is not None:
                raise RuntimeStoreError("session_run_active", "Active Run must converge before archive")
            self._db.execute(
                "UPDATE runtime_sessions SET status='archived',updated_at=? WHERE session_id=?",
                (_now(), session_id),
            )
        return self.require_session(session_id)

    def bind_native_session(
        self,
        session_id: str,
        *,
        native_session_id: str,
        native_runtime_version: str,
        native_contract_sha256: str,
        generation: int,
    ) -> dict[str, Any]:
        if not native_session_id or not native_runtime_version or len(native_contract_sha256) != 64 or generation < 1:
            raise RuntimeStoreError("native_session_binding_invalid", "Native Session binding is invalid")
        session = self.require_session(session_id)
        if session["status"] != "active":
            raise RuntimeStoreError("session_not_active", "Native Session cannot bind to an inactive Session")
        now = _now()
        with self._lock, self._transaction():
            existing = _row(self._db.execute(
                "SELECT * FROM native_session_bindings WHERE session_id=?", (session_id,)
            ).fetchone())
            if existing is not None:
                expected = (
                    native_session_id,
                    native_runtime_version,
                    native_contract_sha256,
                )
                actual = (
                    existing["native_session_id"],
                    existing["native_runtime_version"],
                    existing["native_contract_sha256"],
                )
                if actual != expected:
                    raise RuntimeStoreError("native_session_binding_conflict", "Session is bound to another native identity")
                self._db.execute(
                    "UPDATE native_session_bindings SET generation=?,updated_at=? WHERE session_id=?",
                    (generation, now, session_id),
                )
            else:
                try:
                    self._db.execute(
                        "INSERT INTO native_session_bindings(session_id,native_session_id,native_runtime_version,"
                        "native_contract_sha256,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                        (session_id, native_session_id, native_runtime_version, native_contract_sha256,
                         generation, now, now),
                    )
                except sqlite3.IntegrityError as exc:
                    raise RuntimeStoreError(
                        "native_session_binding_conflict", "Native Session is already owned by another Session"
                    ) from exc
        return self.require_native_session_binding(session_id)

    def require_native_session_binding(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM native_session_bindings WHERE session_id=?", (session_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("native_session_unbound", "Session has no native binding")
        return value

    def resolve_native_session(self, native_session_id: str, *, generation: int) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM native_session_bindings WHERE native_session_id=?", (native_session_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("native_session_unknown", "Native Session is not bridge-owned")
        if value["generation"] != generation:
            raise RuntimeStoreError("native_generation_stale", "Native Session event belongs to a stale generation")
        return value

    def promote_session_generation(
        self,
        session_id: str,
        *,
        native_runtime_version: str,
        native_contract_sha256: str,
        new_generation: int,
    ) -> dict[str, Any]:
        """Fence recovered mutable bindings into a verified newer process generation."""

        with self._lock, self._transaction():
            binding = _row(self._db.execute(
                "SELECT * FROM native_session_bindings WHERE session_id=?", (session_id,)
            ).fetchone())
            if binding is None:
                raise RuntimeStoreError("native_session_unbound", "Session has no native binding")
            if (
                binding["native_runtime_version"] != native_runtime_version
                or binding["native_contract_sha256"] != native_contract_sha256
            ):
                raise RuntimeStoreError("native_recovery_profile_mismatch", "Recovered native profile changed")
            old_generation = int(binding["generation"])
            if new_generation < old_generation:
                raise RuntimeStoreError("native_generation_stale", "Recovery generation moved backwards")
            if new_generation == old_generation:
                return binding
            now = _now()
            self._db.execute(
                "UPDATE native_session_bindings SET generation=?,updated_at=? WHERE session_id=?",
                (new_generation, now, session_id),
            )
            self._db.execute(
                "UPDATE native_run_bindings SET generation=?,updated_at=? WHERE native_session_id=? "
                "AND run_id IN (SELECT run_id FROM runtime_runs WHERE status NOT IN ('completed','failed','cancelled'))",
                (new_generation, now, binding["native_session_id"]),
            )
            self._db.execute(
                "UPDATE native_open_turns SET generation=? WHERE native_session_id=?",
                (new_generation, binding["native_session_id"]),
            )
            self._db.execute(
                "UPDATE runtime_approvals SET generation=?,updated_at=? WHERE session_id=? AND state='pending'",
                (new_generation, now, session_id),
            )
        return self.require_native_session_binding(session_id)

    def create_run(self, session_id: str, *, input_digest: str, run_id: str | None = None) -> dict[str, Any]:
        if len(input_digest) != 64:
            raise RuntimeStoreError("run_input_digest_invalid", "Run input digest must be SHA-256")
        session = self.require_session(session_id)
        if session["status"] != "active":
            raise RuntimeStoreError("session_not_active", "Run cannot be created in an inactive Session")
        identity = run_id or f"run-{uuid.uuid4().hex}"
        now = _now()
        placeholders = ",".join("?" for _ in _ACTIVE_RUN_STATES)
        with self._lock, self._transaction():
            active = self._db.execute(
                f"SELECT run_id FROM runtime_runs WHERE session_id=? AND status IN ({placeholders}) LIMIT 1",
                (session_id, *sorted(_ACTIVE_RUN_STATES)),
            ).fetchone()
            if active is not None:
                raise RuntimeStoreError("session_run_active", "Session already has an active root Run")
            try:
                self._db.execute(
                    "INSERT INTO runtime_runs(run_id,session_id,input_digest,status,created_at,updated_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (identity, session_id, input_digest, "queued", now, now),
                )
            except sqlite3.IntegrityError as exc:
                raise RuntimeStoreError("run_conflict", "Run identity already exists") from exc
        return self.require_run(identity)

    def require_run(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("run_not_found", "Run was not found")
        return value

    def transition_run(self, run_id: str, status: str, *, reason: str | None = None) -> dict[str, Any]:
        with self._lock, self._transaction():
            current = _row(self._db.execute(
                "SELECT * FROM runtime_runs WHERE run_id=?", (run_id,)
            ).fetchone())
            if current is None:
                raise RuntimeStoreError("run_not_found", "Run was not found")
            if current["status"] in _TERMINAL_RUN_STATES:
                if current["status"] == status and current["terminal_reason"] == reason:
                    return current
                raise RuntimeStoreError("run_terminal_conflict", "Run already has a different terminal state")
            if status not in _RUN_TRANSITIONS.get(current["status"], frozenset()):
                raise RuntimeStoreError("run_transition_invalid", "Run state transition is invalid")
            terminal_reason = reason if status in _TERMINAL_RUN_STATES else None
            self._db.execute(
                "UPDATE runtime_runs SET status=?,terminal_reason=?,updated_at=? WHERE run_id=?",
                (status, terminal_reason, _now(), run_id),
            )
        return self.require_run(run_id)

    def bind_native_run(
        self,
        run_id: str,
        *,
        native_message_id: str,
        generation: int,
    ) -> dict[str, Any]:
        run = self.require_run(run_id)
        session_binding = self.require_native_session_binding(run["session_id"])
        if not native_message_id or generation < 1:
            raise RuntimeStoreError("native_run_binding_invalid", "Native Run binding is invalid")
        if generation != session_binding["generation"]:
            raise RuntimeStoreError("native_generation_stale", "Native Run receipt belongs to a stale generation")
        now = _now()
        with self._lock, self._transaction():
            existing = _row(self._db.execute(
                "SELECT * FROM native_run_bindings WHERE run_id=?", (run_id,)
            ).fetchone())
            if existing is not None:
                if existing["native_message_id"] != native_message_id or existing["generation"] != generation:
                    raise RuntimeStoreError("native_run_binding_conflict", "Run is bound to another native receipt")
                return existing
            try:
                self._db.execute(
                    "INSERT INTO native_run_bindings(run_id,native_session_id,native_message_id,generation,"
                    "created_at,updated_at) VALUES(?,?,?,?,?,?)",
                    (run_id, session_binding["native_session_id"], native_message_id, generation, now, now),
                )
            except sqlite3.IntegrityError as exc:
                raise RuntimeStoreError("native_run_binding_conflict", "Native receipt is already bound") from exc
        return self.require_native_run_binding(run_id)

    def claim_native_turn(self, run_id: str, *, native_turn_id: str, generation: int) -> dict[str, Any]:
        if not native_turn_id:
            raise RuntimeStoreError("native_turn_invalid", "Native Turn id must be non-empty")
        with self._lock, self._transaction():
            binding = _row(self._db.execute(
                "SELECT * FROM native_run_bindings WHERE run_id=?", (run_id,)
            ).fetchone())
            if binding is None:
                raise RuntimeStoreError("native_run_unbound", "Run has no native receipt")
            if binding["generation"] != generation:
                raise RuntimeStoreError("native_generation_stale", "Native Turn belongs to a stale generation")
            if binding["native_turn_id"] is not None and binding["native_turn_id"] != native_turn_id:
                raise RuntimeStoreError("native_turn_conflict", "Run is already bound to another native Turn")
            try:
                self._db.execute(
                    "UPDATE native_run_bindings SET native_turn_id=?,updated_at=? WHERE run_id=?",
                    (native_turn_id, _now(), run_id),
                )
            except sqlite3.IntegrityError as exc:
                raise RuntimeStoreError("native_turn_conflict", "Native Turn is already bound") from exc
        return self.require_native_run_binding(run_id)

    def require_native_run_binding(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM native_run_bindings WHERE run_id=?", (run_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("native_run_unbound", "Run has no native binding")
        return value

    def resolve_native_run(
        self,
        *,
        native_session_id: str,
        generation: int,
        native_message_id: str | None = None,
        native_turn_id: str | None = None,
    ) -> dict[str, Any]:
        if (native_message_id is None) == (native_turn_id is None):
            raise RuntimeStoreError("native_run_lookup_invalid", "Exactly one native Run identity is required")
        column, identity = (
            ("native_message_id", native_message_id)
            if native_message_id is not None else ("native_turn_id", native_turn_id)
        )
        with self._lock:
            value = _row(self._db.execute(
                f"SELECT * FROM native_run_bindings WHERE native_session_id=? AND {column}=?",
                (native_session_id, identity),
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("native_run_unknown", "Native fact does not belong to a bound Run")
        if value["generation"] != generation:
            raise RuntimeStoreError("native_generation_stale", "Native Run fact belongs to a stale generation")
        return value

    def resolve_active_native_run(self, native_session_id: str, *, generation: int) -> dict[str, Any]:
        with self._lock:
            rows = self._db.execute(
                "SELECT b.* FROM native_run_bindings b JOIN runtime_runs r ON r.run_id=b.run_id "
                "WHERE b.native_session_id=? AND b.generation=? AND b.native_turn_id IS NOT NULL "
                "AND r.status IN ('running','waiting')",
                (native_session_id, generation),
            ).fetchall()
        if len(rows) != 1:
            raise RuntimeStoreError("native_active_run_ambiguous", "Native approval has no unique active Run")
        return dict(rows[0])

    def open_native_turn(
        self, native_session_id: str, *, native_turn_id: str, generation: int, source_sequence: int
    ) -> dict[str, Any]:
        self.resolve_native_session(native_session_id, generation=generation)
        with self._lock, self._transaction():
            existing = _row(self._db.execute(
                "SELECT * FROM native_open_turns WHERE native_session_id=?", (native_session_id,)
            ).fetchone())
            if existing is not None:
                expected = (native_turn_id, generation, source_sequence)
                actual = (
                    existing["native_turn_id"], existing["generation"], existing["start_source_sequence"]
                )
                if actual != expected:
                    raise RuntimeStoreError("native_turn_overlap", "Native Session already has another open Turn")
                return existing
            self._db.execute(
                "INSERT INTO native_open_turns(native_session_id,native_turn_id,generation,start_source_sequence,created_at) "
                "VALUES(?,?,?,?,?)",
                (native_session_id, native_turn_id, generation, source_sequence, _now()),
            )
        with self._lock:
            return dict(self._db.execute(
                "SELECT * FROM native_open_turns WHERE native_session_id=?", (native_session_id,)
            ).fetchone())

    def claim_open_native_turn(
        self, native_session_id: str, *, native_message_id: str, generation: int
    ) -> dict[str, Any]:
        with self._lock, self._transaction():
            opened = _row(self._db.execute(
                "SELECT * FROM native_open_turns WHERE native_session_id=?", (native_session_id,)
            ).fetchone())
            if opened is None:
                raise RuntimeStoreError("native_turn_not_open", "Native user message has no open Turn")
            if opened["generation"] != generation:
                raise RuntimeStoreError("native_generation_stale", "Open Turn belongs to a stale generation")
            binding = _row(self._db.execute(
                "SELECT * FROM native_run_bindings WHERE native_session_id=? AND native_message_id=?",
                (native_session_id, native_message_id),
            ).fetchone())
            if binding is None or binding["generation"] != generation:
                raise RuntimeStoreError("native_run_unknown", "Claimed message does not belong to a bound Run")
            if binding["native_turn_id"] not in (None, opened["native_turn_id"]):
                raise RuntimeStoreError("native_turn_conflict", "Run is bound to another native Turn")
            try:
                self._db.execute(
                    "UPDATE native_run_bindings SET native_turn_id=?,updated_at=? WHERE run_id=?",
                    (opened["native_turn_id"], _now(), binding["run_id"]),
                )
            except sqlite3.IntegrityError as exc:
                raise RuntimeStoreError("native_turn_conflict", "Native Turn is already bound") from exc
            self._db.execute(
                "DELETE FROM native_open_turns WHERE native_session_id=?", (native_session_id,)
            )
            binding["native_turn_id"] = opened["native_turn_id"]
            return binding

    def bind_native_item(
        self,
        run_id: str,
        *,
        item_id: str,
        native_kind: str,
        native_item_id: str,
        generation: int,
    ) -> dict[str, Any]:
        if not item_id or not native_kind or not native_item_id or generation < 1:
            raise RuntimeStoreError("native_item_binding_invalid", "Native Item binding is invalid")
        run_binding = self.require_native_run_binding(run_id)
        if run_binding["generation"] != generation:
            raise RuntimeStoreError("native_generation_stale", "Native Item belongs to a stale generation")
        now = _now()
        with self._lock, self._transaction():
            existing = _row(self._db.execute(
                "SELECT * FROM native_item_bindings WHERE run_id=? AND native_kind=? AND native_item_id=?",
                (run_id, native_kind, native_item_id),
            ).fetchone())
            if existing is not None:
                if existing["item_id"] != item_id or existing["generation"] != generation:
                    raise RuntimeStoreError("native_item_binding_conflict", "Native Item has another binding")
                return existing
            self._db.execute(
                    "INSERT INTO native_item_bindings(item_id,run_id,native_kind,native_item_id,generation,created_at) "
                    "VALUES(?,?,?,?,?,?)",
                    (item_id, run_id, native_kind, native_item_id, generation, now),
                )
        with self._lock:
            return dict(self._db.execute(
                "SELECT * FROM native_item_bindings WHERE run_id=? AND native_kind=? AND native_item_id=?",
                (run_id, native_kind, native_item_id),
            ).fetchone())

    def resolve_native_item(self, run_id: str, *, native_kind: str, native_item_id: str) -> dict[str, Any] | None:
        with self._lock:
            return _row(self._db.execute(
                "SELECT * FROM native_item_bindings WHERE run_id=? AND native_kind=? AND native_item_id=?",
                (run_id, native_kind, native_item_id),
            ).fetchone())

    def next_item_sequence(self, run_id: str) -> int:
        self.require_run(run_id)
        with self._lock:
            row = self._db.execute(
                "SELECT COALESCE(MAX(item_sequence),0) AS value FROM oaep_items WHERE run_id=?", (run_id,)
            ).fetchone()
            return int(row["value"]) + 1

    def unsettled_side_effect_items(self, session_id: str) -> list[dict[str, Any]]:
        """Return tool calls whose result is unknown; callers must never replay them."""
        self.require_session(session_id)
        with self._lock:
            rows = self._db.execute(
                "SELECT item_json FROM oaep_items WHERE session_id=? AND item_type='tool_call' "
                "AND item_status IN ('pending','running','waiting') ORDER BY event_sequence,item_id",
                (session_id,),
            ).fetchall()
        return [json.loads(row["item_json"]) for row in rows]

    def check_native_source_sequence(self, native_session_id: str, sequence: int) -> str:
        if sequence < 0:
            raise RuntimeStoreError("native_sequence_invalid", "Native source sequence is invalid")
        with self._lock:
            row = self._db.execute(
                "SELECT last_source_sequence FROM native_session_waterlines WHERE native_session_id=?",
                (native_session_id,),
            ).fetchone()
        last = int(row["last_source_sequence"]) if row else -1
        if sequence <= last:
            return "replay"
        if sequence != last + 1:
            raise RuntimeStoreError("native_sequence_gap", "Native source sequence is discontinuous")
        return "next"

    def accept_native_source_sequence(self, native_session_id: str, sequence: int) -> bool:
        """Advance a contiguous native cursor; return False for an exact replay."""

        if sequence < 0:
            raise RuntimeStoreError("native_sequence_invalid", "Native source sequence is invalid")
        with self._lock, self._transaction():
            row = self._db.execute(
                "SELECT last_source_sequence FROM native_session_waterlines WHERE native_session_id=?",
                (native_session_id,),
            ).fetchone()
            last = int(row["last_source_sequence"]) if row else -1
            if sequence <= last:
                return False
            if sequence != last + 1:
                raise RuntimeStoreError("native_sequence_gap", "Native source sequence is discontinuous")
            self._db.execute(
                "INSERT INTO native_session_waterlines(native_session_id,last_source_sequence,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(native_session_id) DO UPDATE SET last_source_sequence=excluded.last_source_sequence,"
                "updated_at=excluded.updated_at",
                (native_session_id, sequence, _now()),
            )
        return True

    def create_approval(
        self,
        *,
        approval_id: str,
        session_id: str,
        run_id: str,
        item_id: str,
        tool_name: str,
        generation: int,
        native_call_id: str | None = None,
        reason: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        if not approval_id or not item_id or not tool_name or generation < 1:
            raise RuntimeStoreError("approval_invalid", "Approval identity is invalid")
        run = self.require_run(run_id)
        if run["session_id"] != session_id or run["status"] not in {"running", "waiting"}:
            raise RuntimeStoreError("approval_run_invalid", "Approval does not belong to an active Run")
        now = _now()
        with self._lock, self._transaction():
            existing = _row(self._db.execute(
                "SELECT * FROM runtime_approvals WHERE approval_id=?", (approval_id,)
            ).fetchone())
            if existing is not None:
                expected = (session_id, run_id, item_id, native_call_id, tool_name, reason, generation)
                actual = tuple(existing[name] for name in (
                    "session_id", "run_id", "item_id", "native_call_id", "tool_name", "reason", "generation"
                ))
                if actual != expected:
                    raise RuntimeStoreError("approval_conflict", "Approval id has another binding")
                return existing, False
            self._db.execute(
                "INSERT INTO runtime_approvals(approval_id,session_id,run_id,item_id,native_call_id,tool_name,"
                "reason,state,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (approval_id, session_id, run_id, item_id, native_call_id, tool_name, reason,
                 "pending", generation, now, now),
            )
        return self.require_approval(approval_id), True

    def require_approval(self, approval_id: str) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM runtime_approvals WHERE approval_id=?", (approval_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("approval_not_found", "Approval was not found")
        return value

    def answer_approval(self, approval_id: str, outcome: str) -> tuple[dict[str, Any], bool]:
        if outcome not in {"allowed-once", "rejected", "cancelled", "unavailable"}:
            raise RuntimeStoreError("approval_outcome_invalid", "Approval outcome is invalid")
        with self._lock, self._transaction():
            approval = _row(self._db.execute(
                "SELECT * FROM runtime_approvals WHERE approval_id=?", (approval_id,)
            ).fetchone())
            if approval is None:
                raise RuntimeStoreError("approval_not_found", "Approval was not found")
            if approval["state"] == "answered":
                if approval["outcome"] == outcome:
                    return approval, False
                raise RuntimeStoreError("approval_already_answered", "First approval answer already won")
            if approval["state"] != "pending":
                raise RuntimeStoreError("approval_not_pending", "Approval is no longer pending")
            self._db.execute(
                "UPDATE runtime_approvals SET state='answered',outcome=?,updated_at=? WHERE approval_id=?",
                (outcome, _now(), approval_id),
            )
        return self.require_approval(approval_id), True

    def pending_approvals(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM runtime_approvals WHERE state='pending' ORDER BY created_at,approval_id"
            ).fetchall()
        return [dict(row) for row in rows]

    def run_has_pending_approvals(self, run_id: str) -> bool:
        with self._lock:
            return self._db.execute(
                "SELECT 1 FROM runtime_approvals WHERE run_id=? AND state='pending' LIMIT 1", (run_id,)
            ).fetchone() is not None

    def prepare_operation(
        self,
        *,
        operation_kind: str,
        idempotency_key: str,
        request_digest: str,
        generation: int,
        session_id: str | None = None,
        run_id: str | None = None,
        operation_id: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        if not operation_kind or not idempotency_key or len(request_digest) != 64 or generation < 1:
            raise RuntimeStoreError("operation_invalid", "Control operation identity is invalid")
        identity = operation_id or f"operation-{uuid.uuid4().hex}"
        now = _now()
        with self._lock, self._transaction():
            existing = _row(self._db.execute(
                "SELECT * FROM control_operations WHERE idempotency_key=?", (idempotency_key,)
            ).fetchone())
            if existing is not None:
                expected = (operation_kind, request_digest, session_id, run_id)
                actual = (
                    existing["operation_kind"], existing["request_digest"],
                    existing["session_id"], existing["run_id"],
                )
                if actual != expected:
                    raise RuntimeStoreError("idempotency_conflict", "Idempotency key was used for another request")
                # Use the public decoder so completed replay includes its
                # structured result rather than leaking the JSON storage form.
                return self.require_operation(existing["operation_id"]), False
            self._db.execute(
                "INSERT INTO control_operations(operation_id,operation_kind,idempotency_key,request_digest,"
                "session_id,run_id,state,generation,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (identity, operation_kind, idempotency_key, request_digest, session_id, run_id,
                 "prepared", generation, now, now),
            )
        return self.require_operation(identity), True

    def require_operation(self, operation_id: str) -> dict[str, Any]:
        with self._lock:
            value = _row(self._db.execute(
                "SELECT * FROM control_operations WHERE operation_id=?", (operation_id,)
            ).fetchone())
        if value is None:
            raise RuntimeStoreError("operation_not_found", "Control operation was not found")
        if value.get("result_json"):
            value["result"] = json.loads(value["result_json"])
        return value

    def transition_operation(
        self,
        operation_id: str,
        state: str,
        *,
        native_request_id: str | None = None,
        result: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock, self._transaction():
            current = _row(self._db.execute(
                "SELECT * FROM control_operations WHERE operation_id=?", (operation_id,)
            ).fetchone())
            if current is None:
                raise RuntimeStoreError("operation_not_found", "Control operation was not found")
            if current["state"] == "completed":
                if state == "completed":
                    return self.require_operation(operation_id)
                raise RuntimeStoreError("operation_completed", "Control operation is already complete")
            if state not in _OPERATION_TRANSITIONS.get(current["state"], frozenset()):
                raise RuntimeStoreError("operation_transition_invalid", "Control operation transition is invalid")
            result_json = None
            if result is not None:
                try:
                    result_json = json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True)
                except (TypeError, ValueError) as exc:
                    raise RuntimeStoreError("operation_result_invalid", "Operation result is not JSON serializable") from exc
            self._db.execute(
                "UPDATE control_operations SET state=?,native_request_id=COALESCE(?,native_request_id),"
                "result_json=COALESCE(?,result_json),updated_at=? WHERE operation_id=?",
                (state, native_request_id, result_json, _now(), operation_id),
            )
        return self.require_operation(operation_id)

    def unresolved_operations(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM control_operations WHERE state != 'completed' ORDER BY created_at,operation_id"
            ).fetchall()
        return [dict(row) for row in rows]
