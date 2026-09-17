"""The Conversation Journal must stay linear in the answer length.

``conversation.item.delta`` rows used to store the accumulated Item payload, so a
streaming answer copied its whole prefix into every delta row and the Journal grew
quadratically in the answer length.  Measured on a real machine: a single Session
reached 1.6 GiB for one long answer, of which 1606.9 MB were accumulated keys and
0.14 MB the actual chunks.

The delta-only contract keeps the Journal linear.  The accumulated Item is still
persisted once per Item in ``runtime_conversation_items``, and every read path that
legacy clients consume re-attaches it, so no consumer loses data.  These tests
guard the write invariant, the read compatibility contract, the fail-closed size
guard, the OAEP projection and the repair tool for Journals written before the
contract existed.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from drsai.backend.runtime import journal_maintenance
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import (
    DELTA_ACCUMULATED_KEYS,
    MAX_DELTA_JOURNAL_PAYLOAD_BYTES,
    RUNTIME_EVENT_BINDING_KEYS,
    compact_delta_payload,
    compact_journal_item_payload,
    ensure_journal_update_guard,
    hydrate_delta_binding,
    repair_legacy_delta_rows,
)
from drsai.backend.runtime.oaep import project_event

WORKSPACE_ID = "ws-delta"
CHUNK = "0123456789abcdef" * 4  # 64 chars
BIG_CHUNK = "abcdefghijklmnop" * 256  # 4096 chars


def _canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _engine(tmp_path: Path) -> tuple[RuntimeEngine, Path]:
    database = tmp_path / "engine.sqlite3"
    engine = RuntimeEngine(
        database=database,
        identity=RuntimeEngineIdentity(runtime_id="rt-delta", instance_id="inst-delta"),
        workspace_exists=lambda workspace_id: workspace_id == WORKSPACE_ID,
    )
    return engine, database


def _connection(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(database), timeout=30.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


def _stream(engine: RuntimeEngine, chunks: list[str]) -> tuple[str, str]:
    """Create a Session/Run and stream ``chunks`` as assistant message deltas."""
    session = engine.create_session(WORKSPACE_ID, "delta storage")
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
            "SELECT rowid,event_kind,item_id,payload_json FROM runtime_session_journal "
            "WHERE session_id=? ORDER BY rowid",
            (session_id,),
        ).fetchall()
    finally:
        connection.close()
    return [dict(row) for row in rows]


def _delta_rows(database: Path, session_id: str) -> list[dict[str, object]]:
    return [
        row
        for row in _journal_rows(database, session_id)
        if row["event_kind"] == "conversation.item.delta"
    ]


def _delta_payloads(database: Path, session_id: str) -> list[dict[str, object]]:
    return [
        json.loads(str(row["payload_json"]))["payload"]
        for row in _delta_rows(database, session_id)
    ]


def _item_payload(database: Path, item_id: str) -> dict[str, object]:
    connection = _connection(database)
    try:
        row = connection.execute(
            "SELECT payload_json FROM runtime_conversation_items WHERE item_id=?", (item_id,)
        ).fetchone()
    finally:
        connection.close()
    assert row is not None, f"missing Conversation Item {item_id}"
    return json.loads(str(row["payload_json"]))


@contextmanager
def _journal_maintenance(database: Path) -> Iterator[sqlite3.Connection]:
    """Run Journal rewrites under the maintenance marker, like the repair tool."""
    connection = _connection(database)
    connection.execute("INSERT OR IGNORE INTO runtime_session_journal_maintenance VALUES(1)")
    try:
        yield connection
    finally:
        connection.execute("DELETE FROM runtime_session_journal_maintenance WHERE singleton=1")
        connection.commit()
        connection.close()


def _as_legacy(database: Path, session_id: str, *, accumulated: str = "L" * 2048) -> int:
    """Rewrite a Session's delta rows into the pre-contract cumulative shape."""
    rewritten = 0
    with _journal_maintenance(database) as connection:
        rows = connection.execute(
            "SELECT rowid,payload_json FROM runtime_session_journal "
            "WHERE session_id=? AND event_kind='conversation.item.delta' ORDER BY rowid",
            (session_id,),
        ).fetchall()
        for row in rows:
            envelope = json.loads(str(row["payload_json"]))
            envelope["payload"] = {
                **envelope["payload"],
                "text": accumulated,
                "content": accumulated,
            }
            connection.execute(
                "UPDATE runtime_session_journal SET payload_json=? WHERE rowid=?",
                (_canonical(envelope), int(row["rowid"])),
            )
            rewritten += 1
    return rewritten


