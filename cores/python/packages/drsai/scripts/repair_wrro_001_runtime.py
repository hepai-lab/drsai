"""Offline repair for WRRO-001 Runtime Journal growth.

The tool is intentionally dry-run by default. Apply mode builds and verifies a
staging database first, then retains the untouched original database as the
backup during the final atomic replacement. It never compacts beyond either
the legacy Session Relay cursor or the OAEP Relay cursor.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT / "src"))

from drsai.backend.runtime.journal import RuntimeConversationJournal  # noqa: E402


CRITICAL_TABLES = {
    "runtime_sessions": "session_id",
    "runtime_runs": "run_id",
    "runtime_events": "event_id",
    "runtime_conversation_items": "item_id",
    "runtime_oaep_items": "item_id",
}


def _connect_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None


def _relay_cursors(control: Path, table: str) -> dict[str, int]:
    if not control.is_file():
        return {}
    with closing(_connect_readonly(control)) as connection:
        if not _table_exists(connection, table):
            return {}
        return {
            str(row["session_id"]): int(row["after_sequence"])
            for row in connection.execute(
                f"SELECT session_id,after_sequence FROM {table}"
            )
        }


def analyze(database: Path, control: Path, *, retain_events: int) -> dict[str, Any]:
    legacy = _relay_cursors(control, "relay_session_event_cursors")
    oaep = _relay_cursors(control, "relay_oaep_event_cursors")
    candidates: list[dict[str, Any]] = []
    with closing(_connect_readonly(database)) as connection:
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
        rows = connection.execute(
            "SELECT session_id,last_sequence,earliest_retained_sequence "
            "FROM runtime_session_sequences ORDER BY session_id"
        ).fetchall()
        total_journal = int(connection.execute(
            "SELECT COUNT(*) FROM runtime_session_journal"
        ).fetchone()[0])
        total_oaep = int(connection.execute(
            "SELECT COUNT(*) FROM runtime_oaep_events"
        ).fetchone()[0]) if _table_exists(connection, "runtime_oaep_events") else 0
        removable_total = 0
        removable_bytes = 0
        for row in rows:
            session_id = str(row["session_id"])
            last = int(row["last_sequence"])
            earliest = int(row["earliest_retained_sequence"])
            relay_boundary = min(legacy.get(session_id, 0), oaep.get(session_id, 0))
            through = min(max(0, last - retain_events), relay_boundary)
            if through < earliest:
                continue
            removable = int(connection.execute(
                "SELECT COUNT(*) FROM runtime_session_journal "
                "WHERE session_id=? AND session_sequence<=?",
                (session_id, through),
            ).fetchone()[0])
            if not removable:
                continue
            payload_bytes = int(connection.execute(
                "SELECT COALESCE(SUM(LENGTH(payload_json)),0) "
                "FROM runtime_session_journal WHERE session_id=? AND session_sequence<=?",
                (session_id, through),
            ).fetchone()[0])
            oaep_bytes = int(connection.execute(
                "SELECT COALESCE(SUM(LENGTH(envelope_json)),0) "
                "FROM runtime_oaep_events WHERE session_id=? AND session_sequence<=?",
                (session_id, through),
            ).fetchone()[0]) if _table_exists(connection, "runtime_oaep_events") else 0
            removable_total += removable
            removable_bytes += payload_bytes + oaep_bytes
            candidates.append({
                "session_id": session_id,
                "last_sequence": last,
                "earliest_retained_sequence": earliest,
                "legacy_relay_cursor": legacy.get(session_id, 0),
                "oaep_relay_cursor": oaep.get(session_id, 0),
                "compact_through_sequence": through,
                "removable_events": removable,
                "estimated_payload_bytes": payload_bytes + oaep_bytes,
            })
    return {
        "issue": "WRRO-001",
        "mode": "dry-run",
        "database": str(database),
        "control_database": str(control),
        "integrity_check": integrity,
        "database_bytes": database.stat().st_size,
        "journal_events": total_journal,
        "oaep_events": total_oaep,
        "retain_events_per_session": retain_events,
        "candidate_sessions": len(candidates),
        "removable_events": removable_total,
        "estimated_removable_payload_bytes": removable_bytes,
        "candidates": candidates,
    }


def _logical_fingerprint(database: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    with closing(_connect_readonly(database)) as connection:
        for table, key in CRITICAL_TABLES.items():
            if not _table_exists(connection, table):
                continue
            digest = hashlib.sha256()
            count = 0
            for row in connection.execute(f"SELECT * FROM {table} ORDER BY {key}"):
                digest.update(json.dumps(
                    list(row), ensure_ascii=False, separators=(",", ":"), default=str
                ).encode("utf-8"))
                digest.update(b"\n")
                count += 1
            result[table] = {"rows": count, "sha256": digest.hexdigest()}
    return result


def _sqlite_backup(source: Path, destination: Path) -> None:
    with closing(sqlite3.connect(source)) as source_db, closing(sqlite3.connect(destination)) as target_db:
        source_db.backup(target_db)


def _assert_integrity(database: Path) -> None:
    with closing(sqlite3.connect(database)) as connection:
        result = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
    if result != "ok":
        raise RuntimeError(f"sqlite_integrity_failed:{result}")


def apply_repair(
    database: Path,
    control: Path,
    *,
    retain_events: int,
    backup: Path,
) -> dict[str, Any]:
    report = analyze(database, control, retain_events=retain_events)
    if report["integrity_check"] != "ok":
        raise RuntimeError("source_sqlite_integrity_failed")
    if backup.exists():
        raise FileExistsError(f"Backup already exists: {backup}")
    staging = database.with_name(f".{database.name}.wrro-001-staging-{os.getpid()}")
    if staging.exists():
        staging.unlink()
    before = _logical_fingerprint(database)
    _sqlite_backup(database, staging)
    try:
        runtime_id = _runtime_id(staging)
        journal = RuntimeConversationJournal(staging, runtime_id)
        removed = 0
        for candidate in report["candidates"]:
            session_id = str(candidate["session_id"])
            through = int(candidate["compact_through_sequence"])
            journal.checkpoint(session_id)
            compacted = journal.compact(session_id, through_sequence=through)
            removed += int(compacted["removed_events"])
        connection = sqlite3.connect(staging)
        try:
            connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            connection.execute("VACUUM")
        finally:
            connection.close()
        _assert_integrity(staging)
        after = _logical_fingerprint(staging)
        if before != after:
            raise RuntimeError("critical_runtime_projection_changed")
        _assert_runtime_offline(database)
        database.replace(backup)
        try:
            staging.replace(database)
        except Exception:
            backup.replace(database)
            raise
        _assert_integrity(database)
        report.update({
            "mode": "applied",
            "backup": str(backup),
            "removed_events_actual": removed,
            "database_bytes_after": database.stat().st_size,
            "critical_fingerprints": after,
        })
        return report
    finally:
        if staging.exists():
            staging.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{staging}{suffix}")
            if sidecar.exists():
                sidecar.unlink()


def _runtime_id(database: Path) -> str:
    with closing(_connect_readonly(database)) as connection:
        row = connection.execute(
            "SELECT runtime_id FROM runtime_session_journal LIMIT 1"
        ).fetchone()
        if row is not None and row[0]:
            return str(row[0])
        row = connection.execute("SELECT runtime_id FROM runtime_runs LIMIT 1").fetchone()
        return str(row[0]) if row is not None and row[0] else "runtime-maintenance"


def _assert_runtime_offline(database: Path) -> None:
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(database, timeout=0.2, isolation_level=None)
        connection.execute("PRAGMA locking_mode=EXCLUSIVE")
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.execute("BEGIN EXCLUSIVE")
        connection.execute("ROLLBACK")
    except sqlite3.Error as exc:
        raise RuntimeError(
            "runtime_database_is_active; stop OpenDrSai Runtime and retry"
        ) from exc
    finally:
        if connection is not None:
            connection.close()
    # WAL/SHM files can remain after an unclean exit even when no process owns
    # the database. Removing them after an exclusive checkpoint distinguishes
    # stale sidecars from live Windows file handles without guessing by size.
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{database}{suffix}")
        if not sidecar.exists():
            continue
        try:
            sidecar.unlink()
        except PermissionError as exc:
            raise RuntimeError(
                f"runtime_database_is_active:{sidecar.name}; stop OpenDrSai Runtime and retry"
            ) from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--control-database", type=Path)
    parser.add_argument("--retain-events", type=int, default=100)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args(argv)
    database = args.database.expanduser().resolve()
    control = (args.control_database or database.with_name("relay-control.sqlite3")).expanduser().resolve()
    if not database.is_file():
        parser.error(f"Runtime database does not exist: {database}")
    if args.retain_events < 1:
        parser.error("--retain-events must be positive")
    if args.apply:
        backup = (args.backup or database.with_name(
            f"{database.stem}.pre-wrro-001{database.suffix}"
        )).expanduser().resolve()
        report = apply_repair(
            database, control, retain_events=args.retain_events, backup=backup
        )
    else:
        report = analyze(database, control, retain_events=args.retain_events)
    output = report if not args.summary_only else {
        key: value for key, value in report.items() if key != "candidates"
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
