from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    HostLocalSecurityMetricsExporter,
    SecurityEventJournal,
    SecurityMetric,
    SecurityMetricsCollector,
    SecurityMetricsExportError,
)


def test_host_local_exporter_renders_deterministic_secret_free_prometheus_text(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("approval.requested", "request-private-id", {
        "reviewer_kind": "human", "secret": "canary-private-secret",
    }, now=100)
    journal.append("approval.decided", "request-private-id", {
        "decision": "expired", "reviewer_kind": "system",
    }, now=107)
    journal.append("effect.terminal", "effect-private-id", {
        "status": "outcome_unknown", "receipt_digest": "canary-private-receipt",
    }, now=108)
    exporter = HostLocalSecurityMetricsExporter(SecurityMetricsCollector(database))

    rendered = exporter.render(now=110)
    assert 'security_approval_timeout_total{reviewer_kind="unknown"} 1' in rendered
    assert "security_effect_outcome_unknown_ratio_basis_points 10000" in rendered
    assert 'security_audit_integrity{valid="true"} 1' in rendered
    assert "private" not in rendered
    assert "canary" not in rendered
    assert not any(hasattr(exporter, name) for name in ("serve", "listen", "bind", "start"))


def test_concurrent_host_scrapes_are_identical_and_do_not_write_state(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("hard_deny.blocked", "proposal-private", {
        "category": "credential_theft",
    }, now=100)
    exporter = HostLocalSecurityMetricsExporter(SecurityMetricsCollector(database))
    before = len(journal.list())
    with ThreadPoolExecutor(max_workers=8) as pool:
        outputs = list(pool.map(lambda _: exporter.render(now=101), range(32)))
    assert len(set(outputs)) == 1
    assert len(journal.list()) == before


class _FakeCollector:
    def __init__(self, metrics=None, error: Exception | None = None):
        self.metrics = metrics or []
        self.error = error

    def snapshot(self, *, now=None):
        if self.error is not None:
            raise self.error
        return list(self.metrics)


@pytest.mark.parametrize(
    ("metrics", "code"),
    [
        ([SecurityMetric("attacker_metric", {"secret": "canary"}, 1)],
         "security_metric_not_allowlisted"),
        ([SecurityMetric("security_audit_integrity", {"valid": "canary-secret"}, 1)],
         "security_metric_label_value_invalid"),
        ([SecurityMetric("security_audit_integrity", {"valid": "true", "run_id": "private"}, 1)],
         "security_metric_labels_invalid"),
        ([SecurityMetric("security_audit_integrity", {"valid": "true"}, float("nan"))],
         "security_metric_value_invalid"),
    ],
)
def test_exporter_rejects_metric_label_and_value_injection(metrics, code: str) -> None:
    exporter = HostLocalSecurityMetricsExporter(_FakeCollector(metrics))  # type: ignore[arg-type]
    with pytest.raises(SecurityMetricsExportError) as rejected:
        exporter.render()
    assert rejected.value.code == code


def test_exporter_rejects_duplicate_cardinality_and_database_failure_without_partial_output() -> None:
    repeated = [
        SecurityMetric("security_audit_integrity", {"valid": "true"}, 1)
        for _ in range(2)
    ]
    exporter = HostLocalSecurityMetricsExporter(_FakeCollector(repeated))  # type: ignore[arg-type]
    with pytest.raises(SecurityMetricsExportError) as duplicate:
        exporter.render()
    assert duplicate.value.code == "security_metric_series_duplicate"

    bounded = HostLocalSecurityMetricsExporter(  # type: ignore[arg-type]
        _FakeCollector([
            SecurityMetric("security_audit_integrity", {"valid": "true"}, 1),
            SecurityMetric("security_audit_integrity", {"valid": "false"}, 1),
        ]),
        max_series_per_metric=1,
    )
    with pytest.raises(SecurityMetricsExportError) as cardinality:
        bounded.render()
    assert cardinality.value.code == "security_metrics_cardinality_exceeded"

    unavailable = HostLocalSecurityMetricsExporter(  # type: ignore[arg-type]
        _FakeCollector(error=sqlite3.OperationalError("database is unavailable")),
    )
    with pytest.raises(SecurityMetricsExportError) as failed:
        unavailable.render()
    assert failed.value.code == "security_metrics_unavailable"
    assert "database" not in str(failed.value).lower()
