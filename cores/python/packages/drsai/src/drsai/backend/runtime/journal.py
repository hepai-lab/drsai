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

from drsai.backend.runtime.oaep import (
    project_event,
    project_item,
    project_run,
    project_session,
    sanitize_persisted_item,
)
from drsai.backend.runtime.observability import ResourceCorrelation, RuntimeObservability
from drsai.oaep.digest import canonical_oaep_item
from drsai.relay.security import redact_credentials


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
    "plan",
    "tool",
    "file_change",
    "approval",
    "artifact",
    "subtask",
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
        # Journal payloads contain diagnostic JSON strings as well as prose.
        # Credential-only redaction keeps stable protocol fields such as
        # ``error_code``/``code`` inspectable while the key-aware recursion
        # above still removes secrets from structured mappings.
        redacted = redact_credentials(value)
        while "[REDACTED]]" in redacted:
            redacted = redacted.replace("[REDACTED]]", "[REDACTED]")
        return redacted
    return value


def _canonical_json(value: Any) -> str:
    safe = _redact_credentials(value)
    return json.dumps(safe, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _oaep_json(value: Any) -> str:
    """Encode an already-sanitized OAEP envelope without rewriting stable IDs."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


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

    def __init__(
        self,
        database: Path,
        runtime_id: str,
        observability: RuntimeObservability | None = None,
        *,
        max_events_per_session: int = 100_000,
        retained_events_per_session: int = 90_000,
    ):
        if not 1 <= retained_events_per_session < max_events_per_session:
            raise ValueError("runtime_journal_capacity_invalid")
        self.database = Path(database)
        self.runtime_id = runtime_id
        self.observability = observability
        self.max_events_per_session = max_events_per_session
        self.retained_events_per_session = retained_events_per_session
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
                CREATE TABLE IF NOT EXISTS runtime_oaep_items (
                  item_id TEXT PRIMARY KEY REFERENCES runtime_conversation_items(item_id),
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  run_id TEXT NOT NULL,
                  run_sequence INTEGER NOT NULL,
                  revision INTEGER NOT NULL,
                  latest_sequence INTEGER NOT NULL,
                  item_type TEXT NOT NULL DEFAULT 'notice',
                  item_status TEXT NOT NULL DEFAULT 'pending',
                  warning_count INTEGER NOT NULL DEFAULT 0,
                  input_tokens INTEGER NOT NULL DEFAULT 0,
                  output_tokens INTEGER NOT NULL DEFAULT 0,
                  total_tokens INTEGER NOT NULL DEFAULT 0,
                  envelope_json TEXT NOT NULL,
                  UNIQUE(run_id, run_sequence)
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_oaep_items_snapshot
                  ON runtime_oaep_items(session_id, latest_sequence, item_id);
                CREATE INDEX IF NOT EXISTS idx_runtime_oaep_items_run_inspection
                  ON runtime_oaep_items(run_id, run_sequence, item_id);
                CREATE INDEX IF NOT EXISTS idx_runtime_oaep_items_run_status
                  ON runtime_oaep_items(run_id, item_status, run_sequence, item_id);
                CREATE TABLE IF NOT EXISTS runtime_oaep_snapshot_checkpoints (
                  session_id TEXT PRIMARY KEY REFERENCES runtime_sessions(session_id),
                  checkpoint_sequence INTEGER NOT NULL,
                  snapshot_hash TEXT NOT NULL,
                  item_count INTEGER NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runtime_oaep_run_summary (
                  run_id TEXT NOT NULL,
                  item_type TEXT NOT NULL,
                  item_status TEXT NOT NULL,
                  item_count INTEGER NOT NULL,
                  warning_count INTEGER NOT NULL,
                  input_tokens INTEGER NOT NULL,
                  output_tokens INTEGER NOT NULL,
                  total_tokens INTEGER NOT NULL,
                  PRIMARY KEY(run_id,item_type,item_status)
                );
                CREATE TRIGGER IF NOT EXISTS runtime_oaep_summary_insert
                  AFTER INSERT ON runtime_oaep_items
                  BEGIN
                    INSERT INTO runtime_oaep_run_summary VALUES(
                      NEW.run_id,NEW.item_type,NEW.item_status,1,NEW.warning_count,
                      NEW.input_tokens,NEW.output_tokens,NEW.total_tokens
                    ) ON CONFLICT(run_id,item_type,item_status) DO UPDATE SET
                      item_count=item_count+1,
                      warning_count=warning_count+NEW.warning_count,
                      input_tokens=input_tokens+NEW.input_tokens,
                      output_tokens=output_tokens+NEW.output_tokens,
                      total_tokens=total_tokens+NEW.total_tokens;
                  END;
                CREATE TRIGGER IF NOT EXISTS runtime_oaep_summary_update
                  AFTER UPDATE OF run_id,item_type,item_status,warning_count,input_tokens,output_tokens,total_tokens
                  ON runtime_oaep_items
                  BEGIN
                    UPDATE runtime_oaep_run_summary SET
                      item_count=item_count-1,
                      warning_count=warning_count-OLD.warning_count,
                      input_tokens=input_tokens-OLD.input_tokens,
                      output_tokens=output_tokens-OLD.output_tokens,
                      total_tokens=total_tokens-OLD.total_tokens
                    WHERE run_id=OLD.run_id AND item_type=OLD.item_type AND item_status=OLD.item_status;
                    DELETE FROM runtime_oaep_run_summary
                    WHERE run_id=OLD.run_id AND item_type=OLD.item_type AND item_status=OLD.item_status
                      AND item_count<=0;
                    INSERT INTO runtime_oaep_run_summary VALUES(
                      NEW.run_id,NEW.item_type,NEW.item_status,1,NEW.warning_count,
                      NEW.input_tokens,NEW.output_tokens,NEW.total_tokens
                    ) ON CONFLICT(run_id,item_type,item_status) DO UPDATE SET
                      item_count=item_count+1,
                      warning_count=warning_count+NEW.warning_count,
                      input_tokens=input_tokens+NEW.input_tokens,
                      output_tokens=output_tokens+NEW.output_tokens,
                      total_tokens=total_tokens+NEW.total_tokens;
                  END;
                CREATE TRIGGER IF NOT EXISTS runtime_oaep_summary_delete
                  AFTER DELETE ON runtime_oaep_items
                  BEGIN
                    UPDATE runtime_oaep_run_summary SET
                      item_count=item_count-1,
                      warning_count=warning_count-OLD.warning_count,
                      input_tokens=input_tokens-OLD.input_tokens,
                      output_tokens=output_tokens-OLD.output_tokens,
                      total_tokens=total_tokens-OLD.total_tokens
                    WHERE run_id=OLD.run_id AND item_type=OLD.item_type AND item_status=OLD.item_status;
                    DELETE FROM runtime_oaep_run_summary
                    WHERE run_id=OLD.run_id AND item_type=OLD.item_type AND item_status=OLD.item_status
                      AND item_count<=0;
                  END;
                CREATE TABLE IF NOT EXISTS runtime_oaep_events (
                  event_id TEXT PRIMARY KEY REFERENCES runtime_session_journal(event_id)
                    ON DELETE CASCADE,
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  session_sequence INTEGER NOT NULL,
                  envelope_json TEXT NOT NULL,
                  UNIQUE(session_id, session_sequence)
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_oaep_events_replay
                  ON runtime_oaep_events(session_id, session_sequence);
                CREATE TABLE IF NOT EXISTS runtime_oaep_item_event_refs (
                  event_id TEXT PRIMARY KEY REFERENCES runtime_oaep_events(event_id)
                    ON DELETE CASCADE,
                  session_id TEXT NOT NULL,
                  run_id TEXT NOT NULL,
                  item_id TEXT NOT NULL,
                  session_sequence INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_oaep_item_event_refs_item
                  ON runtime_oaep_item_event_refs(run_id, item_id, session_sequence);
                CREATE TABLE IF NOT EXISTS runtime_oaep_migration_state (
                  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                  schema_version INTEGER NOT NULL,
                  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
                  legacy_items INTEGER NOT NULL DEFAULT 0,
                  migratable_items INTEGER NOT NULL DEFAULT 0,
                  degraded_items INTEGER NOT NULL DEFAULT 0,
                  projected_items INTEGER NOT NULL DEFAULT 0,
                  legacy_events INTEGER NOT NULL DEFAULT 0,
                  projected_events INTEGER NOT NULL DEFAULT 0,
                  started_at TEXT NOT NULL,
                  completed_at TEXT,
                  last_error_code TEXT
                );
                CREATE TABLE IF NOT EXISTS runtime_session_journal_checkpoints (
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  checkpoint_sequence INTEGER NOT NULL,
                  snapshot_hash TEXT NOT NULL,
                  item_count INTEGER NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(session_id, checkpoint_sequence)
                );
                CREATE TABLE IF NOT EXISTS runtime_session_journal_compacted_runtime_events (
                  runtime_event_id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL REFERENCES runtime_sessions(session_id),
                  compacted_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_session_journal_compacted_events_session
                  ON runtime_session_journal_compacted_runtime_events(session_id);
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
            inspection_columns_added = self._ensure_oaep_inspection_columns(db)
            db.execute(
                "CREATE INDEX IF NOT EXISTS idx_runtime_oaep_items_run_summary "
                "ON runtime_oaep_items(run_id,item_type,item_status,run_sequence,item_id)"
            )
            if inspection_columns_added:
                self._backfill_oaep_inspection_columns(db)
            db.execute("DELETE FROM runtime_oaep_run_summary")
            db.execute(
                "INSERT INTO runtime_oaep_run_summary "
                "SELECT run_id,item_type,item_status,COUNT(*),COALESCE(SUM(warning_count),0),"
                "COALESCE(SUM(input_tokens),0),COALESCE(SUM(output_tokens),0),"
                "COALESCE(SUM(total_tokens),0) FROM runtime_oaep_items "
                "GROUP BY run_id,item_type,item_status"
            )
            try:
                if not self._oaep_projection_is_current(db):
                    self._migrate_legacy_oaep(db)
                # Added after the OAEP projection itself: backfill stable
                # Item -> Event identities without rewriting append-only events.
                db.execute(
                    "INSERT OR IGNORE INTO runtime_oaep_item_event_refs("
                    "event_id,session_id,run_id,item_id,session_sequence) "
                    "SELECT event_id,session_id,json_extract(envelope_json,'$.run_id'),"
                    "json_extract(envelope_json,'$.item_id'),session_sequence "
                    "FROM runtime_oaep_events "
                    "WHERE json_extract(envelope_json,'$.run_id') IS NOT NULL "
                    "AND json_extract(envelope_json,'$.item_id') IS NOT NULL"
                )
            except Exception as error:
                db.execute(
                    "UPDATE runtime_oaep_migration_state SET status='failed',"
                    "completed_at=?,last_error_code=? WHERE singleton=1",
                    (_now(), type(error).__name__),
                )
                raise

    @staticmethod
    def _ensure_oaep_inspection_columns(db: sqlite3.Connection) -> bool:
        existing = {
            str(row["name"])
            for row in db.execute("PRAGMA table_info(runtime_oaep_items)").fetchall()
        }
        definitions = {
            "item_type": "TEXT NOT NULL DEFAULT 'notice'",
            "item_status": "TEXT NOT NULL DEFAULT 'pending'",
            "warning_count": "INTEGER NOT NULL DEFAULT 0",
            "input_tokens": "INTEGER NOT NULL DEFAULT 0",
            "output_tokens": "INTEGER NOT NULL DEFAULT 0",
            "total_tokens": "INTEGER NOT NULL DEFAULT 0",
        }
        added = False
        for name, definition in definitions.items():
            if name not in existing:
                db.execute(f"ALTER TABLE runtime_oaep_items ADD COLUMN {name} {definition}")
                added = True
        return added

    @staticmethod
    def _backfill_oaep_inspection_columns(db: sqlite3.Connection) -> None:
        db.execute(
            "UPDATE runtime_oaep_items SET "
            "item_type=COALESCE(json_extract(envelope_json,'$.type'),'notice'),"
            "item_status=COALESCE(json_extract(envelope_json,'$.status'),'pending'),"
            "warning_count=CASE WHEN lower(COALESCE(json_extract(envelope_json,'$.content.level'),'')) "
            "IN ('warning','warn') THEN 1 ELSE 0 END,"
            "input_tokens=max(0,CAST(COALESCE(json_extract(envelope_json,'$.content.usage.input_tokens'),"
            "json_extract(envelope_json,'$.content.usage.prompt_tokens'),0) AS INTEGER)),"
            "output_tokens=max(0,CAST(COALESCE(json_extract(envelope_json,'$.content.usage.output_tokens'),"
            "json_extract(envelope_json,'$.content.usage.completion_tokens'),0) AS INTEGER)),"
            "total_tokens=max(0,CAST(COALESCE(json_extract(envelope_json,'$.content.usage.total_tokens'),0) AS INTEGER))"
        )

    @staticmethod
    def _oaep_projection_is_current(db: sqlite3.Connection) -> bool:
        """Return whether every projectable legacy row already has OAEP state.

        New writes persist legacy and canonical rows in the same transaction, so
        a completed migration normally needs only this indexed anti-join check on
        restart.  Replaying the entire legacy journal here makes cold start grow
        linearly with history and can starve the co-hosted Relay connection.
        """
        state = db.execute(
            "SELECT status FROM runtime_oaep_migration_state WHERE singleton=1"
        ).fetchone()
        if state is None or str(state["status"]) != "completed":
            return False
        missing_item = db.execute(
            "SELECT 1 FROM runtime_conversation_items AS legacy "
            "WHERE legacy.run_id IS NOT NULL AND NOT EXISTS ("
            "SELECT 1 FROM runtime_oaep_items AS canonical "
            "WHERE canonical.item_id=legacy.item_id) LIMIT 1"
        ).fetchone()
        if missing_item is not None:
            return False
        missing_event = db.execute(
            "SELECT 1 FROM runtime_session_journal AS legacy WHERE NOT EXISTS ("
            "SELECT 1 FROM runtime_oaep_events AS canonical "
            "WHERE canonical.event_id=legacy.event_id) LIMIT 1"
        ).fetchone()
        return missing_event is None

    @staticmethod
    def _run_item_sequence(
        db: sqlite3.Connection, run_id: str, item_id: str
    ) -> int:
        existing = db.execute(
            "SELECT run_sequence FROM runtime_oaep_items WHERE item_id=?",
            (item_id,),
        ).fetchone()
        if existing is not None:
            return int(existing["run_sequence"])
        row = db.execute(
            "SELECT COALESCE(MAX(run_sequence),0) AS value "
            "FROM runtime_oaep_items WHERE run_id=?",
            (run_id,),
        ).fetchone()
        return int(row["value"]) + 1

    @staticmethod
    def _canonical_oaep_item(
        item: dict[str, Any], *, run_sequence: int
    ) -> dict[str, Any]:
        return project_item({**item, "oaep_item_sequence": run_sequence})

    @staticmethod
    def _canonical_oaep_event(
        event: dict[str, Any],
        *,
        run_sequence: int | None = None,
        omit_legacy_item: bool = False,
    ) -> dict[str, Any]:
        envelope = project_event(event)
        if omit_legacy_item:
            envelope.pop("item_id", None)
            envelope.pop("item_revision", None)
            envelope["type"] = "event.session.updated"
            envelope["data"] = {"legacy_projection_omitted": True}
            return envelope
        item = envelope.get("data", {}).get("item")
        if isinstance(item, dict) and run_sequence is not None:
            item["sequence"] = run_sequence
        return envelope

    @staticmethod
    def _normalize_oaep_event_shape(envelope: dict[str, Any]) -> dict[str, Any]:
        """Keep auxiliary legacy events valid without inventing Item identity.

        Runtime backend events such as ``tool.state.changed`` are mirrored once
        as an audit event and once as the canonical OAEP Item mutation.  The
        audit event has a Run but deliberately has no Item identity, so it
        cannot legally use an ``event.item.*`` type.  Preserve its Session
        cursor and safe metadata as a Session update; the following canonical
        Item event remains the authoritative tool/file/artifact mutation.

        This normalization also applies on replay so databases written by an
        earlier build stop emitting an invalid OAEP envelope immediately.
        """
        normalized = dict(envelope)
        event_type = str(normalized.get("type") or "")
        if event_type.startswith("event.item.") and not (
            normalized.get("run_id") and normalized.get("item_id")
        ):
            normalized["type"] = "event.session.updated"
            normalized.pop("item_id", None)
            normalized.pop("item_revision", None)
        return normalized

    def _store_oaep_event(
        self,
        db: sqlite3.Connection,
        event: dict[str, Any],
        *,
        run_sequence: int | None = None,
        canonical_item: dict[str, Any] | None = None,
        omit_legacy_item: bool = False,
    ) -> dict[str, Any]:
        envelope = self._canonical_oaep_event(
            event,
            run_sequence=run_sequence,
            omit_legacy_item=omit_legacy_item,
        )
        if canonical_item is not None and envelope["type"].startswith("event.item."):
            event_item = canonical_item
            if envelope["type"] == "event.item.delta":
                # Persist the exact pre-delta state. The canonical Item is the
                # post-delta Snapshot state, so reverse only the append carried
                # by this Event; replay then applies it exactly once.
                event_item = json.loads(_oaep_json(canonical_item))
                delta = (envelope.get("data") or {}).get("delta")
                content = event_item.get("content") if isinstance(event_item.get("content"), dict) else {}
                if isinstance(delta, dict):
                    kind = str(delta.get("kind") or "")
                    text = str(delta.get("text") or "")
                    field = {
                        "message.text.append": "text",
                        "plan.text.append": "text",
                        "command.output.append": "output",
                        "tool.output.append": "result",
                        "subtask.summary.append": "summary",
                    }.get(kind)
                    if field is not None and isinstance(content.get(field), str):
                        current = str(content[field])
                        content[field] = current[:-len(text)] if text and current.endswith(text) else current
                    elif kind in {"reasoning.text.append", "reasoning.segment.added"}:
                        segments = content.get("segments") if isinstance(content.get("segments"), list) else []
                        segment_id = str(delta.get("segment_id") or f"{event_item.get('id')}:text")
                        for index in range(len(segments) - 1, -1, -1):
                            segment = segments[index]
                            if not isinstance(segment, dict) or str(segment.get("id")) != segment_id:
                                continue
                            current = str(segment.get("text") or "")
                            if kind == "reasoning.segment.added" and current == text:
                                segments.pop(index)
                            elif text and current.endswith(text):
                                segment["text"] = current[:-len(text)]
                            break
                event_item["content"] = content
            envelope["data"] = {
                **dict(envelope.get("data") or {}),
                "item": event_item,
            }
        row = db.execute(
            "SELECT * FROM runtime_sessions WHERE session_id=?",
            (event["session_id"],),
        ).fetchone()
        if row is not None:
            # Every Event carries the current lightweight Session projection.
            # This closes the create-Session/create-Run transaction boundary
            # and makes replay from zero sufficient to rebuild a Snapshot.
            envelope["data"] = {
                **dict(envelope.get("data") or {}),
                "session": project_session(dict(row)),
            }
        if envelope["type"].startswith("event.run.") and event.get("run_id"):
            row = db.execute(
                "SELECT * FROM runtime_runs WHERE run_id=?",
                (event["run_id"],),
            ).fetchone()
            if row is not None:
                run = dict(row)
                run["attachment_refs"] = json.loads(
                    str(run.get("attachment_refs_json") or "[]")
                )
                envelope["data"] = {
                    **dict(envelope.get("data") or {}),
                    "run": project_run(run),
                }
        envelope = self._normalize_oaep_event_shape(envelope)
        db.execute(
            "INSERT INTO runtime_oaep_events("
            "event_id,session_id,session_sequence,envelope_json) VALUES(?,?,?,?) "
            "ON CONFLICT(event_id) DO UPDATE SET envelope_json=excluded.envelope_json",
            (
                event["event_id"],
                event["session_id"],
                event["session_sequence"],
                _oaep_json(envelope),
            ),
        )
        db.execute("DELETE FROM runtime_oaep_item_event_refs WHERE event_id=?", (event["event_id"],))
        if envelope.get("run_id") and envelope.get("item_id"):
            db.execute(
                "INSERT INTO runtime_oaep_item_event_refs("
                "event_id,session_id,run_id,item_id,session_sequence) VALUES(?,?,?,?,?)",
                (
                    event["event_id"],
                    event["session_id"],
                    str(envelope["run_id"]),
                    str(envelope["item_id"]),
                    int(envelope["sequence"]),
                ),
            )
        return envelope

    def _store_oaep_item(
        self, db: sqlite3.Connection, item: dict[str, Any]
    ) -> tuple[dict[str, Any], int]:
        run_id = str(item.get("run_id") or "")
        if not run_id:
            raise ValueError("OAEP Item must belong to a Run")
        run_sequence = self._run_item_sequence(db, run_id, str(item["item_id"]))
        envelope = self._canonical_oaep_item(item, run_sequence=run_sequence)
        run_row = db.execute(
            "SELECT workspace_id FROM runtime_runs WHERE run_id=?", (run_id,)
        ).fetchone()
        if run_row is None:
            raise KeyError("Run not found")
        workspace_id = str(run_row["workspace_id"])
        content = envelope.get("content") if isinstance(envelope.get("content"), dict) else {}
        if envelope.get("type") == "artifact" and not content.get("resource_refs"):
            artifact_id = content.get("artifact_id")
            if artifact_id:
                content["resource_refs"] = [{
                    "protocol": "owop/1",
                    "workspace_id": workspace_id,
                    "resource_type": "artifact",
                    "resource_id": str(artifact_id),
                }]
        operation_ref = content.get("operation_ref")
        if isinstance(operation_ref, dict) and operation_ref.get("workspace_id") != workspace_id:
            raise ValueError("OAEP operation_ref belongs to another Workspace")
        for resource_ref in content.get("resource_refs") or []:
            if not isinstance(resource_ref, dict) or resource_ref.get("workspace_id") != workspace_id:
                raise ValueError("OAEP resource_ref belongs to another Workspace")
        envelope["content"] = content
        usage = content.get("usage") if isinstance(content.get("usage"), dict) else {}
        input_tokens = usage.get("input_tokens", usage.get("prompt_tokens", 0))
        output_tokens = usage.get("output_tokens", usage.get("completion_tokens", 0))
        total_tokens = usage.get("total_tokens", 0)
        input_tokens = int(input_tokens) if isinstance(input_tokens, (int, float)) and input_tokens >= 0 else 0
        output_tokens = int(output_tokens) if isinstance(output_tokens, (int, float)) and output_tokens >= 0 else 0
        total_tokens = int(total_tokens) if isinstance(total_tokens, (int, float)) and total_tokens >= 0 else 0
        previous_row = db.execute(
            "SELECT revision,envelope_json FROM runtime_oaep_items WHERE item_id=?",
            (item["item_id"],),
        ).fetchone()
        if previous_row is not None:
            previous = json.loads(str(previous_row["envelope_json"]))
            if previous.get("session_id") != envelope.get("session_id"):
                raise ValueError("OAEP Item belongs to another Session")
            if previous.get("run_id") != envelope.get("run_id"):
                raise ValueError("OAEP Item belongs to another Run")
            if previous.get("type") != envelope.get("type"):
                raise ValueError("OAEP Item type cannot change")
            old_status = str(previous.get("status") or "pending")
            new_status = str(envelope.get("status") or "pending")
            is_mapping_correction = (
                isinstance(item.get("payload"), dict)
                and item["payload"].get("projection_correction") is True
                and bool(item["payload"].get("mapping_version"))
                and item["payload"].get("mapping_version")
                != (previous.get("source") or {}).get("mapping_version")
            )
            allowed = {
                "pending": {"pending", "running", "waiting", "completed", "failed", "cancelled"},
                "running": {"running", "waiting", "completed", "failed", "cancelled"},
                "waiting": {"waiting", "running", "completed", "failed", "cancelled"},
                "completed": {"completed"},
                "failed": {"failed"},
                "cancelled": {"cancelled"},
            }
            if new_status not in allowed.get(old_status, set()) and not is_mapping_correction:
                raise ValueError(
                    f"OAEP Item status cannot transition from {old_status} to {new_status}"
                )
            if (
                old_status in {"completed", "failed", "cancelled"}
                and int(item["revision"]) > int(previous_row["revision"])
                and previous != envelope
                and not is_mapping_correction
            ):
                raise ValueError("OAEP Item cannot change after reaching a terminal status")
        db.execute(
            "INSERT INTO runtime_oaep_items("
            "item_id,session_id,run_id,run_sequence,revision,latest_sequence,"
            "item_type,item_status,warning_count,input_tokens,output_tokens,total_tokens,envelope_json"
            ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET "
            "revision=excluded.revision,latest_sequence=excluded.latest_sequence,"
            "item_type=excluded.item_type,item_status=excluded.item_status,"
            "warning_count=excluded.warning_count,input_tokens=excluded.input_tokens,"
            "output_tokens=excluded.output_tokens,total_tokens=excluded.total_tokens,"
            "envelope_json=excluded.envelope_json",
            (
                item["item_id"],
                item["session_id"],
                run_id,
                run_sequence,
                item["revision"],
                item["session_sequence"],
                str(envelope.get("type") or "notice"),
                str(envelope.get("status") or "pending"),
                1 if str(content.get("level") or "").lower() in {"warning", "warn"} else 0,
                input_tokens,
                output_tokens,
                total_tokens,
                _oaep_json(envelope),
            ),
        )
        return envelope, run_sequence

    def _migrate_legacy_oaep(self, db: sqlite3.Connection) -> None:
        """Idempotently add canonical OAEP projections for V3 journal rows."""
        started_at = _now()
        db.execute(
            "INSERT INTO runtime_oaep_migration_state("
            "singleton,schema_version,status,started_at) VALUES(1,1,'running',?) "
            "ON CONFLICT(singleton) DO UPDATE SET status='running',"
            "started_at=excluded.started_at,completed_at=NULL,last_error_code=NULL",
            (started_at,),
        )
        items = db.execute(
            "SELECT * FROM runtime_conversation_items ORDER BY latest_sequence,item_id"
        ).fetchall()
        item_sequences: dict[str, int] = {}
        canonical_items: dict[str, dict[str, Any]] = {}
        migratable_items = 0
        degraded_items = 0
        for row in items:
            item = self._item(row)
            if not item.get("run_id"):
                degraded_items += 1
                continue
            migratable_items += 1
            canonical, item_sequences[str(item["item_id"])] = self._store_oaep_item(db, item)
            canonical_items[str(item["item_id"])] = canonical
        events = db.execute(
            "SELECT * FROM runtime_session_journal ORDER BY session_id,session_sequence"
        ).fetchall()
        for row in events:
            event = self._event(row)
            self._store_oaep_event(
                db,
                event,
                run_sequence=item_sequences.get(str(event.get("item_id") or "")),
                canonical_item=canonical_items.get(str(event.get("item_id") or "")),
                omit_legacy_item=bool(event.get("item_id") and not event.get("run_id")),
            )
        projected_items = int(db.execute(
            "SELECT COUNT(*) FROM runtime_oaep_items"
        ).fetchone()[0])
        projected_events = int(db.execute(
            "SELECT COUNT(*) FROM runtime_oaep_events"
        ).fetchone()[0])
        db.execute(
            "UPDATE runtime_oaep_migration_state SET status='completed',"
            "legacy_items=?,migratable_items=?,degraded_items=?,projected_items=?,"
            "legacy_events=?,projected_events=?,completed_at=?,last_error_code=NULL "
            "WHERE singleton=1",
            (
                len(items), migratable_items, degraded_items, projected_items,
                len(events), projected_events, _now(),
            ),
        )

    def oaep_migration_report(self) -> dict[str, Any]:
        """Return a content-free, restart-stable OAEP migration audit report."""
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM runtime_oaep_migration_state WHERE singleton=1"
            ).fetchone()
            if row is None:
                return {
                    "schema_version": 1,
                    "status": "pending",
                    "legacy_items": 0,
                    "migratable_items": 0,
                    "degraded_items": 0,
                    "projected_items": 0,
                    "legacy_events": 0,
                    "projected_events": 0,
                    "complete": False,
                }
            report = dict(row)
            report.pop("singleton", None)
            report["complete"] = (
                report["status"] == "completed"
                and int(report["projected_items"]) == int(report["migratable_items"])
                and int(report["projected_events"]) == int(report["legacy_events"])
            )
            report["totals"] = {
                "items": int(report["legacy_items"]),
                "events": int(report["legacy_events"]),
            }
            report["projectable"] = {
                "items": int(report["migratable_items"]),
                "events": int(report["legacy_events"]),
            }
            report["degraded_notices"] = [
                {
                    "code": "legacy_item_without_run",
                    "count": int(report["degraded_items"]),
                }
            ]
            report["failures"] = {
                "count": 0 if report["status"] == "completed" else 1,
                "last_error_code": report.get("last_error_code"),
            }
            return report

    def downgrade_empty_oaep_schema(self) -> None:
        """Drop only an empty OAEP projection schema; populated data fails closed."""
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            item_count = int(db.execute(
                "SELECT COUNT(*) FROM runtime_oaep_items"
            ).fetchone()[0])
            event_count = int(db.execute(
                "SELECT COUNT(*) FROM runtime_oaep_events"
            ).fetchone()[0])
            if item_count or event_count:
                db.rollback()
                raise RuntimeError("oaep_downgrade_data_present")
            db.executescript(
                "DROP TABLE runtime_oaep_events;"
                "DROP TABLE runtime_oaep_items;"
                "DROP TABLE runtime_oaep_migration_state;"
            )

    def ensure_oaep_projection(self, session_id: str) -> bool:
        """Lazily repair a missing OAEP projection; returns whether work ran."""
        with self._connect() as db:
            self._session(db, session_id)
            legacy_items = int(db.execute(
                "SELECT COUNT(*) FROM runtime_conversation_items "
                "WHERE session_id=? AND run_id IS NOT NULL", (session_id,),
            ).fetchone()[0])
            projected_items = int(db.execute(
                "SELECT COUNT(*) FROM runtime_oaep_items WHERE session_id=?",
                (session_id,),
            ).fetchone()[0])
            legacy_events = int(db.execute(
                "SELECT COUNT(*) FROM runtime_session_journal WHERE session_id=?",
                (session_id,),
            ).fetchone()[0])
            projected_events = int(db.execute(
                "SELECT COUNT(*) FROM runtime_oaep_events WHERE session_id=?",
                (session_id,),
            ).fetchone()[0])
        if projected_items == legacy_items and projected_events == legacy_events:
            return False
        with self._lock, self._connect() as db:
            self._migrate_legacy_oaep(db)
        return True

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
        self.enforce_capacity(session_id)
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
        started = time.perf_counter()
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
        event = self._event(row)
        self._store_oaep_event(db, event)
        if self.observability is not None:
            self.observability.record_conversation_latency_in_transaction(
                db,
                "journal_append",
                (time.perf_counter() - started) * 1000,
                ResourceCorrelation(
                    event_id,
                    event_id,
                    runtime_id=self.runtime_id,
                    workspace_id=str(session["workspace_id"]),
                    session_id=session_id,
                    run_id=run_id or "",
                ),
                {"protocol": "oaep/1"},
            )
        return event, True

    def notify_committed(self) -> None:
        """Wake local subscribers after a caller-owned transaction commits."""
        self.enforce_capacity()
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
        self.enforce_capacity(session_id)
        return item, event, created

    def capacity_policy(self) -> dict[str, Any]:
        return {
            "max_events_per_session": self.max_events_per_session,
            "retained_events_per_session": self.retained_events_per_session,
            "overflow_strategy": "checkpoint_then_compact",
            "cursor_gap": "cursor_expired",
            "recovery": "authoritative_snapshot_then_replay",
        }

    def enforce_capacity(self, session_id: str | None = None) -> dict[str, int]:
        """Bound retained append history without deleting the Item projection.

        A checkpoint of the complete authoritative projection is committed
        before old events are removed.  Slow clients therefore receive
        ``cursor_expired`` and recover from Snapshot; terminal and Approval
        Items remain present in ``runtime_conversation_items``/OAEP Items.
        """
        with self._connect() as db:
            if session_id is None:
                rows = db.execute(
                    "SELECT session_id,last_sequence,earliest_retained_sequence "
                    "FROM runtime_session_sequences WHERE "
                    "last_sequence-earliest_retained_sequence+1>?",
                    (self.max_events_per_session,),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT session_id,last_sequence,earliest_retained_sequence "
                    "FROM runtime_session_sequences WHERE session_id=?",
                    (session_id,),
                ).fetchall()
        compacted_sessions = removed_events = 0
        for row in rows:
            retained = int(row["last_sequence"]) - int(row["earliest_retained_sequence"]) + 1
            if retained <= self.max_events_per_session:
                continue
            selected = str(row["session_id"])
            through = int(row["last_sequence"]) - self.retained_events_per_session
            self.checkpoint(selected)
            result = self.compact(selected, through_sequence=through)
            compacted_sessions += 1
            removed_events += int(result["removed_events"])
        return {
            "compacted_sessions": compacted_sessions,
            "removed_events": removed_events,
        }

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
        item = self._item(item_row)
        event = self._event(event_row)
        if item.get("run_id"):
            canonical_item, run_sequence = self._store_oaep_item(db, item)
            self._store_oaep_event(
                db,
                event,
                run_sequence=run_sequence,
                canonical_item=canonical_item,
            )
        else:
            # V3 allowed Session-level Conversation Items. They remain visible
            # through the legacy projection, but OAEP Items always belong to a
            # Run; preserve the Session cursor without forging a synthetic Run.
            self._store_oaep_event(db, event, omit_legacy_item=True)
        return item, event, True

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

    def oaep_items(
        self, session_id: str, *, through_sequence: int | None = None
    ) -> list[dict[str, Any]]:
        """Return canonical OAEP Items at a Session waterline."""
        self.ensure_oaep_projection(session_id)
        with self._connect() as db:
            self._session(db, session_id)
            if through_sequence is None:
                state = db.execute(
                    "SELECT last_sequence FROM runtime_session_sequences WHERE session_id=?",
                    (session_id,),
                ).fetchone()
                through_sequence = int(state["last_sequence"]) if state else 0
            rows = db.execute(
                "SELECT envelope_json FROM runtime_oaep_items "
                "WHERE session_id=? AND latest_sequence<=? "
                "ORDER BY run_id,run_sequence,item_id",
                (session_id, through_sequence),
            ).fetchall()
        return [sanitize_persisted_item(json.loads(str(row["envelope_json"]))) for row in rows]

    def oaep_items_window(
        self,
        session_id: str,
        *,
        through_sequence: int,
        before_sequence: int | None = None,
        before_item_id: str = "",
        limit: int = 100,
    ) -> tuple[list[dict[str, Any]], tuple[int, str] | None]:
        """Return a bounded newest-first window without materializing history.

        The returned page is ordered chronologically for presentation.  The
        continuation key points strictly before the oldest returned Item and is
        bound to the caller's immutable Snapshot waterline.
        """
        self.ensure_oaep_projection(session_id)
        bounded = max(1, min(int(limit), 500))
        clauses = ["session_id=?", "latest_sequence<=?"]
        parameters: list[Any] = [session_id, through_sequence]
        if before_sequence is not None:
            clauses.append("(latest_sequence<? OR (latest_sequence=? AND item_id<?))")
            parameters.extend([before_sequence, before_sequence, before_item_id])
        parameters.append(bounded + 1)
        with self._connect() as db:
            self._session(db, session_id)
            rows = db.execute(
                "SELECT latest_sequence,item_id,envelope_json FROM runtime_oaep_items WHERE "
                + " AND ".join(clauses)
                + " ORDER BY latest_sequence DESC,item_id DESC LIMIT ?",
                parameters,
            ).fetchall()
        selected = rows[:bounded]
        continuation = (
            (int(selected[-1]["latest_sequence"]), str(selected[-1]["item_id"]))
            if len(rows) > bounded and selected else None
        )
        # ``latest_sequence`` is the stable keyset boundary, but is not the
        # presentation order: revising an early Item moves its latest journal
        # sequence past later Items.  OAEP requires each Run's Item sequence to
        # remain monotonic, so sort the bounded page by canonical Run order
        # without changing the continuation key selected above.
        items = [
            sanitize_persisted_item(json.loads(str(row["envelope_json"])))
            for row in selected
        ]
        items.sort(key=lambda item: (
            str(item.get("run_id") or ""),
            int(item.get("sequence") or 0),
            str(item.get("id") or ""),
        ))
        return items, continuation

    def snapshot_waterline(self, session_id: str) -> int:
        with self._connect() as db:
            self._session(db, session_id)
            state = db.execute(
                "SELECT last_sequence FROM runtime_session_sequences WHERE session_id=?",
                (session_id,),
            ).fetchone()
        return int(state["last_sequence"]) if state is not None else 0

    def oaep_checkpoint(self, session_id: str, *, through_sequence: int) -> dict[str, Any]:
        """Persist a bounded-memory digest of the canonical OAEP Item projection."""
        self.ensure_oaep_projection(session_id)
        created = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            self._session(db, session_id)
            rows = db.execute(
                "SELECT envelope_json FROM runtime_oaep_items "
                "WHERE session_id=? AND latest_sequence<=? "
                "ORDER BY run_id,run_sequence,item_id",
                (session_id, through_sequence),
            )
            digest_state = hashlib.sha256()
            digest_state.update(b"[")
            item_count = 0
            for row in rows:
                if item_count:
                    digest_state.update(b",")
                item = sanitize_persisted_item(json.loads(str(row["envelope_json"])))
                digest_state.update(canonical_oaep_item(item).encode())
                item_count += 1
            digest_state.update(b"]")
            digest = digest_state.hexdigest()
            db.execute(
                "INSERT OR REPLACE INTO runtime_oaep_snapshot_checkpoints("
                "session_id,checkpoint_sequence,snapshot_hash,item_count,created_at"
                ") VALUES(?,?,?,?,?)",
                (session_id, through_sequence, digest, item_count, created),
            )
            db.commit()
        return {
            "session_id": session_id,
            "checkpoint_sequence": through_sequence,
            "snapshot_hash": digest,
            "item_count": item_count,
            "created_at": created,
        }

    def oaep_run_items(self, session_id: str, run_id: str) -> list[dict[str, Any]]:
        """Return one Run's canonical items using the Run inspection index."""
        self.ensure_oaep_projection(session_id)
        with self._connect() as db:
            self._session(db, session_id)
            rows = db.execute(
                "SELECT envelope_json FROM runtime_oaep_items "
                "WHERE run_id=? ORDER BY run_sequence,item_id",
                (run_id,),
            ).fetchall()
        return [sanitize_persisted_item(json.loads(str(row["envelope_json"]))) for row in rows]

    def oaep_run_items_page(
        self,
        session_id: str,
        run_id: str,
        *,
        after_sequence: int = 0,
        after_item_id: str = "",
        limit: int = 100,
        item_type: str | None = None,
        status: str | None = None,
        ensure_projection: bool = True,
    ) -> tuple[list[dict[str, Any]], bool]:
        """Read a bounded Run timeline page with a database keyset cursor."""
        if ensure_projection:
            self.ensure_oaep_projection(session_id)
        bounded = max(1, min(int(limit), 500))
        clauses = [
            "run_id=?",
            "(run_sequence>? OR (run_sequence=? AND item_id>?))",
        ]
        parameters: list[Any] = [run_id, after_sequence, after_sequence, after_item_id]
        if item_type:
            clauses.append("item_type=?")
            parameters.append(item_type)
        if status:
            clauses.append("item_status=?")
            parameters.append(status)
        parameters.append(bounded + 1)
        with self._connect() as db:
            self._session(db, session_id)
            rows = db.execute(
                "SELECT envelope_json FROM runtime_oaep_items WHERE "
                + " AND ".join(clauses)
                + " ORDER BY run_sequence,item_id LIMIT ?",
                parameters,
            ).fetchall()
        return (
            [
                sanitize_persisted_item(json.loads(str(row["envelope_json"])))
                for row in rows[:bounded]
            ],
            len(rows) > bounded,
        )

    def oaep_run_inspection_summary(
        self, session_id: str, run_id: str, *, ensure_projection: bool = True,
    ) -> dict[str, Any]:
        """Aggregate a Run without materializing its complete timeline."""
        if ensure_projection:
            self.ensure_oaep_projection(session_id)
        with self._connect() as db:
            self._session(db, session_id)
            grouped = db.execute(
                "SELECT item_type,item_status,item_count,warning_count,input_tokens,"
                "output_tokens,total_tokens FROM runtime_oaep_run_summary WHERE run_id=?",
                (run_id,),
            ).fetchall()
            failed_row = db.execute(
                "SELECT run_sequence,item_id,envelope_json FROM runtime_oaep_items "
                "WHERE run_id=? AND item_status='failed' ORDER BY run_sequence,item_id LIMIT 1",
                (run_id,),
            ).fetchone()
            notice_row = db.execute(
                "SELECT run_sequence,item_id,envelope_json FROM runtime_oaep_items "
                "WHERE run_id=? AND item_type='notice' ORDER BY run_sequence,item_id LIMIT 1",
                (run_id,),
            ).fetchone()
        candidates = [row for row in (failed_row, notice_row) if row is not None]
        error_row = min(candidates, key=lambda row: (int(row["run_sequence"]), str(row["item_id"]))) if candidates else None
        counts: dict[str, int] = {}
        statuses: dict[str, int] = {}
        warning_count = input_tokens = output_tokens = total_tokens = 0
        for row in grouped:
            item_kind = str(row["item_type"] or "notice")
            item_status = str(row["item_status"] or "pending")
            count = int(row["item_count"])
            counts[item_kind] = counts.get(item_kind, 0) + count
            statuses[item_status] = statuses.get(item_status, 0) + count
            warning_count += int(row["warning_count"] or 0)
            input_tokens += int(row["input_tokens"] or 0)
            output_tokens += int(row["output_tokens"] or 0)
            total_tokens += int(row["total_tokens"] or 0)
        if total_tokens == 0:
            total_tokens = input_tokens + output_tokens
        return {
            "counts_by_item_type": counts,
            "counts_by_status": statuses,
            "warning_count": warning_count,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
            },
            "error_item": (
                sanitize_persisted_item(json.loads(str(error_row["envelope_json"])))
                if error_row else None
            ),
        }

    def oaep_run_item_predecessor(
        self,
        session_id: str,
        run_id: str,
        item_id: str,
        *,
        item_type: str | None = None,
        status: str | None = None,
    ) -> tuple[dict[str, Any], tuple[int, str] | None]:
        """Locate an Item and the key immediately before it for deep linking."""
        self.ensure_oaep_projection(session_id)
        with self._connect() as db:
            self._session(db, session_id)
            target = db.execute(
                "SELECT run_sequence,item_id,envelope_json FROM runtime_oaep_items "
                "WHERE run_id=? AND item_id=?",
                (run_id, item_id),
            ).fetchone()
            if target is None:
                raise KeyError(item_id)
            target_envelope = sanitize_persisted_item(
                json.loads(str(target["envelope_json"]))
            )
            if item_type and target_envelope.get("type") != item_type:
                raise KeyError(item_id)
            if status and target_envelope.get("status") != status:
                raise KeyError(item_id)
            clauses = [
                "run_id=?",
                "(run_sequence<? OR (run_sequence=? AND item_id<?))",
            ]
            parameters: list[Any] = [
                run_id, int(target["run_sequence"]), int(target["run_sequence"]), str(target["item_id"]),
            ]
            if item_type:
                clauses.append("item_type=?")
                parameters.append(item_type)
            if status:
                clauses.append("item_status=?")
                parameters.append(status)
            predecessor = db.execute(
                "SELECT run_sequence,item_id FROM runtime_oaep_items WHERE "
                + " AND ".join(clauses)
                + " ORDER BY run_sequence DESC,item_id DESC LIMIT 1",
                parameters,
            ).fetchone()
        return target_envelope, (
            (int(predecessor["run_sequence"]), str(predecessor["item_id"]))
            if predecessor else None
        )

    def oaep_item_event_refs(
        self, session_id: str, run_id: str, item_ids: list[str],
    ) -> dict[str, list[dict[str, Any]]]:
        """Return stable OAEP Event identities for a bounded page of Items."""
        if not item_ids:
            return {}
        placeholders = ",".join("?" for _ in item_ids)
        with self._connect() as db:
            self._session(db, session_id)
            rows = db.execute(
                "SELECT item_id,event_id,session_sequence FROM runtime_oaep_item_event_refs "
                f"WHERE session_id=? AND run_id=? AND item_id IN ({placeholders}) "
                "ORDER BY item_id,session_sequence,event_id",
                (session_id, run_id, *item_ids),
            ).fetchall()
        result: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            result.setdefault(str(row["item_id"]), []).append({
                "event_id": str(row["event_id"]),
                "sequence": int(row["session_sequence"]),
            })
        return result

    def replay_oaep(
        self,
        session_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        """Replay canonical OAEP Events using the Session-scoped cursor."""
        # Reuse the legacy cursor validation while both physical views coexist.
        legacy = self.replay(
            session_id, after_sequence=after_sequence, limit=limit
        )
        if not legacy:
            return []
        event_ids = [str(event["event_id"]) for event in legacy]
        placeholders = ",".join("?" for _ in event_ids)
        with self._connect() as db:
            rows = db.execute(
                f"SELECT event_id,envelope_json FROM runtime_oaep_events "
                f"WHERE event_id IN ({placeholders})",
                event_ids,
            ).fetchall()
        by_id = {
            str(row["event_id"]): json.loads(str(row["envelope_json"]))
            for row in rows
        }
        if len(by_id) != len(event_ids):
            self.ensure_oaep_projection(session_id)
            with self._connect() as db:
                rows = db.execute(
                    f"SELECT event_id,envelope_json FROM runtime_oaep_events "
                    f"WHERE event_id IN ({placeholders})",
                    event_ids,
                ).fetchall()
            by_id = {
                str(row["event_id"]): json.loads(str(row["envelope_json"]))
                for row in rows
            }
            if len(by_id) != len(event_ids):
                raise RuntimeError("Canonical OAEP Journal projection is incomplete")
        return [
            self._normalize_oaep_event_shape(by_id[event_id])
            for event_id in event_ids
        ]

    def wait_for_oaep_events(
        self,
        session_id: str,
        *,
        after_sequence: int,
        timeout: float = 15.0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        legacy = self.wait_for_events(
            session_id,
            after_sequence=after_sequence,
            timeout=timeout,
            limit=limit,
        )
        if not legacy:
            return []
        return self.replay_oaep(
            session_id,
            after_sequence=after_sequence,
            limit=len(legacy),
        )

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

    def workspace_catalog_watermark(self, workspace_id: str) -> int:
        """Return an opaque local cursor for content-free Session catalog events."""
        if not workspace_id:
            raise ValueError("workspace_id_required")
        with self._connect() as db:
            row = db.execute(
                "SELECT COALESCE(MAX(rowid),0) AS watermark FROM runtime_session_journal "
                "WHERE workspace_id=? AND event_kind IN "
                "('session.updated','session.archived','session.unarchived','session.removed')",
                (workspace_id,),
            ).fetchone()
        return int(row["watermark"] if row is not None else 0)

    def wait_for_workspace_catalog_events(
        self,
        workspace_id: str,
        *,
        after_cursor: int,
        timeout: float = 15.0,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        """Wait for committed, content-free catalog invalidations in append order."""
        if not workspace_id:
            raise ValueError("workspace_id_required")
        if after_cursor < 0 or limit < 1 or limit > 2_000:
            raise ValueError("workspace_catalog_cursor_invalid")
        deadline = time.monotonic() + max(0.0, timeout)
        kind_map = {
            "session.updated": "event.session.updated",
            "session.archived": "event.session.archived",
            "session.unarchived": "event.session.unarchived",
            "session.removed": "event.session.deleted",
        }
        with self._changed:
            while True:
                with self._connect() as db:
                    rows = db.execute(
                        "SELECT rowid,event_id,session_id,session_sequence,event_kind "
                        "FROM runtime_session_journal WHERE workspace_id=? AND rowid>? "
                        "AND event_kind IN "
                        "('session.updated','session.archived','session.unarchived','session.removed') "
                        "ORDER BY rowid LIMIT ?",
                        (workspace_id, after_cursor, limit),
                    ).fetchall()
                if rows:
                    return [
                        {
                            "cursor": int(row["rowid"]),
                            "event_id": str(row["event_id"]),
                            "session_id": str(row["session_id"]),
                            "type": kind_map[str(row["event_kind"])],
                            "sequence": int(row["session_sequence"]),
                        }
                        for row in rows
                    ]
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return []
                self._changed.wait(remaining)

    def checkpoint(self, session_id: str) -> dict[str, Any]:
        created = _now()
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
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
            )
            digest_state = hashlib.sha256()
            digest_state.update(b"[")
            item_count = 0
            for row in rows:
                if item_count:
                    digest_state.update(b",")
                digest_state.update(_canonical_json(self._item(row)).encode())
                item_count += 1
            digest_state.update(b"]")
            digest = digest_state.hexdigest()
            db.execute(
                "INSERT OR REPLACE INTO runtime_session_journal_checkpoints("
                "session_id,checkpoint_sequence,snapshot_hash,item_count,created_at"
                ") VALUES(?,?,?,?,?)",
                (
                    session_id,
                    watermark,
                    digest,
                    item_count,
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
                (watermark, session_id),
            )
            db.commit()
        return {
            "session_id": session_id,
            "checkpoint_sequence": watermark,
            "snapshot_hash": digest,
            "item_count": item_count,
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
            # RuntimeEngine's upgrade reconciler projects legacy runtime_events into
            # the Journal.  Remember the exact source identities removed here so a
            # later restart cannot mistake intentional compaction for missing data.
            # This is deliberately an exact tombstone set instead of a rowid/high
            # water mark: old events can be imported out of order.
            db.execute(
                "INSERT OR IGNORE INTO runtime_session_journal_compacted_runtime_events("
                "runtime_event_id,session_id,compacted_at) "
                "SELECT substr(dedupe_key,length('runtime-event:')+1),session_id,? "
                "FROM runtime_session_journal "
                "WHERE session_id=? AND session_sequence<=? "
                "AND dedupe_key LIKE 'runtime-event:%'",
                (_now(), session_id, through_sequence),
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
            "item_id": str(row["item_id"]) if row["item_id"] is not None else None,
            "item_revision": int(row["item_revision"]) if row["item_revision"] is not None else None,
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
