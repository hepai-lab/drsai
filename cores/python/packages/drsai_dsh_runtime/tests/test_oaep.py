from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.contracts import OAEP_SCHEMA_SHA256
from opendrsai_dsh_runtime.oaep import (
    OaepCursorExpired,
    OaepJournal,
    OaepProtocol,
    OaepValidationError,
)
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore


def _store(tmp_path: Path) -> RuntimeAuthorityStore:
    store = RuntimeAuthorityStore(tmp_path / "authority.sqlite3")
    store.create_session(
        session_id="session-1",
        workspace_id="workspace-1",
        workspace_fingerprint="f" * 64,
        native_profile="dsh-sdk-0.1.0-rc.5",
        mapping_version="dsh-session-events-v1",
    )
    store.create_run("session-1", run_id="run-1", input_digest="a" * 64)
    return store


def _item(*, status: str = "pending", text: str = "hello", sequence: int = 1) -> dict:
    return {
        "id": "item-1",
        "session_id": "session-1",
        "run_id": "run-1",
        "type": "message",
        "status": status,
        "sequence": sequence,
        "created_at": "2026-08-16T00:00:00+00:00",
        "updated_at": "2026-08-16T00:00:00+00:00",
        "source": {"backend": "deepseek-harness"},
        "content": {"role": "assistant", "text": text},
    }


def _append(journal: OaepJournal, event_type: str, key: str, *, item: dict | None = None) -> dict:
    return journal.append(
        "session-1",
        run_id="run-1",
        item_id="item-1",
        event_type=event_type,
        dedupe_key=key,
        source={"backend": "deepseek-harness"},
        data={"item": item} if item is not None else {},
    )


def test_protocol_loads_exact_pinned_checkout_schema() -> None:
    protocol = OaepProtocol()
    assert protocol.schema["version"] == "1.0"
    assert len(OAEP_SCHEMA_SHA256) == 64


def test_journal_allocates_contiguous_session_cursor_and_idempotently_replays(tmp_path: Path) -> None:
    store = _store(tmp_path)
    journal = OaepJournal(store)
    first = _append(journal, "event.item.created", "native:1", item=_item())
    replay = _append(journal, "event.item.created", "native:1", item=_item())
    second = journal.append(
        "session-1",
        run_id="run-1",
        item_id="item-1",
        event_type="event.item.delta",
        dedupe_key="native:2",
        source={"backend": "deepseek-harness"},
        data={"delta": {"kind": "message.text.append", "text": " world"}},
    )
    assert first == replay
    assert (first["sequence"], second["sequence"]) == (1, 2)
    assert journal.event_page("session-1", after_sequence=0, limit=1) == {
        "version": "1.0",
        "object": "list",
        "data": [first],
        "next_sequence": 1,
        "has_more": True,
    }
    store.close()


def test_atomic_item_projection_and_snapshot_survive_reopen(tmp_path: Path) -> None:
    path = tmp_path / "authority.sqlite3"
    store = _store(tmp_path)
    journal = OaepJournal(store)
    _append(journal, "event.item.created", "create", item=_item())
    completed = _item(status="completed", text="hello world")
    _append(journal, "event.item.completed", "complete", item=completed)
    snapshot = journal.snapshot("session-1")
    assert snapshot["items"] == [completed]
    assert snapshot["snapshot_sequence"] == 2
    assert snapshot["checkpoint"]["item_count"] == 1
    store.close()

    reopened = RuntimeAuthorityStore(path)
    reopened_snapshot = OaepJournal(reopened).snapshot("session-1")
    assert reopened_snapshot == snapshot
    reopened.close()


def test_dedupe_conflict_and_item_invariants_roll_back_cursor(tmp_path: Path) -> None:
    store = _store(tmp_path)
    journal = OaepJournal(store)
    _append(journal, "event.item.created", "same", item=_item())
    with pytest.raises(OaepValidationError, match="oaep_dedupe_conflict"):
        _append(journal, "event.item.created", "same", item=_item(text="different"))
    with pytest.raises(OaepValidationError, match="oaep_item_status_mismatch"):
        _append(journal, "event.item.completed", "bad", item=_item(status="running"))
    assert journal.event_page("session-1")["next_sequence"] == 1
    store.close()


def test_item_sequence_is_unique_per_run(tmp_path: Path) -> None:
    store = _store(tmp_path)
    journal = OaepJournal(store)
    _append(journal, "event.item.created", "one", item=_item())
    other = _item()
    other["id"] = "item-2"
    with pytest.raises(OaepValidationError, match="oaep_item_sequence_conflict"):
        journal.append(
            "session-1",
            run_id="run-1",
            item_id="item-2",
            event_type="event.item.created",
            dedupe_key="two",
            source={"backend": "deepseek-harness"},
            data={"item": other},
        )
    assert journal.event_page("session-1")["next_sequence"] == 1
    store.close()


def test_wait_event_page_observes_live_append(tmp_path: Path) -> None:
    store = _store(tmp_path)
    journal = OaepJournal(store)
    result: list[dict] = []
    waiter = threading.Thread(
        target=lambda: result.append(journal.wait_event_page("session-1", after_sequence=0, timeout=1.0))
    )
    waiter.start()
    time.sleep(0.05)
    _append(journal, "event.item.created", "wake", item=_item())
    waiter.join(timeout=2)
    assert result[0]["data"][0]["dedupe_key"] == "wake"
    store.close()


def test_expired_cursor_requires_snapshot_recovery_and_projection_is_retained(tmp_path: Path) -> None:
    store = _store(tmp_path)
    journal = OaepJournal(store)
    _append(journal, "event.item.created", "create", item=_item())
    _append(journal, "event.item.completed", "complete", item=_item(status="completed"))
    assert journal.expire_through("session-1", 1) == 1
    with pytest.raises(OaepCursorExpired) as expired:
        journal.event_page("session-1", after_sequence=0)
    assert expired.value.expired_through == 1
    assert expired.value.snapshot["snapshot_sequence"] == 2
    assert expired.value.snapshot["items"][0]["status"] == "completed"
    page = journal.event_page("session-1", after_sequence=1)
    assert [event["sequence"] for event in page["data"]] == [2]
    with pytest.raises(OaepValidationError, match="oaep_retention_beyond_waterline"):
        journal.expire_through("session-1", 3)
    store.close()