def _stream_with_binding(
    engine: RuntimeEngine, chunks: list[str]
) -> tuple[str, str, dict[str, object]]:
    """Create a Session/Run and stream chunks that carry the Run/Session binding.

    ``RuntimeEngine.append_event`` merges the caller's data into the accumulated
    Item payload, so passing the binding is what the Backend adapters do on every
    streamed chunk of a real Run.
    """
    session = engine.create_session(WORKSPACE_ID, "delta binding")
    session_id = str(session["session_id"])
    run, _created = engine.create_run(
        session_id, "agent-definition", f"idem-binding-{session_id}"
    )
    run_id = str(run["run_id"])
    binding: dict[str, object] = {
        "run_id": run_id,
        "session_id": session_id,
        "workspace_id": WORKSPACE_ID,
        "runtime_id": "rt-delta",
        "instance_id": "inst-delta",
        "correlation_id": f"corr-{run_id}",
    }
    for index, chunk in enumerate(chunks, start=1):
        engine.append_event(run_id, "message.delta", {**binding, "text": chunk, "index": index})
    return session_id, run_id, binding


def _replay_legacy_binding(database: Path, session_id: str) -> int:
    """Rewrite a Session's delta rows to repeat the binding of their Item."""
    rewritten = 0
    with _journal_maintenance(database) as connection:
        rows = connection.execute(
            "SELECT rowid,item_id,payload_json FROM runtime_session_journal "
            "WHERE session_id=? AND event_kind='conversation.item.delta' ORDER BY rowid",
            (session_id,),
        ).fetchall()
        for row in rows:
            item_row = connection.execute(
                "SELECT payload_json FROM runtime_conversation_items WHERE item_id=?",
                (row["item_id"],),
            ).fetchone()
            assert item_row is not None
            item_payload = json.loads(str(item_row["payload_json"]))
            envelope = json.loads(str(row["payload_json"]))
            envelope["payload"] = {
                **envelope["payload"],
                **{
                    key: item_payload[key]
                    for key in RUNTIME_EVENT_BINDING_KEYS
                    if key in item_payload
                },
            }
            connection.execute(
                "UPDATE runtime_session_journal SET payload_json=? WHERE rowid=?",
                (_canonical(envelope), int(row["rowid"])),
            )
            rewritten += 1
    return rewritten


def test_compact_delta_payload_removes_every_accumulated_key() -> None:
    payload = {
        "delta": "abc",
        "text": "abc",
        "content": "abc",
        "output": "x",
        "summary": "y",
        "result": "z",
        "status": "streaming",
        "event_type": "message.delta",
    }
    compact = compact_delta_payload(payload)

    assert compact == {"delta": "abc", "status": "streaming", "event_type": "message.delta"}
    assert set(DELTA_ACCUMULATED_KEYS).isdisjoint(compact)
    # structural fields survive and the caller's payload is not mutated
    assert payload["text"] == "abc"


def test_compact_delta_payload_keeps_delta_explicit() -> None:
    assert compact_delta_payload({"text": "abc"}) == {"delta": ""}
    assert compact_delta_payload({"delta": "", "content": "abc"}) == {"delta": ""}
    # a non-string delta must never fall back to an accumulated key
    assert compact_delta_payload({"delta": None, "text": "abc"}) == {"delta": ""}
    assert compact_delta_payload({"delta": 7, "text": "abc"}) == {"delta": ""}


