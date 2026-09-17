"""Offline maintenance entry point for the Runtime Conversation Journal.

``conversation.item.delta`` rows written before the delta-only contract carried the
accumulated Item payload, so a long answer copied itself into every delta row and a
single Session could reach gigabytes.  ``repair_legacy_delta_rows`` rewrites those
rows into their incremental form; the accumulated Item remains available in
``runtime_conversation_items`` and is re-attached whenever the Session is read.

Stop the desktop Runtime before running this: the repair writes to the Journal and
``--vacuum`` needs exclusive access to the database.  ``--dry-run`` is read-only: it
reports the reclaimable volume without writing rows or touching the schema.

``--purge-legacy-mirrors`` additionally deletes Journal rows that only mirror an
Item-projected Runtime Event.  ``_reconcile_conversation_journal`` used to import the
whole pre-Journal ``runtime_events`` table, streamed ``agent.message.delta`` and
``thinking.delta`` chunks included, and ``append_event`` mirrored
``subagent.markdown``/``subagent.thinking`` before those types were recognised as
Item content.  Those rows carry no ``item_id``, so OAEP could only demote them to a
content-free ``event.session.updated``; the text they hold is already persisted once
per Item.  Each removed Event is recorded in
``runtime_session_journal_compacted_runtime_events`` so the importer never writes it
back.

``--compact-runtime-events`` additionally reduces the stored payload of streamed
Runtime Events.  ``agent.message.delta``/``thinking.delta``/``subagent.*`` rows written
before ``compact_runtime_event_payload`` existed repeated the whole Run/Session binding
next to their chunk, which made a long answer's Event log an order of magnitude larger
than its text.  The rows themselves are kept -- Run Event cursors, ``list_events``
replay and the Relay's bounded SSE buffer read this log chunk by chunk -- so only the
repeated envelope is removed, and ``run_id``/``sequence``/``created_at`` plus the chunk
text stay in place.  ``runtime_events`` is append-only for ordinary writers, so the
pass runs under the same explicit maintenance marker the delta repair uses and disarms
it again for every batch.

Unless ``--no-backup`` is given, a transactionally consistent copy of the database is
created next to it before the first write and kept as the recovery point.  That and
the post-repair ``PRAGMA integrity_check`` follow the data-safety rules the offline
Runtime maintenance tools already use.  Both passes are idempotent and resumable, so
they can safely be re-run after an interruption.

    python -m drsai.backend.runtime.journal_maintenance --database <engine.sqlite3>
        [--session <session-id>] [--limit N] [--batch-size N] [--dry-run] [--vacuum]
        [--purge-legacy-mirrors] [--compact-runtime-events] [--backup PATH] [--no-backup]
        [--skip-integrity-check]
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from drsai.backend.runtime.journal import (
    compact_runtime_event_payloads,
    ensure_journal_delete_guard,
    ensure_journal_update_guard,
    ensure_runtime_event_guards,
    purge_legacy_event_mirrors,
    repair_legacy_delta_rows,
)


def _default_backup_path(database: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return database.with_name(f"{database.name}.pre-delta-repair-{stamp}.sqlite3")


def _backup_database(connection: sqlite3.Connection, destination: Path) -> None:
    """Copy the database with SQLite's online backup API.

    The copy is transactionally consistent even if the file is large, and it is
    written next to the original so a failed repair can be rolled back by hand.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(destination), timeout=30.0) as target:
        connection.backup(target)


