"""Runtime-owned health alarms for durable isolated Effect recovery."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityAuditEvent, SecurityEventJournal
from .isolated_effect_execution import (
    IsolatedEffectExecutionService,
    IsolatedEffectRecoveryMetrics,
)


@dataclass(frozen=True)
class IsolatedEffectRecoveryThresholds:
    max_nonterminal_attempts: int = 10
    max_total_recovery_failures: int = 1
    max_oldest_pending_seconds: float = 120.0

    def __post_init__(self) -> None:
        if self.max_nonterminal_attempts < 1:
            raise ValueError("max_nonterminal_attempts must be positive")
        if self.max_total_recovery_failures < 1:
            raise ValueError("max_total_recovery_failures must be positive")
        if self.max_oldest_pending_seconds <= 0:
            raise ValueError("max_oldest_pending_seconds must be positive")


@dataclass(frozen=True)
class IsolatedEffectRecoveryAlertEvaluation:
    metrics: IsolatedEffectRecoveryMetrics
    active_alerts: frozenset[str]
    emitted_events: tuple[SecurityAuditEvent, ...]


class IsolatedEffectRecoveryMonitor:
    """Evaluates fixed Runtime policy and emits only transition events."""

    ALERT_TYPES = frozenset({"backlog", "recovery_failures", "stale_attempt"})

    def __init__(
        self,
        service: IsolatedEffectExecutionService,
        *,
        thresholds: IsolatedEffectRecoveryThresholds | None = None,
        clock=time.time,
    ):
        self.service = service
        self.database = Path(service.database)
        self.thresholds = thresholds or IsolatedEffectRecoveryThresholds()
        self.clock = clock
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_isolated_effect_recovery_alerts(
                    alert_type TEXT PRIMARY KEY CHECK(alert_type IN (
                        'backlog','recovery_failures','stale_attempt'
                    )),
                    active INTEGER NOT NULL CHECK(active IN (0,1)),
                    observed_value REAL NOT NULL,
                    threshold_value REAL NOT NULL,
                    changed_at REAL NOT NULL,
                    evaluated_at REAL NOT NULL
                );
            """)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    def evaluate(self) -> IsolatedEffectRecoveryAlertEvaluation:
        metrics = self.service.recovery_metrics()
        now = float(self.clock())
        observations = {
            "backlog": (
                float(metrics.nonterminal_attempts),
                float(self.thresholds.max_nonterminal_attempts),
                metrics.nonterminal_attempts >= self.thresholds.max_nonterminal_attempts,
            ),
            "recovery_failures": (
                float(metrics.total_recovery_failures),
                float(self.thresholds.max_total_recovery_failures),
                metrics.total_recovery_failures >= self.thresholds.max_total_recovery_failures,
            ),
            "stale_attempt": (
                float(metrics.oldest_pending_seconds),
                float(self.thresholds.max_oldest_pending_seconds),
                metrics.oldest_pending_seconds >= self.thresholds.max_oldest_pending_seconds,
            ),
        }
        emitted: list[SecurityAuditEvent] = []
        active_alerts: set[str] = set()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for alert_type in sorted(observations):
                observed, threshold, active = observations[alert_type]
                previous = db.execute(
                    "SELECT active FROM runtime_isolated_effect_recovery_alerts WHERE alert_type=?",
                    (alert_type,),
                ).fetchone()
                previous_active = bool(previous["active"]) if previous is not None else False
                changed_at = now if previous is None or previous_active != active else None
                db.execute(
                    "INSERT INTO runtime_isolated_effect_recovery_alerts"
                    "(alert_type,active,observed_value,threshold_value,changed_at,evaluated_at) "
                    "VALUES(?,?,?,?,?,?) ON CONFLICT(alert_type) DO UPDATE SET "
                    "active=excluded.active,observed_value=excluded.observed_value,"
                    "threshold_value=excluded.threshold_value,"
                    "changed_at=CASE WHEN active<>excluded.active THEN excluded.changed_at "
                    "ELSE changed_at END,evaluated_at=excluded.evaluated_at",
                    (alert_type, int(active), observed, threshold, changed_at or now, now),
                )
                if active:
                    active_alerts.add(alert_type)
                if previous_active != active:
                    event_type = (
                        "isolated_recovery.alert_raised" if active
                        else "isolated_recovery.alert_cleared"
                    )
                    emitted.append(self.journal.append_in_transaction(
                        db, event_type, alert_type,
                        {"alert_type": alert_type, "observed": observed, "threshold": threshold},
                        now=now,
                    ))
            db.commit()
        return IsolatedEffectRecoveryAlertEvaluation(
            metrics=metrics,
            active_alerts=frozenset(active_alerts),
            emitted_events=tuple(emitted),
        )
