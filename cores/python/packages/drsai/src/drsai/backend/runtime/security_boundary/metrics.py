"""Low-cardinality metrics projected from the append-only security journal."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import time
from typing import Mapping
import sqlite3

from .audit import SecurityAuditError, SecurityEventJournal


@dataclass(frozen=True)
class SecurityMetric:
    name: str
    labels: Mapping[str, str]
    value: int | float


_EVENT_METRICS = {
    "effect.claimed": "security_effect_claimed_total",
    "effect.terminal": "security_effect_terminal_total",
    "effect.recovered_unknown": "security_effect_recovered_unknown_total",
    "credential.lease_issued": "security_credential_lease_total",
    "credential.lease_consumed": "security_credential_lease_total",
    "credential.lease_expired": "security_credential_lease_total",
    "credential.lease_revoked": "security_credential_lease_total",
    "network.authorized": "security_network_authorized_total",
    "network.response": "security_network_response_total",
    "hard_deny.blocked": "security_hard_deny_total",
    "approval.requested": "security_approval_requested_total",
    "approval.decided": "security_approval_decision_total",
    "authorization.grant_issued": "security_authorization_grant_issued_total",
    "approval.decision_duplicate": "security_approval_decision_duplicate_total",
    "approval.decision_conflict": "security_approval_decision_conflict_total",
    "authorization.grant_revoked": "security_authorization_grant_revoked_total",
    "permission_mode.changed": "security_permission_mode_transition_total",
    "auto_reviewer.decided": "security_auto_reviewer_decision_total",
    "auto_reviewer.routed": "security_auto_reviewer_route_total",
    "auto_reviewer.route_applied": "security_auto_reviewer_route_applied_total",
    "permission_config.migrated": "security_permission_config_migration_total",
    "permission_mode.transition_started": "security_permission_mode_transition_started_total",
    "permission_kill_switch.changed": "security_permission_kill_switch_change_total",
    "permission_kill_switch.propagated": "security_permission_kill_switch_propagation_total",
    "permission_profile.inherited": "security_permission_profile_inheritance_total",
    "isolated_recovery.alert_raised": "security_isolated_recovery_alert_total",
    "isolated_recovery.alert_cleared": "security_isolated_recovery_alert_total",
    "approval.adapter_failed": "security_approval_adapter_failure_total",
    "approval_slo.alert_raised": "security_approval_slo_alert_total",
    "approval_slo.alert_cleared": "security_approval_slo_alert_total",
    "approval_slo.policy_accepted": "security_approval_slo_policy_accepted_total",
}
_TERMINAL_STATUS = frozenset({"succeeded", "failed", "timed_out", "outcome_unknown"})
_APPROVAL_TIME_BUCKETS = (1, 5, 30, 120, 600, 3600)


class SecurityMetricsCollector:
    """Exports only allowlisted dimensions; identifiers never become labels."""

    def __init__(self, database: Path):
        self.database = Path(database)
        self.journal = SecurityEventJournal(database)

    def snapshot(self, *, now: float | None = None) -> list[SecurityMetric]:
        counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
        observed_at = float(time.time() if now is None else now)
        approval_requested_at: dict[str, float] = {}
        approval_resolved: set[str] = set()
        effect_terminal_total = 0
        effect_unknown_total = 0

        def increment(name: str, labels: Mapping[str, str] | None = None) -> None:
            normalized = tuple(sorted((labels or {}).items()))
            key = (name, normalized)
            counters[key] = counters.get(key, 0) + 1

        for event in self.journal.list():
            if event.event_type == "approval.requested":
                approval_requested_at[event.subject_id] = event.created_at
            elif event.event_type == "approval.decided":
                approval_resolved.add(event.subject_id)
                requested_at = approval_requested_at.get(event.subject_id)
                if requested_at is not None:
                    latency = max(0.0, event.created_at - requested_at)
                    for boundary in _APPROVAL_TIME_BUCKETS:
                        if latency <= boundary:
                            increment("security_approval_decision_latency_bucket", {"le": str(boundary)})
                    increment("security_approval_decision_latency_bucket", {"le": "+Inf"})
            name = _EVENT_METRICS.get(event.event_type)
            if name is None:
                continue
            labels: dict[str, str] = {}
            if event.event_type == "effect.terminal":
                status = str(event.payload.get("status") or "unknown")
                labels["status"] = status if status in _TERMINAL_STATUS else "unknown"
                effect_terminal_total += 1
                if status == "outcome_unknown":
                    effect_unknown_total += 1
            elif event.event_type.startswith("credential.lease_"):
                labels["action"] = event.event_type.rsplit("_", 1)[-1]
            elif event.event_type == "network.response":
                try:
                    status_code = int(event.payload.get("status_code", 0))
                except (TypeError, ValueError):
                    status_code = 0
                labels["status_class"] = f"{status_code // 100}xx" if 100 <= status_code <= 599 else "unknown"
                labels["credential"] = "used" if event.payload.get("credential_used") is True else "none"
            elif event.event_type == "hard_deny.blocked":
                allowed = {
                    "security_control_tampering", "credential_theft", "host_persistence",
                    "cross_process_injection", "audit_disable", "host_control_plane", "unknown",
                }
                category = str(event.payload.get("category") or "unknown")
                labels["category"] = category if category in allowed else "unknown"
            elif event.event_type == "approval.requested":
                reviewer_kind = str(event.payload.get("reviewer_kind") or "unknown")
                labels["reviewer_kind"] = reviewer_kind if reviewer_kind in {"human", "auto"} else "unknown"
            elif event.event_type == "approval.decided":
                decision = str(event.payload.get("decision") or "unknown")
                labels["decision"] = decision if decision in {"approved", "denied", "cancelled", "expired"} else "unknown"
                reviewer_kind = str(event.payload.get("reviewer_kind") or "unknown")
                labels["reviewer_kind"] = reviewer_kind if reviewer_kind in {"human", "auto"} else "unknown"
            elif event.event_type in {"approval.decision_duplicate", "approval.decision_conflict"}:
                reviewer_kind = str(event.payload.get("reviewer_kind") or "unknown")
                labels["reviewer_kind"] = reviewer_kind if reviewer_kind in {"human", "auto"} else "unknown"
            elif event.event_type == "permission_mode.changed":
                mode_id = str(event.payload.get("mode_id") or "unknown")
                transition = str(event.payload.get("transition_kind") or "unknown")
                source = str(event.payload.get("selection_source") or "unknown")
                labels["mode_id"] = mode_id if mode_id in {
                    "manual_safe", "auto_reviewed", "isolated_full_access",
                } else "unknown"
                labels["transition"] = transition if transition in {
                    "initial", "same", "upgrade", "downgrade", "mixed",
                } else "unknown"
                labels["source"] = source if source in {
                    "user", "administrator", "personal_default",
                } else "unknown"
            elif event.event_type == "auto_reviewer.decided":
                outcome = str(event.payload.get("outcome") or "unknown")
                source = str(event.payload.get("decision_source") or "unknown")
                confidence = str(event.payload.get("confidence_bucket") or "unknown")
                labels["outcome"] = outcome if outcome in {"approve", "deny", "escalate"} else "unknown"
                labels["review_source"] = source if source in {"rule", "model", "system"} else "unknown"
                labels["confidence"] = confidence if confidence in {"none", "low", "medium", "high"} else "unknown"
            elif event.event_type == "auto_reviewer.routed":
                route = str(event.payload.get("route") or "unknown")
                labels["route"] = route if route in {"approved", "denied", "escalated"} else "unknown"
            elif event.event_type == "auto_reviewer.route_applied":
                decision = str(event.payload.get("decision") or "unknown")
                labels["decision"] = decision if decision in {"approved", "denied", "cancelled"} else "unknown"
                labels["human_escalation"] = "true" if event.payload.get("human_escalation_created") is True else "false"
            elif event.event_type == "permission_config.migrated":
                mode_id = str(event.payload.get("mode_id") or "unknown")
                labels["mode_id"] = mode_id if mode_id in {"manual_safe", "auto_reviewed"} else "unknown"
                labels["reselection"] = "true" if event.payload.get("requires_reselection") is True else "false"
            elif event.event_type == "permission_mode.transition_started":
                transition = str(event.payload.get("transition_kind") or "unknown")
                mode_id = str(event.payload.get("target_mode_id") or "unknown")
                labels["transition"] = transition if transition in {
                    "initial", "same", "upgrade", "downgrade", "mixed",
                } else "unknown"
                labels["mode_id"] = mode_id if mode_id in {
                    "manual_safe", "auto_reviewed", "isolated_full_access",
                } else "unknown"
            elif event.event_type in {"permission_kill_switch.changed", "permission_kill_switch.propagated"}:
                switch_name = str(event.payload.get("switch_name") or "unknown")
                labels["switch"] = switch_name if switch_name in {
                    "auto_reviewer", "isolated_full_access",
                } else "unknown"
                if event.event_type == "permission_kill_switch.changed":
                    labels["active"] = "true" if event.payload.get("active") is True else "false"
            elif event.event_type == "permission_profile.inherited":
                mode_id = str(event.payload.get("mode_id") or "unknown")
                labels["mode_id"] = mode_id if mode_id in {
                    "manual_safe", "auto_reviewed", "isolated_full_access",
                } else "unknown"
            elif event.event_type in {
                "isolated_recovery.alert_raised", "isolated_recovery.alert_cleared",
            }:
                alert_type = str(event.payload.get("alert_type") or "unknown")
                labels["alert"] = alert_type if alert_type in {
                    "backlog", "recovery_failures", "stale_attempt",
                } else "unknown"
                labels["state"] = (
                    "raised" if event.event_type.endswith("alert_raised") else "cleared"
                )
            elif event.event_type == "approval.adapter_failed":
                adapter = str(event.payload.get("adapter_kind") or "unknown")
                category = str(event.payload.get("failure_category") or "unknown")
                labels["adapter"] = adapter if adapter in {"codex", "tui", "oaep"} else "unknown"
                labels["category"] = category if category in {
                    "protocol", "invalid_decision", "expired", "conflict", "internal",
                } else "unknown"
            elif event.event_type in {"approval_slo.alert_raised", "approval_slo.alert_cleared"}:
                alert_type = str(event.payload.get("alert_type") or "unknown")
                labels["alert"] = alert_type if alert_type in {
                    "approval_timeout_rate", "expired_grant_rate",
                    "outcome_unknown_rate", "adapter_failures",
                } else "unknown"
                labels["state"] = (
                    "raised" if event.event_type.endswith("alert_raised") else "cleared"
                )
            increment(name, labels)
            if event.event_type == "approval.decided" and event.payload.get("decision") == "expired":
                increment("security_approval_timeout_total", {"reviewer_kind": labels["reviewer_kind"]})
        for request_id, requested_at in approval_requested_at.items():
            if request_id in approval_resolved:
                continue
            age = max(0.0, observed_at - requested_at)
            for boundary in _APPROVAL_TIME_BUCKETS:
                if age <= boundary:
                    increment("security_approval_pending_age_bucket", {"le": str(boundary)})
            increment("security_approval_pending_age_bucket", {"le": "+Inf"})
        try:
            self.journal.verify()
            increment("security_audit_integrity", {"valid": "true"})
        except SecurityAuditError:
            increment("security_audit_integrity", {"valid": "false"})
        metrics = [
            SecurityMetric(name, dict(labels), value)
            for (name, labels), value in sorted(counters.items())
        ]
        if effect_unknown_total:
            metrics.append(SecurityMetric(
                "security_effect_outcome_unknown_ratio_basis_points", {},
                effect_unknown_total * 10_000 // effect_terminal_total,
            ))
        metrics.extend(self._grant_state_metrics(observed_at))
        return sorted(metrics, key=lambda metric: (metric.name, tuple(sorted(metric.labels.items()))))

    def _grant_state_metrics(self, now: float) -> list[SecurityMetric]:
        with sqlite3.connect(self.database) as db:
            exists = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' "
                "AND name='runtime_authorization_grants'",
            ).fetchone()
            if exists is None:
                return []
            rows = db.execute(
                "SELECT expires_at,consumed_at,revoked_at FROM runtime_authorization_grants",
            ).fetchall()
        counts = {"active": 0, "expired_unconsumed": 0, "consumed": 0, "revoked": 0}
        unused = 0
        for expires_at, consumed_at, revoked_at in rows:
            if consumed_at is not None:
                counts["consumed"] += 1
            elif revoked_at is not None:
                counts["revoked"] += 1
                unused += 1
            elif float(expires_at) <= now:
                counts["expired_unconsumed"] += 1
                unused += 1
            else:
                counts["active"] += 1
                unused += 1
        metrics = [
            SecurityMetric("security_authorization_grant_state", {"state": state}, value)
            for state, value in sorted(counts.items())
        ]
        if rows:
            metrics.append(SecurityMetric(
                "security_authorization_grant_unused_ratio_basis_points", {},
                unused * 10_000 // len(rows),
            ))
        return metrics
