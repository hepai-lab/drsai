"""Runtime-owned Terminal identity, leases, output journal, and lifecycle state."""

from __future__ import annotations

import sqlite3
import threading
import time
import uuid
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol

try:
    from drsai.backend.runtime.terminal.screen import TerminalScreen
except ImportError:  # direct-file focused tests
    from screen import TerminalScreen  # type: ignore


ACTIVE_STATES = frozenset({"starting", "running", "detached", "reconnecting"})


class TerminalStateError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.detail = detail or {}


class TerminalHandle(Protocol):
    pid: int | None
    def write(self, data: bytes) -> None: ...
    def resize(self, cols: int, rows: int) -> None: ...
    def kill(self) -> None: ...


class TerminalProvider(Protocol):
    def spawn(
        self,
        *,
        cwd: Path,
        argv: list[str],
        cols: int,
        rows: int,
        on_output: Callable[[bytes], None],
        on_exit: Callable[[int | None, str | None], None],
    ) -> TerminalHandle: ...


@dataclass(frozen=True)
class TerminalWorkspaceBinding:
    workspace_id: str
    root: Path
    worktree_id: str | None = None


class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class TerminalStateService:
    def __init__(
        self,
        database: Path,
        runtime_id: str,
        provider: TerminalProvider,
        resolve_workspace: Callable[[str], TerminalWorkspaceBinding | None],
        *,
        max_event_bytes: int = 64 * 1024,
        max_journal_bytes: int = 1024 * 1024,
        journal_retention_seconds: int = 24 * 60 * 60,
        terminal_retention_seconds: int = 7 * 24 * 60 * 60,
        default_lease_seconds: int = 30,
    ):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self.runtime_id = runtime_id
        self.provider = provider
        self.resolve_workspace = resolve_workspace
        self.max_event_bytes = max(1, max_event_bytes)
        self.max_journal_bytes = max(self.max_event_bytes, max_journal_bytes)
        self.journal_retention_seconds = max(1, journal_retention_seconds)
        self.terminal_retention_seconds = max(1, terminal_retention_seconds)
        self.default_lease_seconds = max(1, default_lease_seconds)
        self._lock = threading.RLock()
        self._handles: dict[str, TerminalHandle] = {}
        self._screens: dict[str, TerminalScreen] = {}
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None, factory=_ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS runtime_terminals(
                  terminal_id TEXT PRIMARY KEY, runtime_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
                  worktree_id TEXT, cwd TEXT NOT NULL, shell TEXT, argv_json TEXT, status TEXT NOT NULL,
                  generation INTEGER NOT NULL, pid INTEGER, cols INTEGER NOT NULL, rows INTEGER NOT NULL,
                  created_at REAL NOT NULL, updated_at REAL NOT NULL, exited_at REAL,
                  exit_code INTEGER, exit_signal TEXT, last_sequence INTEGER NOT NULL DEFAULT 0,
                  first_sequence INTEGER NOT NULL DEFAULT 1, journal_bytes INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_terminals_workspace ON runtime_terminals(workspace_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS runtime_terminal_events(
                  terminal_id TEXT NOT NULL REFERENCES runtime_terminals(terminal_id), sequence INTEGER NOT NULL,
                  data BLOB NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(terminal_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS runtime_terminal_leases(
                  lease_id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL REFERENCES runtime_terminals(terminal_id),
                  client_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('reader','writer')),
                  created_at REAL NOT NULL, expires_at REAL NOT NULL, released_at REAL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_terminal_leases ON runtime_terminal_leases(terminal_id, expires_at);
                CREATE TABLE IF NOT EXISTS runtime_terminal_screens(
                  terminal_id TEXT PRIMARY KEY REFERENCES runtime_terminals(terminal_id),
                  snapshot_sequence INTEGER NOT NULL, generation INTEGER NOT NULL,
                  snapshot_json TEXT NOT NULL, updated_at REAL NOT NULL
                );
                """
            )
            columns = {str(row["name"]) for row in db.execute("PRAGMA table_info(runtime_terminals)")}
            if "argv_json" not in columns:
                db.execute("ALTER TABLE runtime_terminals ADD COLUMN argv_json TEXT")
            now = time.time()
            db.execute(
                "UPDATE runtime_terminals SET status='lost', updated_at=?, exited_at=COALESCE(exited_at, ?), "
                "exit_signal=COALESCE(exit_signal, 'runtime_restart') WHERE runtime_id=? AND status IN ('starting','running','detached','reconnecting')",
                (now, now, self.runtime_id),
            )
            db.execute("UPDATE runtime_terminal_leases SET released_at=? WHERE released_at IS NULL", (now,))

    def create(
        self,
        workspace_id: str,
        *,
        cwd: str = ".",
        argv: list[str] | None = None,
        shell: str | None = None,
        cols: int = 100,
        rows: int = 30,
    ) -> dict[str, Any]:
        binding = self.resolve_workspace(workspace_id)
        if binding is None:
            raise TerminalStateError("workspace_not_found", "Workspace is not open.")
        target = self._resolve_cwd(binding.root, cwd)
        cols, rows = self._dimensions(cols, rows)
        command = [str(item) for item in (argv or ([shell] if shell else [])) if str(item)]
        if not command:
            raise TerminalStateError("terminal_argv_invalid", "Terminal argv must contain a command.")
        terminal_id = f"terminal-{uuid.uuid4()}"
        now = time.time()
        with self._connect() as db:
            db.execute(
                "INSERT INTO runtime_terminals(terminal_id,runtime_id,workspace_id,worktree_id,cwd,shell,argv_json,status,generation,pid,cols,rows,created_at,updated_at,exited_at,exit_code,exit_signal,last_sequence,first_sequence,journal_bytes) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (terminal_id, self.runtime_id, workspace_id, binding.worktree_id, str(target), command[0], json.dumps(command), "starting", 1,
                 None, cols, rows, now, now, None, None, None, 0, 1, 0),
            )
            screen = TerminalScreen(rows, cols)
            self._screens[terminal_id] = screen
            self._save_screen(db, terminal_id, screen.snapshot(0, 1))
        try:
            handle = self.provider.spawn(
                cwd=target, argv=command, cols=cols, rows=rows,
                on_output=lambda data: self.append_output(terminal_id, data),
                on_exit=lambda code, signal: self.record_exit(terminal_id, code, signal),
            )
        except Exception as exc:
            self.record_exit(terminal_id, None, "spawn_failed")
            raise TerminalStateError("terminal_spawn_failed", str(exc), retryable=True) from exc
        self._handles[terminal_id] = handle
        with self._connect() as db:
            db.execute(
                "UPDATE runtime_terminals SET status='running', pid=?, updated_at=? WHERE terminal_id=? AND status='starting'",
                (handle.pid, time.time(), terminal_id),
            )
        return self.describe(terminal_id)

    def list(self, workspace_id: str | None = None) -> list[dict[str, Any]]:
        query, args = "SELECT * FROM runtime_terminals", ()
        if workspace_id:
            query, args = query + " WHERE workspace_id=?", (workspace_id,)
        query += " ORDER BY updated_at DESC, terminal_id"
        with self._connect() as db:
            rows = db.execute(query, args).fetchall()
        return [self._terminal(row) for row in rows]

    def describe(self, terminal_id: str) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM runtime_terminals WHERE terminal_id=?", (terminal_id,)).fetchone()
        if row is None:
            raise TerminalStateError("terminal_not_found", "Terminal does not exist.")
        return self._terminal(row)

    def attach(self, terminal_id: str, client_id: str, *, writer: bool, after_sequence: int = 0, lease_seconds: int | None = None, prefer_snapshot: bool = False) -> dict[str, Any]:
        terminal = self.describe(terminal_id)
        if terminal["status"] in {"exited", "lost"} and writer:
            raise TerminalStateError("terminal_not_writable", "Terminal is no longer writable.")
        now = time.time()
        expires = now + max(1, lease_seconds or self.default_lease_seconds)
        mode = "writer" if writer else "reader"
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE runtime_terminal_leases SET released_at=? WHERE released_at IS NULL AND expires_at<=?", (now, now))
            if writer:
                conflict = db.execute(
                    "SELECT lease_id, client_id, expires_at FROM runtime_terminal_leases "
                    "WHERE terminal_id=? AND mode='writer' AND released_at IS NULL AND expires_at>?",
                    (terminal_id, now),
                ).fetchone()
                if conflict:
                    db.rollback()
                    raise TerminalStateError("terminal_writer_conflict", "Terminal already has an active writer.", retryable=True,
                                             detail={"lease_id": conflict["lease_id"], "expires_at": conflict["expires_at"]})
            lease_id = f"terminal-lease-{uuid.uuid4()}"
            db.execute("INSERT INTO runtime_terminal_leases VALUES(?,?,?,?,?,?,NULL)", (lease_id, terminal_id, client_id, mode, now, expires))
            if terminal["status"] == "detached":
                db.execute("UPDATE runtime_terminals SET status='running', updated_at=? WHERE terminal_id=?", (now, terminal_id))
            db.commit()
        replay = self.replay(terminal_id, after_sequence, prefer_snapshot=prefer_snapshot)
        return {"lease_id": lease_id, "mode": mode, "expires_at": expires, "terminal": self.describe(terminal_id), **replay}

    def renew(self, lease_id: str, *, lease_seconds: int | None = None) -> dict[str, Any]:
        now, expires = time.time(), time.time() + max(1, lease_seconds or self.default_lease_seconds)
        with self._connect() as db:
            changed = db.execute(
                "UPDATE runtime_terminal_leases SET expires_at=? WHERE lease_id=? AND released_at IS NULL AND expires_at>?",
                (expires, lease_id, now),
            ).rowcount
        if not changed:
            raise TerminalStateError("terminal_lease_expired", "Terminal lease is expired or released.")
        return {"lease_id": lease_id, "expires_at": expires}

    def resume(
        self,
        terminal_id: str,
        lease_id: str,
        *,
        after_sequence: int = 0,
        lease_seconds: int | None = None,
        prefer_snapshot: bool = False,
    ) -> dict[str, Any]:
        now = time.time()
        expires = now + max(1, lease_seconds or self.default_lease_seconds)
        with self._connect() as db:
            lease = db.execute(
                "SELECT mode FROM runtime_terminal_leases WHERE lease_id=? AND terminal_id=? "
                "AND released_at IS NULL AND expires_at>?",
                (lease_id, terminal_id, now),
            ).fetchone()
            if lease is None:
                raise TerminalStateError("terminal_lease_expired", "Terminal lease is expired, released, or mismatched.")
            db.execute("UPDATE runtime_terminal_leases SET expires_at=? WHERE lease_id=?", (expires, lease_id))
        return {
            "lease_id": lease_id,
            "mode": str(lease["mode"]),
            "expires_at": expires,
            "terminal": self.describe(terminal_id),
            **self.replay(terminal_id, after_sequence, prefer_snapshot=prefer_snapshot),
        }

    def detach(self, lease_id: str, *, expected_terminal_id: str | None = None) -> dict[str, Any]:
        with self._connect() as db:
            lease = db.execute("SELECT * FROM runtime_terminal_leases WHERE lease_id=?", (lease_id,)).fetchone()
            if lease is None:
                raise TerminalStateError("terminal_lease_not_found", "Terminal lease does not exist.")
            if expected_terminal_id is not None and lease["terminal_id"] != expected_terminal_id:
                raise TerminalStateError("terminal_lease_mismatch", "Terminal lease belongs to a different Terminal.")
            db.execute("UPDATE runtime_terminal_leases SET released_at=COALESCE(released_at, ?) WHERE lease_id=?", (time.time(), lease_id))
            active = db.execute(
                "SELECT COUNT(*) FROM runtime_terminal_leases WHERE terminal_id=? AND released_at IS NULL AND expires_at>?",
                (lease["terminal_id"], time.time()),
            ).fetchone()[0]
            if not active:
                db.execute("UPDATE runtime_terminals SET status='detached', updated_at=? WHERE terminal_id=? AND status='running'", (time.time(), lease["terminal_id"]))
        return self.describe(str(lease["terminal_id"]))

    def write(self, lease_id: str, data: bytes, *, expected_terminal_id: str | None = None) -> None:
        terminal_id = self._writer_terminal(lease_id, expected_terminal_id=expected_terminal_id)
        handle = self._handles.get(terminal_id)
        if handle is None:
            raise TerminalStateError("terminal_process_unavailable", "Terminal process is unavailable.")
        handle.write(data)

    def resize(
        self, lease_id: str, cols: int, rows: int, *, expected_terminal_id: str | None = None
    ) -> dict[str, Any]:
        terminal_id = self._writer_terminal(lease_id, expected_terminal_id=expected_terminal_id)
        cols, rows = self._dimensions(cols, rows)
        handle = self._handles.get(terminal_id)
        if handle is None:
            raise TerminalStateError("terminal_process_unavailable", "Terminal process is unavailable.")
        handle.resize(cols, rows)
        with self._connect() as db:
            db.execute("UPDATE runtime_terminals SET cols=?, rows=?, updated_at=? WHERE terminal_id=?", (cols, rows, time.time(), terminal_id))
            screen = self._screens.get(terminal_id)
            if screen:
                screen.resize(rows, cols)
                terminal = self.describe(terminal_id)
                self._save_screen(db, terminal_id, screen.snapshot(terminal["last_sequence"], terminal["generation"]))
        return self.describe(terminal_id)

    def kill(self, terminal_id: str) -> dict[str, Any]:
        self.describe(terminal_id)
        handle = self._handles.get(terminal_id)
        if handle is not None:
            handle.kill()
        else:
            self.record_exit(terminal_id, None, "explicit_kill")
        return self.describe(terminal_id)

    def append_output(self, terminal_id: str, data: bytes) -> None:
        if not data:
            return
        for offset in range(0, len(data), self.max_event_bytes):
            block = bytes(data[offset:offset + self.max_event_bytes])
            with self._lock, self._connect() as db:
                db.execute("BEGIN IMMEDIATE")
                row = db.execute("SELECT last_sequence, journal_bytes FROM runtime_terminals WHERE terminal_id=?", (terminal_id,)).fetchone()
                if row is None:
                    db.rollback()
                    return
                sequence = int(row["last_sequence"]) + 1
                db.execute("INSERT INTO runtime_terminal_events VALUES(?,?,?,?)", (terminal_id, sequence, block, time.time()))
                screen = self._screens.get(terminal_id)
                if screen:
                    screen.feed(block)
                    generation = db.execute("SELECT generation FROM runtime_terminals WHERE terminal_id=?", (terminal_id,)).fetchone()[0]
                    self._save_screen(db, terminal_id, screen.snapshot(sequence, int(generation)))
                journal_bytes = int(row["journal_bytes"]) + len(block)
                expired = db.execute(
                    "SELECT sequence, length(data) AS size FROM runtime_terminal_events WHERE terminal_id=? AND created_at<? ORDER BY sequence",
                    (terminal_id, time.time() - self.journal_retention_seconds),
                ).fetchall()
                for event in expired:
                    db.execute("DELETE FROM runtime_terminal_events WHERE terminal_id=? AND sequence=?", (terminal_id, event["sequence"]))
                    journal_bytes -= int(event["size"])
                while journal_bytes > self.max_journal_bytes:
                    oldest = db.execute("SELECT sequence, length(data) AS size FROM runtime_terminal_events WHERE terminal_id=? ORDER BY sequence LIMIT 1", (terminal_id,)).fetchone()
                    if oldest is None:
                        break
                    db.execute("DELETE FROM runtime_terminal_events WHERE terminal_id=? AND sequence=?", (terminal_id, oldest["sequence"]))
                    journal_bytes -= int(oldest["size"])
                first = db.execute("SELECT COALESCE(MIN(sequence), ?) FROM runtime_terminal_events WHERE terminal_id=?", (sequence + 1, terminal_id)).fetchone()[0]
                db.execute("UPDATE runtime_terminals SET last_sequence=?, first_sequence=?, journal_bytes=?, updated_at=? WHERE terminal_id=?",
                           (sequence, int(first), journal_bytes, time.time(), terminal_id))
                db.commit()

    def snapshot(self, terminal_id: str) -> dict[str, Any]:
        self.describe(terminal_id)
        with self._connect() as db:
            row = db.execute("SELECT snapshot_json FROM runtime_terminal_screens WHERE terminal_id=?", (terminal_id,)).fetchone()
        if row is None:
            raise TerminalStateError("terminal_snapshot_unavailable", "Terminal screen snapshot is unavailable.", retryable=True)
        return json.loads(str(row["snapshot_json"]))

    def replay(self, terminal_id: str, after_sequence: int, *, prefer_snapshot: bool = False) -> dict[str, Any]:
        terminal = self.describe(terminal_id)
        snapshot_required = after_sequence < terminal["first_sequence"] - 1
        snapshot = self.snapshot(terminal_id) if snapshot_required or prefer_snapshot else None
        effective = int(snapshot["snapshot_sequence"]) if snapshot is not None else max(0, after_sequence)
        with self._connect() as db:
            rows = db.execute("SELECT sequence, data, created_at FROM runtime_terminal_events WHERE terminal_id=? AND sequence>? ORDER BY sequence", (terminal_id, effective)).fetchall()
        return {
            "snapshot_required": snapshot_required,
            "events": [{
                "terminal_id": terminal["terminal_id"], "runtime_id": terminal["runtime_id"],
                "workspace_id": terminal["workspace_id"], "worktree_id": terminal["worktree_id"],
                "generation": terminal["generation"], "sequence": int(row["sequence"]),
                "data": bytes(row["data"]), "created_at": float(row["created_at"]),
            } for row in rows],
            "last_sequence": terminal["last_sequence"],
            **({"snapshot": snapshot} if snapshot is not None else {}),
        }

    def record_exit(self, terminal_id: str, exit_code: int | None, signal: str | None) -> None:
        now = time.time()
        with self._connect() as db:
            db.execute("UPDATE runtime_terminals SET status='exited', exit_code=?, exit_signal=?, exited_at=?, updated_at=? WHERE terminal_id=? AND status NOT IN ('exited','lost')",
                       (exit_code, signal, now, now, terminal_id))
            db.execute("UPDATE runtime_terminal_leases SET released_at=? WHERE terminal_id=? AND released_at IS NULL", (now, terminal_id))
        self._handles.pop(terminal_id, None)
        self._screens.pop(terminal_id, None)

    def purge_expired(self, *, now: float | None = None) -> list[str]:
        """Remove terminal tombstones only after the configured diagnostic retention window."""
        cutoff = (now if now is not None else time.time()) - self.terminal_retention_seconds
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute(
                "SELECT terminal_id FROM runtime_terminals WHERE runtime_id=? AND status IN ('exited','lost') "
                "AND COALESCE(exited_at, updated_at)<? ORDER BY terminal_id",
                (self.runtime_id, cutoff),
            ).fetchall()
            terminal_ids = [str(row["terminal_id"]) for row in rows]
            for terminal_id in terminal_ids:
                db.execute("DELETE FROM runtime_terminal_leases WHERE terminal_id=?", (terminal_id,))
                db.execute("DELETE FROM runtime_terminal_events WHERE terminal_id=?", (terminal_id,))
                db.execute("DELETE FROM runtime_terminal_screens WHERE terminal_id=?", (terminal_id,))
                db.execute("DELETE FROM runtime_terminals WHERE terminal_id=?", (terminal_id,))
            db.commit()
        return terminal_ids

    @staticmethod
    def _save_screen(db: sqlite3.Connection, terminal_id: str, snapshot: dict[str, Any]) -> None:
        db.execute(
            "INSERT INTO runtime_terminal_screens VALUES(?,?,?,?,?) "
            "ON CONFLICT(terminal_id) DO UPDATE SET snapshot_sequence=excluded.snapshot_sequence, "
            "generation=excluded.generation, snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at",
            (terminal_id, int(snapshot["snapshot_sequence"]), int(snapshot["generation"]),
             json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), time.time()),
        )

    def _writer_terminal(self, lease_id: str, *, expected_terminal_id: str | None = None) -> str:
        with self._connect() as db:
            row = db.execute("SELECT terminal_id FROM runtime_terminal_leases WHERE lease_id=? AND mode='writer' AND released_at IS NULL AND expires_at>?", (lease_id, time.time())).fetchone()
        if row is None:
            raise TerminalStateError("terminal_writer_lease_required", "An active writer lease is required.")
        terminal_id = str(row["terminal_id"])
        if expected_terminal_id is not None and terminal_id != expected_terminal_id:
            raise TerminalStateError("terminal_lease_mismatch", "Terminal lease belongs to a different Terminal.")
        return terminal_id

    @staticmethod
    def _resolve_cwd(root: Path, relative: str) -> Path:
        if not relative or "\x00" in relative or Path(relative).is_absolute():
            raise TerminalStateError("terminal_cwd_invalid", "Terminal cwd must be Workspace-relative.")
        root = root.resolve(strict=True)
        target = (root / relative).resolve(strict=True)
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise TerminalStateError("terminal_cwd_escape", "Terminal cwd escapes the Workspace.") from exc
        if not target.is_dir():
            raise TerminalStateError("terminal_cwd_invalid", "Terminal cwd must be a directory.")
        return target

    @staticmethod
    def _dimensions(cols: int, rows: int) -> tuple[int, int]:
        return max(20, min(int(cols), 500)), max(5, min(int(rows), 200))

    @staticmethod
    def _terminal(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "terminal_id": row["terminal_id"], "runtime_id": row["runtime_id"],
            "workspace_id": row["workspace_id"], "worktree_id": row["worktree_id"],
            "cwd": row["cwd"], "shell": row["shell"],
            "argv": json.loads(row["argv_json"]) if row["argv_json"] else ([row["shell"]] if row["shell"] else []),
            "status": row["status"],
            "generation": int(row["generation"]), "pid": row["pid"], "cols": int(row["cols"]), "rows": int(row["rows"]),
            "created_at": float(row["created_at"]), "updated_at": float(row["updated_at"]),
            "exited_at": float(row["exited_at"]) if row["exited_at"] is not None else None,
            "exit_code": row["exit_code"], "exit_signal": row["exit_signal"],
            "last_sequence": int(row["last_sequence"]), "first_sequence": int(row["first_sequence"]),
            "journal_bytes": int(row["journal_bytes"]),
        }
