"""Local OWOP file, search, and durable watch implementation."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import mimetypes
import os
import sqlite3
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.workspace.paths import WorkspacePathError, relative_parts, resolve_workspace_path
from drsai.owop.protocol import OWOPError
from drsai.owop.process_pty import LocalProcessPtyOperations
from drsai.owop.workspace_checkpoints import WorkspaceCheckpointStore

# git.exe is a console app: without CREATE_NO_WINDOW every git call from a
# console-less (packaged/Electron) process flashes a terminal window.
GIT_CREATIONFLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


IGNORED_DIRECTORIES = frozenset({".git", ".drsai", "node_modules", "__pycache__"})
DETERMINISTIC_MIME_TYPES = {
    ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown",
    ".json": "application/json", ".xml": "application/xml", ".csv": "text/csv",
    ".html": "text/html", ".htm": "text/html", ".css": "text/css",
    ".js": "text/javascript", ".ts": "text/typescript", ".py": "text/x-python",
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml",
}


def _mime_type(path: str) -> str | None:
    return DETERMINISTIC_MIME_TYPES.get(Path(path).suffix.lower()) or mimetypes.guess_type(path)[0]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _file_identity(info: os.stat_result) -> tuple[str, str]:
    """Return the device/inode identity of a file-system object as decimal strings."""

    return str(int(info.st_dev)), str(int(info.st_ino))


class _ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


class WorkspaceWatchJournal:
    def __init__(self, database: Path):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS owop_workspace_events (
                  workspace_id TEXT NOT NULL,
                  sequence INTEGER NOT NULL,
                  event_id TEXT NOT NULL UNIQUE,
                  resource_sequence INTEGER NOT NULL,
                  cursor TEXT NOT NULL,
                  dedupe_key TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  data_json TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(workspace_id, sequence),
                  UNIQUE(workspace_id, dedupe_key)
                );
                CREATE TABLE IF NOT EXISTS owop_file_resources (
                  workspace_id TEXT NOT NULL,
                  file_id TEXT NOT NULL,
                  relative_path TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  digest TEXT,
                  device TEXT NOT NULL,
                  inode TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  last_state TEXT NOT NULL DEFAULT 'available',
                  PRIMARY KEY(workspace_id, file_id),
                  UNIQUE(workspace_id, relative_path)
                );
                """
            )
            self._normalize_file_resource_schema(db)

    @staticmethod
    def _normalize_file_resource_schema(db: sqlite3.Connection) -> None:
        """Keep resource identity columns on TEXT and add missing state columns.

        ``st_dev`` and ``st_ino`` are unsigned 64-bit values on Windows (for example
        ``15615211651905627626``), which a SQLite ``INTEGER`` column cannot store, so
        identities are persisted as decimal strings, matching the runtime identity
        stores (``runtime_acl_projections``). Tables created before that change are
        rebuilt once; identities that already fit an ``INTEGER`` round-trip unchanged.
        """
        columns = {str(row[1]): str(row[2]).upper() for row in db.execute("PRAGMA table_info(owop_file_resources)")}
        if not columns:
            return
        if "last_state" not in columns:
            db.execute("ALTER TABLE owop_file_resources ADD COLUMN last_state TEXT NOT NULL DEFAULT 'available'")
        if columns.get("device", "").startswith("TEXT") and columns.get("inode", "").startswith("TEXT"):
            return
        db.executescript(
            """
            DROP TABLE IF EXISTS owop_file_resources_integer_identity;
            ALTER TABLE owop_file_resources RENAME TO owop_file_resources_integer_identity;
            CREATE TABLE owop_file_resources (
              workspace_id TEXT NOT NULL,
              file_id TEXT NOT NULL,
              relative_path TEXT NOT NULL,
              kind TEXT NOT NULL,
              digest TEXT,
              device TEXT NOT NULL,
              inode TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              last_state TEXT NOT NULL DEFAULT 'available',
              PRIMARY KEY(workspace_id, file_id),
              UNIQUE(workspace_id, relative_path)
            );
            INSERT INTO owop_file_resources
              (workspace_id,file_id,relative_path,kind,digest,device,inode,created_at,updated_at,last_state)
              SELECT workspace_id,file_id,relative_path,kind,digest,
                     CAST(device AS TEXT),CAST(inode AS TEXT),created_at,updated_at,last_state
              FROM owop_file_resources_integer_identity;
            DROP TABLE owop_file_resources_integer_identity;
            """
        )

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.database, timeout=30, factory=_ClosingConnection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def append(self, workspace_id: str, event_type: str, data: Mapping[str, Any], *, dedupe_key: str | None = None) -> dict[str, Any]:
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            sequence = int(db.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM owop_workspace_events WHERE workspace_id=?",
                (workspace_id,),
            ).fetchone()[0])
            event_id = f"event-{uuid.uuid4()}"
            dedupe = dedupe_key or event_id
            cursor = f"{workspace_id}:{sequence}"
            created = _now()
            try:
                db.execute(
                    "INSERT INTO owop_workspace_events VALUES(?,?,?,?,?,?,?,?,?)",
                    (workspace_id, sequence, event_id, sequence, cursor, dedupe, event_type, json.dumps(dict(data), separators=(",", ":"), sort_keys=True), created),
                )
            except sqlite3.IntegrityError:
                existing = db.execute(
                    "SELECT * FROM owop_workspace_events WHERE workspace_id=? AND dedupe_key=?",
                    (workspace_id, dedupe),
                ).fetchone()
                db.commit()
                if existing is None:
                    raise
                return self._event(existing)
            row = db.execute(
                "SELECT * FROM owop_workspace_events WHERE workspace_id=? AND sequence=?",
                (workspace_id, sequence),
            ).fetchone()
            db.commit()
        return self._event(row)

    def list(self, workspace_id: str, after_sequence: int, limit: int) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM owop_workspace_events WHERE workspace_id=? AND sequence>? ORDER BY sequence LIMIT ?",
                (workspace_id, after_sequence, limit),
            ).fetchall()
        return [self._event(row) for row in rows]

    def register_file_resource(
        self,
        workspace_id: str,
        relative_path: str,
        *,
        kind: str,
        digest: str | None,
        device: str,
        inode: str,
    ) -> dict[str, Any]:
        """Return a stable, Workspace-scoped opaque id for a file-system object.

        ``device`` and ``inode`` are decimal strings because file identities may be
        unsigned 64-bit values that do not fit a SQLite ``INTEGER`` column.
        """
        with self._lock, self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM owop_file_resources WHERE workspace_id=? AND relative_path=?",
                (workspace_id, relative_path),
            ).fetchone()
            now = _now()
            if existing is None:
                file_id = f"file-{uuid.uuid4()}"
                db.execute(
                    "INSERT INTO owop_file_resources "
                    "(workspace_id,file_id,relative_path,kind,digest,device,inode,created_at,updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?)",
                    (workspace_id, file_id, relative_path, kind, digest, device, inode, now, now),
                )
            else:
                file_id = str(existing["file_id"])
                db.execute(
                    "UPDATE owop_file_resources SET kind=?, digest=?, device=?, inode=?, updated_at=?, last_state='available' "
                    "WHERE workspace_id=? AND file_id=?",
                    (kind, digest, device, inode, now, workspace_id, file_id),
                )
            row = db.execute(
                "SELECT * FROM owop_file_resources WHERE workspace_id=? AND file_id=?",
                (workspace_id, file_id),
            ).fetchone()
            db.commit()
        return dict(row)

    def file_resource(self, workspace_id: str, file_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM owop_file_resources WHERE workspace_id=? AND file_id=?",
                (workspace_id, file_id),
            ).fetchone()
        return dict(row) if row is not None else None

    def move_file_resource(self, workspace_id: str, source: str, destination: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE owop_file_resources SET relative_path=?, updated_at=?, last_state='moved' "
                "WHERE workspace_id=? AND relative_path=?",
                (destination, _now(), workspace_id, source),
            )
            db.commit()

    def relocate_file_resource(self, workspace_id: str, file_id: str, destination: str) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE owop_file_resources SET relative_path=?, updated_at=?, last_state='moved' "
                "WHERE workspace_id=? AND file_id=?",
                (destination, _now(), workspace_id, file_id),
            )
            db.commit()

    @staticmethod
    def _event(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "version": "1.0",
            "event_id": row["event_id"],
            "workspace_id": row["workspace_id"],
            "sequence": row["sequence"],
            "resource_sequence": row["resource_sequence"],
            "cursor": row["cursor"],
            "dedupe_key": row["dedupe_key"],
            "type": row["event_type"],
            "data": json.loads(row["data_json"]),
        }