def test_message_delta_rows_store_only_the_chunk(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    chunks = [BIG_CHUNK] * 8
    session_id, run_id = _stream(engine, chunks)

    rows = _delta_rows(database, session_id)
    assert len(rows) == len(chunks)
    for row in rows:
        payload = json.loads(str(row["payload_json"]))["payload"]
        assert set(DELTA_ACCUMULATED_KEYS).isdisjoint(payload), payload
        assert payload["delta"] == BIG_CHUNK
        assert payload["event_type"] == "message.delta"
        assert payload["status"] == "streaming"

    # the accumulated Item is still persisted once, so the projection advances
    item_payload = _item_payload(database, f"assistant:{run_id}")
    assert item_payload["text"] == BIG_CHUNK * len(chunks)
    assert item_payload["content"] == BIG_CHUNK * len(chunks)
    assert item_payload["status"] == "streaming"

    snapshot = engine.conversation_snapshot(session_id)
    projected = {item["item_id"]: item for item in snapshot["items"]}
    assert projected[f"assistant:{run_id}"]["payload"]["text"] == BIG_CHUNK * len(chunks)


def test_journal_delta_bytes_grow_linearly(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    small_session, _ = _stream(engine, [BIG_CHUNK] * 4)
    large_session, _ = _stream(engine, [BIG_CHUNK] * 16)

    small = sum(len(str(row["payload_json"])) for row in _delta_rows(database, small_session))
    large = sum(len(str(row["payload_json"])) for row in _delta_rows(database, large_session))

    assert small > 0
    # 4x the chunks must cost ~4x the bytes.  The pre-contract cumulative rows
    # stored the growing prefix and cost ~16x, i.e. quadratic in the answer length.
    assert large < 6 * small
    # ... and the Journal stays within one copy of the answer plus row overhead.
    assert large < 2 * (len(BIG_CHUNK) * 16)


def test_session_events_re_attach_the_accumulated_item_payload(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    chunks = [BIG_CHUNK] * 4
    session_id, _run_id = _stream(engine, chunks)
    final_text = BIG_CHUNK * len(chunks)

    events = engine.list_session_events(session_id)
    deltas = [event for event in events if event["kind"] == "conversation.item.delta"]
    assert len(deltas) == len(chunks)
    for event in deltas:
        payload = event["payload"]["payload"]
        # Legacy consumers project the Item from every entry, so the accumulated
        # fields must be present even though the stored row does not carry them.
        assert payload["text"] == final_text
        assert payload["content"] == final_text
        assert payload["delta"] == BIG_CHUNK

    # the stored rows themselves stay incremental
    for payload in _delta_payloads(database, session_id):
        assert set(DELTA_ACCUMULATED_KEYS).isdisjoint(payload)

    streamed = engine.wait_session_events(session_id, after_sequence=0, timeout=0.0)
    assert [event["event_id"] for event in streamed] == [event["event_id"] for event in events]

    # OAEP delta envelopes are still projected from the chunk itself, which is the
    # invariant the desktop client validates (type/delta agreement).
    oaep_deltas = [
        event
        for event in engine.list_oaep_events(session_id)
        if event["type"] == "event.item.delta"
    ]
    assert len(oaep_deltas) == len(chunks)
    for event in oaep_deltas:
        assert bool(event["data"].get("delta")) is True
        assert event["data"]["delta"]["kind"] == "message.text.append"
        assert event["data"]["delta"]["text"] == BIG_CHUNK


def test_oversized_delta_payload_is_rejected(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session = engine.create_session(WORKSPACE_ID, "guard")
    session_id = str(session["session_id"])
    run, _created = engine.create_run(session_id, "agent-definition", "idem-guard")
    run_id = str(run["run_id"])
    item_id = f"assistant:{run_id}"

    connection = _connection(database)
    try:
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(ValueError, match="delta limit"):
            engine.conversation_journal.upsert_item_in_transaction(
                connection,
                session_id,
                item_id=item_id,
                kind="message",
                role="assistant",
                revision=1,
                source_client="runtime",
                payload={
                    "delta": "x",
                    "blob": "y" * MAX_DELTA_JOURNAL_PAYLOAD_BYTES,
                },
                run_id=run_id,
                event_kind="conversation.item.delta",
                updated_at="2026-01-01T00:00:00+00:00",
            )
        connection.rollback()
        written_items = connection.execute(
            "SELECT COUNT(*) FROM runtime_conversation_items WHERE item_id=?", (item_id,)
        ).fetchone()[0]
    finally:
        connection.close()

    # Fail closed: no delta row, no Item, nothing partially applied.
    assert written_items == 0
    assert _delta_rows(database, session_id) == []


def test_large_but_legal_delta_chunk_is_stored_intact(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _stream(engine, [BIG_CHUNK])
    chunk = "z" * 256_000

    engine.append_event(run_id, "message.delta", {"text": chunk})

    payloads = _delta_payloads(database, session_id)
    assert len(payloads) == 2
    assert payloads[-1]["delta"] == chunk
    assert _item_payload(database, f"assistant:{run_id}")["text"] == BIG_CHUNK + chunk


def test_repair_reports_then_rewrites_and_is_idempotent(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK] * 3)
    assert _as_legacy(database, session_id) == 3

    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection, dry_run=True)
    finally:
        connection.close()
    assert report["scanned"] == 3
    assert report["repaired"] == 3
    assert report["bytes_before"] > report["bytes_after"] > 0
    # a dry run must not write
    assert all("text" in payload for payload in _delta_payloads(database, session_id))

    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection)
    finally:
        connection.close()
    assert report["repaired"] == 3
    for payload in _delta_payloads(database, session_id):
        assert set(DELTA_ACCUMULATED_KEYS).isdisjoint(payload)
        assert payload["delta"] == BIG_CHUNK

    # re-running finds nothing left to reclaim
    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection)
    finally:
        connection.close()
    assert report["repaired"] == 0
    assert report["unchanged"] == 3


def test_repair_keeps_the_legacy_read_contract_intact(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    chunks = [BIG_CHUNK] * 3
    session_id, _run_id = _stream(engine, chunks)

    def projected_text() -> list[str]:
        return [
            event["payload"]["payload"]["text"]
            for event in engine.list_session_events(session_id)
            if event["kind"] == "conversation.item.delta"
        ]

    before = projected_text()

    assert _as_legacy(database, session_id) == 3
    connection = _connection(database)
    try:
        assert repair_legacy_delta_rows(connection)["repaired"] == 3
    finally:
        connection.close()

    after = projected_text()
    expected = [BIG_CHUNK * len(chunks)] * len(chunks)
    assert before == expected
    assert after == expected


def test_repair_skips_rows_without_a_delta_chunk(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK])
    assert _as_legacy(database, session_id) == 1

    # An accumulated row without a chunk cannot be reduced without inventing
    # Item content, so it must be left intact and reported.
    with _journal_maintenance(database) as connection:
        row = connection.execute(
            "SELECT rowid,payload_json FROM runtime_session_journal "
            "WHERE session_id=? AND event_kind='conversation.item.delta'",
            (session_id,),
        ).fetchone()
        envelope = json.loads(str(row["payload_json"]))
        envelope["payload"] = {
            key: value for key, value in envelope["payload"].items() if key != "delta"
        }
        connection.execute(
            "UPDATE runtime_session_journal SET payload_json=? WHERE rowid=?",
            (_canonical(envelope), int(row["rowid"])),
        )

    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection)
    finally:
        connection.close()

    assert report["scanned"] == 1
    assert report["repaired"] == 0
    assert report["skipped_without_delta"] == 1
    assert "text" in _delta_payloads(database, session_id)[0]


