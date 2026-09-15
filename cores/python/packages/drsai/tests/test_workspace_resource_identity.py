"""Resource identity persistence in the local Workspace watch journal."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from drsai.owop.local_workspace import LocalWorkspaceOperations, WorkspaceWatchJournal


LEGACY_RESOURCE_TABLE = """
CREATE TABLE owop_file_resources (
  workspace_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT,
  device INTEGER NOT NULL,
  inode INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, file_id),
  UNIQUE(workspace_id, relative_path)
);
"""


def _column_types(database: Path) -> dict[str, str]:
    with sqlite3.connect(database) as db:
        return {str(row[1]): str(row[2]).upper() for row in db.execute("PRAGMA table_info(owop_file_resources)")}


def _table_names(database: Path) -> set[str]:
    with sqlite3.connect(database) as db:
        return {str(row[0]) for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_unsigned_64_bit_file_identity_survives_reopen(tmp_path: Path) -> None:
    database = tmp_path / "workspace-events.sqlite3"
    device, inode = str(2**64 - 1), str(2**63 + 5)
    journal = WorkspaceWatchJournal(database)
    registered = journal.register_file_resource(
        "workspace-a", "resource.txt", kind="file", digest=None, device=device, inode=inode,
    )

    record = WorkspaceWatchJournal(database).file_resource("workspace-a", registered["file_id"])

    assert (record["device"], record["inode"]) == (device, inode)
    assert _column_types(database)["device"] == "TEXT"
    assert _column_types(database)["inode"] == "TEXT"


def test_legacy_integer_identity_table_is_rebuilt_once(tmp_path: Path) -> None:
    database = tmp_path / "workspace-events.sqlite3"
    with sqlite3.connect(database) as db:
        db.executescript(LEGACY_RESOURCE_TABLE)
        db.execute(
            "INSERT INTO owop_file_resources VALUES(?,?,?,?,?,?,?,?,?)",
            ("workspace-a", "file-legacy", "legacy.txt", "file", "sha256:" + "0" * 64, 7, 11, "t0", "t0"),
        )

    journal = WorkspaceWatchJournal(database)
    migrated = journal.file_resource("workspace-a", "file-legacy")

    assert (migrated["device"], migrated["inode"]) == ("7", "11")
    assert migrated["last_state"] == "available"
    assert _column_types(database)["device"] == "TEXT"
    assert "owop_file_resources_integer_identity" not in _table_names(database)

    journal.register_file_resource(
        "workspace-a", "legacy.txt", kind="file", digest=None, device=str(2**64 - 1), inode=str(2**63),
    )
    assert journal.file_resource("workspace-a", "file-legacy")["device"] == str(2**64 - 1)
    assert "owop_file_resources_integer_identity" not in _table_names(database)


def test_relocation_repair_matches_persisted_identity(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    journal = WorkspaceWatchJournal(tmp_path / "state" / "workspace-events.sqlite3")
    operations = LocalWorkspaceOperations("workspace-a", root, journal)
    (root / "draft.txt").write_text("v1", encoding="utf-8")
    file_id = operations.register_file({"path": "draft.txt"})["resource"]["file_id"]
    persisted = journal.file_resource("workspace-a", file_id)

    (root / "draft.txt").replace(root / "moved.txt")
    moved = (root / "moved.txt").stat()
    assert (str(moved.st_dev), str(moved.st_ino)) == (persisted["device"], persisted["inode"])

    repaired = operations.repair_relocations()

    assert repaired == {"scanned": 1, "repaired": 1, "complete": True}
    assert journal.file_resource("workspace-a", file_id)["relative_path"] == "moved.txt"