def _integrity_check(connection: sqlite3.Connection) -> str:
    return str(connection.execute("PRAGMA integrity_check").fetchone()[0])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="journal_maintenance",
        description="Reclaim space from legacy cumulative Journal delta rows.",
    )
    parser.add_argument(
        "--database",
        required=True,
        help="path to the Runtime database (for example <DRSAI_HOME>/runtime/engine.sqlite3)",
    )
    parser.add_argument(
        "--session", default=None, help="repair a single Session id instead of every Session"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="maximum number of delta rows to scan"
    )
    parser.add_argument(
        "--batch-size", type=int, default=500, help="rows written per transaction"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="report the reclaimable volume without writing"
    )
    parser.add_argument(
        "--vacuum",
        action="store_true",
        help="VACUUM after a successful write to shrink the file",
    )
    parser.add_argument(
        "--backup",
        nargs="?",
        default=None,
        const="",
        metavar="PATH",
        help="write the pre-repair backup to PATH instead of the default sibling name",
    )
    parser.add_argument(
        "--no-backup", action="store_true", help="skip the pre-repair backup (not recommended)"
    )
    parser.add_argument(
        "--skip-integrity-check",
        action="store_true",
        help="skip the post-repair PRAGMA integrity_check",
    )
    parser.add_argument(
        "--purge-legacy-mirrors",
        action="store_true",
        help=(
            "also delete Journal rows that only mirror an Item-projected Runtime Event "
            "(streamed deltas and subagent streaming text)"
        ),
    )
    parser.add_argument(
        "--compact-runtime-events",
        action="store_true",
        help=(
            "also reduce the stored payload of streamed Runtime Events "
            "(agent.message.delta, thinking.delta, subagent.*) to the chunk they carry"
        ),
    )
    args = parser.parse_args(argv)

    database = Path(args.database).expanduser()
    if not database.is_file():
        print(json.dumps({"error": "database_not_found", "path": str(database)}))
        return 2

    started = time.monotonic()
    before = database.stat().st_size
    stats: dict[str, Any] = {"dry_run": bool(args.dry_run), "database_bytes_before": before}
    connection = sqlite3.connect(str(database), timeout=30.0)
    connection.row_factory = sqlite3.Row
    try:
        if not args.dry_run and not args.no_backup:
            # ``--backup`` with no value selects the default sibling name.
            backup = (
                Path(args.backup).expanduser() if args.backup else _default_backup_path(database)
            )
            _backup_database(connection, backup)
            stats["backup_path"] = str(backup)
            stats["backup_bytes"] = backup.stat().st_size
        # A Journal written before the maintenance escape existed keeps an
        # unconditional append-only trigger; upgrade it so the repair can commit.
        # A dry run must stay read-only, so it never touches the schema.
        if not args.dry_run and connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_session_journal'"
        ).fetchone():
            connection.execute(
                "CREATE TABLE IF NOT EXISTS runtime_session_journal_maintenance ("
                "singleton INTEGER PRIMARY KEY CHECK(singleton=1))"
            )
            ensure_journal_update_guard(connection)
            if args.purge_legacy_mirrors:
                ensure_journal_delete_guard(connection)
            connection.commit()
        if args.compact_runtime_events and not args.dry_run and connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_events'"
        ).fetchone():
            # The Event log is append-only too; upgrade its guard so the payload
            # compaction can rewrite rows, exactly like the Journal repair above.
            ensure_runtime_event_guards(connection)
            connection.commit()
        stats.update(
            repair_legacy_delta_rows(
                connection,
                session_id=args.session,
                batch_size=args.batch_size,
                limit=args.limit,
                dry_run=args.dry_run,
            )
        )
        if args.purge_legacy_mirrors:
            stats["purge_legacy_mirrors"] = purge_legacy_event_mirrors(
                connection,
                session_id=args.session,
                batch_size=args.batch_size,
                dry_run=args.dry_run,
            )
        if args.compact_runtime_events:
            stats["compact_runtime_events"] = compact_runtime_event_payloads(
                connection,
                batch_size=args.batch_size,
                limit=args.limit,
                dry_run=args.dry_run,
            )
        reclaimed = (
            int(stats["repaired"])
            + int(stats.get("purge_legacy_mirrors", {}).get("purged", 0))
            + int(stats.get("compact_runtime_events", {}).get("compacted", 0))
        )
        if args.vacuum and not args.dry_run and reclaimed:
            # VACUUM cannot run inside a transaction and needs exclusive access.
            connection.execute("VACUUM")
        if not args.dry_run and not args.skip_integrity_check:
            integrity = _integrity_check(connection)
            stats["integrity_check"] = integrity
            if integrity != "ok":
                stats["database_bytes_after"] = database.stat().st_size
                stats["elapsed_seconds"] = round(time.monotonic() - started, 2)
                stats["error"] = "integrity_check_failed"
                print(json.dumps(stats, indent=2, sort_keys=True))
                return 3
    except (sqlite3.Error, OSError) as error:
        print(json.dumps({"error": "sqlite_error", "message": str(error)}))
        return 1
    finally:
        connection.close()

    stats["database_bytes_after"] = database.stat().st_size
    stats["elapsed_seconds"] = round(time.monotonic() - started, 2)
    print(json.dumps(stats, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