def test_repair_can_target_one_session_and_resume(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    repaired_session, _ = _stream(engine, [BIG_CHUNK] * 5)
    untouched_session, _ = _stream(engine, [BIG_CHUNK])
    assert _as_legacy(database, repaired_session) == 5
    assert _as_legacy(database, untouched_session) == 1

    # --limit stops mid-Session without leaving the database inconsistent
    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(
            connection, session_id=repaired_session, batch_size=2, limit=3
        )
    finally:
        connection.close()
    assert report["scanned"] == 3
    assert report["repaired"] == 3
    assert "text" in _delta_payloads(database, untouched_session)[0]

    # resumable: a second run still finds the legacy rows the limit skipped
    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection, session_id=repaired_session, batch_size=2)
    finally:
        connection.close()
    assert report["repaired"] == 2
    assert report["unchanged"] == 3
    assert all("text" not in payload for payload in _delta_payloads(database, repaired_session))
    assert "text" in _delta_payloads(database, untouched_session)[0]


def test_repair_rejects_invalid_bounds(tmp_path: Path) -> None:
    _unused_engine, database = _engine(tmp_path)
    connection = _connection(database)
    try:
        with pytest.raises(ValueError):
            repair_legacy_delta_rows(connection, batch_size=0)
        with pytest.raises(ValueError):
            repair_legacy_delta_rows(connection, limit=0)
    finally:
        connection.close()


