from __future__ import annotations

import pytest

from drsai.backend.runtime.observability import (
    CONVERSATION_LATENCY_STAGES,
    METRICS,
    ResourceCorrelation,
    RuntimeObservability,
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
