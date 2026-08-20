from __future__ import annotations

import sqlite3
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    ApprovalSecuritySloMonitor,
    ApprovalSecuritySloThresholds,
    HostLocalSecurityMetricsExporter,
    SecurityEventJournal,
    SecurityMetricsCollector,
    SecurityAuditError,
)


def _seed_grants(database: Path) -> None:
    with sqlite3.connect(database) as db:
        db.execute("""CREATE TABLE runtime_authorization_grants(
            grant_id TEXT PRIMARY KEY, expires_at REAL NOT NULL,
            consumed_at REAL, revoked_at REAL
        )""")
        db.executemany(
            "INSERT INTO runtime_authorization_grants VALUES(?,?,?,?)",
            [
                ("grant-expired-private", 95, None, None),
                ("grant-active-private", 200, None, None),
                ("grant-consumed-private", 200, 90, None),
                ("grant-revoked-private", 200, None, 90),
            ],
        )


def _seed_window_events(journal: SecurityEventJournal) -> None:
    for index in range(10):
        journal.append("approval.decided", f"approval-private-{index}", {
            "decision": "expired" if index < 2 else "approved",
            "reviewer_kind": "human",
        }, now=90 + index / 100)
        journal.append("effect.terminal", f"effect-private-{index}", {
            "status": "outcome_unknown" if index == 0 else "succeeded",
        }, now=90 + index / 100)
    journal.append("approval.adapter_failed", "adapter-private", {
        "adapter_kind": "codex", "failure_category": "protocol",
    }, now=91)


def test_p1_slo_monitor_raises_deduplicates_and_clears_all_alerts(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    _seed_window_events(journal)
    _seed_grants(database)
    now = [100.0]
    thresholds = ApprovalSecuritySloThresholds(
        window_seconds=100,
        minimum_decisions=10,
        minimum_effects=10,
        max_timeout_ratio_basis_points=500,
        max_expired_grant_ratio_basis_points=1_000,
        max_outcome_unknown_ratio_basis_points=100,
        max_adapter_failures=1,
    )
    monitor = ApprovalSecuritySloMonitor(database, thresholds=thresholds, clock=lambda: now[0])

    raised = monitor.evaluate()
    assert raised.active_alerts == ApprovalSecuritySloMonitor.ALERT_TYPES
    assert len(raised.emitted_events) == 4
    assert {event.event_type for event in raised.emitted_events} == {"approval_slo.alert_raised"}
    assert dict((name, value) for name, value, _ in raised.observations) == {
        "adapter_failures": 1,
        "approval_timeout_rate": 2000,
        "expired_grant_rate": 2500,
        "outcome_unknown_rate": 1000,
    }
    assert monitor.evaluate().emitted_events == ()

    with sqlite3.connect(database) as db:
        db.execute(
            "UPDATE runtime_authorization_grants SET revoked_at=? "
            "WHERE consumed_at IS NULL AND revoked_at IS NULL",
            (1000,),
        )
    now[0] = 1000
    cleared = monitor.evaluate()
    assert cleared.active_alerts == frozenset()
    assert len(cleared.emitted_events) == 4
    assert {event.event_type for event in cleared.emitted_events} == {"approval_slo.alert_cleared"}
    assert monitor.evaluate().emitted_events == ()
    journal.verify()

    rendered = HostLocalSecurityMetricsExporter(SecurityMetricsCollector(database)).render(now=1000)
    assert rendered.count("security_approval_slo_alert_total") == 8
    assert "private" not in rendered
    with pytest.raises(FrozenInstanceError):
        thresholds.window_seconds = 1  # type: ignore[misc]


def test_p1_slo_rate_alerts_require_minimum_sample_floor(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("approval.decided", "approval-private", {
        "decision": "expired", "reviewer_kind": "human",
    }, now=90)
    journal.append("effect.terminal", "effect-private", {
        "status": "outcome_unknown",
    }, now=90)
    monitor = ApprovalSecuritySloMonitor(
        database,
        thresholds=ApprovalSecuritySloThresholds(
            window_seconds=100, minimum_decisions=10, minimum_effects=10,
        ),
        clock=lambda: 100,
    )
    result = monitor.evaluate()
    assert result.active_alerts == frozenset()
    assert result.emitted_events == ()
    observations = {name: value for name, value, _ in result.observations}
    assert observations["approval_timeout_rate"] == 10_000
    assert observations["outcome_unknown_rate"] == 10_000


def test_p1_slo_alert_state_rolls_back_with_security_journal_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("approval.adapter_failed", "adapter-private", {
        "adapter_kind": "codex", "failure_category": "protocol",
    }, now=90)
    monitor = ApprovalSecuritySloMonitor(
        database,
        thresholds=ApprovalSecuritySloThresholds(window_seconds=100, max_adapter_failures=1),
        clock=lambda: 100,
    )
    original = monitor.journal.append_in_transaction

    def fail_append(*args, **kwargs):
        raise sqlite3.OperationalError("injected audit failure")

    monkeypatch.setattr(monitor.journal, "append_in_transaction", fail_append)
    with pytest.raises(sqlite3.OperationalError, match="audit failure"):
        monitor.evaluate()
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_approval_security_slo_alerts",
        ).fetchone()[0] == 0

    monkeypatch.setattr(monitor.journal, "append_in_transaction", original)
    retried = monitor.evaluate()
    assert retried.active_alerts == frozenset({"adapter_failures"})
    assert len(retried.emitted_events) == 1


def test_p1_slo_monitor_refuses_unverified_audit_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = tmp_path / "security.sqlite3"
    monitor = ApprovalSecuritySloMonitor(database, clock=lambda: 100)

    def fail_verify():
        raise SecurityAuditError("security_event_digest_invalid", "tampered")

    monkeypatch.setattr(monitor.journal, "verify", fail_verify)
    with pytest.raises(SecurityAuditError) as rejected:
        monitor.evaluate()
    assert rejected.value.code == "security_event_digest_invalid"
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_approval_security_slo_alerts",
        ).fetchone()[0] == 0