def test_journal_maintenance_cli_reports_then_repairs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK, BIG_CHUNK])
    assert _as_legacy(database, session_id) == 2

    assert journal_maintenance.main(["--database", str(database), "--dry-run"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is True
    assert report["repaired"] == 2
    assert report["bytes_before"] > report["bytes_after"] > 0
    assert report["database_bytes_before"] > 0
    assert all("text" in payload for payload in _delta_payloads(database, session_id))
    assert list(tmp_path.glob("*.pre-delta-repair-*")) == []
    connection = _connection(database)
    try:
        # a dry run is read-only: it must not arm the maintenance escape
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM runtime_session_journal_maintenance"
            ).fetchone()[0]
            == 0
        )
    finally:
        connection.close()

    assert (
        journal_maintenance.main(
            ["--database", str(database), "--session", session_id, "--vacuum"]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["repaired"] == 2
    assert report["dry_run"] is False
    assert report["database_bytes_after"] > 0
    assert report["integrity_check"] == "ok"
    # a real run keeps a consistent pre-repair copy as the recovery point
    backup = Path(report["backup_path"])
    assert backup.is_file() and backup.stat().st_size > 0
    assert backup.name.startswith("engine.sqlite3.pre-delta-repair-")
    assert all("text" not in payload for payload in _delta_payloads(database, session_id))

    assert journal_maintenance.main(["--database", str(database)]) == 0
    assert json.loads(capsys.readouterr().out)["repaired"] == 0


def test_journal_maintenance_cli_can_skip_backup_and_integrity_check(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK])
    assert _as_legacy(database, session_id) == 1

    assert journal_maintenance.main(["--database", str(database), "--no-backup"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["repaired"] == 1
    assert report["integrity_check"] == "ok"
    assert "backup_path" not in report
    assert list(tmp_path.glob("*.pre-delta-repair-*")) == []

    # an explicit backup destination is honoured, and the integrity check can be skipped
    destination = tmp_path / "recovery" / "engine.sqlite3"
    assert (
        journal_maintenance.main(
            [
                "--database",
                str(database),
                "--backup",
                str(destination),
                "--skip-integrity-check",
            ]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert "integrity_check" not in report
    assert Path(report["backup_path"]) == destination
    assert destination.is_file() and destination.stat().st_size > 0


def test_journal_maintenance_cli_reports_a_missing_database(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert journal_maintenance.main(["--database", str(tmp_path / "absent.sqlite3")]) == 2
    assert json.loads(capsys.readouterr().out)["error"] == "database_not_found"


def test_journal_maintenance_cli_dry_run_is_read_only_on_legacy_guard(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK])
    assert _as_legacy(database, session_id) == 1

    connection = _connection(database)
    try:
        # a Journal whose guard predates the maintenance escape
        connection.execute("DROP TRIGGER runtime_session_journal_no_update")
        connection.execute(
            "CREATE TRIGGER runtime_session_journal_no_update "
            "BEFORE UPDATE ON runtime_session_journal "
            "BEGIN SELECT RAISE(ABORT, 'Runtime Session Journal is append-only'); END"
        )
    finally:
        connection.close()

    assert journal_maintenance.main(["--database", str(database), "--dry-run"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["repaired"] == 1
    assert "text" in _delta_payloads(database, session_id)[0]

    connection = _connection(database)
    try:
        sql = str(
            connection.execute(
                "SELECT sql FROM sqlite_master WHERE name='runtime_session_journal_no_update'"
            ).fetchone()[0]
        )
        assert "runtime_session_journal_maintenance" not in sql
    finally:
        connection.close()


# --------------------------------------------------------------------------- #
# The append-only guard survives the maintenance escape
# --------------------------------------------------------------------------- #


def test_journal_rows_stay_append_only_outside_maintenance(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK])

    connection = _connection(database)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "UPDATE runtime_session_journal SET payload_json='{}' WHERE session_id=?",
                (session_id,),
            )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "DELETE FROM runtime_session_journal WHERE session_id=?", (session_id,)
            )
        # the maintenance escape is a marker, not a permanent mode
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM runtime_session_journal_maintenance"
            ).fetchone()[0]
            == 0
        )
    finally:
        connection.close()


def test_guard_upgrade_enables_repair_on_legacy_databases(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id = _stream(engine, [BIG_CHUNK, BIG_CHUNK])
    assert _as_legacy(database, session_id) == 2

    connection = _connection(database)
    try:
        # a Journal created before the maintenance escape existed
        connection.execute("DROP TRIGGER runtime_session_journal_no_update")
        connection.execute(
            "CREATE TRIGGER runtime_session_journal_no_update "
            "BEFORE UPDATE ON runtime_session_journal "
            "BEGIN SELECT RAISE(ABORT, 'Runtime Session Journal is append-only'); END"
        )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            repair_legacy_delta_rows(connection)

        assert ensure_journal_update_guard(connection) is True
        assert repair_legacy_delta_rows(connection)["repaired"] == 2
        # upgrading is a one-off migration
        assert ensure_journal_update_guard(connection) is False
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "UPDATE runtime_session_journal SET payload_json='{}' WHERE session_id=?",
                (session_id,),
            )
    finally:
        connection.close()

    assert all(
        set(DELTA_ACCUMULATED_KEYS).isdisjoint(payload)
        for payload in _delta_payloads(database, session_id)
    )


# --------------------------------------------------------------------------- #
# The Run/Session binding is stored once, in the Conversation Item
# --------------------------------------------------------------------------- #


def test_compact_journal_item_payload_drops_only_item_reproduced_binding() -> None:
    payload = {
        "run_id": "run-1",
        "session_id": "session-1",
        "workspace_id": WORKSPACE_ID,
        "delta": "abc",
        "status": "streaming",
    }
    canonical = {"run_id": "run-1", "session_id": "session-1"}

    compact = compact_journal_item_payload(
        "conversation.item.delta", payload, canonical=canonical
    )
    assert compact == {
        "workspace_id": WORKSPACE_ID,
        "delta": "abc",
        "status": "streaming",
    }
    # the caller's payload is never mutated
    assert payload["run_id"] == "run-1"

    # a binding the Item does not reproduce is the row's own information
    assert compact_journal_item_payload(
        "conversation.item.delta", {**payload, "run_id": "run-elsewhere"}, canonical=canonical
    ) == {
        "workspace_id": WORKSPACE_ID,
        "delta": "abc",
        "status": "streaming",
        "run_id": "run-elsewhere",
    }

    # without a canonical Item, or for a non-delta Event, nothing is dropped
    assert compact_journal_item_payload("conversation.item.delta", payload) == payload
    assert (
        compact_journal_item_payload(
            "conversation.item.upsert", payload, canonical=canonical
        )
        == payload
    )


def test_hydrate_delta_binding_restores_only_the_removed_binding() -> None:
    canonical = {"run_id": "run-1", "session_id": "session-1", "text": "accumulated"}
    stripped = {
        "item_id": "assistant:run-1",
        "payload": {"delta": "abc", "status": "streaming"},
    }

    restored = hydrate_delta_binding(stripped, canonical)
    assert restored["payload"] == {
        "run_id": "run-1",
        "session_id": "session-1",
        "delta": "abc",
        "status": "streaming",
    }
    # the stored row wins: hydration only fills what is missing
    assert hydrate_delta_binding(
        {"payload": {"delta": "abc", "run_id": "row-owned"}}, canonical
    )["payload"] == {"delta": "abc", "run_id": "row-owned", "session_id": "session-1"}

    intact = {"payload": {"delta": "abc", "run_id": "run-1", "session_id": "session-1"}}
    assert hydrate_delta_binding(intact, canonical) == intact
    assert hydrate_delta_binding(intact, None) == intact
    # the stored row is returned as-is, never mutated
    assert intact["payload"] == {
        "delta": "abc",
        "run_id": "run-1",
        "session_id": "session-1",
    }


def test_delta_row_drops_the_binding_its_item_keeps(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id, binding = _stream_with_binding(engine, [CHUNK, CHUNK])
    item_payload = _item_payload(database, f"assistant:{run_id}")

    # the accumulated Item keeps the whole binding ...
    assert {key: item_payload[key] for key in binding} == binding
    # ... while the delta rows keep only their chunk
    payloads = _delta_payloads(database, session_id)
    assert len(payloads) == 2
    for payload in payloads:
        assert set(binding).isdisjoint(payload), payload
        assert payload["delta"] == CHUNK
        assert payload["status"] == "streaming"

    # readers still see the binding, restored from the Item
    deltas = [
        event
        for event in engine.list_session_events(session_id)
        if event["kind"] == "conversation.item.delta"
    ]
    assert len(deltas) == len(payloads)
    for event in deltas:
        projected = event["payload"]["payload"]
        assert {key: projected[key] for key in binding} == binding
        assert projected["delta"] == CHUNK


def test_repair_removes_the_delta_binding_and_is_idempotent(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, _run_id, binding = _stream_with_binding(engine, [BIG_CHUNK, BIG_CHUNK])
    assert _replay_legacy_binding(database, session_id) == 2
    for payload in _delta_payloads(database, session_id):
        assert set(binding) <= set(payload)
        # the binding is the only thing left to reclaim: no accumulated keys
        assert set(DELTA_ACCUMULATED_KEYS).isdisjoint(payload)

    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection, dry_run=True)
        assert report["repaired"] == 2
        assert report["bytes_before"] > report["bytes_after"] > 0
        # a dry run must not write
        assert set(binding) <= set(_delta_payloads(database, session_id)[0])
        report = repair_legacy_delta_rows(connection)
    finally:
        connection.close()
    assert report["repaired"] == 2

    for payload in _delta_payloads(database, session_id):
        assert set(binding).isdisjoint(payload), payload
        assert payload["delta"] == BIG_CHUNK

    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection)
    finally:
        connection.close()
    assert report["repaired"] == 0
    assert report["unchanged"] == 2


def test_repair_keeps_a_binding_the_item_cannot_reproduce(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id, binding = _stream_with_binding(engine, [CHUNK])

    # The row's own ``run_id`` disagrees with the Item's, so the compaction must
    # not assume the Item can replace it.
    with _journal_maintenance(database) as connection:
        row = connection.execute(
            "SELECT rowid,payload_json FROM runtime_session_journal "
            "WHERE session_id=? AND event_kind='conversation.item.delta'",
            (session_id,),
        ).fetchone()
        envelope = json.loads(str(row["payload_json"]))
        envelope["payload"] = {
            **envelope["payload"],
            **binding,
            "run_id": "run-elsewhere",
        }
        connection.execute(
            "UPDATE runtime_session_journal SET payload_json=? WHERE rowid=?",
            (_canonical(envelope), int(row["rowid"])),
        )

    connection = _connection(database)
    try:
        report = repair_legacy_delta_rows(connection)
    finally:
        connection.close()

    payload = _delta_payloads(database, session_id)[0]
    assert report["repaired"] == 1
    # the differing binding is the row's own information and survives ...
    assert payload["run_id"] == "run-elsewhere"
    assert "session_id" not in payload
    assert "correlation_id" not in payload
    # ... while the Item keeps the authoritative Run identity
    assert _item_payload(database, f"assistant:{run_id}")["run_id"] == run_id


def test_oaep_delta_projection_is_independent_of_the_stored_binding() -> None:
    inner = {
        "run_id": "run-1",
        "session_id": "session-1",
        "delta": BIG_CHUNK,
        "status": "streaming",
    }
    event: dict[str, object] = {
        "event_id": "se-1",
        "runtime_id": "rt-delta",
        "workspace_id": WORKSPACE_ID,
        "session_id": "session-1",
        "run_id": "run-1",
        "session_sequence": 7,
        "kind": "conversation.item.delta",
        "timestamp": "2026-01-01T00:00:00+00:00",
        "item_id": "assistant:run-1",
        "item_revision": 3,
        "payload": {
            "item_id": "assistant:run-1",
            "revision": 3,
            "kind": "message",
            "role": "assistant",
            "source_client": "runtime",
            "source_message_id": None,
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
            "payload": inner,
        },
    }
    compacted = {
        **event,
        "payload": {
            **event["payload"],  # type: ignore[arg-type]
            "payload": compact_journal_item_payload(
                "conversation.item.delta",
                inner,
                canonical={"run_id": "run-1", "session_id": "session-1"},
            ),
        },
    }
    assert set(compacted["payload"]["payload"]) == {"delta", "status"}  # type: ignore[index]
    # the OAEP envelope is projected from the chunk, so the reduction is invisible
    assert project_event(compacted) == project_event(event)  # type: ignore[arg-type]


def test_journal_maintenance_cli_reclaims_the_delta_binding(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id, binding = _stream_with_binding(engine, [BIG_CHUNK] * 3)
    assert _replay_legacy_binding(database, session_id) == 3

    assert journal_maintenance.main(["--database", str(database), "--dry-run"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["repaired"] == 3
    assert report["bytes_before"] > report["bytes_after"] > 0
    assert set(binding) <= set(_delta_payloads(database, session_id)[0])

    assert journal_maintenance.main(["--database", str(database), "--no-backup"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["repaired"] == 3
    assert report["integrity_check"] == "ok"
    for payload in _delta_payloads(database, session_id):
        assert set(binding).isdisjoint(payload), payload
        assert payload["delta"] == BIG_CHUNK

    # the authoritative Item still holds the binding exactly once
    item_payload = _item_payload(database, f"assistant:{run_id}")
    assert {key: item_payload[key] for key in binding} == binding
