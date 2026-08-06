"""Idempotent, Runtime-scoped migration of legacy workdir Sessions."""

from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path
from typing import Any, Iterable

from .engine import RuntimeEngine
from .registry import RuntimeRegistry
from .sqlite_connection import ClosingConnection


class LegacySessionMigrator:
    def __init__(self, database: Path, registry: RuntimeRegistry, engine: RuntimeEngine):
        self.database = Path(database)
        self.registry = registry
        self.engine = engine
        with self._connect() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS legacy_session_migrations (
                runtime_id TEXT NOT NULL, legacy_session_id TEXT NOT NULL, source_workdir TEXT NOT NULL,
                status TEXT NOT NULL, workspace_id TEXT, session_id TEXT, reason TEXT,
                PRIMARY KEY(runtime_id, legacy_session_id))"""
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, factory=ClosingConnection)
        connection.row_factory = sqlite3.Row
        return connection

    def migrate(self, rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        results = []
        runtime_id = self.registry.identity.runtime_id
        by_path = {record.path: record.workspace_id for record in self.registry.list_workspaces()}
        for raw in rows:
            legacy_id = str(raw.get("session_id") or raw.get("thread_id") or "").strip()
            workdir = str(raw.get("workdir") or "").strip()
            if not legacy_id:
                raise ValueError("Legacy Session identity is required")
            try:
                canonical = str(Path(workdir).expanduser().resolve(strict=False)) if workdir else ""
            except (OSError, RuntimeError):
                canonical = ""
            workspace_id = by_path.get(canonical)
            session_id = self._session_id(runtime_id, legacy_id)
            if workspace_id:
                self.engine.import_session(session_id, workspace_id, str(raw.get("title") or "Imported session"))
                result = self._upsert(runtime_id, legacy_id, workdir, "migrated", workspace_id, session_id, None)
            else:
                result = self._upsert(runtime_id, legacy_id, workdir, "pending", None, None, "workspace_not_registered")
            results.append(result)
        return results

    def list_pending(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT * FROM legacy_session_migrations WHERE runtime_id=? AND status='pending' ORDER BY legacy_session_id", (self.registry.identity.runtime_id,)).fetchall()
        return [dict(row) for row in rows]

    def _upsert(self, runtime_id: str, legacy_id: str, workdir: str, status: str, workspace_id: str | None, session_id: str | None, reason: str | None) -> dict[str, Any]:
        with self._connect() as db:
            existing = db.execute("SELECT * FROM legacy_session_migrations WHERE runtime_id=? AND legacy_session_id=?", (runtime_id, legacy_id)).fetchone()
            if existing and existing["status"] == "migrated":
                return dict(existing)
            db.execute(
                """INSERT INTO legacy_session_migrations VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(runtime_id, legacy_session_id) DO UPDATE SET
                source_workdir=excluded.source_workdir, status=excluded.status, workspace_id=excluded.workspace_id,
                session_id=excluded.session_id, reason=excluded.reason""",
                (runtime_id, legacy_id, workdir, status, workspace_id, session_id, reason),
            )
            row = db.execute("SELECT * FROM legacy_session_migrations WHERE runtime_id=? AND legacy_session_id=?", (runtime_id, legacy_id)).fetchone()
        return dict(row)

    @staticmethod
    def _session_id(runtime_id: str, legacy_id: str) -> str:
        digest = hashlib.sha256(f"{runtime_id}\0{legacy_id}".encode()).hexdigest()[:32]
        return f"session-legacy-{digest}"
