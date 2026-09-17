"""A streamed Runtime Event row must carry the chunk, not the Run/Session envelope.

``runtime_events`` stores one row per streamed chunk.  Backend adapters fill those
rows with the full Run/Session binding (``run_id``, ``session_id``,
``workspace_runtime_id``, ``agent_definition_id``, ...) every single time, so a long
answer wrote the same twelve fields once per token.  Measured on a production
Database: 48.2 MiB of ``agent.message.delta`` carried 209 KiB of unique chunk text,
and 99% of those bytes were the repeated binding.

``compact_runtime_event_payload`` stores the reduced payload instead.  The row itself
must survive, because it *is* the stream: Run Event cursors, ``list_events`` replay,
the V1 conversation feed and the Relay's bounded SSE buffer all read this log chunk by
chunk.  So the compaction removes only the fields that every reader resolves from the
Run the row points at.

These tests guard the contract from both sides:

* a streamed row stores the chunk plus whatever describes *that chunk*, and nothing
  else;
* every other Event keeps its payload byte for byte -- the shape that
  ``json_extract(data_json,'$.backend_metadata.turn_id')`` and the desktop's
  diagnostic reader depend on;
* replayed events still report ``run_id``/``sequence``/``created_at`` and the V1
  conversation feed still re-attaches ``run_id`` through ``json_set``;
* ``compact_runtime_event_payloads`` reduces the rows written before the helper
  existed, in place and under the explicit maintenance escape, without ever becoming
  the last owner of a chunk;
* the log stays append-only for ordinary writers before, during and after the pass.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path

import pytest

from drsai.backend.runtime import journal_maintenance
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import (
    RUNTIME_EVENT_BINDING_KEYS,
    SUBAGENT_STREAM_EVENT_TYPES,
    compact_runtime_event_payload,
    compact_runtime_event_payloads,
    ensure_runtime_event_guards,
    runtime_event_payload_is_item_owned,
    runtime_event_stream_filter,
)

WORKSPACE_ID = "ws-compact"
CHUNK = "streamed-token-" * 48  # 720 chars: the text the row exists for
CREATED_AT = "2026-01-01T00:00:00+00:00"
SUBAGENT_TYPES = ("subagent.markdown", "subagent.thinking")
# The streamed types a Backend adapter reaches through the writer entry points.
# ``oaep.item.*`` needs its canonical Item binding, so it is covered separately.
WRITER_STREAM_TYPES = (
    "message.delta",
    "agent.message.delta",
    "thinking.delta",
    "agent.item.message.delta",
    "agent.item.reasoning.delta",
    "agent.item.plan.delta",
    "agent.item.command.delta",
    "agent.item.subtask.delta",
    "agent.item.tool.delta",
    *SUBAGENT_TYPES,
)
# A canonical OAEP Item mutation.  ``_record_runtime_event_item_in_transaction``
# resolves its Backend Item binding from ``backend_metadata`` (which the import path
# later reads the turn id back out of), so the metadata has to survive the
# reduction: it is not part of the repeated Run/Session envelope.
OAEP_DELTA: dict[str, object] = {
    "backend": "opendrsai",
    "backend_metadata": {
        "thread_id": "thread-1",
        "turn_id": "turn-1",
        "item_id": "item-1",
        "item_type": "message",
    },
    "delta": CHUNK,
}
ITEM_OWNED_EVENT_TYPES = (
    *WRITER_STREAM_TYPES,
    "oaep.item.message.delta",
    "oaep.item.reasoning.delta",
)

# The Run/Session binding a Backend Adapter repeats on every streamed chunk.  Values
# are deliberately distinct from the row's own columns, so a test can prove the
# reduced payload no longer *has* them rather than merely that they are equal.
BINDING: dict[str, object] = {
    "run_id": "run-from-payload",
    "session_id": "session-from-payload",
    "workspace_id": "workspace-from-payload",
    "runtime_id": "runtime-from-payload",
    "instance_id": "instance-from-payload",
    "workspace_runtime_id": "workspace-runtime-from-payload",
    "agent_backend_runtime_id": "backend-runtime-from-payload",
    "correlation_id": "correlation-from-payload",
    "agent_definition_id": "definition-from-payload",
    "agent_definition_version": 7,
    "input_resource_count": 3,
    "parent_run_id": None,
}
BINDING_BYTES = len(
    json.dumps(BINDING, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
)


def _canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _engine(tmp_path: Path) -> tuple[RuntimeEngine, Path]:
    database = tmp_path / "engine.sqlite3"
    engine = RuntimeEngine(
        database=database,
        identity=RuntimeEngineIdentity(runtime_id="rt-compact", instance_id="inst-compact"),
        workspace_exists=lambda workspace_id: workspace_id == WORKSPACE_ID,
    )
    return engine, database


def _connection(database: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(database), timeout=30.0, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


def _run(engine: RuntimeEngine) -> tuple[str, str]:
    session = engine.create_session(WORKSPACE_ID, "runtime event payload compaction")
    session_id = str(session["session_id"])
    run, _created = engine.create_run(session_id, "agent-definition", f"idem-{session_id}")
    return session_id, str(run["run_id"])


def _append_legacy_event(
    database: Path,
    run_id: str,
    event_type: str,
    payload: object,
    *,
    backend_event_key: str | None = None,
) -> int:
    """Append a row exactly as the pre-compaction writer stored it."""
    connection = _connection(database)
    try:
        sequence = int(
            connection.execute(
                "SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?",
                (run_id,),
            ).fetchone()[0]
        )
        connection.execute(
            "INSERT INTO runtime_events(event_id,run_id,sequence,event_type,data_json,"
            "created_at,backend_event_key) VALUES(?,?,?,?,?,?,?)",
            (
                f"event-{uuid.uuid4()}",
                run_id,
                sequence,
                event_type,
                payload if isinstance(payload, str) else _canonical(payload),
                CREATED_AT,
                backend_event_key,
            ),
        )
    finally:
        connection.close()
    return sequence


def _rows(database: Path, run_id: str) -> list[dict[str, object]]:
    connection = _connection(database)
    try:
        rows = connection.execute(
            "SELECT rowid,sequence,event_type,data_json,created_at"
            " FROM runtime_events WHERE run_id=? ORDER BY sequence",
            (run_id,),
        ).fetchall()
    finally:
        connection.close()
    return [dict(row) for row in rows]


def _stored_payload(database: Path, run_id: str, event_type: str) -> dict[str, object]:
    connection = _connection(database)
    try:
        row = connection.execute(
            "SELECT data_json FROM runtime_events WHERE run_id=? AND event_type=?",
            (run_id, event_type),
        ).fetchone()
    finally:
        connection.close()
    assert row is not None, f"no {event_type} row for {run_id}"
    return json.loads(str(row["data_json"]))


def _stored_by_key(database: Path, run_id: str, backend_event_key: str) -> dict[str, object]:
    connection = _connection(database)
    try:
        row = connection.execute(
            "SELECT data_json FROM runtime_events WHERE run_id=? AND backend_event_key=?",
            (run_id, backend_event_key),
        ).fetchone()
    finally:
        connection.close()
    assert row is not None, f"no row for Backend Event key {backend_event_key}"
    return json.loads(str(row["data_json"]))


def _open_marker(database: Path) -> bool:
    connection = _connection(database)
    try:
        row = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_events_maintenance'"
        ).fetchone()
        if row is None:
            return False
        return bool(
            connection.execute("SELECT COUNT(*) FROM runtime_events_maintenance").fetchone()[0]
        )
    finally:
        connection.close()


def _compact(database: Path, **kwargs: object) -> dict[str, int]:
    connection = _connection(database)
    try:
        return compact_runtime_event_payloads(connection, **kwargs)  # type: ignore[arg-type]
    finally:
        connection.close()


def _upgrade(database: Path) -> bool:
    connection = _connection(database)
    try:
        return ensure_runtime_event_guards(connection)
    finally:
        connection.close()


def _items(database: Path, session_id: str) -> list[dict[str, object]]:
    connection = _connection(database)
    try:
        return [
            dict(row)
            for row in connection.execute(
                "SELECT item_id,item_kind,payload_json FROM runtime_conversation_items"
                " WHERE session_id=? ORDER BY item_id",
                (session_id,),
            ).fetchall()
        ]
    finally:
        connection.close()


def _events_unchanged(before: list[dict[str, object]], after: list[dict[str, object]]) -> bool:
    """Rows are rewritten only in ``data_json``; identity and order must not move."""
    keys = ("rowid", "sequence", "event_type", "created_at")
    return [{key: row[key] for key in keys} for row in before] == [
        {key: row[key] for key in keys} for row in after
    ]


def _expected_reduced(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """The stored payload every row must hold once every stream row is reduced."""
    expected = []
    for row in rows:
        payload = json.loads(str(row["data_json"]))
        if runtime_event_payload_is_item_owned(str(row["event_type"])):
            payload = {key: value for key, value in payload.items() if key not in RUNTIME_EVENT_BINDING_KEYS}
        expected.append(payload)
    return expected


# --------------------------------------------------------------------------- #
# The contract itself
# --------------------------------------------------------------------------- #


def test_the_binding_key_set_is_the_run_session_envelope() -> None:
    """Exactly the repeated fields are dropped -- adding one is a deliberate act."""
    assert RUNTIME_EVENT_BINDING_KEYS == frozenset(
        {
            "run_id",
            "session_id",
            "workspace_id",
            "runtime_id",
            "instance_id",
            "workspace_runtime_id",
            "agent_backend_runtime_id",
            "correlation_id",
            "agent_definition_id",
            "agent_definition_version",
            "input_resource_count",
            "parent_run_id",
        }
    )
    # every one of them is already a Runtime Run column or a row of its own
    assert "delta" not in RUNTIME_EVENT_BINDING_KEYS
    assert "content" not in RUNTIME_EVENT_BINDING_KEYS
    assert "text" not in RUNTIME_EVENT_BINDING_KEYS
    assert "backend_metadata" not in RUNTIME_EVENT_BINDING_KEYS
    assert "subagent_id" not in RUNTIME_EVENT_BINDING_KEYS


def test_the_reducible_event_types_are_the_chunked_ones() -> None:
    clause, parameters = runtime_event_stream_filter()
    assert "event_type LIKE 'oaep.item.%'" in clause
    assert set(parameters) <= {
        "message.delta",
        "agent.message.delta",
        "thinking.delta",
        "agent.item.message.delta",
        "agent.item.reasoning.delta",
        "agent.item.plan.delta",
        "agent.item.command.delta",
        "agent.item.subtask.delta",
        "agent.item.tool.delta",
        *SUBAGENT_STREAM_EVENT_TYPES,
    }
    for event_type in ITEM_OWNED_EVENT_TYPES:
        assert runtime_event_payload_is_item_owned(event_type), event_type
    # an Event written once per Run transition is never reduced
    for event_type in ("run.created", "run.state.changed", "artifact.created", "approval.requested"):
        assert not runtime_event_payload_is_item_owned(event_type), event_type


def test_a_streamed_payload_keeps_only_the_chunk() -> None:
    payload = {**BINDING, "delta": CHUNK, "index": 4, "subagent_id": "sub-1"}
    assert compact_runtime_event_payload("agent.message.delta", payload) == {
        "delta": CHUNK,
        "index": 4,
        "subagent_id": "sub-1",
    }
    # the same reduction applies to the subagent streams, whose row is the only copy
    for event_type in SUBAGENT_TYPES:
        assert compact_runtime_event_payload(event_type, payload) == {
            "delta": CHUNK,
            "index": 4,
            "subagent_id": "sub-1",
        }


def test_a_non_stream_payload_is_returned_unchanged() -> None:
    payload = {**BINDING, "artifact_id": "art-1"}
    assert compact_runtime_event_payload("artifact.created", payload) == payload
    assert compact_runtime_event_payload("run.created", {}) == {}


# --------------------------------------------------------------------------- #
# The writers
# --------------------------------------------------------------------------- #


def test_the_streamed_batch_stores_only_the_chunk(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    payload = {**BINDING, "delta": CHUNK, "backend_metadata": {"turn_id": "turn-1"}}

    results = engine.append_backend_events(
        run_id, [("agent.message.delta", dict(payload), "chunk-1")]
    )

    # the caller still receives the payload it sent; only the stored copy is reduced
    assert results[0]["data"] == payload
    stored = _stored_by_key(database, run_id, "chunk-1")
    assert stored == {"delta": CHUNK, "backend_metadata": {"turn_id": "turn-1"}}
    assert RUNTIME_EVENT_BINDING_KEYS.isdisjoint(stored)


def test_the_keyed_and_keyless_writers_store_only_the_chunk(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)

    keyless = engine.append_event(run_id, "agent.message.delta", {**BINDING, "text": CHUNK})
    keyed = engine.append_backend_event(
        run_id, "thinking.delta", {**BINDING, "delta": CHUNK}, "thought-1"
    )

    assert keyless["data"] == {**BINDING, "text": CHUNK}
    assert keyed["data"] == {**BINDING, "delta": CHUNK}
    assert _stored_payload(database, run_id, "agent.message.delta") == {"text": CHUNK}
    assert _stored_by_key(database, run_id, "thought-1") == {"delta": CHUNK}


def test_every_streamed_type_is_reduced(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    # (event_type, payload sent, Backend Event key, payload that must be stored).
    # Every ``agent.item.*`` variant resolves its Item identity from
    # ``backend_metadata.item_id``; without it they all fall back to ``"default"``
    # and collide on one canonical Item.
    cases: list[tuple[str, dict[str, object], str, dict[str, object]]] = []
    for index, event_type in enumerate(WRITER_STREAM_TYPES):
        data: dict[str, object] = {**BINDING, "delta": CHUNK}
        expected: dict[str, object] = {"delta": CHUNK}
        if event_type.startswith("agent.item."):
            metadata = {"item_id": f"item-{index}"}
            data["backend_metadata"] = metadata
            expected["backend_metadata"] = metadata
        cases.append((event_type, data, f"key-{index}", expected))
    cases.append(("oaep.item.message.delta", {**BINDING, **OAEP_DELTA}, "key-oaep", dict(OAEP_DELTA)))

    engine.append_backend_events(run_id, [(event_type, dict(data), key) for event_type, data, key, _ in cases])

    for event_type, _data, key, expected in cases:
        stored = _stored_by_key(database, run_id, key)
        assert stored == expected, event_type
        assert RUNTIME_EVENT_BINDING_KEYS.isdisjoint(stored), event_type
        assert _stored_payload(database, run_id, event_type) == expected, event_type


def test_a_non_stream_event_keeps_its_payload_byte_for_byte(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    payload = {**BINDING, "artifact_id": "art-1", "backend_metadata": {"turn_id": "turn-9"}}

    # a mixed batch takes the general path, a streamed-only batch the fast path
    engine.append_backend_events(run_id, [("artifact.created", dict(payload), "art-key")])
    engine.append_event(run_id, "tool.state.changed", {**BINDING, "tool_call_id": "call-1"})

    assert _stored_by_key(database, run_id, "art-key") == payload
    assert _stored_payload(database, run_id, "tool.state.changed") == {
        **BINDING,
        "tool_call_id": "call-1",
    }
    # the SQL that re-links imported Backend Runs still finds the turn id
    connection = _connection(database)
    try:
        found = connection.execute(
            "SELECT COUNT(*) FROM runtime_events e WHERE e.run_id=?"
            " AND json_extract(e.data_json,'$.backend_metadata.turn_id')=?",
            (run_id, "turn-9"),
        ).fetchone()[0]
    finally:
        connection.close()
    assert found == 1


def test_replayed_events_still_carry_identity_and_text(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _run(engine)
    engine.append_backend_events(
        run_id,
        [
            ("agent.message.delta", {**BINDING, "delta": CHUNK}, "chunk-1"),
            ("artifact.created", {**BINDING, "artifact_id": "art-1"}, "art-key"),
        ],
    )

    events = engine.list_events(run_id)
    delta = next(event for event in events if event["type"] == "agent.message.delta")
    # identity comes from the columns, not from the reduced payload
    assert delta["run_id"] == run_id
    assert delta["sequence"] > 0
    assert delta["created_at"]
    assert delta["data"]["delta"] == CHUNK
    assert RUNTIME_EVENT_BINDING_KEYS.isdisjoint(delta["data"])

    feed = engine.list_conversation(session_id, limit=500)
    item = next(entry for entry in feed["data"] if entry["kind"] == "agent.message.delta")
    # the V1 conversation feed re-attaches run_id with json_set
    assert item["payload"]["run_id"] == run_id
    assert item["payload"]["delta"] == CHUNK
    assert item["timestamp"]


# --------------------------------------------------------------------------- #
# Compacting what is already stored
# --------------------------------------------------------------------------- #


def test_the_pass_reduces_legacy_rows_in_place(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    chunks = 4
    for index in range(chunks):
        _append_legacy_event(
            database,
            run_id,
            "agent.message.delta",
            {**BINDING, "delta": f"{CHUNK}{index}", "index": index},
        )
    # a subagent stream whose row is the only copy of its text
    _append_legacy_event(database, run_id, "subagent.markdown", {**BINDING, "text": CHUNK})
    # a canonical OAEP Item mutation, covered by the same ``oaep.item.%`` predicate
    _append_legacy_event(database, run_id, "oaep.item.message.delta", {**BINDING, **OAEP_DELTA})
    # a non-stream Event: never scanned, never rewritten
    _append_legacy_event(database, run_id, "artifact.created", {**BINDING, "artifact_id": "art-1"})
    before = _rows(database, run_id)
    streams = [
        row for row in before if runtime_event_payload_is_item_owned(str(row["event_type"]))
    ]

    assert _upgrade(database) is True
    # upgrading is a one-off migration, and it is idempotent
    assert _upgrade(database) is False

    report = _compact(database)

    assert report["scanned"] == len(streams) == chunks + 2
    assert report["compacted"] == len(streams)
    assert report["unchanged"] == 0
    assert report["bytes_before"] == sum(len(str(row["data_json"])) for row in streams)
    assert report["bytes_after"] < report["bytes_before"]

    after = _rows(database, run_id)
    # the rows, their order, their sequences and their timestamps are untouched
    assert _events_unchanged(before, after)
    # exactly the Run/Session envelope was removed, and nothing else
    assert [json.loads(str(row["data_json"])) for row in after] == _expected_reduced(before)

    for row, original in zip(after, before):
        stored = json.loads(str(row["data_json"]))
        if runtime_event_payload_is_item_owned(str(row["event_type"])):
            assert RUNTIME_EVENT_BINDING_KEYS.isdisjoint(stored)
            # the twelve removed key/value texts plus the twelve commas that joined
            # them; the braces and the eleven separators of the standalone envelope
            # serialization are not part of the diff
            assert len(str(original["data_json"])) - len(str(row["data_json"])) == BINDING_BYTES - 1
        else:
            assert row["data_json"] == original["data_json"]
    # the chunk each row exists for is still there, in the order it was streamed
    deltas = [
        json.loads(str(row["data_json"]))["delta"]
        for row in after
        if row["event_type"] == "agent.message.delta"
    ]
    assert deltas == [f"{CHUNK}{index}" for index in range(chunks)]
    # the subagent row is the only copy of its text, so it must still hold it
    assert _stored_payload(database, run_id, "subagent.markdown") == {"text": CHUNK}
    # the OAEP metadata the import path reads the turn id from is kept
    assert _stored_payload(database, run_id, "oaep.item.message.delta") == dict(OAEP_DELTA)


def test_the_log_stays_append_only_around_the_pass(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    _append_legacy_event(database, run_id, "agent.message.delta", {**BINDING, "delta": CHUNK})
    assert _upgrade(database) is True

    connection = _connection(database)
    try:
        # the escape is armed by the pass, not by the upgrade
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "UPDATE runtime_events SET data_json='{}' WHERE run_id=?", (run_id,)
            )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM runtime_events WHERE run_id=?", (run_id,))
    finally:
        connection.close()

    assert _compact(database)["compacted"] == 1
    # the pass disarms the escape in `finally`, so the log is append-only again
    assert _open_marker(database) is False
    connection = _connection(database)
    try:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute(
                "UPDATE runtime_events SET data_json='{}' WHERE run_id=?", (run_id,)
            )
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM runtime_events WHERE run_id=?", (run_id,))
    finally:
        connection.close()
    # ... and a row can still be appended
    _append_legacy_event(database, run_id, "agent.message.delta", {**BINDING, "delta": "next"})


def test_dry_run_reports_the_volume_without_writing(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    for index in range(3):
        _append_legacy_event(
            database, run_id, "agent.message.delta", {**BINDING, "delta": f"{CHUNK}{index}"}
        )
    before = _rows(database, run_id)

    report = _compact(database, dry_run=True)

    assert report["scanned"] == 3
    assert report["compacted"] == 3
    assert report["bytes_before"] > 0
    assert report["bytes_after"] < report["bytes_before"]
    assert _rows(database, run_id) == before
    # a dry run never touches the schema either
    assert _open_marker(database) is False
    assert _upgrade(database) is True


def test_the_pass_is_idempotent(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    expected = 3
    for index in range(expected):
        _append_legacy_event(
            database, run_id, "agent.message.delta", {**BINDING, "delta": f"{CHUNK}{index}"}
        )
    assert _upgrade(database) is True
    assert _compact(database)["compacted"] == expected

    second = _compact(database)

    assert second["scanned"] == expected
    assert second["compacted"] == 0
    assert second["unchanged"] == expected
    assert second["bytes_before"] == 0
    assert _open_marker(database) is False


def test_the_pass_walks_every_row_in_bounded_batches(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    expected = 5
    for index in range(expected):
        _append_legacy_event(
            database, run_id, "agent.message.delta", {**BINDING, "delta": f"{CHUNK}{index}"}
        )
    assert _upgrade(database) is True

    report = _compact(database, batch_size=1)

    assert report["scanned"] == expected
    assert report["compacted"] == expected
    assert all(
        RUNTIME_EVENT_BINDING_KEYS.isdisjoint(json.loads(str(row["data_json"])))
        for row in _rows(database, run_id)
    )


def test_the_pass_stops_at_the_limit(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    for index in range(5):
        _append_legacy_event(
            database, run_id, "agent.message.delta", {**BINDING, "delta": f"{CHUNK}{index}"}
        )
    assert _upgrade(database) is True

    report = _compact(database, batch_size=2, limit=3)

    assert report["scanned"] == 3
    assert report["compacted"] == 3
    remaining = [
        row
        for row in _rows(database, run_id)
        if not RUNTIME_EVENT_BINDING_KEYS.isdisjoint(json.loads(str(row["data_json"])))
    ]
    assert len(remaining) == 2
    assert _compact(database)["compacted"] == 2


def test_the_pass_skips_payloads_it_cannot_improve(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    # already reduced
    _append_legacy_event(database, run_id, "agent.message.delta", {"delta": CHUNK})
    # not a JSON object
    _append_legacy_event(database, run_id, "agent.message.delta", CHUNK)
    # damaged beyond parsing: kept verbatim so a reader can report the corruption
    _append_legacy_event(database, run_id, "subagent.markdown", "{not json")
    assert _upgrade(database) is True

    report = _compact(database)

    assert report["scanned"] == 3
    assert report["compacted"] == 0
    assert report["unchanged"] == 3
    assert report["bytes_before"] == 0
    # nothing was written, so the escape was never armed
    assert _open_marker(database) is False


def test_a_subagent_stream_keeps_the_only_copy_of_its_text(tmp_path: Path) -> None:
    engine, database = _engine(tmp_path)
    session_id, run_id = _run(engine)
    for index in range(2):
        _append_legacy_event(
            database, run_id, "subagent.markdown", {**BINDING, "text": f"{CHUNK}{index}"}
        )
    assert _upgrade(database) is True
    assert _compact(database)["compacted"] == 2

    events = engine.list_events(run_id)
    texts = [
        event["data"]["text"] for event in events if event["type"] == "subagent.markdown"
    ]
    assert texts == [f"{CHUNK}0", f"{CHUNK}1"]
    # no Conversation Item owns this text, so the Event row must keep it
    assert _items(database, session_id) == []


# --------------------------------------------------------------------------- #
# The offline CLI
# --------------------------------------------------------------------------- #


def test_the_cli_compacts_runtime_events(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    for index in range(3):
        _append_legacy_event(
            database, run_id, "subagent.markdown", {**BINDING, "text": f"{CHUNK}{index}"}
        )
    _append_legacy_event(database, run_id, "artifact.created", {**BINDING, "artifact_id": "art-1"})
    # an already reduced stream row: scanned on every pass, never rewritten
    _append_legacy_event(database, run_id, "subagent.thinking", {"delta": "tail"})
    before = _rows(database, run_id)

    # a dry run reports the reclaimable volume and writes nothing at all
    assert (
        journal_maintenance.main(["--database", str(database), "--dry-run", "--compact-runtime-events"])
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is True
    assert report["compact_runtime_events"]["scanned"] == 4
    assert report["compact_runtime_events"]["compacted"] == 3
    assert report["compact_runtime_events"]["unchanged"] == 1
    assert report["compact_runtime_events"]["bytes_before"] > 0
    assert _rows(database, run_id) == before
    assert _open_marker(database) is False
    assert list(tmp_path.glob("*.pre-delta-repair-*")) == []

    assert (
        journal_maintenance.main(
            ["--database", str(database), "--compact-runtime-events", "--vacuum", "--no-backup"]
        )
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["dry_run"] is False
    assert report["compact_runtime_events"]["compacted"] == 3
    assert report["repaired"] == 0
    assert report["integrity_check"] == "ok"
    assert "backup_path" not in report
    after = _rows(database, run_id)
    assert _events_unchanged(before, after)
    assert [json.loads(str(row["data_json"])) for row in after] == _expected_reduced(before)
    assert _open_marker(database) is False

    # re-running finds nothing left to reclaim
    assert (
        journal_maintenance.main(["--database", str(database), "--compact-runtime-events"])
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["compact_runtime_events"]["compacted"] == 0
    assert report["compact_runtime_events"]["scanned"] == 4


def test_the_cli_needs_the_flag_to_compact(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    engine, database = _engine(tmp_path)
    _session_id, run_id = _run(engine)
    _append_legacy_event(database, run_id, "agent.message.delta", {**BINDING, "delta": CHUNK})
    before = _rows(database, run_id)

    assert journal_maintenance.main(["--database", str(database), "--no-backup"]) == 0
    report = json.loads(capsys.readouterr().out)

    assert "compact_runtime_events" not in report
    assert _rows(database, run_id) == before
    # without the flag the Event guard is not even upgraded
    assert _open_marker(database) is False


def test_the_cli_rejects_an_unusable_batch_size(tmp_path: Path) -> None:
    _engine_unused, database = _engine(tmp_path)
    assert _upgrade(database) is True
    with pytest.raises(ValueError):
        _compact(database, batch_size=0)
