"""Runtime-owned SLO alarms for Approval, Grant, and Effect safety health."""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from drsai.backend.runtime.sqlite_connection import ClosingConnection

from .audit import SecurityAuditEvent, SecurityEventJournal


@dataclass(frozen=True)
class ApprovalSecuritySloThresholds:
    window_seconds: float = 300.0
    minimum_decisions: int = 10
    minimum_effects: int = 10
    max_timeout_ratio_basis_points: int = 500
    max_expired_grant_ratio_basis_points: int = 1_000
    max_outcome_unknown_ratio_basis_points: int = 100
    max_adapter_failures: int = 1

    def __post_init__(self) -> None:
        if self.window_seconds <= 0 or self.minimum_decisions < 1 or self.minimum_effects < 1:
            raise ValueError("Approval SLO window and sample floors must be positive")
        for value in (
            self.max_timeout_ratio_basis_points,
            self.max_expired_grant_ratio_basis_points,
            self.max_outcome_unknown_ratio_basis_points,
        ):
            if value < 0 or value > 10_000:
                raise ValueError("Approval SLO ratios must be basis points")
        if self.max_adapter_failures < 1:
            raise ValueError("Approval SLO adapter failure threshold must be positive")


@dataclass(frozen=True)
class ApprovalSecuritySloEvaluation:
    active_alerts: frozenset[str]
    emitted_events: tuple[SecurityAuditEvent, ...]
    observations: tuple[tuple[str, int, int], ...]


class ApprovalSecuritySloMonitor:
    ALERT_TYPES = frozenset({
        "approval_timeout_rate", "expired_grant_rate",
        "outcome_unknown_rate", "adapter_failures",
    })

    def __init__(
        self,
        database: Path,
        *,
        thresholds: ApprovalSecuritySloThresholds | None = None,
        clock=time.time,
        policy_digest: str | None = None,
    ):
        self.database = Path(database)
        self.thresholds = thresholds or ApprovalSecuritySloThresholds()
        self.clock = clock
        self.policy_digest = policy_digest
        self.journal = SecurityEventJournal(self.database)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS runtime_approval_security_slo_alerts(
                alert_type TEXT PRIMARY KEY CHECK(alert_type IN (
                    'approval_timeout_rate','expired_grant_rate',
                    'outcome_unknown_rate','adapter_failures'
                )),
                active INTEGER NOT NULL CHECK(active IN (0,1)),
                observed_value INTEGER NOT NULL,
                threshold_value INTEGER NOT NULL,
                changed_at REAL NOT NULL,
                evaluated_at REAL NOT NULL
            )""")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.database, timeout=30, isolation_level=None, factory=ClosingConnection,
        )
        connection.row_factory = sqlite3.Row
        return connection

    @staticmethod
    def _basis_points(numerator: int, denominator: int) -> int:
        return numerator * 10_000 // denominator if denominator else 0

    def _expired_grant_ratio(self, now: float) -> int:
        with self._connect() as db:
            exists = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' "
                "AND name='runtime_authorization_grants'",
            ).fetchone()
            if exists is None:
                return 0
            row = db.execute(
                "SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN consumed_at IS NULL "
                "AND revoked_at IS NULL AND expires_at<=? THEN 1 ELSE 0 END),0) AS expired "
                "FROM runtime_authorization_grants",
                (now,),
            ).fetchone()
        return self._basis_points(int(row["expired"]), int(row["total"]))

    def evaluate(self) -> ApprovalSecuritySloEvaluation:
        now = float(self.clock())
        since = now - self.thresholds.window_seconds
        decisions = timeouts = effects = unknown = adapter_failures = 0
        self.journal.verify()
        for event in self.journal.list():
            if event.created_at < since or event.created_at > now:
                continue
            if event.event_type == "approval.decided":
                decisions += 1
                timeouts += int(event.payload.get("decision") == "expired")
            elif event.event_type == "effect.terminal":
                effects += 1
                unknown += int(event.payload.get("status") == "outcome_unknown")
            elif event.event_type == "approval.adapter_failed":
                adapter_failures += 1
        timeout_ratio = self._basis_points(timeouts, decisions)
        unknown_ratio = self._basis_points(unknown, effects)
        observations = {
            "approval_timeout_rate": (
                timeout_ratio, self.thresholds.max_timeout_ratio_basis_points,
                decisions >= self.thresholds.minimum_decisions
                and timeout_ratio > self.thresholds.max_timeout_ratio_basis_points,
            ),
            "expired_grant_rate": (
                self._expired_grant_ratio(now),
                self.thresholds.max_expired_grant_ratio_basis_points,
                False,
            ),
            "outcome_unknown_rate": (
                unknown_ratio, self.thresholds.max_outcome_unknown_ratio_basis_points,
                effects >= self.thresholds.minimum_effects
                and unknown_ratio > self.thresholds.max_outcome_unknown_ratio_basis_points,
            ),
            "adapter_failures": (
                adapter_failures, self.thresholds.max_adapter_failures,
                adapter_failures >= self.thresholds.max_adapter_failures,
            ),
        }
        expired_value, expired_threshold, _ = observations["expired_grant_rate"]
        observations["expired_grant_rate"] = (
            expired_value, expired_threshold, expired_value > expired_threshold,
        )
        emitted: list[SecurityAuditEvent] = []
        active_alerts: set[str] = set()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            for alert_type in sorted(observations):
                observed, threshold, active = observations[alert_type]
                previous = db.execute(
                    "SELECT active FROM runtime_approval_security_slo_alerts WHERE alert_type=?",
                    (alert_type,),
                ).fetchone()
                previous_active = bool(previous["active"]) if previous is not None else False
                db.execute(
                    "INSERT INTO runtime_approval_security_slo_alerts"
                    "(alert_type,active,observed_value,threshold_value,changed_at,evaluated_at) "
                    "VALUES(?,?,?,?,?,?) ON CONFLICT(alert_type) DO UPDATE SET "
                    "active=excluded.active,observed_value=excluded.observed_value,"
                    "threshold_value=excluded.threshold_value,"
                    "changed_at=CASE WHEN active<>excluded.active THEN excluded.changed_at "
                    "ELSE changed_at END,evaluated_at=excluded.evaluated_at",
                    (alert_type, int(active), observed, threshold, now, now),
                )
                if active:
                    active_alerts.add(alert_type)
                if previous_active != active:
                    payload = {
                        "alert_type": alert_type, "observed": observed,
                        "threshold": threshold,
                        "window_seconds": self.thresholds.window_seconds,
                    }
                    if self.policy_digest:
                        payload["policy_digest"] = self.policy_digest
                    emitted.append(self.journal.append_in_transaction(
                        db,
                        "approval_slo.alert_raised" if active else "approval_slo.alert_cleared",
                        alert_type,
                        payload,
                        now=now,
                    ))
            db.commit()
        return ApprovalSecuritySloEvaluation(
            active_alerts=frozenset(active_alerts),
            emitted_events=tuple(emitted),
            observations=tuple(
                (name, int(value), int(threshold))
                for name, (value, threshold, _) in sorted(observations.items())
            ),
        )

    @classmethod
    def from_signed_policy(cls, database: Path, policy, *, clock=time.time):
        from .approval_slo_policy import SignedApprovalSloPolicy

        if not isinstance(policy, SignedApprovalSloPolicy) or not policy.digest:
            raise ValueError("A verified signed Approval SLO policy is required")
        return cls(
            database, thresholds=policy.thresholds, clock=clock, policy_digest=policy.digest,
        )
