from __future__ import annotations

import time

import pytest

from drsai.backend.runtime.observability import (
    CONVERSATION_LATENCY_RETENTION_SECONDS,
    CONVERSATION_LATENCY_STAGES,
    METRICS,
    ResourceCorrelation,
    RuntimeObservability,
    USER_SLO_DEFINITIONS,
)
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity


def test_required_runtime_metrics_are_bounded_correlated_and_redacted(tmp_path):
    metrics = RuntimeObservability(tmp_path / "metrics.sqlite3")
    correlation = ResourceCorrelation(
        "corr-1", "op-1", "host-1", "runtime-1", "workspace-1", "worktree-1",
        "terminal-1", "session-1", "run-1",
    )
    for name in sorted(METRICS):
        metrics.record(name, 1, correlation, {"phase": "recovery", "token": "secret-canary"})
    rows = metrics.list("corr-1")
    assert len(rows) == len(METRICS)
    assert {row["metric"] for row in rows} == METRICS
    assert "secret-canary" not in str(rows)
    assert all(row["dimensions"]["workspace_id"] == "workspace-1" for row in rows)
    with pytest.raises(ValueError):
        metrics.record("pty.replay.lag", 1, correlation, {"output": "not telemetry"})
    with pytest.raises(ValueError):
        metrics.record("unknown", 1, correlation)


def test_conversation_latency_report_finds_p95_bottleneck_without_content(tmp_path):
    metrics = RuntimeObservability(tmp_path / "latency.sqlite3")
    for sample in range(100):
        correlation = ResourceCorrelation(
            f"corr-{sample}", f"event-{sample}", runtime_id="runtime-1",
            workspace_id="workspace-1", session_id="session-1", run_id="run-1",
        )
        durations = {
            "journal_append": 2 + sample % 2,
            "runtime_wss_send": 4 + sample % 3,
            "relay_fanout": 45 + sample % 10,
            "client_receive": 3 + sample % 2,
            "client_render": 8 + sample % 4,
        }
        for stage in CONVERSATION_LATENCY_STAGES:
            assert metrics.record_conversation_latency(
                stage, durations[stage], correlation, {"protocol": "oaep/1"}
            )
            assert not metrics.record_conversation_latency(
                stage, 299_999, correlation, {"protocol": "oaep/1"}
            ), "replayed evidence must not replace the first measurement"
    incomplete = ResourceCorrelation("corr-incomplete", "event-incomplete")
    metrics.record_conversation_latency("journal_append", 1, incomplete)

    report = metrics.conversation_latency_report(minimum_complete_samples=100)
    assert report["ready"] is True
    assert report["complete_sample_count"] == 100
    assert report["incomplete_sample_count"] == 1
    assert report["p95_bottleneck"] == "relay_fanout"
    assert report["stages"]["relay_fanout"]["p95_ms"] == 54
    assert report["stages"]["relay_fanout"]["p50_ms"] == 49
    assert report["relay_worker_count"] == 0
    assert report["multi_worker_ready"] is False
    serialized = str(report)
    assert "corr-" not in serialized
    assert "workspace-1" not in serialized


def test_runtime_journal_records_authoritative_append_stage_in_same_transaction(tmp_path):
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-one", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Observed")
    events = engine.list_session_events(session["session_id"], after_sequence=0)
    assert events
    observation = engine.observability.conversation_latency_observations(
        events[-1]["event_id"]
    )
    assert observation and observation[0]["stage"] == "journal_append"
    assert observation[0]["duration_ms"] >= 0


@pytest.mark.parametrize("stage", ["unknown", "message", "relay_body"])
def test_conversation_latency_rejects_unknown_stage_and_payload_dimensions(tmp_path, stage):
    metrics = RuntimeObservability(tmp_path / "latency.sqlite3")
    correlation = ResourceCorrelation("corr", "operation")
    with pytest.raises(ValueError):
        metrics.record_conversation_latency(stage, 1, correlation)
    with pytest.raises(ValueError):
        metrics.record_conversation_latency(
            "client_render", 1, correlation, {"message": "secret-canary"}
        )
    with pytest.raises(ValueError):
        metrics.record_conversation_latency("client_render", float("nan"), correlation)


