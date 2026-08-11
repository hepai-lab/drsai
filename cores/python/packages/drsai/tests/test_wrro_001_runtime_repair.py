from __future__ import annotations

import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import sys

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import SessionCursorExpired


_SCRIPT = Path(__file__).parents[1] / "scripts" / "repair_wrro_001_runtime.py"
_SPEC = importlib.util.spec_from_file_location("repair_wrro_001_runtime_test", _SCRIPT)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)


def test_wrro_repair_is_dry_run_by_default_and_atomically_preserves_projection(
    tmp_path: Path,
) -> None:
    database = tmp_path / "engine.sqlite3"
    control = tmp_path / "relay-control.sqlite3"
    backup = tmp_path / "engine.pre-wrro-001.sqlite3"
    engine = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-one", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Repair fixture")
    session_id = session["session_id"]
    for sequence in range(150):
        engine.conversation_journal.append_event(
            session_id,
            "session.updated",
            {"title": "Repair fixture", "sequence": sequence},
            dedupe_key=f"fixture-{sequence}",
        )
    snapshot_before = engine.conversation_snapshot(session_id)
    last_sequence = int(snapshot_before["snapshot_sequence"])
    with sqlite3.connect(control) as connection:
        connection.executescript(
            "CREATE TABLE relay_session_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL);"
            "CREATE TABLE relay_oaep_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL);"
        )
        connection.execute(
            "INSERT INTO relay_session_event_cursors VALUES(?,?)",
            (session_id, last_sequence),
        )
        connection.execute(
            "INSERT INTO relay_oaep_event_cursors VALUES(?,?)",
            (session_id, last_sequence),
        )

    size_before = database.stat().st_size
    dry_run = _MODULE.analyze(database, control, retain_events=10)
    assert dry_run["mode"] == "dry-run"
    assert dry_run["candidate_sessions"] == 1
    assert dry_run["removable_events"] >= 140
    assert not backup.exists()
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM runtime_session_journal"
        ).fetchone()[0] == last_sequence

    applied = _MODULE.apply_repair(
        database, control, retain_events=10, backup=backup
    )
    assert applied["mode"] == "applied"
    assert applied["removed_events_actual"] == dry_run["removable_events"]
    assert backup.is_file() and database.is_file()
    assert database.stat().st_size < size_before

    repaired = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-one", "instance-two"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    assert repaired.get_session(session_id)["title"] == "Repair fixture"
    assert repaired.conversation_snapshot(session_id)["items"] == snapshot_before["items"]
    with pytest.raises(SessionCursorExpired):
        repaired.list_session_events(session_id, after_sequence=0)
    tail = repaired.list_session_events(
        session_id,
        after_sequence=int(applied["candidates"][0]["compact_through_sequence"]),
    )
    assert len(tail) == 10
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    with closing(sqlite3.connect(backup)) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM runtime_session_journal"
        ).fetchone()[0] == last_sequence


def test_wrro_repair_never_compacts_past_the_slower_relay_cursor(
    tmp_path: Path,
) -> None:
    database = tmp_path / "engine.sqlite3"
    control = tmp_path / "relay-control.sqlite3"
    engine = RuntimeEngine(
        database,
        RuntimeEngineIdentity("runtime-one", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session_id = engine.create_session("workspace-one")["session_id"]
    for sequence in range(20):
        engine.conversation_journal.append_event(
            session_id, "session.updated", {"sequence": sequence},
            dedupe_key=f"event-{sequence}",
        )
    with sqlite3.connect(control) as connection:
        connection.executescript(
            "CREATE TABLE relay_session_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL);"
            "CREATE TABLE relay_oaep_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL);"
        )
        connection.execute(
            "INSERT INTO relay_session_event_cursors VALUES(?,?)", (session_id, 20)
        )
        connection.execute(
            "INSERT INTO relay_oaep_event_cursors VALUES(?,?)", (session_id, 7)
        )
    report = _MODULE.analyze(database, control, retain_events=1)
    assert report["candidates"][0]["compact_through_sequence"] == 7
