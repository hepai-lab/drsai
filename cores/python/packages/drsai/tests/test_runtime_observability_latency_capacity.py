"""Runtime telemetry must stay bounded on a machine that streams a lot.

Measured on a real Runtime database (474 MiB after the legacy event mirrors had
been purged): ``conversation_latency_stages`` alone held 99,793 rows / 39.97 MiB
of it, i.e. one ``journal_append`` sample per appended session event.  Each row
costs ~420 bytes because the packed dimensions echo the full Runtime identity
(runtime/host/session/run/protocol) next to a primary key that already carries
the correlation, so the population simply sat at the old 100_000 ceiling.

These tests pin the bound down: the conversation-latency capacity is a small
explicit default, the trim keeps the newest samples, and the user-journey SLO
samples keep their own independent ceiling so lowering the latency capacity
cannot truncate cross-device SLO history.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.observability import (
    DEFAULT_CONVERSATION_LATENCY_CAPACITY,
    DEFAULT_USER_SLO_CAPACITY,
    ResourceCorrelation,
    RuntimeObservability,
)

JOURNAL_STAGE = "journal_append"


def _observability(tmp_path: Path, **overrides: int) -> RuntimeObservability:
    return RuntimeObservability(tmp_path / "conversation-latency.sqlite3", **overrides)


def _correlation(index: int) -> ResourceCorrelation:
    return ResourceCorrelation(
        correlation_id=f"corr-{index:06d}",
        operation_id=f"op-{index:06d}",
        runtime_id="rt-observe",
        session_id="session-observe",
        run_id="run-observe",
    )


def _count(database: Path, table: str) -> int:
    connection = sqlite3.connect(str(database))
    try:
        return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    finally:
        connection.close()


def _latency_ids(database: Path) -> list[str]:
    connection = sqlite3.connect(str(database))
    try:
        rows = connection.execute(
            "SELECT correlation_id FROM conversation_latency_stages ORDER BY observed_at, rowid"
        ).fetchall()
    finally:
        connection.close()
    return [str(row[0]) for row in rows]


def test_default_capacity_fits_one_day_of_item_deltas() -> None:
    """The latency cap must be small enough that identity echo cannot dominate."""
    assert DEFAULT_CONVERSATION_LATENCY_CAPACITY == 20_000
    assert DEFAULT_CONVERSATION_LATENCY_CAPACITY < 100_000
    assert DEFAULT_USER_SLO_CAPACITY == 100_000


def test_conversation_latency_trim_keeps_only_the_newest_samples(tmp_path: Path) -> None:
    capacity = 8
    observability = _observability(
        tmp_path,
        conversation_latency_capacity=capacity,
        conversation_latency_trim_interval=1,
    )
    for index in range(40):
        assert observability.record_conversation_latency(
            JOURNAL_STAGE,
            1.5,
            _correlation(index),
            {"runtime_id": "rt-observe", "session_id": "session-observe"},
        )
    retained = _latency_ids(observability.database)
    assert len(retained) == capacity
    assert retained == [f"corr-{index:06d}" for index in range(40 - capacity, 40)]


def test_user_slo_capacity_is_independent_of_the_latency_capacity(tmp_path: Path) -> None:
    observability = _observability(
        tmp_path,
        conversation_latency_capacity=5,
        conversation_latency_trim_interval=1,
        user_slo_capacity=7,
    )
    for index in range(12):
        assert observability.record_conversation_latency(
            JOURNAL_STAGE, 1.0, _correlation(index)
        )
        assert observability.record_user_slo_stage(
            "first_screen", "cache_load", 3.0, sample_id=f"sample-{index:06d}"
        )
    assert _count(observability.database, "conversation_latency_stages") == 5
    assert _count(observability.database, "user_slo_stages") == 7


def test_latency_samples_are_deduplicated_by_correlation_and_stage(tmp_path: Path) -> None:
    observability = _observability(tmp_path)
    correlation = _correlation(1)
    assert observability.record_conversation_latency(JOURNAL_STAGE, 1.0, correlation) is True
    assert observability.record_conversation_latency(JOURNAL_STAGE, 9.0, correlation) is False
    assert _count(observability.database, "conversation_latency_stages") == 1


@pytest.mark.parametrize("capacity", [4, 1_000_001])
def test_out_of_range_latency_capacity_is_rejected(tmp_path: Path, capacity: int) -> None:
    with pytest.raises(ValueError):
        _observability(tmp_path, conversation_latency_capacity=capacity)


def test_out_of_range_user_slo_capacity_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        _observability(tmp_path, user_slo_capacity=4)
    with pytest.raises(ValueError):
        _observability(tmp_path, user_slo_capacity=1_000_001)


def test_out_of_range_trim_interval_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        _observability(tmp_path, conversation_latency_trim_interval=0)
