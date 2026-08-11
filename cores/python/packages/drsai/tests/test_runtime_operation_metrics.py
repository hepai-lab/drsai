from pathlib import Path

from drsai.backend.runtime.operation_metrics import RuntimeOperationMetrics


def test_operation_metrics_persist_latency_and_content_free_failures(tmp_path: Path) -> None:
    database = tmp_path / "metrics.sqlite3"
    metrics = RuntimeOperationMetrics(database)
    metrics.record("replay.plan", 12.5)
    metrics.record("replay.plan", 20.0, error_code="plan_stale")
    metrics.record("adoption.apply", 35.0)

    reopened = RuntimeOperationMetrics(database)
    rows = {row["operation"]: row for row in reopened.list()}
    assert rows["replay.plan"]["total"] == 2
    assert rows["replay.plan"]["failures"] == 1
    assert rows["replay.plan"]["latency_ms_average"] == 16.25
    assert rows["replay.plan"]["last_error_code"] == "plan_stale"
    assert rows["replay.plan"]["latency_histogram"]["lt_100_ms"] == 2
    assert "content" not in str(rows).lower()
    assert "prompt" not in str(rows).lower()
