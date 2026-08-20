from __future__ import annotations

from pathlib import Path
import sqlite3

from drsai.backend.runtime.security_boundary import SecurityEventJournal, SecurityMetricsCollector


def test_security_metrics_have_only_allowlisted_low_cardinality_labels(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("effect.claimed", "execution-secret-id", {"run_id": "run-secret-id"}, now=100)
    journal.append("effect.terminal", "execution-secret-id", {
        "status": "succeeded", "receipt_digest": "sha256:secret-receipt",
    }, now=101)
    journal.append("credential.lease_consumed", "lease-secret-id", {
        "credential_ref_digest": "sha256:secret-ref", "target": "https://private-target.example",
    }, now=102)
    journal.append("network.response", "request-secret-id", {
        "status_code": 204, "credential_used": True, "origin": "https://private-target.example",
    }, now=103)
    journal.append("hard_deny.blocked", "proposal-secret-id", {
        "category": "credential_theft", "operation": "secret-operation",
    }, now=104)
    journal.append("approval.requested", "request-secret-id", {
        "reviewer_kind": "human", "run_id": "run-secret-id",
    }, now=105)
    journal.append("approval.decided", "request-secret-id", {
        "decision": "approved", "reviewer_kind": "human", "reviewer_id": "user-secret-id",
    }, now=106)
    journal.append("authorization.grant_issued", "grant-secret-id", {
        "request_id": "request-secret-id", "operation": "secret-operation",
    }, now=107)

    metrics = SecurityMetricsCollector(database).snapshot()
    serialized = str(metrics)
    for forbidden in (
        "secret-id", "secret-receipt", "secret-ref", "private-target", "secret-operation",
    ):
        assert forbidden not in serialized
    assert {metric.name for metric in metrics} == {
        "security_effect_claimed_total",
        "security_effect_terminal_total",
        "security_credential_lease_total",
        "security_network_response_total",
        "security_hard_deny_total",
        "security_approval_requested_total",
        "security_approval_decision_total",
        "security_authorization_grant_issued_total",
        "security_approval_decision_latency_bucket",
        "security_audit_integrity",
    }
    assert all(set(metric.labels).issubset({
        "status", "action", "status_class", "credential", "category", "valid",
        "reviewer_kind", "decision", "le",
    }) for metric in metrics)


def test_unknown_event_values_collapse_to_bounded_labels(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    for index in range(100):
        journal.append("hard_deny.blocked", f"proposal-{index}", {"category": f"attacker-{index}"}, now=100 + index)
    metrics = SecurityMetricsCollector(database).snapshot()
    hard_deny = [metric for metric in metrics if metric.name == "security_hard_deny_total"]
    assert hard_deny == [type(hard_deny[0])("security_hard_deny_total", {"category": "unknown"}, 100)]


def test_approval_metrics_cover_pending_latency_timeout_duplicate_and_conflict(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("approval.requested", "pending-private-id", {"reviewer_kind": "human"}, now=100)
    journal.append("approval.requested", "resolved-private-id", {"reviewer_kind": "human"}, now=100)
    journal.append("approval.decided", "resolved-private-id", {
        "decision": "expired", "reviewer_kind": "system",
    }, now=107)
    journal.append("approval.decision_duplicate", "resolved-private-id", {
        "reviewer_kind": "human",
    }, now=108)
    journal.append("approval.decision_conflict", "resolved-private-id", {
        "reviewer_kind": "human",
    }, now=109)

    metrics = SecurityMetricsCollector(database).snapshot(now=110)
    names = {metric.name for metric in metrics}
    assert {
        "security_approval_pending_age_bucket",
        "security_approval_decision_latency_bucket",
        "security_approval_decision_duplicate_total",
        "security_approval_decision_conflict_total",
    }.issubset(names)
    assert any(metric.name == "security_approval_decision_total" and metric.labels == {
        "decision": "expired", "reviewer_kind": "unknown",
    } for metric in metrics)
    assert any(metric.name == "security_approval_timeout_total" and metric.labels == {
        "reviewer_kind": "unknown",
    } and metric.value == 1 for metric in metrics)
    assert "private-id" not in str(metrics)


def test_permission_mode_metrics_are_low_cardinality_and_hide_run_profile_ids(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("permission_mode.changed", "binding-private-id", {
        "run_id": "run-private-id", "profile_digest": "profile-private-id",
        "mode_id": "auto_reviewed", "transition_kind": "upgrade", "selection_source": "user",
    }, now=100)
    journal.append("authorization.grant_revoked", "grant-private-id", {
        "reason_code": "permission_mode_transition",
    }, now=101)
    metrics = SecurityMetricsCollector(database).snapshot(now=102)
    assert any(metric.name == "security_permission_mode_transition_total" and metric.labels == {
        "mode_id": "auto_reviewed", "transition": "upgrade", "source": "user",
    } for metric in metrics)
    assert any(metric.name == "security_authorization_grant_revoked_total" for metric in metrics)
    assert "private-id" not in str(metrics)


def test_auto_reviewer_metrics_exclude_reason_model_and_proposal_identity(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("auto_reviewer.decided", "review-private-id", {
        "outcome": "escalate", "decision_source": "model", "confidence_bucket": "medium",
        "reason_code": "private-reason", "model_version": "private-model-version",
        "proposal_id": "proposal-private-id",
    }, now=100)
    metrics = SecurityMetricsCollector(database).snapshot(now=101)
    assert any(metric.name == "security_auto_reviewer_decision_total" and metric.labels == {
        "outcome": "escalate", "review_source": "model", "confidence": "medium",
    } for metric in metrics)
    assert "private" not in str(metrics)


def test_auto_route_and_config_migration_metrics_are_bounded(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("auto_reviewer.routed", "request-private-id", {
        "route": "escalated", "review_id": "review-private-id",
    }, now=100)
    journal.append("auto_reviewer.route_applied", "request-private-id", {
        "decision": "cancelled", "human_escalation_created": True,
    }, now=101)
    journal.append("permission_config.migrated", "migration-private-id", {
        "mode_id": "manual_safe", "requires_reselection": True,
        "reason_code": "private-reason",
    }, now=102)
    metrics = SecurityMetricsCollector(database).snapshot(now=103)
    assert any(metric.name == "security_auto_reviewer_route_total" and metric.labels == {
        "route": "escalated",
    } for metric in metrics)
    assert any(metric.name == "security_auto_reviewer_route_applied_total" and metric.labels == {
        "decision": "cancelled", "human_escalation": "true",
    } for metric in metrics)
    assert any(metric.name == "security_permission_config_migration_total" and metric.labels == {
        "mode_id": "manual_safe", "reselection": "true",
    } for metric in metrics)
    assert "private" not in str(metrics)


def test_transition_kill_switch_and_inheritance_metrics_hide_authority_ids(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("permission_mode.transition_started", "transition-private-id", {
        "run_id": "run-private-id", "transition_kind": "downgrade", "target_mode_id": "manual_safe",
    }, now=100)
    journal.append("permission_kill_switch.changed", "switch-private-id", {
        "switch_name": "auto_reviewer", "active": True, "reason_code": "private-reason",
    }, now=101)
    journal.append("permission_kill_switch.propagated", "switch-private-id", {
        "switch_name": "auto_reviewer", "affected_runs": 3,
    }, now=102)
    journal.append("permission_profile.inherited", "inherit-private-id", {
        "mode_id": "manual_safe", "parent_effective_digest": "private-parent",
    }, now=103)
    metrics = SecurityMetricsCollector(database).snapshot(now=104)
    assert any(metric.name == "security_permission_mode_transition_started_total" and metric.labels == {
        "mode_id": "manual_safe", "transition": "downgrade",
    } for metric in metrics)
    assert any(metric.name == "security_permission_kill_switch_change_total" and metric.labels == {
        "switch": "auto_reviewer", "active": "true",
    } for metric in metrics)
    assert any(metric.name == "security_permission_profile_inheritance_total" and metric.labels == {
        "mode_id": "manual_safe",
    } for metric in metrics)
    assert "private" not in str(metrics)


def test_grant_state_and_unknown_ratios_come_from_durable_authority_facts(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("effect.terminal", "effect-private-1", {"status": "succeeded"}, now=100)
    journal.append("effect.terminal", "effect-private-2", {"status": "outcome_unknown"}, now=101)
    with sqlite3.connect(database) as db:
        db.execute("""CREATE TABLE runtime_authorization_grants(
            grant_id TEXT PRIMARY KEY, expires_at REAL NOT NULL,
            consumed_at REAL, revoked_at REAL
        )""")
        db.executemany(
            "INSERT INTO runtime_authorization_grants VALUES(?,?,?,?)",
            [
                ("grant-private-active", 300, None, None),
                ("grant-private-expired", 150, None, None),
                ("grant-private-consumed", 300, 120, None),
                ("grant-private-revoked", 300, None, 130),
            ],
        )
    metrics = SecurityMetricsCollector(database).snapshot(now=200)
    states = {
        metric.labels["state"]: metric.value
        for metric in metrics if metric.name == "security_authorization_grant_state"
    }
    assert states == {"active": 1, "consumed": 1, "expired_unconsumed": 1, "revoked": 1}
    assert next(
        metric.value for metric in metrics
        if metric.name == "security_authorization_grant_unused_ratio_basis_points"
    ) == 7500
    assert next(
        metric.value for metric in metrics
        if metric.name == "security_effect_outcome_unknown_ratio_basis_points"
    ) == 5000
    assert "private" not in str(metrics)
