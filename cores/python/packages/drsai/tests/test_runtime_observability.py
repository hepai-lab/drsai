from __future__ import annotations

import pytest

from drsai.backend.runtime.observability import METRICS, ResourceCorrelation, RuntimeObservability


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