class LocalWorkspaceOperations:
    def __init__(
        self,
        workspace_id: str,
        root: Path,
        journal: WorkspaceWatchJournal,
        checkpoint_store: WorkspaceCheckpointStore | None = None,
        process_pty: LocalProcessPtyOperations | None = None,
        worktree_handlers: Mapping[str, Any] | None = None,
    ):
        self.workspace_id = workspace_id
        supplied_root = Path(root).absolute()
        supplied_info = supplied_root.lstat()
        supplied_attributes = int(getattr(supplied_info, "st_file_attributes", 0))
        if stat.S_ISLNK(supplied_info.st_mode) or supplied_attributes & int(
            getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        ):
            raise ValueError("Workspace root cannot be a symlink or junction")
        self.root = supplied_root.resolve(strict=True)
        if os.path.normcase(str(self.root)) != os.path.normcase(str(supplied_root)):
            raise ValueError("Workspace root must already be canonical")
        if not self.root.is_dir():
            raise ValueError("Workspace root must be a directory")
        root_info = self.root.stat()
        self._root_identity = (int(root_info.st_dev), int(root_info.st_ino))
        self.journal = journal
        self.checkpoints = checkpoint_store or WorkspaceCheckpointStore(journal.database.parent, workspace_id, self.root)
        self.process_pty = process_pty or LocalProcessPtyOperations(
            self.root, cwd_resolver=lambda value: self._path(value, strict=True)
        )
        self.worktree_handlers = dict(worktree_handlers or {})

    def handlers(self) -> dict[str, Any]:
        return {
            "workspace.describe": self.describe,
            "files.list": self.list_files,
            "files.register": self.register_file,
            "files.resolve": self.resolve_file,
            "files.stat": self.stat_file,
            "files.read": self.read_file,
            "files.write": self.write_file,
            "files.move": self.move_file,
            "files.remove": self.remove_file,
            "search.query": self.search,
            "watch.subscribe": self.watch,
            "git.status": self.git_status,
            "git.diff": self.git_diff,
            "git.file_at_ref": self.git_file_at_ref,
            "git.stage": self.git_stage,
            "git.unstage": self.git_unstage,
            "git.revert": self.git_revert,
            "git.commit": self.git_commit,
            **self.worktree_handlers,
            "checkpoint.create": self.checkpoint_create,
            "checkpoint.preview": self.checkpoint_preview,
            "checkpoint.restore": self.checkpoint_restore,
            "checkpoint.accept": self.checkpoint_accept,
            **self.process_pty.handlers(),
        }

    def close(self) -> None:
        self.process_pty.close()

    def describe(self, _params: Mapping[str, Any]) -> dict[str, Any]:
        return {"workspace_id": self.workspace_id, "canonical_path": str(self.root)}

    def _path(self, value: str, *, strict: bool) -> Path:
        try:
            self._assert_root_identity()
            parts = relative_parts(value)
            self._reject_reparse(parts, include_leaf=strict)
            path = resolve_workspace_path(self.root, value, strict=strict)
            self._assert_boundary(path)
            self._assert_root_identity()
            return path
        except (WorkspacePathError, FileNotFoundError, PermissionError) as exc:
            code = exc.code if isinstance(exc, WorkspacePathError) else "workspace_path_unavailable"
            raise OWOPError(code, str(exc), "operation", details={"path": value}) from exc

    def _assert_root_identity(self) -> None:
        try:
            info = self.root.lstat()
        except (FileNotFoundError, PermissionError) as exc:
            raise WorkspacePathError("workspace_root_changed", "Workspace root is no longer available.") from exc
        attributes = int(getattr(info, "st_file_attributes", 0))
        identity = (int(info.st_dev), int(info.st_ino))
        if (
            stat.S_ISLNK(info.st_mode)
            or attributes & int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))
            or identity != self._root_identity
        ):
            raise WorkspacePathError(
                "workspace_root_changed",
                "Workspace root changed after registration; reopen it before continuing.",
            )

    def _assert_boundary(self, path: Path) -> None:
        root = os.path.normcase(str(self.root))
        candidate = os.path.normcase(str(path))
        try:
            if os.path.commonpath([root, candidate]) != root:
                raise OWOPError("workspace_escape_rejected", "Path escapes Workspace root.", "operation")
        except ValueError as exc:
            raise OWOPError("workspace_escape_rejected", "Path is on another volume.", "operation") from exc

    def _reject_reparse(self, parts: tuple[str, ...], *, include_leaf: bool) -> None:
        current = self.root
        selected = parts if include_leaf else parts[:-1]
        for part in selected:
            current = current / part
            try:
                info = current.lstat()
            except FileNotFoundError:
                continue
            attributes = int(getattr(info, "st_file_attributes", 0))
            if stat.S_ISLNK(info.st_mode) or attributes & int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)):
                raise WorkspacePathError("workspace_reparse_point_rejected", "Workspace path crosses a symlink or junction.")

    def _secure_recheck(self, value: str, *, include_leaf: bool = False) -> None:
        try:
            self._assert_root_identity()
            self._reject_reparse(relative_parts(value), include_leaf=include_leaf)
            self._assert_root_identity()
        except WorkspacePathError as exc:
            raise OWOPError(exc.code, str(exc), "operation", details={"path": value}) from exc

    def _open_read(self, path: Path):
        handle = path.open("rb")
        try:
            resolved = Path(os.path.realpath(path)).resolve(strict=True)
            self._assert_boundary(resolved)
        except Exception:
            handle.close()
            raise
        return handle

    def list_files(self, params: Mapping[str, Any]) -> dict[str, Any]:
        base = self._path(str(params["path"]), strict=True)
        if not base.is_dir():
            raise OWOPError("workspace_path_invalid", "List path is not a directory.", "operation")
        include_ignored = bool(params.get("include_ignored", False))
        maximum_depth = int(params["depth"]) if params.get("depth") is not None else None
        entries: list[dict[str, Any]] = []
        for directory, names, files in os.walk(base):
            if not include_ignored:
                names[:] = [name for name in names if name not in IGNORED_DIRECTORIES]
            for name in sorted([*names, *files]):
                path = Path(directory) / name
                try:
                    depth = len(path.relative_to(base).parts)
                except ValueError:
                    continue
                if maximum_depth is not None and depth > maximum_depth:
                    continue
                relative = path.relative_to(self.root).as_posix()
                info = path.stat()
                entries.append({"path": relative, "kind": "directory" if path.is_dir() else "file", "size": info.st_size})
        entries.sort(key=lambda item: item["path"].casefold())
        offset = self._cursor(params.get("cursor"))
        limit = int(params["limit"])
        page = entries[offset:offset + limit]
        next_offset = offset + len(page)
        return {"entries": page, "cursor": str(next_offset) if next_offset < len(entries) else None, "total": len(entries)}

    def stat_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        path = self._path(str(params["path"]), strict=True)
        info = path.stat()
        result = {"path": path.relative_to(self.root).as_posix(), "kind": "directory" if path.is_dir() else "file", "size": info.st_size, "modified_ns": info.st_mtime_ns}
        if path.is_file():
            with self._open_read(path) as handle:
                snapshot = handle.read()
                result["size"] = len(snapshot)
                result["digest"] = _digest(snapshot)
        return result

    @staticmethod
    def _digest_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        return f"sha256:{digest.hexdigest()}"

    @staticmethod
    def _resource_capabilities(kind: str, mime_type: str | None) -> dict[str, bool]:
        previewable = kind == "file" and bool(
            (mime_type or "").startswith(("text/", "image/", "audio/", "video/"))
            or mime_type in {"application/json", "application/pdf", "application/xml"}
        )
        return {
            "read": kind == "file",
            "preview": previewable,
            "download": kind == "file",
            "reveal": True,
            "open_external": False,
        }

    def _file_resource_descriptor(
        self,
        file_id: str,
        relative_path: str,
        path: Path | None,
        *,
        state: str,
        digest: str | None = None,
    ) -> dict[str, Any]:
        if path is None:
            kind = "file"
            mime_type = _mime_type(relative_path)
            return {
                "file_id": file_id,
                "path": relative_path,
                "name": Path(relative_path).name,
                "kind": kind,
                "mime_type": mime_type,
                "size": 0,
                "modified_ns": 0,
                "digest": digest,
                "state": state,
                "capabilities": {key: False for key in ("read", "preview", "download", "reveal", "open_external")},
            }
        info = path.stat()
        kind = "directory" if path.is_dir() else "file"
        current_digest = self._digest_file(path) if kind == "file" else None
        mime_type = _mime_type(relative_path) if kind == "file" else None
        return {
            "file_id": file_id,
            "path": relative_path,
            "name": path.name,
            "kind": kind,
            "mime_type": mime_type,
            "size": info.st_size,
            "modified_ns": info.st_mtime_ns,
            "digest": current_digest,
            "state": state,
            "capabilities": self._resource_capabilities(kind, mime_type),
        }

    def register_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        value = str(params["path"])
        path = self._path(value, strict=True)
        info = path.stat()
        relative = path.relative_to(self.root).as_posix()
        kind = "directory" if path.is_dir() else "file"
        current_digest = self._digest_file(path) if kind == "file" else None
        expected_digest = params.get("expected_digest")
        if expected_digest is not None and expected_digest != current_digest:
            raise OWOPError(
                "owop_conflict",
                "File digest changed before registration.",
                "operation",
                details={"expected_digest": expected_digest, "actual_digest": current_digest},
            )
        device, inode = _file_identity(info)
        record = self.journal.register_file_resource(
            self.workspace_id,
            relative,
            kind=kind,
            digest=current_digest,
            device=device,
            inode=inode,
        )
        return {"resource": self._file_resource_descriptor(record["file_id"], relative, path, state="available")}

    def _find_relocated_resource(
        self,
        record: Mapping[str, Any],
        *,
        max_entries: int,
        deadline: float,
    ) -> tuple[tuple[str, Path] | None, int, bool]:
        """Bounded repair helper; never called from foreground resolve."""
        expected_identity = (str(record["device"]), str(record["inode"]))
        scanned = 0
        for directory, names, files in os.walk(self.root):
            names[:] = [name for name in names if name not in IGNORED_DIRECTORIES]
            for name in [*names, *files]:
                if scanned >= max_entries or time.monotonic() >= deadline:
                    return None, scanned, False
                scanned += 1
                candidate = Path(directory) / name
                try:
                    info = candidate.lstat()
                except (FileNotFoundError, PermissionError):
                    continue
                attributes = int(getattr(info, "st_file_attributes", 0))
                if stat.S_ISLNK(info.st_mode) or attributes & int(getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)):
                    continue
                if _file_identity(info) == expected_identity:
                    relative = candidate.relative_to(self.root).as_posix()
                    return (relative, candidate), scanned, True
        return None, scanned, True

    def repair_relocations(
        self,
        *,
        max_entries: int = 10_000,
        time_budget_seconds: float = 2.0,
    ) -> dict[str, Any]:
        """Run an explicitly scheduled, bounded relocation repair pass."""

        if not 1 <= max_entries <= 10_000 or not 0 < time_budget_seconds <= 2.0:
            raise ValueError("resource_repair_limits_invalid")
        deadline = time.monotonic() + time_budget_seconds
        scanned = 0
        repaired = 0
        complete = True
        # A bounded query avoids loading or scanning an unbounded index.
        with self.journal._connect() as db:
            records = [dict(row) for row in db.execute(
                "SELECT * FROM owop_file_resources WHERE workspace_id=? ORDER BY updated_at LIMIT ?",
                (self.workspace_id, max_entries),
            ).fetchall()]
        for record in records:
            if scanned >= max_entries or time.monotonic() >= deadline:
                complete = False
                break
            try:
                self._path(str(record["relative_path"]), strict=True)
                continue
            except OWOPError as exc:
                if exc.code not in {"workspace_path_unavailable", "workspace_path_invalid"}:
                    continue
            relocated, consumed, search_complete = self._find_relocated_resource(
                record,
                max_entries=max_entries - scanned,
                deadline=deadline,
            )
            scanned += consumed
            complete = complete and search_complete
            if relocated is not None:
                relative, _path = relocated
                self.journal.relocate_file_resource(self.workspace_id, str(record["file_id"]), relative)
                repaired += 1
            if not search_complete:
                break
        return {"scanned": scanned, "repaired": repaired, "complete": complete}

    def resolve_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        file_id = str(params["file_id"])
        record = self.journal.file_resource(self.workspace_id, file_id)
        if record is None:
            raise OWOPError("resource_not_found", "File resource is unavailable.", "operation")
        relative = str(record["relative_path"])
        try:
            path = self._path(relative, strict=True)
            state = str(record.get("last_state") or "available")
        except OWOPError as exc:
            if exc.code not in {"workspace_path_unavailable", "workspace_path_invalid"}:
                raise
            return {"resource": self._file_resource_descriptor(file_id, relative, None, state="deleted", digest=record.get("digest"))}
        descriptor = self._file_resource_descriptor(file_id, relative, path, state=state)
        expected_digest = params.get("expected_digest") or record.get("digest")
        if expected_digest and descriptor["digest"] != expected_digest and descriptor["state"] != "moved":
            descriptor["state"] = "changed"
        return {"resource": descriptor}

    def read_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        path = self._path(str(params["path"]), strict=True)
        offset, length = int(params["offset"]), int(params["length"])
        with self._open_read(path) as handle:
            digest = hashlib.sha256()
            size = 0
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
            handle.seek(offset)
            data = handle.read(length)
        return {
            "path": path.relative_to(self.root).as_posix(),
            "offset": offset,
            "size": size,
            "content_base64": base64.b64encode(data).decode("ascii"),
            "digest": f"sha256:{digest.hexdigest()}",
            "binary": b"\x00" in data,
            "eof": offset + len(data) >= size,
        }

    def write_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        value = str(params["path"])
        path = self._path(value, strict=False)
        parent = path.parent
        if bool(params.get("create_parents")):
            parent.mkdir(parents=True, exist_ok=True)
        self._secure_recheck(value)
        if not parent.is_dir():
            raise OWOPError("workspace_path_unavailable", "Destination parent does not exist.", "operation")
        expected = params.get("expected_digest")
        if path.exists():
            with self._open_read(path) as handle:
                current = handle.read()
        else:
            current = None
        current_digest = _digest(current) if current is not None else None
        if expected is not None and expected != current_digest:
            raise OWOPError(
                "owop_conflict", "File digest changed before write.", "operation",
                details={"expected_digest": expected, "actual_digest": current_digest},
            )
        try:
            content = base64.b64decode(str(params["content_base64"]), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise OWOPError("owop_content_invalid", "File content is not valid base64.", "operation") from exc
        temporary: Path | None = None
        try:
            descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.owop-", dir=parent)
            temporary = Path(name)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            self._secure_recheck(value)
            os.replace(temporary, path)
            temporary = None
            self._secure_recheck(value, include_leaf=True)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        event_type = "file.changed" if current is not None else "file.created"
        event = self.journal.append(self.workspace_id, event_type, {"path": value, "digest": _digest(content)})
        return {"path": value, "size": len(content), "digest": _digest(content), "event": event}

    def move_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        source_value, destination_value = str(params["source"]), str(params["destination"])
        source = self._path(source_value, strict=True)
        destination = self._path(destination_value, strict=False)
        expected = params.get("expected_digest")
        if expected is not None and source.is_file():
            with self._open_read(source) as handle:
                actual_digest = _digest(handle.read())
            if actual_digest != expected:
                raise OWOPError("owop_conflict", "Source digest changed before move.", "operation")
        destination.parent.mkdir(parents=True, exist_ok=True)
        self._secure_recheck(destination_value)
        os.replace(source, destination)
        self._secure_recheck(destination_value, include_leaf=True)
        self.journal.move_file_resource(self.workspace_id, source_value, destination_value)
        event = self.journal.append(self.workspace_id, "file.renamed", {"source": source_value, "destination": destination_value})
        return {"source": source_value, "destination": destination_value, "event": event}

    def remove_file(self, params: Mapping[str, Any]) -> dict[str, Any]:
        value = str(params["path"])
        path = self._path(value, strict=True)
        expected = params.get("expected_digest")
        if expected is not None and path.is_file():
            with self._open_read(path) as handle:
                actual_digest = _digest(handle.read())
            if actual_digest != expected:
                raise OWOPError("owop_conflict", "File digest changed before remove.", "operation")
        self._secure_recheck(value, include_leaf=True)
        if path.is_dir():
            if not params.get("recursive"):
                path.rmdir()
            else:
                import shutil
                shutil.rmtree(path)
        else:
            path.unlink()
        event = self.journal.append(self.workspace_id, "file.removed", {"path": value})
        return {"path": value, "event": event}

    def search(self, params: Mapping[str, Any]) -> dict[str, Any]:
        base = self._path(str(params.get("path") or "."), strict=True)
        query = str(params["query"]).casefold()
        matches: list[dict[str, Any]] = []
        for directory, names, files in os.walk(base):
            if not params.get("include_ignored"):
                names[:] = [name for name in names if name not in IGNORED_DIRECTORIES]
            for name in files:
                path = Path(directory) / name
                relative = path.relative_to(self.root).as_posix()
                if query in relative.casefold():
                    matches.append({"path": relative, "match": "path"})
                    continue
                if path.stat().st_size <= 1024 * 1024:
                    try:
                        text = path.read_text(encoding="utf-8")
                    except (UnicodeDecodeError, OSError):
                        continue
                    if query in text.casefold():
                        matches.append({"path": relative, "match": "content"})
        matches.sort(key=lambda item: item["path"].casefold())
        offset, limit = self._cursor(params.get("cursor")), int(params["limit"])
        page = matches[offset:offset + limit]
        next_offset = offset + len(page)
        return {"matches": page, "cursor": str(next_offset) if next_offset < len(matches) else None, "total": len(matches)}

    def watch(self, params: Mapping[str, Any]) -> dict[str, Any]:
        events = self.journal.list(self.workspace_id, int(params["after_sequence"]), int(params.get("limit") or 1000))
        return {"events": events, "last_sequence": events[-1]["sequence"] if events else int(params["after_sequence"])}

    def _git(self, args: list[str], *, text: bool = True) -> subprocess.CompletedProcess:
        try:
            completed = subprocess.run(
                ["git", *args],
                cwd=self.root,
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"},
                capture_output=True,
                text=text,
                timeout=60,
                creationflags=GIT_CREATIONFLAGS,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise OWOPError("git_unavailable", "Git operation could not start.", "operation") from exc
        if completed.returncode != 0:
            stderr = completed.stderr if text else completed.stderr.decode("utf-8", errors="replace")
            raise OWOPError(
                "git_command_failed",
                "Git operation failed.",
                "operation",
                details={"exit_code": completed.returncode, "stderr": str(stderr)[-4000:]},
            )
        return completed

    def _git_diff_bytes(self, *, path: str | None = None, staged: bool = False) -> bytes:
        args = ["diff", "--binary", "--no-ext-diff"]
        if staged:
            args.append("--cached")
        if path:
            self._path(path, strict=False)
            args.extend(["--", path])
        return self._git(args, text=False).stdout

    def git_status(self, _params: Mapping[str, Any]) -> dict[str, Any]:
        output = self._git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], text=False).stdout
        records = [item.decode("utf-8", errors="replace") for item in output.split(b"\0") if item]
        branch = self._git(["branch", "--show-current"]).stdout.strip() or None
        revision = self._git(["rev-parse", "HEAD"]).stdout.strip()
        changes = []
        for record in records:
            status = record[:2]
            path = record[3:] if len(record) > 3 else ""
            changes.append({"relative_path": path, "status": status})
        return {"clean": not records, "entries": records, "branch": branch, "revision": revision, "changes": changes}

    def git_diff(self, params: Mapping[str, Any]) -> dict[str, Any]:
        content = self._git_diff_bytes(path=str(params["path"]) if params.get("path") else None, staged=bool(params.get("staged")))
        maximum = 1024 * 1024
        binary = b"\x00" in content
        return {"diff": content[:maximum].decode("utf-8", errors="replace"), "text": content[:maximum].decode("utf-8", errors="replace"),
                "diff_digest": _digest(content), "staged": bool(params.get("staged")), "binary": binary,
                "truncated": len(content) > maximum, "stale_revision": False}

    def git_file_at_ref(self, params: Mapping[str, Any]) -> dict[str, Any]:
        path, reference = str(params["path"]), str(params["ref"])
        relative_parts(path)
        if reference.startswith("-") or any(character in reference for character in "\r\n\0"):
            raise OWOPError("git_ref_invalid", "Git ref is invalid.", "operation")
        content = self._git(["show", f"{reference}:{path}"], text=False).stdout
        maximum = int(params.get("max_bytes") or 1024 * 1024)
        return {"path": path, "ref": reference, "content_base64": base64.b64encode(content[:maximum]).decode("ascii"),
                "digest": _digest(content), "truncated": len(content) > maximum, "size": len(content)}

    def git_stage(self, params: Mapping[str, Any]) -> dict[str, Any]:
        paths = [str(value) for value in params["paths"]]
        for value in paths:
            self._path(value, strict=True)
        self._git(["add", "--", *paths])
        event = self.journal.append(self.workspace_id, "git.changed", {"action": "stage", "paths": paths})
        return {"paths": paths, "event": event}

    def git_unstage(self, params: Mapping[str, Any]) -> dict[str, Any]:
        paths = [str(value) for value in params["paths"]]
        for value in paths:
            relative_parts(value)
        self._git(["reset", "-q", "HEAD", "--", *paths])
        event = self.journal.append(self.workspace_id, "git.changed", {"action": "unstage", "paths": paths})
        return {"paths": paths, "event": event}

    def git_revert(self, params: Mapping[str, Any]) -> dict[str, Any]:
        paths = [str(value) for value in params["paths"]]
        current = self._git_diff_bytes()
        if _digest(current) != params["diff_digest"]:
            raise OWOPError("owop_conflict", "Git diff changed before revert.", "operation")
        for value in paths:
            relative_parts(value)
        self._git(["checkout", "--", *paths])
        event = self.journal.append(self.workspace_id, "git.changed", {"action": "revert", "paths": paths})
        return {"paths": paths, "event": event}

    def git_commit(self, params: Mapping[str, Any]) -> dict[str, Any]:
        current = self._git_diff_bytes(staged=True)
        if _digest(current) != params["diff_digest"]:
            raise OWOPError("owop_conflict", "Staged Git diff changed before commit.", "operation")
        completed = self._git(["commit", "-m", str(params["message"])])
        commit_id = self._git(["rev-parse", "HEAD"]).stdout.strip()
        event = self.journal.append(self.workspace_id, "git.changed", {"action": "commit", "commit_id": commit_id})
        return {"commit_id": commit_id, "summary": completed.stdout[-4000:], "event": event}

    def checkpoint_create(self, params: Mapping[str, Any]) -> dict[str, Any]:
        result = self.checkpoints.create(params)
        self.journal.append(self.workspace_id, "checkpoint.changed", {"action": "create", "checkpoint_id": result["checkpoint_id"]})
        return result

    def checkpoint_preview(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return self.checkpoints.preview(str(params["checkpoint_id"]))

    def checkpoint_restore(self, params: Mapping[str, Any]) -> dict[str, Any]:
        result = self.checkpoints.restore(str(params["checkpoint_id"]), str(params["preview_digest"]))
        self.journal.append(self.workspace_id, "checkpoint.changed", {"action": "restore", "checkpoint_id": result["checkpoint_id"]})
        return result

    def checkpoint_accept(self, params: Mapping[str, Any]) -> dict[str, Any]:
        result = self.checkpoints.accept(str(params["checkpoint_id"]))
        self.journal.append(self.workspace_id, "checkpoint.changed", {"action": "accept", "checkpoint_id": result["checkpoint_id"]})
        return result

    @staticmethod
    def _cursor(value: Any) -> int:
        if value in {None, ""}:
            return 0
        try:
            offset = int(value)
        except (TypeError, ValueError) as exc:
            raise OWOPError("owop_cursor_invalid", "Pagination cursor is invalid.", "operation") from exc
        if offset < 0:
            raise OWOPError("owop_cursor_invalid", "Pagination cursor is invalid.", "operation")
        return offset
