"""Durable, Session-scoped conversation journal owned by the Agent Runtime."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from drsai.relay.security import redact_secrets


SESSION_EVENT_KINDS = {
    "session.updated",
    "run.created",
    "run.state.changed",
    "conversation.item.created",
    "conversation.item.delta",
    "conversation.item.upsert",
    "tool.state.changed",
    "approval.created",
    "approval.decided",
    "artifact.created",
    "session.archived",
    "session.removed",
}
CONVERSATION_ITEM_KINDS = {
    "message",
    "reasoning",
    "tool",
    "approval",
    "artifact",
    "error",
}
CONVERSATION_ROLES = {"user", "assistant", "system", "tool", None}
SOURCE_CLIENTS = {"windows", "android", "runtime"}
_SECRET_KEY = re.compile(
    r"(?i)^(?:authorization|cookie|token|secret|password|private_?key|api_?key|"
    r"access_?token|refresh_?token|id_?token|client_?secret|registration_?token|"
    r"access_?grant_?code)$"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redact_credentials(value: Any, key: str = "") -> Any:
    if _SECRET_KEY.fullmatch(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {
            str(child_key): _redact_credentials(child, str(child_key))
            for child_key, child in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact_credentials(item) for item in value]
    if isinstance(value, str):
        redacted = redact_secrets(value)
        while "[REDACTED]]" in redacted:
            redacted = redacted.replace("[REDACTED]]", "[REDACTED]")
        return redacted
    return value


def _canonical_json(value: Any) -> str:
    safe = _redact_credentials(value)
    return json.dumps(safe, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class SessionCursorExpired(ValueError):
    def __init__(
        self,
        *,
        runtime_id: str,
        workspace_id: str,
        session_id: str,
        requested_sequence: int,
        earliest_sequence: int,
        latest_sequence: int,
    ) -> None:
        super().__init__("Session Event cursor is older than retained history")
        self.details = {
            "reason": "history_truncated",
            "requested_sequence": requested_sequence,
            "earliest_sequence": earliest_sequence,
            "latest_sequence": latest_sequence,
            "runtime_id": runtime_id,
            "workspace_id": workspace_id,
            "session_id": session_id,
        }


class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class RuntimeConversationJournal:
    """Append-first Session events plus a deterministic current-item projection."""

    def __init__(self, database: Path, runtime_id: str):
        self.database = Path(database)
        self.runtime_id = runtime_id
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._changed = threading.Condition(self._lock)
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
                CREATE TABLE IF NOT EXISTS runtime_session_sequences (
                  session_id TEXT PRIMARY KEY REFERENCES runtime_sessions(session_id),
                  last_sequence INTEGER NOT NULL DEFAULT 0,
                  earliest_retained_sequence INTEGER NOT NULL DEFAULT 1,
                  checkpoint_sequence INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS runtime_session_journal (
                  event_id TEXT PRIMARY KEY,
                  runtime_id TEXT NOT NULL,
                  workspace_id TEXT NOT NULL,
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  run_id TEXT REFERENCES runtime_runs(run_id),
                  session_sequence INTEGER NOT NULL,
                  event_kind TEXT NOT NULL,
                  item_id TEXT,
                  item_revision INTEGER,
                  dedupe_key TEXT,
                  payload_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  UNIQUE(session_id, session_sequence)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_session_journal_dedupe
                  ON runtime_session_journal(session_id, dedupe_key)
                  WHERE dedupe_key IS NOT NULL;
                CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_session_journal_item_revision
                  ON runtime_session_journal(session_id, item_id, item_revision)
                  WHERE item_id IS NOT NULL AND item_revision IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_runtime_session_journal_replay
                  ON runtime_session_journal(session_id, session_sequence);
                CREATE TABLE IF NOT EXISTS runtime_conversation_items (
                  item_id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  run_id TEXT REFERENCES runtime_runs(run_id),
                  item_kind TEXT NOT NULL,
                  role TEXT,
                  revision INTEGER NOT NULL,
                  latest_sequence INTEGER NOT NULL,
                  source_client TEXT NOT NULL,
                  source_message_id TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  payload_json TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_conversation_source_message
                  ON runtime_conversation_items(session_id, source_client, source_message_id)
                  WHERE source_message_id IS NOT NULL;
                CREATE INDEX IF NOT EXISTS idx_runtime_conversation_snapshot
                  ON runtime_conversation_items(session_id, latest_sequence, item_id);
                CREATE TABLE IF NOT EXISTS runtime_session_journal_checkpoints (
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  checkpoint_sequence INTEGER NOT NULL,
                  snapshot_hash TEXT NOT NULL,
                  item_count INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(session_id, checkpoint_sequence)
                );
                CREATE TABLE IF NOT EXISTS runtime_session_journal_maintenance (
                  singleton INTEGER PRIMARY KEY CHECK(singleton=1)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_session_journal_no_update
                  BEFORE UPDATE ON runtime_session_journal
                  BEGIN SELECT RAISE(ABORT, 'Runtime Session Journal is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS runtime_session_journal_no_delete
                  BEFORE DELETE ON runtime_session_journal
                  WHEN NOT EXISTS (
                    SELECT 1 FROM runtime_session_journal_maintenance WHERE singleton=1
                  )
                  BEGIN SELECT RAISE(ABORT, 'Runtime Session Journal is append-only'); END;
                """
            )

    @staticmethod
    def _session(db: sqlite3.Connection, session_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT session_id,workspace_id FROM runtime_sessions WHERE session_id=?",
            (session_id,),
        ).fetchone()
        if row is None:
            raise KeyError("Session not found")
        return row

    @staticmethod
    def _validate_run(
        db: sqlite3.Connection, session_id: str, run_id: str | None
    ) -> None:
        if run_id is None:
            return
        row = db.execute(
            "SELECT session_id FROM runtime_runs WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if row is None:
            raise KeyError("Run not found")
        if str(row["session_id"]) != session_id:
            raise ValueError("Run belongs to another Session")

    @staticmethod
    def _next_sequence(db: sqlite3.Connection, session_id: str) -> int:
        db.execute(
            "INSERT OR IGNORE INTO runtime_session_sequences(session_id) VALUES(?)",
            (session_id,),
        )
        row = db.execute(
            "SELECT last_sequence FROM runtime_session_sequences WHERE session_id=?",
            (session_id,),
        ).fetchone()
        sequence = int(row["last_sequence"]) + 1
        db.execute(
            "UPDATE runtime_session_sequences SET last_sequence=? WHERE session_id=?",
            (sequence, session_id),
        )
        return sequence

    def append_event(
        self,
        session_id: str,
        kind: str,
        payload: dict[str, Any],
        *,
        run_id: str | None = None,
        dedupe_key: str | None = None,
        created_at: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        if kind not in SESSION_EVENT_KINDS:
            raise ValueError(f"Unknown Session Event kind: {kind}")
        if dedupe_key is not None and (not dedupe_key or len(dedupe_key) > 500):
            raise ValueError("Session Event dedupe key is invalid")
        with self._changed, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            event, created = self.append_event_in_transaction(
                db,
                session_id,
                kind,
                payload,
                run_id=run_id,
                dedupe_key=dedupe_key,
                created_at=created_at,
            )
            db.commit()
            if created:
                self._changed.notify_all()
        return event, created

    def append_event_in_transaction(
        self,
        db: sqlite3.Connection,
        session_id: str,
        kind: str,
        payload: dict[str, Any],
        *,
        run_id: str | None = None,
        dedupe_key: str | None = None,
        created_at: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Append using the caller's open write transaction."""
        if kind not in SESSION_EVENT_KINDS:
            raise ValueError(f"Unknown Session Event kind: {kind}")
        if dedupe_key is not None and (not dedupe_key or len(dedupe_key) > 500):
            raise ValueError("Session Event dedupe key is invalid")
        encoded = _canonical_json(payload)
        session = self._session(db, session_id)
        self._validate_run(db, session_id, run_id)
        if dedupe_key is not None:
            existing = db.execute(
                "SELECT * FROM runtime_session_journal "
                "WHERE session_id=? AND dedupe_key=?",
                (session_id, dedupe_key),
            ).fetchone()
            if existing is not None:
                if (
                    str(existing["event_kind"]) != kind
                    or (existing["run_id"] or None) != run_id
                    or str(existing["payload_json"]) != encoded
                ):
                    raise ValueError(
                        "Session Event dedupe key is bound to different semantics"
                    )
                return self._event(existing), False
        sequence = self._next_sequence(db, session_id)
        event_id = f"se-{uuid.uuid4()}"
        timestamp = created_at or _now()
        db.execute(
            "INSERT INTO runtime_session_journal("
            "event_id,runtime_id,workspace_id,session_id,run_id,session_sequence,"
            "event_kind,item_id,item_revision,dedupe_key,payload_json,created_at"
            ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                event_id,
                self.runtime_id,
                str(session["workspace_id"]),
                session_id,
                run_id,
                sequence,
                kind,
                None,
                None,
                dedupe_key,
                encoded,
                timestamp,
            ),
        )
        row = db.execute(
            "SELECT * FROM runtime_session_journal WHERE event_id=?",
            (event_id,),
        ).fetchone()
        return self._event(row), True

    def notify_committed(self) -> None:
        """Wake local subscribers after a caller-owned transaction commits."""
        with self._changed:
            self._changed.notify_all()

    def upsert_item(
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
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any], bool]:
        with self._changed, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            item, event, created = self.upsert_item_in_transaction(
                db,
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
                created_at=created_at,
                updated_at=updated_at,
            )
            db.commit()
            if created:
                self._changed.notify_all()
        return item, event, created

    def upsert_item_in_transaction(
        self,
        db: sqlite3.Connection,
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
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any], bool]:
        """Upsert an Item and append its event in the caller's transaction."""
        if not item_id or len(item_id) > 500:
            raise ValueError("Conversation Item id is invalid")
        if kind not in CONVERSATION_ITEM_KINDS:
            raise ValueError(f"Unknown Conversation Item kind: {kind}")
        if role not in CONVERSATION_ROLES:
            raise ValueError(f"Unknown Conversation role: {role}")
        if source_client not in SOURCE_CLIENTS:
            raise ValueError(f"Unknown Conversation source client: {source_client}")
        if revision < 1:
            raise ValueError("Conversation Item revision must be positive")
        if source_message_id is not None and (
            not source_message_id or len(source_message_id) > 500
        ):
            raise ValueError("Conversation source message id is invalid")
        encoded = _canonical_json(payload)
        session = self._session(db, session_id)
        self._validate_run(db, session_id, run_id)
        if source_message_id is not None:
            existing_source = db.execute(
                "SELECT * FROM runtime_conversation_items "
                "WHERE session_id=? AND source_client=? AND source_message_id=?",
                (session_id, source_client, source_message_id),
            ).fetchone()
            if (
                existing_source is not None
                and str(existing_source["item_id"]) != item_id
            ):
                raise ValueError(
                    "Source message id is bound to another Conversation Item"
                )
        existing = db.execute(
            "SELECT * FROM runtime_conversation_items WHERE item_id=?",
            (item_id,),
        ).fetchone()
        if existing is not None:
            if str(existing["session_id"]) != session_id:
                raise ValueError("Conversation Item belongs to another Session")
            if int(existing["revision"]) > revision:
                raise ValueError("Conversation Item revision cannot go backwards")
            same = (
                int(existing["revision"]) == revision
                and (existing["run_id"] or None) == run_id
                and str(existing["item_kind"]) == kind
                and (existing["role"] or None) == role
                and str(existing["source_client"]) == source_client
                and (existing["source_message_id"] or None) == source_message_id
                and str(existing["payload_json"]) == encoded
            )
            if int(existing["revision"]) == revision and not same:
                raise ValueError(
                    "Conversation Item revision is bound to different semantics"
                )
            if same:
                event = db.execute(
                    "SELECT * FROM runtime_session_journal "
                    "WHERE session_id=? AND item_id=? AND item_revision=?",
                    (session_id, item_id, revision),
                ).fetchone()
                return self._item(existing), self._event(event), False
        sequence = self._next_sequence(db, session_id)
        timestamp = updated_at or _now()
        created = (
            str(existing["created_at"])
            if existing is not None
            else (created_at or timestamp)
        )
        selected_event_kind = event_kind or (
            "conversation.item.created"
            if existing is None
            else "conversation.item.upsert"
        )
        if selected_event_kind not in {
            "conversation.item.created",
            "conversation.item.delta",
            "conversation.item.upsert",
        }:
            raise ValueError("Conversation Item event kind is invalid")
        event_id = f"se-{uuid.uuid4()}"
        event_payload = {
            "item_id": item_id,
            "revision": revision,
            "kind": kind,
            "role": role,
            "source_client": source_client,
            "source_message_id": source_message_id,
            "created_at": created,
            "updated_at": timestamp,
            "payload": json.loads(encoded),
        }
        db.execute(
            "INSERT INTO runtime_session_journal("
            "event_id,runtime_id,workspace_id,session_id,run_id,session_sequence,"
            "event_kind,item_id,item_revision,dedupe_key,payload_json,created_at"
            ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                event_id,
                self.runtime_id,
                str(session["workspace_id"]),
                session_id,
                run_id,
                sequence,
                selected_event_kind,
                item_id,
                revision,
                None,
                _canonical_json(event_payload),
                timestamp,
            ),
        )
        db.execute(
            """
            INSERT INTO runtime_conversation_items(
              item_id,session_id,run_id,item_kind,role,revision,latest_sequence,
              source_client,source_message_id,created_at,updated_at,payload_json
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(item_id) DO UPDATE SET
              run_id=excluded.run_id,item_kind=excluded.item_kind,role=excluded.role,
              revision=excluded.revision,latest_sequence=excluded.latest_sequence,
              source_client=excluded.source_client,
              source_message_id=excluded.source_message_id,
              updated_at=excluded.updated_at,payload_json=excluded.payload_json
            """,
            (
                item_id,
                session_id,
                run_id,
                kind,
                role,
                revision,
                sequence,
                source_client,
                source_message_id,
                created,
                timestamp,
                encoded,
            ),
        )
        item_row = db.execute(
            "SELECT * FROM runtime_conversation_items WHERE item_id=?",
            (item_id,),
        ).fetchone()
        event_row = db.execute(
            "SELECT * FROM runtime_session_journal WHERE event_id=?",
            (event_id,),
        ).fetchone()
        return self._item(item_row), self._event(event_row), True

    def snapshot(self, session_id: str) -> dict[str, Any]:
        with self._connect() as db:
            db.execute("BEGIN")
            self._session(db, session_id)
            state = db.execute(
                "SELECT last_sequence FROM runtime_session_sequences WHERE session_id=?",
                (session_id,),
            ).fetchone()
            watermark = int(state["last_sequence"]) if state is not None else 0
            rows = db.execute(
                "SELECT * FROM runtime_conversation_items "
                "WHERE session_id=? AND latest_sequence<=? "
                "ORDER BY latest_sequence,item_id",
                (session_id, watermark),
            ).fetchall()
            db.commit()
        return {
            "session_id": session_id,
            "snapshot_sequence": watermark,
            "items": [self._item(row) for row in rows],
            "next_cursor": None,
        }

    def replay(
        self,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        if after_sequence < 0:
            raise ValueError("after_sequence cannot be negative")
        if not 1 <= limit <= 2000:
            raise ValueError("Session Event limit must be between 1 and 2000")
        with self._connect() as db:
            session = self._session(db, session_id)
            state = db.execute(
                "SELECT * FROM runtime_session_sequences WHERE session_id=?",
                (session_id,),
            ).fetchone()
            latest = int(state["last_sequence"]) if state is not None else 0
            earliest = (
                int(state["earliest_retained_sequence"]) if state is not None else 1
            )
            if after_sequence < earliest - 1:
                raise SessionCursorExpired(
                    runtime_id=self.runtime_id,
                    workspace_id=str(session["workspace_id"]),
                    session_id=session_id,
                    requested_sequence=after_sequence,
                    earliest_sequence=earliest,
                    latest_sequence=latest,
                )
            rows = db.execute(
                "SELECT * FROM runtime_session_journal "
                "WHERE session_id=? AND session_sequence>? "
                "ORDER BY session_sequence LIMIT ?",
                (session_id, after_sequence, limit),
            ).fetchall()
        return [self._event(row) for row in rows]

    def wait_for_events(
        self,
        session_id: str,
        *,
        after_sequence: int,
        timeout: float = 15.0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        deadline = time.monotonic() + max(0.0, timeout)
        with self._changed:
            while True:
                events = self.replay(
                    session_id,
                    after_sequence=after_sequence,
                    limit=limit,
                )
                if events:
                    return events
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return []
                self._changed.wait(remaining)

    def checkpoint(self, session_id: str) -> dict[str, Any]:
        snapshot = self.snapshot(session_id)
        canonical = _canonical_json(snapshot["items"])
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        created = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._session(db, session_id)
            db.execute(
                "INSERT OR REPLACE INTO runtime_session_journal_checkpoints("
                "session_id,checkpoint_sequence,snapshot_hash,item_count,created_at"
                ") VALUES(?,?,?,?,?)",
                (
                    session_id,
                    snapshot["snapshot_sequence"],
                    digest,
                    len(snapshot["items"]),
                    created,
                ),
            )
            db.execute(
                "INSERT OR IGNORE INTO runtime_session_sequences(session_id) VALUES(?)",
                (session_id,),
            )
            db.execute(
                "UPDATE runtime_session_sequences SET checkpoint_sequence="
                "MAX(checkpoint_sequence,?) WHERE session_id=?",
                (snapshot["snapshot_sequence"], session_id),
            )
            db.commit()
        return {
            "session_id": session_id,
            "checkpoint_sequence": snapshot["snapshot_sequence"],
            "snapshot_hash": digest,
            "item_count": len(snapshot["items"]),
            "created_at": created,
        }

    @staticmethod
    def project_items(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Deterministically rebuild the current Item projection from Journal events."""
        items: dict[str, dict[str, Any]] = {}
        for event in events:
            if event.get("kind") not in {
                "conversation.item.created",
                "conversation.item.delta",
                "conversation.item.upsert",
            }:
                continue
            payload = event.get("payload")
            if not isinstance(payload, dict) or not payload.get("item_id"):
                continue
            item_id = str(payload["item_id"])
            revision = int(payload.get("revision") or 0)
            current = items.get(item_id)
            if current is not None and int(current["revision"]) >= revision:
                continue
            items[item_id] = {
                "item_id": item_id,
                "session_id": str(event["session_id"]),
                "run_id": event.get("run_id"),
                "kind": str(payload["kind"]),
                "role": payload.get("role"),
                "revision": revision,
                "session_sequence": int(event["session_sequence"]),
                "source_client": str(payload["source_client"]),
                "source_message_id": payload.get("source_message_id"),
                "created_at": str(payload["created_at"]),
                "updated_at": str(payload["updated_at"]),
                "payload": payload.get("payload") or {},
            }
        return sorted(
            items.values(),
            key=lambda item: (int(item["session_sequence"]), str(item["item_id"])),
        )

    @staticmethod
    def projection_hash(items: list[dict[str, Any]]) -> str:
        canonical = json.dumps(
            items, ensure_ascii=False, separators=(",", ":"), sort_keys=True
        )
        return hashlib.sha256(canonical.encode()).hexdigest()

    def compact(self, session_id: str, *, through_sequence: int) -> dict[str, int]:
        if through_sequence < 1:
            raise ValueError("Compaction sequence must be positive")
        with self._changed, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._session(db, session_id)
            state = db.execute(
                "SELECT * FROM runtime_session_sequences WHERE session_id=?",
                (session_id,),
            ).fetchone()
            if state is None or int(state["checkpoint_sequence"]) < through_sequence:
                db.rollback()
                raise ValueError("Compaction requires a checkpoint at or after the boundary")
            db.execute(
                "INSERT OR IGNORE INTO runtime_session_journal_maintenance VALUES(1)"
            )
            removed = db.execute(
                "DELETE FROM runtime_session_journal "
                "WHERE session_id=? AND session_sequence<=?",
                (session_id, through_sequence),
            ).rowcount
            db.execute("DELETE FROM runtime_session_journal_maintenance WHERE singleton=1")
            db.execute(
                "UPDATE runtime_session_sequences SET earliest_retained_sequence="
                "MAX(earliest_retained_sequence,?) WHERE session_id=?",
                (through_sequence + 1, session_id),
            )
            db.commit()
            self._changed.notify_all()
        return {
            "removed_events": int(removed),
            "earliest_retained_sequence": through_sequence + 1,
        }

    @staticmethod
    def _event(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            raise RuntimeError("Conversation Item is missing its Journal event")
        return {
            "event_id": str(row["event_id"]),
            "runtime_id": str(row["runtime_id"]),
            "workspace_id": str(row["workspace_id"]),
            "session_id": str(row["session_id"]),
            "run_id": str(row["run_id"]) if row["run_id"] is not None else None,
            "session_sequence": int(row["session_sequence"]),
            "kind": str(row["event_kind"]),
            "timestamp": str(row["created_at"]),
            "payload": json.loads(str(row["payload_json"])),
        }

    @staticmethod
    def _item(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "item_id": str(row["item_id"]),
            "session_id": str(row["session_id"]),
            "run_id": str(row["run_id"]) if row["run_id"] is not None else None,
            "kind": str(row["item_kind"]),
            "role": str(row["role"]) if row["role"] is not None else None,
            "revision": int(row["revision"]),
            "session_sequence": int(row["latest_sequence"]),
            "source_client": str(row["source_client"]),
            "source_message_id": (
                str(row["source_message_id"])
                if row["source_message_id"] is not None
                else None
            ),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
            "payload": json.loads(str(row["payload_json"])),
        }