def test_conversation_latency_is_capacity_bounded_and_excludes_expired_rows(tmp_path):
    metrics = RuntimeObservability(
        tmp_path / "latency.sqlite3",
        conversation_latency_capacity=5,
        conversation_latency_trim_interval=1,
    )
    for index in range(6):
        metrics.record_conversation_latency(
            "journal_append", index, ResourceCorrelation(f"corr-{index}", f"event-{index}")
        )
    with metrics._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM conversation_latency_stages").fetchone()[0] == 5
        db.execute(
            "UPDATE conversation_latency_stages SET observed_at=?",
            (time.time() - CONVERSATION_LATENCY_RETENTION_SECONDS - 1,),
        )
    assert metrics.conversation_latency_report()["incomplete_sample_count"] == 0
    assert metrics.conversation_latency_observations("corr-5") == []


def test_conversation_latency_database_uses_wal_for_cross_worker_visibility(tmp_path):
    database = tmp_path / "latency.sqlite3"
    first = RuntimeObservability(database)
    second = RuntimeObservability(database)
    correlation = ResourceCorrelation("event", "event")
    assert first.record_conversation_latency("journal_append", 1, correlation)
    assert second.conversation_latency_observations("event") == [{
        "correlation_id": "event",
        "operation_id": "event",
        "stage": "journal_append",
        "duration_ms": 1.0,
    }]
    with second._connect() as db:
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"


def test_user_slo_report_has_four_aggregate_journeys_and_locates_bottlenecks(tmp_path):
    metrics = RuntimeObservability(tmp_path / "slo.sqlite3")
    for index in range(20):
        sample_id = f"sample-{index:04d}"
        values = {
            "first_screen": (100, 300, 200),
            "operation_confirmation": (100, 2_100 + index, 100),
            "reconnect": (200, 4_000, 500),
        }
        for journey, durations in values.items():
            for stage, duration in zip(USER_SLO_DEFINITIONS[journey]["stages"], durations):
                assert metrics.record_user_slo_stage(
                    journey, stage, duration, sample_id=sample_id
                )
                assert not metrics.record_user_slo_stage(
                    journey, stage, 299_999, sample_id=sample_id
                )
        event = ResourceCorrelation(f"event-{index}", f"operation-{index}")
        for stage, duration in zip(CONVERSATION_LATENCY_STAGES, (10, 20, 1_100, 10, 20)):
            metrics.record_conversation_latency(stage, duration, event)

    report = metrics.user_slo_report()
    assert report["schema_version"] == "p6-user-slo/1"
    assert report["ready"] is True
    assert set(report["journeys"]) == set(USER_SLO_DEFINITIONS)
    assert report["journeys"]["first_screen"]["within_threshold"] is True
    assert report["journeys"]["operation_confirmation"]["within_threshold"] is False
    assert report["journeys"]["operation_confirmation"]["bottleneck"] == "runtime_commit"
    assert report["journeys"]["event_to_render"]["bottleneck"] == "relay_fanout"
    assert report["journeys"]["reconnect"]["p50_ms"] > 0
    serialized = str(report)
    assert "sample-" not in serialized
    assert "event-" not in serialized
    with metrics._connect() as db:
        stored = str(db.execute("SELECT * FROM user_slo_stages").fetchall())
    assert "sample-" not in stored


@pytest.mark.parametrize(
    ("journey", "stage", "sample_id"),
    [
        ("unknown", "cache_load", "sample-0001"),
        ("first_screen", "runtime_commit", "sample-0001"),
        ("reconnect", "transport_restore", "short"),
        ("reconnect", "transport_restore", "sample/with/path"),
    ],
)
def test_user_slo_rejects_unknown_mismatched_or_identifying_input(
    tmp_path, journey, stage, sample_id
):
    metrics = RuntimeObservability(tmp_path / "slo.sqlite3")
    with pytest.raises(ValueError):
        metrics.record_user_slo_stage(journey, stage, 1, sample_id=sample_id)


@pytest.mark.parametrize("capacity", [0, 4, 1_000_001])
def test_conversation_latency_rejects_unbounded_capacity(tmp_path, capacity):
    with pytest.raises(ValueError, match="capacity"):
        RuntimeObservability(
            tmp_path / "latency.sqlite3", conversation_latency_capacity=capacity
        )


@pytest.mark.parametrize("interval", [0, 10_001])
def test_conversation_latency_rejects_unbounded_trim_interval(tmp_path, interval):
    with pytest.raises(ValueError, match="trim interval"):
        RuntimeObservability(
            tmp_path / "latency.sqlite3", conversation_latency_trim_interval=interval
        )
