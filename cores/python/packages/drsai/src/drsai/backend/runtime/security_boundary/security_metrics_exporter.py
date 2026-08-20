"""Host-local, pull-based Prometheus rendering for security metrics."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .metrics import SecurityMetric, SecurityMetricsCollector


class SecurityMetricsExportError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


_EMPTY = {}
_LABEL_VALUES: dict[str, dict[str, frozenset[str]]] = {
    "security_effect_claimed_total": _EMPTY,
    "security_effect_terminal_total": {"status": frozenset({
        "succeeded", "failed", "timed_out", "outcome_unknown", "unknown",
    })},
    "security_effect_recovered_unknown_total": _EMPTY,
    "security_effect_outcome_unknown_ratio_basis_points": _EMPTY,
    "security_credential_lease_total": {"action": frozenset({
        "issued", "consumed", "expired", "revoked",
    })},
    "security_network_authorized_total": _EMPTY,
    "security_network_response_total": {
        "status_class": frozenset({"1xx", "2xx", "3xx", "4xx", "5xx", "unknown"}),
        "credential": frozenset({"used", "none"}),
    },
    "security_hard_deny_total": {"category": frozenset({
        "security_control_tampering", "credential_theft", "host_persistence",
        "cross_process_injection", "audit_disable", "host_control_plane", "unknown",
    })},
    "security_approval_requested_total": {"reviewer_kind": frozenset({"human", "auto", "unknown"})},
    "security_approval_decision_total": {
        "decision": frozenset({"approved", "denied", "cancelled", "expired", "unknown"}),
        "reviewer_kind": frozenset({"human", "auto", "unknown"}),
    },
    "security_approval_decision_latency_bucket": {"le": frozenset({
        "1", "5", "30", "120", "600", "3600", "+Inf",
    })},
    "security_approval_pending_age_bucket": {"le": frozenset({
        "1", "5", "30", "120", "600", "3600", "+Inf",
    })},
    "security_approval_timeout_total": {"reviewer_kind": frozenset({"human", "auto", "unknown"})},
    "security_approval_decision_duplicate_total": {"reviewer_kind": frozenset({"human", "auto", "unknown"})},
    "security_approval_decision_conflict_total": {"reviewer_kind": frozenset({"human", "auto", "unknown"})},
    "security_approval_adapter_failure_total": {
        "adapter": frozenset({"codex", "tui", "oaep", "unknown"}),
        "category": frozenset({"protocol", "invalid_decision", "expired", "conflict", "internal", "unknown"}),
    },
    "security_approval_slo_alert_total": {
        "alert": frozenset({
            "approval_timeout_rate", "expired_grant_rate",
            "outcome_unknown_rate", "adapter_failures", "unknown",
        }),
        "state": frozenset({"raised", "cleared"}),
    },
    "security_approval_slo_policy_accepted_total": _EMPTY,
    "security_authorization_grant_issued_total": _EMPTY,
    "security_authorization_grant_revoked_total": _EMPTY,
    "security_authorization_grant_state": {"state": frozenset({
        "active", "expired_unconsumed", "consumed", "revoked",
    })},
    "security_authorization_grant_unused_ratio_basis_points": _EMPTY,
    "security_permission_mode_transition_total": {
        "mode_id": frozenset({"manual_safe", "auto_reviewed", "isolated_full_access", "unknown"}),
        "transition": frozenset({"initial", "same", "upgrade", "downgrade", "mixed", "unknown"}),
        "source": frozenset({"user", "administrator", "personal_default", "unknown"}),
    },
    "security_permission_mode_transition_started_total": {
        "mode_id": frozenset({"manual_safe", "auto_reviewed", "isolated_full_access", "unknown"}),
        "transition": frozenset({"initial", "same", "upgrade", "downgrade", "mixed", "unknown"}),
    },
    "security_auto_reviewer_decision_total": {
        "outcome": frozenset({"approve", "deny", "escalate", "unknown"}),
        "review_source": frozenset({"rule", "model", "system", "unknown"}),
        "confidence": frozenset({"none", "low", "medium", "high", "unknown"}),
    },
    "security_auto_reviewer_route_total": {"route": frozenset({"approved", "denied", "escalated", "unknown"})},
    "security_auto_reviewer_route_applied_total": {
        "decision": frozenset({"approved", "denied", "cancelled", "unknown"}),
        "human_escalation": frozenset({"true", "false"}),
    },
    "security_permission_config_migration_total": {
        "mode_id": frozenset({"manual_safe", "auto_reviewed", "unknown"}),
        "reselection": frozenset({"true", "false"}),
    },
    "security_permission_kill_switch_change_total": {
        "switch": frozenset({"auto_reviewer", "isolated_full_access", "unknown"}),
        "active": frozenset({"true", "false"}),
    },
    "security_permission_kill_switch_propagation_total": {
        "switch": frozenset({"auto_reviewer", "isolated_full_access", "unknown"}),
    },
    "security_permission_profile_inheritance_total": {
        "mode_id": frozenset({"manual_safe", "auto_reviewed", "isolated_full_access", "unknown"}),
    },
    "security_isolated_recovery_alert_total": {
        "alert": frozenset({"backlog", "recovery_failures", "stale_attempt", "unknown"}),
        "state": frozenset({"raised", "cleared"}),
    },
    "security_audit_integrity": {"valid": frozenset({"true", "false"})},
}
_METRIC_NAME = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")


@dataclass(frozen=True)
class HostLocalSecurityMetricsExporter:
    """A renderer only: the trusted host chooses its local transport."""

    collector: SecurityMetricsCollector
    max_series: int = 512
    max_series_per_metric: int = 64

    def __post_init__(self) -> None:
        if self.max_series < 1 or self.max_series_per_metric < 1:
            raise ValueError("security metrics exporter limits must be positive")

    def render(self, *, now: float | None = None) -> str:
        try:
            metrics = self.collector.snapshot(now=now)
        except Exception as error:
            raise SecurityMetricsExportError(
                "security_metrics_unavailable", "Security metrics snapshot is unavailable.",
            ) from error
        if len(metrics) > self.max_series:
            raise SecurityMetricsExportError("security_metrics_cardinality_exceeded", "Too many metric series.")
        per_metric: dict[str, int] = {}
        seen_series: set[tuple[str, tuple[tuple[str, str], ...]]] = set()
        lines: list[str] = []
        for metric in sorted(metrics, key=lambda item: (item.name, tuple(sorted(item.labels.items())))):
            allowed = _LABEL_VALUES.get(metric.name)
            if allowed is None or not _METRIC_NAME.fullmatch(metric.name):
                raise SecurityMetricsExportError("security_metric_not_allowlisted", "Metric is not allowlisted.")
            per_metric[metric.name] = per_metric.get(metric.name, 0) + 1
            if per_metric[metric.name] > self.max_series_per_metric:
                raise SecurityMetricsExportError(
                    "security_metrics_cardinality_exceeded", "Metric series limit exceeded.",
                )
            labels = dict(metric.labels)
            if set(labels) != set(allowed):
                raise SecurityMetricsExportError("security_metric_labels_invalid", "Metric labels are invalid.")
            for key, value in labels.items():
                if value not in allowed[key]:
                    raise SecurityMetricsExportError(
                        "security_metric_label_value_invalid", "Metric label value is invalid.",
                    )
            series_key = (metric.name, tuple(sorted(labels.items())))
            if series_key in seen_series:
                raise SecurityMetricsExportError(
                    "security_metric_series_duplicate", "Metric series is duplicated.",
                )
            seen_series.add(series_key)
            value = metric.value
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise SecurityMetricsExportError("security_metric_value_invalid", "Metric value is invalid.")
            numeric = float(value)
            if not math.isfinite(numeric) or numeric < 0:
                raise SecurityMetricsExportError("security_metric_value_invalid", "Metric value is invalid.")
            packed_labels = ""
            if labels:
                packed_labels = "{" + ",".join(
                    f'{key}="{labels[key]}"' for key in sorted(labels)
                ) + "}"
            rendered_value = str(value) if isinstance(value, int) else format(value, ".17g")
            lines.append(f"{metric.name}{packed_labels} {rendered_value}")
        return "\n".join(lines) + ("\n" if lines else "")
