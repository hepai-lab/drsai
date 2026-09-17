"""Journal rows that only mirror a Runtime Event must be removable, safely.

Two generations of writers stored the same streamed text twice: the canonical
Item journal (``runtime_conversation_items`` plus its ``conversation.item.delta``
rows) and, next to it, a copy of the raw Runtime Event.

* ``_reconcile_conversation_journal`` imported the whole pre-Journal
  ``runtime_events`` table -- streamed ``agent.message.delta``/``thinking.delta``
  chunks included -- as audit rows with no ``item_id``.
* ``append_event`` mirrored ``subagent.markdown``/``subagent.thinking`` as
  ``session.updated`` before those types were recognised as Item content.

Neither row can carry Item identity, so the OAEP projection could only demote
them to a content-free ``event.session.updated``.  On a real machine this was the
largest single consumer of the Runtime database: one Session alone held 23,781
``subagent.markdown`` mirror rows, and 53.86 MiB of the Journal was imported
``agent.message.delta`` copies.

``purge_legacy_event_mirrors`` deletes those rows.  These tests guard the four
properties that make the deletion safe:

1. only mirrors are removed -- canonical Items, their delta rows and every other
   event kind survive;
2. nothing is removed while the audit copy in ``runtime_events`` is missing, so
   the purge never becomes the last owner of the content;
3. each removed Event is recorded in the compaction ledger, so
   ``_reconcile_conversation_journal`` cannot import it back;
4. the append-only guard still holds for ordinary writers, and ``--dry-run``
   writes nothing at all.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path

import pytest

from drsai.backend.runtime import journal_maintenance
from drsai.backend.runtime.engine import (
    RuntimeEngine,
    RuntimeEngineIdentity,
    _session_event_kind,
)
from drsai.backend.runtime.journal import (
    DELTA_ACCUMULATED_KEYS,
    ensure_journal_delete_guard,
    purge_legacy_event_mirrors,
)

WORKSPACE_ID = "ws-purge"
BIG_CHUNK = "abcdefghijklmnop" * 128  # 2048 chars
STREAMED_MIRROR_TYPES = ("message.delta", "agent.message.delta", "thinking.delta")
SUBAGENT_MIRROR_TYPES = ("subagent.markdown", "subagent.thinking")


def _canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _engine(tmp_path: Path) -> tuple[RuntimeEngine, Path]:
    database = tmp_path / "engine.sqlite3"
    engine = RuntimeEngine(
        database=database,
        identity=RuntimeEngineIdentity(runtime_id="rt-purge", instance_id="inst-purge"),
        workspace_exists=lambda workspace_id: workspace_id == WORKSPACE_ID,
    )
    return engine, database


def _connection(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(database), timeout=30.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


def _stream(engine: RuntimeEngine, chunks: list[str]) -> tuple[str, str]:
    """Create a Session/Run and stream ``chunks`` as assistant message deltas."""
    session = engine.create_session(WORKSPACE_ID, "legacy mirror purge")
    session_id = str(session["session_id"])
    run, _created = engine.create_run(session_id, "agent-definition", f"idem-{session_id}")
    run_id = str(run["run_id"])
    for index, chunk in enumerate(chunks, start=1):
        engine.append_event(run_id, "message.delta", {"text": chunk, "index": index})
    return session_id, run_id


def _journal_rows(database: Path, session_id: str) -> list[dict[str, object]]:
    connection = _connection(database)
    try:
        rows = connection.execute(
            "SELECT rowid,event_id,event_kind,item_id,dedupe_key,payload_json"
            " FROM runtime_session_journal WHERE session_id=? ORDER BY rowid",
            (session_id,),
        ).fetchall()
    finally:
        connection.close()
    return [dict(row) for row in rows]


def _mirror_rows(database: Path, session_id: str) -> list[dict[str, object]]:
    """Journal rows the legacy writers left behind: no Item identity."""
    return [
        row
        for row in _journal_rows(database, session_id)
        if row["item_id"] is None and _mirrored_type(row) is not None
    ]


def _canonical_rows(database: Path, session_id: str) -> list[dict[str, object]]:
    return [row for row in _journal_rows(database, session_id) if row["item_id"] is not None]


def _runtime_events(database: Path, run_id: str) -> list[dict[str, object]]:
    connection = _connection(database)
    try:
        rows = connection.execute(
            "SELECT event_id,event_type FROM runtime_events WHERE run_id=? ORDER BY sequence",
            (run_id,),
        ).fetchall()
    finally:
        connection.close()
    return [dict(row) for row in rows]


def _append_runtime_event(database: Path, run_id: str, event_type: str, text: str) -> str:
    """Append one Runtime Event row, as the legacy ``append_event`` wrote it."""
    connection = _connection(database)
    try:
        sequence = int(
            connection.execute(
                "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?",
                (run_id,),
            ).fetchone()[0]
        )
        event_id = f"event-{uuid.uuid4()}"
        connection.execute(
            "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,"
            "created_at,backend_event_key) VALUES(?,?,?,?,?,?,NULL)",
            (event_id, run_id, sequence, event_type, _canonical({"text": text}),
             "2026-01-01T00:00:00+00:00"),
        )
    finally:
        connection.close()
    return event_id


def _imported_mirror(
    engine: RuntimeEngine,
    database: Path,
    session_id: str,
    run_id: str,
    *,
    event_type: str,
    text: str = BIG_CHUNK,
    source_event_id: str | None = None,
    migrated: bool = True,
    backend_event_key: str | None = None,
) -> dict[str, object]:
    """Re-create one Journal audit row exactly as the legacy writers left it.

    ``_reconcile_conversation_journal`` appended
    ``{"runtime_event_id", "type", "data", "migrated"}``; ``append_event``
    mirrored the same shape without ``migrated``.  Unless ``source_event_id`` is
    given, a real ``runtime_events`` row is appended first, so the audit copy the
    purge checks for exists exactly as it does in production.
    """
    if source_event_id is None:
        source_event_id = _append_runtime_event(database, run_id, event_type, text)
    payload: dict[str, object] = {
        "runtime_event_id": source_event_id,
        "type": event_type,
        "data": {"text": text},
    }
    if backend_event_key is not None:
        payload["backend_event_key"] = backend_event_key
    if migrated:
        payload["migrated"] = True
    connection = _connection(database)
    try:
        event, _created = engine.conversation_journal.append_event_in_transaction(
            connection,
            session_id,
            _session_event_kind(event_type),
            payload,
            run_id=run_id,
            dedupe_key=f"runtime-event:{source_event_id}",
        )
    finally:
        connection.close()
    assert str(event["item_id"] or "") == "", "a mirror row never has Item identity"
    return event


def _payload(row: dict[str, object]) -> dict[str, object]:
    """Decoded payload of a raw Journal row or of a decoded Journal event."""
    decoded = row.get("payload")
    if isinstance(decoded, dict):
        return decoded
    return json.loads(str(row["payload_json"]))  # type: ignore[return-value]


def _is_mirrorable(event_type: str) -> bool:
    """The Runtime Event types whose Journal mirrors the purge removes."""
    return event_type.endswith(".delta") or event_type in SUBAGENT_MIRROR_TYPES


def _payload_type(row: dict[str, object]) -> str | None:
    event_type = _payload(row).get("type")
    return event_type if isinstance(event_type, str) else None


def _mirrored_type(row: dict[str, object]) -> str | None:
    event_type = _payload_type(row)
    if event_type is None or not _is_mirrorable(event_type):
        return None
    return event_type


def _source_event_id(row: dict[str, object]) -> str:
    return str(_payload(row)["runtime_event_id"])


def _ledger(database: Path) -> set[str]:
    connection = _connection(database)
    try:
        rows = connection.execute(
            "SELECT runtime_event_id FROM runtime_session_journal_compacted_runtime_events"
        ).fetchall()
    finally:
        connection.close()
    return {str(row[0]) for row in rows}


def _maintenance_armed(database: Path) -> bool:
    connection = _connection(database)
    try:
        return bool(
            connection.execute(
                "SELECT COUNT(*) FROM runtime_session_journal_maintenance"
            ).fetchone()[0]
        )
    finally:
        connection.close()


def _purge(database: Path, **kwargs: object) -> dict[str, int]:
    connection = _connection(database)
    try:
        return purge_legacy_event_mirrors(connection, **kwargs)  # type: ignore[arg-type]
    finally:
        connection.close()


def _oaep_envelopes(database: Path, session_id: str) -> list[dict[str, object]]:
    connection = _connection(database)
    try:
        rows = connection.execute(
            "SELECT event_id,envelope_json FROM runtime_oaep_events"
            " WHERE session_id=? ORDER BY session_sequence",
            (session_id,),
        ).fetchall()
    finally:
        connection.close()
    return [
        {"event_id": str(row["event_id"]), **json.loads(str(row["envelope_json"]))}
        for row in rows
    ]


def _mirror_envelopes(database: Path, session_id: str) -> list[dict[str, object]]:
    return [
        envelope
        for envelope in _oaep_envelopes(database, session_id)
        if isinstance(envelope.get("data"), dict) and "runtime_event_id" in envelope["data"]
    ]


# --------------------------------------------------------------------------- #
# The duplication this tool exists to remove
# --------------------------------------------------------------------------- #


def test_purge_removes_mirrors_and_keeps_the_canonical_journal(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    chunks = [BIG_CHUNK] * 3
    session_id, run_id = _stream(engine, chunks)
    canonical_before = _canonical_rows(database, session_id)
    assert len(canonical_before) == len(chunks)

    # the audit copies the legacy reconciler imported for the same content
    streamed_events = [
        event
        for event in _runtime_events(database, run_id)
        if _is_mirrorable(str(event["event_type"]))
    ]
    assert len(streamed_events) == len(chunks)
    for event in streamed_events:
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=str(event["event_type"]),
            source_event_id=str(event["event_id"]),
        )
    mirrors = _mirror_rows(database, session_id)
    assert len(mirrors) == len(chunks)
    # ... and every one of them projects to a content-free Session update
    assert [envelope["type"] for envelope in _mirror_envelopes(database, session_id)] == [
        "event.session.updated"
    ] * len(chunks)

    before_bytes = sum(len(str(row["payload_json"])) for row in mirrors)
    report = _purge(database)

    assert report["scanned"] == len(chunks)
    assert report["purged"] == len(chunks)
    assert report["unmarked"] == 0
    assert report["skipped_source_missing"] == 0
    assert report["bytes_before"] == before_bytes
    assert report["oaep_events_removed"] == len(chunks)
    assert _mirror_rows(database, session_id) == []
    assert _mirror_envelopes(database, session_id) == []

    # the canonical Item Journal is untouched, byte for byte
    assert _canonical_rows(database, session_id) == canonical_before
    for row in _canonical_rows(database, session_id):
        payload = json.loads(str(row["payload_json"]))["payload"]
        assert set(DELTA_ACCUMULATED_KEYS).isdisjoint(payload)
        assert payload["delta"] == BIG_CHUNK

    # the removed Events are recorded so the importer cannot write them back
    assert _ledger(database) == {_source_event_id(row) for row in mirrors}

    # the raw audit log still holds the content the mirrors copied
    assert [
        str(event["event_id"])
        for event in _runtime_events(database, run_id)
        if _is_mirrorable(str(event["event_type"]))
    ] == [str(event["event_id"]) for event in streamed_events]


def test_purge_keeps_every_reader_working(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    chunks = [BIG_CHUNK] * 3
    session_id, run_id = _stream(engine, chunks)
    for event in _runtime_events(database, run_id):
        if not _is_mirrorable(str(event["event_type"])):
            continue
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=str(event["event_type"]),
            source_event_id=str(event["event_id"]),
        )

    def read_all() -> dict[str, object]:
        snapshot = engine.conversation_snapshot(session_id)
        oaep = engine.oaep_snapshot(session_id)
        return {
            # The legacy Session Event projection re-attaches the accumulated Item
            # payload, but only for the rows the Item journal owns.  A mirror row
            # never has it, so it must not be counted as reader-visible content.
            "canonical_texts": [
                str(event["payload"]["payload"]["text"])
                for event in engine.list_session_events(session_id)
                if event["kind"] == "conversation.item.delta"
                and isinstance(event["payload"].get("payload"), dict)
            ],
            "snapshot": snapshot,
            "snapshot_texts": [
                str(item["payload"]["text"]) for item in snapshot["items"]
            ],
            "oaep": oaep,
            "oaep_texts": [str(item["content"]["text"]) for item in oaep["items"]],
            # the OAEP delta stream is projected from the chunk the Item journal
            # stored, so it must survive the removal of the mirror envelopes
            "oaep_deltas": [
                str(event["data"]["delta"]["text"])
                for event in engine.list_oaep_events(session_id)
                if event["type"] == "event.item.delta"
            ],
        }

    before = read_all()
    assert before["canonical_texts"] == [BIG_CHUNK * len(chunks)] * len(chunks)
    assert before["snapshot_texts"] == [BIG_CHUNK * len(chunks)]
    assert before["oaep_texts"] == [BIG_CHUNK * len(chunks)]
    assert before["oaep_deltas"] == [BIG_CHUNK] * len(chunks)

    assert _purge(database)["purged"] == len(chunks)

    after = read_all()
    # every reader returns exactly what it returned before the purge
    assert after["canonical_texts"] == before["canonical_texts"]
    assert after["snapshot"] == before["snapshot"]
    assert after["snapshot_texts"] == before["snapshot_texts"]
    assert after["oaep"] == before["oaep"]
    assert after["oaep_texts"] == before["oaep_texts"]
    assert after["oaep_deltas"] == before["oaep_deltas"]
    # the waterline comes from the Session sequence counter, which only ever grows,
    # so removing Journal rows cannot rewind it
    assert after["oaep"]["snapshot_sequence"] == before["oaep"]["snapshot_sequence"] > 0


def test_purge_removes_subagent_streaming_mirrors(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    for event_type in SUBAGENT_MIRROR_TYPES:
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=event_type, migrated=False,
        )
    mirrors = _mirror_rows(database, session_id)
    assert [_mirrored_type(row) for row in mirrors] == list(SUBAGENT_MIRROR_TYPES)

    report = _purge(database, session_id=session_id)

    assert report["purged"] == 2
    assert _mirror_rows(database, session_id) == []
    assert len(_canonical_rows(database, session_id)) == 1
    assert _ledger(database) == {_source_event_id(row) for row in mirrors}


def test_purge_leaves_other_event_kinds_alone(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    kept: set[str] = set()
    for event_type in ("tool.state.changed", "artifact.created", "run.state.changed"):
        kept.add(str(_imported_mirror(
            engine, database, session_id, run_id,
            event_type=event_type, text="kept", migrated=False,
        )["event_id"]))
    purged = _imported_mirror(
        engine, database, session_id, run_id,
        event_type="agent.message.delta", migrated=False,
    )

    report = _purge(database, session_id=session_id)

    assert report["purged"] == 1
    remaining = {str(row["event_id"]) for row in _journal_rows(database, session_id)}
    assert kept <= remaining
    assert str(purged["event_id"]) not in remaining
    assert _ledger(database) == {_source_event_id(purged)}


# --------------------------------------------------------------------------- #
# Safety: the purge must never become the last owner of the content
# --------------------------------------------------------------------------- #


def test_purge_keeps_a_mirror_whose_audit_event_is_gone(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    orphan = _imported_mirror(
        engine, database, session_id, run_id,
        event_type="agent.message.delta", migrated=False,
    )
    live = _imported_mirror(
        engine, database, session_id, run_id,
        event_type="thinking.delta", migrated=False,
    )

    # drop the Runtime Event behind one mirror, as a legacy Event prune would
    connection = _connection(database)
    try:
        connection.execute("DROP TRIGGER runtime_events_no_delete")
        connection.execute(
            "DELETE FROM runtime_events WHERE event_id=?", (_source_event_id(orphan),)
        )
    finally:
        connection.close()

    report = _purge(database, session_id=session_id)

    assert report["scanned"] == 2
    assert report["purged"] == 1
    assert report["skipped_source_missing"] == 1
    remaining = _mirror_rows(database, session_id)
    assert [str(row["event_id"]) for row in remaining] == [str(orphan["event_id"])]
    # the surviving row is still readable and still carries its text
    assert json.loads(str(remaining[0]["payload_json"]))["data"]["text"] == BIG_CHUNK
    assert _ledger(database) == {_source_event_id(live)}


def test_purge_skips_rows_without_a_source_event_id(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    connection = _connection(database)
    try:
        event, _created = engine.conversation_journal.append_event_in_transaction(
            connection,
            session_id,
            "conversation.item.delta",
            # an even older shape: raw Runtime Event data, no Event identity
            {"type": "agent.message.delta", "data": {"delta": BIG_CHUNK}},
            run_id=run_id,
        )
    finally:
        connection.close()

    report = _purge(database, session_id=session_id)

    assert report["scanned"] == 1
    assert report["purged"] == 0
    assert report["unmarked"] == 1
    # it cannot be recorded in the ledger, so it stays rather than risk the
    # importer writing it back
    assert _ledger(database) == set()
    assert [str(row["event_id"]) for row in _mirror_rows(database, session_id)] == [
        str(event["event_id"])
    ]


def test_purge_dry_run_reports_without_writing(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK, BIG_CHUNK])
    for event_type in STREAMED_MIRROR_TYPES:
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=event_type, migrated=False,
        )
    before = _journal_rows(database, session_id)
    envelopes_before = _oaep_envelopes(database, session_id)

    report = _purge(database, dry_run=True)

    assert report["scanned"] == 3
    assert report["purged"] == 3
    assert report["bytes_before"] > 0
    assert report["oaep_events_removed"] == 0
    assert _journal_rows(database, session_id) == before
    assert _oaep_envelopes(database, session_id) == envelopes_before
    assert _ledger(database) == set()
    assert _maintenance_armed(database) is False


def test_purge_is_idempotent(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK, BIG_CHUNK])
    for event_type in STREAMED_MIRROR_TYPES:
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=event_type, migrated=False,
        )
    assert _purge(database)["purged"] == 3

    second = _purge(database)
    assert second["purged"] == 0
    assert second["scanned"] == 0
    assert second["bytes_before"] == 0


def test_purge_walks_every_row_in_bounded_batches(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    expected = 5
    for index in range(expected):
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type="agent.message.delta", text=f"{BIG_CHUNK}{index}", migrated=False,
        )

    # One call chains as many batches as it needs: the cursor advances past each
    # deleted batch, so a small batch size never skips a row.
    report = _purge(database, batch_size=2)

    assert report["scanned"] == expected
    assert report["purged"] == expected
    assert _mirror_rows(database, session_id) == []
    assert len(_ledger(database)) == expected
    assert len(_canonical_rows(database, session_id)) == 1

    # re-running over the emptied Journal has nothing left to reclaim
    assert _purge(database, batch_size=2) == {
        "scanned": 0,
        "purged": 0,
        "unmarked": 0,
        "skipped_source_missing": 0,
        "bytes_before": 0,
        "oaep_events_removed": 0,
    }


def test_purge_batch_size_one_never_skips_a_row(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    expected = 4
    for index in range(expected):
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type="thinking.delta", text=f"{BIG_CHUNK}{index}", migrated=False,
        )

    report = _purge(database, batch_size=1)

    assert report["scanned"] == expected
    assert report["purged"] == expected
    assert _mirror_rows(database, session_id) == []
    assert len(_ledger(database)) == expected


def test_purge_can_target_a_single_session(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    purged_session, purged_run = _stream(engine, [BIG_CHUNK])
    kept_session, kept_run = _stream(engine, [BIG_CHUNK])
    kept = _imported_mirror(
        engine, database, kept_session, kept_run,
        event_type="agent.message.delta", migrated=False,
    )
    purged = _imported_mirror(
        engine, database, purged_session, purged_run,
        event_type="agent.message.delta", migrated=False,
    )

    report = _purge(database, session_id=purged_session)

    assert report["purged"] == 1
    assert _mirror_rows(database, purged_session) == []
    assert [str(row["event_id"]) for row in _mirror_rows(database, kept_session)] == [
        str(kept["event_id"])
    ]
    assert _ledger(database) == {_source_event_id(purged)}


def test_purge_rejects_invalid_batch_size(tmp_path: Path) -> None:
    _unused_engine, database = _engine(tmp_path)
    with pytest.raises(ValueError):
        _purge(database, batch_size=0)


# --------------------------------------------------------------------------- #
# Durability: the reconciler must not import the purged Events back
# --------------------------------------------------------------------------- #


def test_purged_events_are_not_imported_back(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK, BIG_CHUNK])
    for event in _runtime_events(database, run_id):
        if not _is_mirrorable(str(event["event_type"])):
            continue
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=str(event["event_type"]),
            source_event_id=str(event["event_id"]),
        )
    assert _purge(database)["purged"] == 2

    # a later start-up runs the importer over the same append-only audit log
    engine._reconcile_conversation_journal()

    assert _mirror_rows(database, session_id) == []
    assert len(_canonical_rows(database, session_id)) == 2
    assert len(_ledger(database)) == 2


def test_reconcile_never_imports_streamed_events_again(tmp_path: Path) -> None:
    """Streamed chunks stay owned by the Item journal, purged or not."""
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    _imported_mirror(
        engine, database, session_id, run_id,
        event_type="message.delta", migrated=False,
    )
    assert _purge(database)["purged"] == 1

    # a streamed Event with no Journal row of its own at all
    _append_runtime_event(database, run_id, "message.delta", BIG_CHUNK)
    engine._reconcile_conversation_journal()

    assert _mirror_rows(database, session_id) == []
    assert len(_canonical_rows(database, session_id)) == 1


def test_reconcile_still_imports_events_that_were_never_purged(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    before = len(_journal_rows(database, session_id))
    source_event_id = _append_runtime_event(database, run_id, "artifact.created", "kept")

    engine._reconcile_conversation_journal()

    imported = [
        row
        for row in _journal_rows(database, session_id)
        if row["dedupe_key"] == f"runtime-event:{source_event_id}"
    ]
    assert len(imported) == 1
    assert _payload_type(imported[0]) == "artifact.created"
    assert len(_journal_rows(database, session_id)) == before + 1
    # the importer simply has nothing to do on a second pass
    engine._reconcile_conversation_journal()
    assert len(_journal_rows(database, session_id)) == before + 1


# --------------------------------------------------------------------------- #
# The append-only guard and the maintenance escape
# --------------------------------------------------------------------------- #


def test_purge_cannot_delete_outside_maintenance(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK])

    connection = _connection(database)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "DELETE FROM runtime_session_journal WHERE session_id=?", (session_id,)
            )
        # the escape is a marker, not a mode: purge disarms it in `finally`
        assert _maintenance_armed(database) is False
    finally:
        connection.close()


def test_guard_upgrade_enables_purge_on_legacy_databases(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    mirror = _imported_mirror(
        engine, database, session_id, run_id,
        event_type="agent.message.delta", migrated=False,
    )

    connection = _connection(database)
    try:
        # a Journal created before the maintenance escape existed
        connection.execute("DROP TRIGGER runtime_session_journal_no_delete")
        connection.execute(
            "CREATE TRIGGER runtime_session_journal_no_delete "
            "BEFORE DELETE ON runtime_session_journal "
            "BEGIN SELECT RAISE(ABORT, 'Runtime Session Journal is append-only'); END"
        )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            purge_legacy_event_mirrors(connection)
        # the failed pass left nothing behind
        assert _maintenance_armed(database) is False

        assert ensure_journal_delete_guard(connection) is True
        assert purge_legacy_event_mirrors(connection)["purged"] == 1
        # upgrading is a one-off migration
        assert ensure_journal_delete_guard(connection) is False
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "DELETE FROM runtime_session_journal WHERE session_id=?", (session_id,)
            )
    finally:
        connection.close()

    assert _mirror_rows(database, session_id) == []
    assert _ledger(database) == {_source_event_id(mirror)}


# --------------------------------------------------------------------------- #
# The offline CLI
# --------------------------------------------------------------------------- #


def test_journal_maintenance_cli_purges_legacy_mirrors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK, BIG_CHUNK])
    for event_type in ("agent.message.delta", "subagent.markdown"):
        _imported_mirror(
            engine, database, session_id, run_id,
            event_type=event_type, migrated=False,
        )
    assert len(_mirror_rows(database, session_id)) == 2

    # a dry run reports the reclaimable volume and writes nothing
    assert (
        journal_maintenance.main(
            ["--database", str(database), "--dry-run", "--purge-legacy-mirrors"]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is True
    assert report["purge_legacy_mirrors"]["purged"] == 2
    assert report["purge_legacy_mirrors"]["bytes_before"] > 0
    assert len(_mirror_rows(database, session_id)) == 2
    assert _ledger(database) == set()
    assert _maintenance_armed(database) is False
    assert list(tmp_path.glob("*.pre-delta-repair-*")) == []

    assert (
        journal_maintenance.main(
            ["--database", str(database), "--purge-legacy-mirrors", "--vacuum"]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is False
    assert report["purge_legacy_mirrors"]["purged"] == 2
    assert report["purge_legacy_mirrors"]["oaep_events_removed"] == 2
    assert report["repaired"] == 0
    assert report["integrity_check"] == "ok"
    assert Path(report["backup_path"]).is_file()
    assert _mirror_rows(database, session_id) == []
    assert len(_ledger(database)) == 2
    assert len(_canonical_rows(database, session_id)) == 2

    # re-running finds nothing left to reclaim and keeps no backup churn
    assert (
        journal_maintenance.main(
            ["--database", str(database), "--purge-legacy-mirrors", "--no-backup"]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["purge_legacy_mirrors"]["purged"] == 0
    assert "backup_path" not in report
    assert len(_ledger(database)) == 2


def test_journal_maintenance_cli_needs_the_flag_to_purge(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    _imported_mirror(
        engine, database, session_id, run_id,
        event_type="agent.message.delta", migrated=False,
    )

    # without --purge-legacy-mirrors the tool only repairs cumulative deltas
    assert journal_maintenance.main(["--database", str(database), "--no-backup"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert "purge_legacy_mirrors" not in report
    assert len(_mirror_rows(database, session_id)) == 1
