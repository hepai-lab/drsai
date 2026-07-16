"""Persistent identity and workspace registry for an OpenDrSai Runtime."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


class _ClosingConnection(sqlite3.Connection):
    """Commit/rollback and close deterministically, including on Windows."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class RuntimeIdentity:
    runtime_id: str
    instance_id: str


@dataclass(frozen=True)
class WorkspaceRecord:
    workspace_id: str
    path: str
    created_at: str
    last_opened_at: str
    closed_at: str | None

    @property
    def open(self) -> bool:
        return self.closed_at is None

    def as_dict(self) -> dict[str, str | bool | None]:
        return {
            "workspace_id": self.workspace_id,
            "path": self.path,
            "created_at": self.created_at,
            "last_opened_at": self.last_opened_at,
            "closed_at": self.closed_at,
            "open": self.open,
        }


class RuntimeRegistry:
    """SQLite-backed Runtime identity and authoritative Workspace registry."""

    def __init__(self, database: Path):
        self.database = database.expanduser().resolve(strict=False)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()
        self.identity = RuntimeIdentity(self._get_or_create_runtime_id(), f"instance-{uuid.uuid4()}")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database, timeout=30, factory=_ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._lock, self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    canonical_path TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    last_opened_at TEXT NOT NULL,
                    closed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_workspaces_open
                    ON workspaces(closed_at, last_opened_at DESC);
                """
            )

    def _get_or_create_runtime_id(self) -> str:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT value FROM runtime_metadata WHERE key='runtime_id'").fetchone()
            if row:
                return str(row["value"])
            runtime_id = f"runtime-{uuid.uuid4()}"
            connection.execute("INSERT INTO runtime_metadata(key, value) VALUES('runtime_id', ?)", (runtime_id,))
            return runtime_id

    @staticmethod
    def canonical_path(path: str, *, cwd: Path | None = None, home: Path | None = None) -> Path:
        if not isinstance(path, str) or not path or len(path) > 4096 or "\x00" in path:
            raise ValueError("Invalid workspace path")
        expanded = path
        if path == "~" or path.startswith("~/") or path.startswith("~\\"):
            home_path = (home or Path.home()).resolve(strict=True)
            expanded = str(home_path / path[2:]) if len(path) > 1 else str(home_path)
        candidate = Path(expanded)
        if not candidate.is_absolute():
            candidate = (cwd or Path.cwd()) / candidate
        canonical = candidate.resolve(strict=True)
        if not canonical.is_dir():
            raise ValueError("Workspace path must be a directory")
        return canonical

    def open_workspace(self, path: str, *, cwd: Path | None = None, home: Path | None = None) -> WorkspaceRecord:
        canonical = str(self.canonical_path(path, cwd=cwd, home=home))
        opened_at = _now()
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM workspaces WHERE canonical_path=?", (canonical,)).fetchone()
            if row:
                connection.execute(
                    "UPDATE workspaces SET last_opened_at=?, closed_at=NULL WHERE workspace_id=?",
                    (opened_at, row["workspace_id"]),
                )
                return WorkspaceRecord(str(row["workspace_id"]), canonical, str(row["created_at"]), opened_at, None)
            workspace_id = f"workspace-{uuid.uuid4()}"
            connection.execute(
                "INSERT INTO workspaces(workspace_id, canonical_path, created_at, last_opened_at, closed_at) VALUES(?, ?, ?, ?, NULL)",
                (workspace_id, canonical, opened_at, opened_at),
            )
            return WorkspaceRecord(workspace_id, canonical, opened_at, opened_at, None)

    def get_workspace(self, workspace_id: str, *, include_closed: bool = False) -> WorkspaceRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM workspaces WHERE workspace_id=?", (workspace_id,)).fetchone()
        record = self._record(row) if row else None
        return record if record and (include_closed or record.open) else None

    def list_workspaces(self, *, include_closed: bool = False) -> list[WorkspaceRecord]:
        query = "SELECT * FROM workspaces"
        if not include_closed:
            query += " WHERE closed_at IS NULL"
        query += " ORDER BY last_opened_at DESC, workspace_id"
        with self._lock, self._connect() as connection:
            rows = connection.execute(query).fetchall()
        return [self._record(row) for row in rows]

    def close_workspace(self, workspace_id: str) -> WorkspaceRecord | None:
        closed_at = _now()
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM workspaces WHERE workspace_id=?", (workspace_id,)).fetchone()
            if not row:
                return None
            if row["closed_at"] is None:
                connection.execute("UPDATE workspaces SET closed_at=? WHERE workspace_id=?", (closed_at, workspace_id))
            else:
                closed_at = str(row["closed_at"])
        return WorkspaceRecord(
            str(row["workspace_id"]),
            str(row["canonical_path"]),
            str(row["created_at"]),
            str(row["last_opened_at"]),
            closed_at,
        )

    @staticmethod
    def _record(row: sqlite3.Row) -> WorkspaceRecord:
        return WorkspaceRecord(
            str(row["workspace_id"]),
            str(row["canonical_path"]),
            str(row["created_at"]),
            str(row["last_opened_at"]),
            str(row["closed_at"]) if row["closed_at"] is not None else None,
        )
