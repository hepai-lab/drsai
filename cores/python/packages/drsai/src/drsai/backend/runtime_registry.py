"""Persistent identity and workspace registry for an OpenDrSai Runtime."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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


_WORKTREE_TRANSITIONS: dict[str, frozenset[str]] = {
    "creating": frozenset({"active", "archived", "removing"}),
    "active": frozenset({"review", "merge_pending", "archived", "removing"}),
    "review": frozenset({"active", "merge_pending", "merged", "archived", "removing"}),
    "merge_pending": frozenset({"active", "review", "merged", "archived", "removing"}),
    "merged": frozenset({"removing"}),
    "archived": frozenset({"active", "removing"}),
    "removing": frozenset({"removed"}),
    "removed": frozenset(),
}


@dataclass(frozen=True)
class WorktreeRecord:
    worktree_id: str
    idempotency_key: str
    source_workspace_id: str
    workspace_id: str | None
    repo_root: str
    canonical_path: str
    branch: str
    base_commit: str
    status: str
    location: str
    source_dirty: bool
    source_status_summary: str | None
    created_at: str
    updated_at: str
    removed_at: str | None
    last_error_code: str | None
    last_error_message: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "worktree_id": self.worktree_id,
            "idempotency_key": self.idempotency_key,
            "source_workspace_id": self.source_workspace_id,
            "workspace_id": self.workspace_id,
            "repo_root": self.repo_root,
            "canonical_path": self.canonical_path,
            "branch": self.branch,
            "base_commit": self.base_commit,
            "status": self.status,
            "location": self.location,
            "source_dirty": self.source_dirty,
            "source_status_summary": self.source_status_summary,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "removed_at": self.removed_at,
            "last_error_code": self.last_error_code,
            "last_error_message": self.last_error_message,
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
                CREATE TABLE IF NOT EXISTS worktrees (
                    worktree_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL,
                    source_workspace_id TEXT NOT NULL REFERENCES workspaces(workspace_id),
                    workspace_id TEXT UNIQUE REFERENCES workspaces(workspace_id),
                    repo_root TEXT NOT NULL,
                    canonical_path TEXT NOT NULL UNIQUE,
                    branch TEXT NOT NULL,
                    base_commit TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN (
                        'creating', 'active', 'review', 'merge_pending', 'merged', 'archived', 'removing', 'removed'
                    )),
                    location TEXT NOT NULL CHECK(location IN ('local', 'remote')),
                    source_dirty INTEGER NOT NULL DEFAULT 0 CHECK(source_dirty IN (0, 1)),
                    source_status_summary TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    removed_at TEXT,
                    last_error_code TEXT,
                    last_error_message TEXT,
                    CHECK(workspace_id IS NULL OR workspace_id <> source_workspace_id),
                    UNIQUE(source_workspace_id, idempotency_key),
                    UNIQUE(repo_root, branch)
                );
                CREATE INDEX IF NOT EXISTS idx_worktrees_source_status
                    ON worktrees(source_workspace_id, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_worktrees_workspace
                    ON worktrees(workspace_id);
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

    def reserve_worktree(
        self,
        *,
        source_workspace_id: str,
        idempotency_key: str,
        repo_root: str,
        canonical_path: str,
        branch: str,
        base_commit: str,
        location: str,
        source_dirty: bool = False,
        source_status_summary: str | None = None,
    ) -> WorktreeRecord:
        """Reserve one Worktree identity before the Git side effect occurs."""
        if not idempotency_key or len(idempotency_key) > 256 or "\x00" in idempotency_key:
            raise ValueError("Invalid Worktree idempotency key")
        if location not in {"local", "remote"}:
            raise ValueError("Invalid Worktree location")
        for name, value, limit in (
            ("repo root", repo_root, 4096), ("canonical path", canonical_path, 4096),
            ("branch", branch, 255), ("base commit", base_commit, 128),
        ):
            if not isinstance(value, str) or not value or len(value) > limit or "\x00" in value:
                raise ValueError(f"Invalid Worktree {name}")
        source = self.get_workspace(source_workspace_id)
        if source is None:
            raise KeyError("Source Workspace is not open")
        resolved_repo = str(Path(repo_root).resolve(strict=True))
        resolved_target = str(Path(canonical_path).resolve(strict=False))
        if resolved_target == source.path:
            raise ValueError("Worktree path must differ from Source Workspace")
        created_at = _now()
        with self._lock, self._connect() as connection:
            existing = connection.execute(
                "SELECT * FROM worktrees WHERE source_workspace_id=? AND idempotency_key=?",
                (source_workspace_id, idempotency_key),
            ).fetchone()
            if existing:
                self._assert_same_worktree_reservation(
                    existing, resolved_repo, resolved_target, branch, base_commit, location
                )
                return self._worktree_record(existing)
            worktree_id = f"worktree-{uuid.uuid4()}"
            try:
                connection.execute(
                    """INSERT INTO worktrees(
                        worktree_id, idempotency_key, source_workspace_id, workspace_id,
                        repo_root, canonical_path, branch, base_commit, status, location,
                        source_dirty, source_status_summary, created_at, updated_at
                    ) VALUES(?, ?, ?, NULL, ?, ?, ?, ?, 'creating', ?, ?, ?, ?, ?)""",
                    (
                        worktree_id, idempotency_key, source_workspace_id, resolved_repo,
                        resolved_target, branch, base_commit, location, int(source_dirty),
                        source_status_summary, created_at, created_at,
                    ),
                )
            except sqlite3.IntegrityError:
                # A concurrent caller may have committed the same idempotency key.
                existing = connection.execute(
                    "SELECT * FROM worktrees WHERE source_workspace_id=? AND idempotency_key=?",
                    (source_workspace_id, idempotency_key),
                ).fetchone()
                if existing:
                    self._assert_same_worktree_reservation(
                        existing, resolved_repo, resolved_target, branch, base_commit, location
                    )
                    return self._worktree_record(existing)
                raise
            row = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
        assert row is not None
        return self._worktree_record(row)

    def bind_worktree_workspace(self, worktree_id: str) -> WorktreeRecord:
        """Register the created Worktree path as its independent execution Workspace."""
        current = self.get_worktree(worktree_id)
        if current is None:
            raise KeyError("Worktree not found")
        if current.workspace_id:
            return current
        workspace = self.open_workspace(current.canonical_path)
        if workspace.workspace_id == current.source_workspace_id:
            raise ValueError("Worktree Workspace must differ from Source Workspace")
        updated_at = _now()
        with self._lock, self._connect() as connection:
            connection.execute(
                """UPDATE worktrees SET workspace_id=?, status='active', updated_at=?,
                   last_error_code=NULL, last_error_message=NULL
                   WHERE worktree_id=? AND workspace_id IS NULL AND status='creating'""",
                (workspace.workspace_id, updated_at, worktree_id),
            )
            row = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
        if row is None:
            raise KeyError("Worktree not found")
        record = self._worktree_record(row)
        if record.workspace_id != workspace.workspace_id:
            raise RuntimeError("Worktree binding conflict")
        return record

    def get_worktree(self, worktree_id: str) -> WorktreeRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
        return self._worktree_record(row) if row else None

    def get_worktree_by_workspace(self, workspace_id: str, *, include_removed: bool = False) -> WorktreeRecord | None:
        query = "SELECT * FROM worktrees WHERE workspace_id=?"
        if not include_removed:
            query += " AND status<>'removed'"
        with self._lock, self._connect() as connection:
            row = connection.execute(query, (workspace_id,)).fetchone()
        return self._worktree_record(row) if row else None

    def get_worktree_by_path(self, canonical_path: str, *, include_removed: bool = False) -> WorktreeRecord | None:
        query = "SELECT * FROM worktrees WHERE canonical_path=?"
        if not include_removed:
            query += " AND status<>'removed'"
        with self._lock, self._connect() as connection:
            row = connection.execute(query, (canonical_path,)).fetchone()
        return self._worktree_record(row) if row else None

    def get_worktree_by_idempotency(self, source_workspace_id: str, idempotency_key: str) -> WorktreeRecord | None:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM worktrees WHERE source_workspace_id=? AND idempotency_key=?",
                (source_workspace_id, idempotency_key),
            ).fetchone()
        return self._worktree_record(row) if row else None

    def list_worktrees(
        self,
        *,
        source_workspace_id: str | None = None,
        include_removed: bool = False,
    ) -> list[WorktreeRecord]:
        conditions: list[str] = []
        parameters: list[str] = []
        if source_workspace_id is not None:
            conditions.append("source_workspace_id=?")
            parameters.append(source_workspace_id)
        if not include_removed:
            conditions.append("status<>'removed'")
        query = "SELECT * FROM worktrees"
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY updated_at DESC, worktree_id"
        with self._lock, self._connect() as connection:
            rows = connection.execute(query, parameters).fetchall()
        return [self._worktree_record(row) for row in rows]

    def transition_worktree(
        self,
        worktree_id: str,
        target_status: str,
        *,
        expected_status: str | None = None,
    ) -> WorktreeRecord:
        if target_status not in _WORKTREE_TRANSITIONS:
            raise ValueError("Invalid Worktree status")
        updated_at = _now()
        with self._lock, self._connect() as connection:
            row = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
            if row is None:
                raise KeyError("Worktree not found")
            current = str(row["status"])
            if expected_status is not None and current != expected_status:
                raise RuntimeError("Worktree state conflict")
            if current != target_status and target_status not in _WORKTREE_TRANSITIONS[current]:
                raise ValueError(f"Illegal Worktree transition: {current} -> {target_status}")
            removed_at = updated_at if target_status == "removed" else row["removed_at"]
            connection.execute(
                "UPDATE worktrees SET status=?, updated_at=?, removed_at=? WHERE worktree_id=?",
                (target_status, updated_at, removed_at, worktree_id),
            )
            updated = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
        assert updated is not None
        return self._worktree_record(updated)

    def record_worktree_error(self, worktree_id: str, code: str, message: str) -> WorktreeRecord:
        if not code or not message:
            raise ValueError("Worktree error code and message are required")
        updated_at = _now()
        with self._lock, self._connect() as connection:
            changed = connection.execute(
                "UPDATE worktrees SET last_error_code=?, last_error_message=?, updated_at=? WHERE worktree_id=?",
                (code[:128], message[:4000], updated_at, worktree_id),
            ).rowcount
            if not changed:
                raise KeyError("Worktree not found")
            row = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
        assert row is not None
        return self._worktree_record(row)

    def update_worktree_branch(self, worktree_id: str, branch: str) -> WorktreeRecord:
        if not branch or len(branch) > 255 or "\x00" in branch:
            raise ValueError("Invalid Worktree branch")
        updated_at = _now()
        with self._lock, self._connect() as connection:
            try:
                changed = connection.execute(
                    "UPDATE worktrees SET branch=?, updated_at=? WHERE worktree_id=? AND status<>'removed'",
                    (branch, updated_at, worktree_id),
                ).rowcount
            except sqlite3.IntegrityError as exc:
                raise RuntimeError("Worktree branch conflict") from exc
            if not changed:
                raise KeyError("Worktree not found")
            row = connection.execute("SELECT * FROM worktrees WHERE worktree_id=?", (worktree_id,)).fetchone()
        assert row is not None
        return self._worktree_record(row)

    @staticmethod
    def _record(row: sqlite3.Row) -> WorkspaceRecord:
        return WorkspaceRecord(
            str(row["workspace_id"]),
            str(row["canonical_path"]),
            str(row["created_at"]),
            str(row["last_opened_at"]),
            str(row["closed_at"]) if row["closed_at"] is not None else None,
        )

    @staticmethod
    def _worktree_record(row: sqlite3.Row) -> WorktreeRecord:
        return WorktreeRecord(
            worktree_id=str(row["worktree_id"]),
            idempotency_key=str(row["idempotency_key"]),
            source_workspace_id=str(row["source_workspace_id"]),
            workspace_id=str(row["workspace_id"]) if row["workspace_id"] is not None else None,
            repo_root=str(row["repo_root"]),
            canonical_path=str(row["canonical_path"]),
            branch=str(row["branch"]),
            base_commit=str(row["base_commit"]),
            status=str(row["status"]),
            location=str(row["location"]),
            source_dirty=bool(row["source_dirty"]),
            source_status_summary=str(row["source_status_summary"]) if row["source_status_summary"] is not None else None,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
            removed_at=str(row["removed_at"]) if row["removed_at"] is not None else None,
            last_error_code=str(row["last_error_code"]) if row["last_error_code"] is not None else None,
            last_error_message=str(row["last_error_message"]) if row["last_error_message"] is not None else None,
        )

    @staticmethod
    def _assert_same_worktree_reservation(
        row: sqlite3.Row,
        repo_root: str,
        canonical_path: str,
        branch: str,
        base_commit: str,
        location: str,
    ) -> None:
        actual = tuple(str(row[key]) for key in ("repo_root", "canonical_path", "branch", "base_commit", "location"))
        expected = (repo_root, canonical_path, branch, base_commit, location)
        if actual != expected:
            raise RuntimeError("Worktree idempotency key was reused with different arguments")
