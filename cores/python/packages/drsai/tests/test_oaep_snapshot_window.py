from __future__ import annotations

import hashlib
import json
import sqlite3
import tracemalloc
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity


ROOT = Path(__file__).resolve().parents[5]
OAEP_SCHEMA = ROOT / "cores" / "protocol" / "oaep" / "oaep.schema.json"
WINDOW_FIXTURE = ROOT / "cores" / "protocol" / "oaep" / "snapshot-window.examples.json"


def _runtime(tmp_path: Path) -> tuple[RuntimeEngine, dict, dict]:
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-window", "instance-window"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Window Session")
    run, _ = engine.create_run(session["session_id"], "agent@1", "window-run")
    return engine, session, run


def _record_messages(engine: RuntimeEngine, session_id: str, run_id: str, count: int) -> None:
    for index in range(count):
        engine.record_conversation_item(
            session_id,
            item_id=f"window-item-{index:06d}",
            kind="message",
            role="user",
            revision=1,
            source_client="windows",
            source_message_id=f"window-source-{index:06d}",
            payload={"text": f"message {index}", "status": "completed"},
            run_id=run_id,
        )


def test_snapshot_window_cross_language_fixture_matches_schema() -> None:
    schema = json.loads(OAEP_SCHEMA.read_text(encoding="utf-8"))
    fixture = json.loads(WINDOW_FIXTURE.read_text(encoding="utf-8"))
    assert fixture["contract"] == "oaep-snapshot-window/1"
    for page in fixture["pages"]:
        Draft202012Validator(schema).validate(page)
        assert page["checkpoint"]["sequence"] == page["snapshot_sequence"]
    assert {
        item["id"] for page in fixture["pages"] for item in page["items"]
    } == set(fixture["expected_item_ids"])


def test_snapshot_window_is_checkpoint_bound_complete_and_tamper_proof(tmp_path: Path) -> None:
    engine, session, run = _runtime(tmp_path)
    _record_messages(engine, session["session_id"], run["run_id"], 25)

    first = engine.oaep_snapshot(session["session_id"], limit=7)
    assert len(first["items"]) == 7
    assert first["window"]["has_more"] is True
    assert first["checkpoint"]["item_count"] == 25
    Draft202012Validator(json.loads(OAEP_SCHEMA.read_text(encoding="utf-8"))).validate(first)

    # A later write must be observed by the live Event stream, but must never
    # leak into pages belonging to this already-issued Snapshot checkpoint.
    engine.record_conversation_item(
        session["session_id"],
        item_id="new-after-checkpoint",
        kind="message",
        role="user",
        revision=1,
        source_client="android",
        source_message_id="new-after-checkpoint",
        payload={"text": "new", "status": "completed"},
        run_id=run["run_id"],
    )

    pages = [first]
    cursor = first["window"]["next_cursor"]
    while cursor:
        page = engine.oaep_snapshot(session["session_id"], cursor=cursor, limit=7)
        assert page["checkpoint"] == first["checkpoint"]
        assert page["snapshot_sequence"] == first["snapshot_sequence"]
        pages.append(page)
        cursor = page["window"]["next_cursor"]

    item_ids = [item["id"] for page in pages for item in page["items"]]
    assert len(item_ids) == 25
    assert len(set(item_ids)) == 25
    assert "new-after-checkpoint" not in item_ids
    assert set(item_ids) == {
        item["id"]
        for item in engine.oaep_snapshot(session["session_id"])["items"]
        if item["id"] != "new-after-checkpoint"
    }
    canonical_items = sorted(
        [item for page in pages for item in page["items"]],
        key=lambda item: (str(item["run_id"]), int(item["sequence"]), str(item["id"])),
    )
    canonical = json.dumps(
        canonical_items, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    )
    assert hashlib.sha256(canonical.encode()).hexdigest() == first["checkpoint"]["snapshot_hash"]

    token = str(first["window"]["next_cursor"])
    replacement = "A" if token[-1] != "A" else "B"
    with pytest.raises(ValueError, match="Invalid OAEP Snapshot cursor"):
        engine.oaep_snapshot(session["session_id"], cursor=token[:-1] + replacement, limit=7)
    other = engine.create_session("workspace-one", "Other Session")
    with pytest.raises(ValueError, match="Invalid OAEP Snapshot cursor"):
        engine.oaep_snapshot(other["session_id"], cursor=token, limit=7)


def test_100k_item_cold_start_is_bounded_and_streams_checkpoint_hash(tmp_path: Path) -> None:
    engine, session, run = _runtime(tmp_path)
    _record_messages(engine, session["session_id"], run["run_id"], 1)
    session_id = session["session_id"]
    run_id = run["run_id"]

    with sqlite3.connect(engine.database) as db:
        db.row_factory = sqlite3.Row
        base = db.execute(
            "SELECT latest_sequence,envelope_json FROM runtime_oaep_items WHERE session_id=?",
            (session_id,),
        ).fetchone()
        assert base is not None
        base_sequence = int(base["latest_sequence"])
        envelope = json.loads(str(base["envelope_json"]))
        timestamp = "2026-08-04T00:00:00+00:00"

        def conversation_rows():
            for index in range(1, 100_000):
                item_id = f"bulk-item-{index:06d}"
                sequence = base_sequence + index
                yield (
                    item_id, session_id, run_id, "message", "user", 1, sequence,
                    "runtime", None, timestamp, timestamp,
                    json.dumps({"text": "bounded", "status": "completed"}, separators=(",", ":")),
                )

        db.executemany(
            "INSERT INTO runtime_conversation_items("
            "item_id,session_id,run_id,item_kind,role,revision,latest_sequence,"
            "source_client,source_message_id,created_at,updated_at,payload_json"
            ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            conversation_rows(),
        )

        def oaep_rows():
            for index in range(1, 100_000):
                item_id = f"bulk-item-{index:06d}"
                sequence = base_sequence + index
                item = {**envelope, "id": item_id, "sequence": index + 1}
                yield (
                    item_id, session_id, run_id, index + 1, 1, sequence,
                    "message", "completed", 0, 0, 0, 0,
                    json.dumps(item, ensure_ascii=False, separators=(",", ":")),
                )

        db.executemany(
            "INSERT INTO runtime_oaep_items("
            "item_id,session_id,run_id,run_sequence,revision,latest_sequence,item_type,"
            "item_status,warning_count,input_tokens,output_tokens,total_tokens,envelope_json"
            ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            oaep_rows(),
        )
        db.execute(
            "UPDATE runtime_session_sequences SET last_sequence=? WHERE session_id=?",
            (base_sequence + 99_999, session_id),
        )
        db.commit()

    tracemalloc.start()
    snapshot = engine.oaep_snapshot(session_id, limit=100)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert len(snapshot["items"]) == 100
    assert snapshot["checkpoint"]["item_count"] == 100_000
    assert snapshot["window"]["has_more"] is True
    assert snapshot["window"]["next_cursor"]
    assert len(json.dumps(snapshot, ensure_ascii=False).encode()) < 256 * 1024
    # The checkpoint digest and page query both stream; they must not retain a
    # Python object graph proportional to the 100k-item transcript.
    assert peak < 32 * 1024 * 1024
