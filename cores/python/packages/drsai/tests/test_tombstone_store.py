from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import TombstoneError, TombstoneStore


def prepared(store: TombstoneStore, suffix: str = "1"):
    return store.prepare(
        tombstone_id=suffix * 32,
        deletion_execution_id=f"delete-{suffix}", run_id="run-1",
        profile_digest="sha256:profile", source_payload_digest="sha256:source",
    )


def test_prepare_is_idempotent_but_identity_reuse_with_new_scope_fails(tmp_path: Path) -> None:
    store = TombstoneStore(tmp_path / "security.sqlite3", clock=lambda: 100)
    first = prepared(store)
    assert prepared(store) == first
    with pytest.raises(TombstoneError) as mismatch:
        store.prepare(
            tombstone_id="1" * 32, deletion_execution_id="delete-1", run_id="run-other",
            profile_digest="sha256:profile", source_payload_digest="sha256:source",
        )
    assert mismatch.value.code == "tombstone_scope_mismatch"


def test_restore_claim_release_and_terminal_transition_are_single_winner(tmp_path: Path) -> None:
    store = TombstoneStore(tmp_path / "security.sqlite3")
    record = prepared(store)
    store.mark_moved(record.tombstone_id)
    store.claim_restore(record.tombstone_id, "restore-1", "sha256:destination")
    with pytest.raises(TombstoneError) as conflict:
        store.claim_restore(record.tombstone_id, "restore-2", "sha256:other")
    assert conflict.value.code == "tombstone_state_conflict"
    store.release_restore(record.tombstone_id, "restore-1")
    store.claim_restore(record.tombstone_id, "restore-2", "sha256:other")
    assert store.mark_restored(record.tombstone_id, "restore-2").state == "restored"


def test_purge_requires_moved_state_and_exact_claim(tmp_path: Path) -> None:
    store = TombstoneStore(tmp_path / "security.sqlite3")
    record = prepared(store)
    with pytest.raises(TombstoneError):
        store.claim_purge(record.tombstone_id, "purge-too-early")
    store.mark_moved(record.tombstone_id)
    store.claim_purge(record.tombstone_id, "purge-1")
    with pytest.raises(TombstoneError) as mismatch:
        store.mark_purged(record.tombstone_id, "purge-other")
    assert mismatch.value.code == "tombstone_purge_claim_mismatch"
    assert store.mark_purged(record.tombstone_id, "purge-1").state == "purged"


def test_tombstone_events_are_append_only(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    store = TombstoneStore(database)
    record = prepared(store)
    store.mark_delete_unknown(record.tombstone_id, "InjectedError")
    store.mark_moved(record.tombstone_id)
    with sqlite3.connect(database) as connection:
        events = connection.execute(
            "SELECT state FROM runtime_filesystem_tombstone_events ORDER BY sequence",
        ).fetchall()
        assert events == [("prepared",), ("delete_unknown",), ("moved",)]
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("DELETE FROM runtime_filesystem_tombstone_events")
