"""Evaluate Beta expansion, pause, kill-switch, and rollback drills as Stage 7 evidence."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

STAGES = {
    # Stage 7 closes on immediate, identity-bound technical acceptance. Longer
    # observation windows remain post-acceptance rollout policy, not a build gate.
    "internal": (0, 0), "canary": (72, 50), "beta_1": (72, 100),
    "beta_5": (120, 500), "beta_20": (168, 2000), "beta_50": (168, 5000),
    "beta_100": (336, 10000),
}


def decide(stage: str, metrics: dict) -> tuple[str, str]:
    hard = (
        ("duplicate_side_effects", "duplicate_side_effect"),
        ("data_corruptions", "data_corruption"),
        ("security_incidents", "security_incident"),
    )
    for field, reason in hard:
        if metrics.get(field, 0) > 0:
            return "kill_switch", reason
    samples = metrics.get("samples", 0)
    recovery_attempts = metrics.get("recovery_attempts", 0)
    rates = (
        (metrics.get("crashes", 0) / max(samples, 1), 0.005, "crash_rate"),
        (metrics.get("anrs", 0) / max(samples, 1), 0.003, "anr_rate"),
        (metrics.get("recovery_failures", 0) / max(recovery_attempts, 1), 0.01, "recovery_failure_rate"),
        (metrics.get("resource_failures", 0) / max(samples, 1), 0.01, "resource_failure_rate"),
        (metrics.get("login_failures", 0) / max(samples, 1), 0.01, "login_failure_rate"),
    )
    for rate, limit, reason in rates:
        if rate > limit:
            return "pause", reason
    hours, minimum_samples = STAGES[stage]
    if samples < minimum_samples:
        return "hold", "minimum_samples"
    if metrics.get("observation_hours", 0) < hours:
        return "hold", "observation_window"
    return "expand", "stage_gates_passed"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--drills", type=Path, required=True)
    parser.add_argument("--incidents", type=Path, required=True)
    parser.add_argument("--stage", choices=sorted(STAGES), required=True)
    parser.add_argument("--policy-version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    metrics = json.loads(args.metrics.read_text(encoding="utf-8"))
    drills = json.loads(args.drills.read_text(encoding="utf-8"))
    incidents = json.loads(args.incidents.read_text(encoding="utf-8"))
    if (metrics.get("identity") != identity or drills.get("identity") != identity or incidents.get("identity") != identity):
        raise SystemExit("rollout_identity_mismatch")
    provenance = metrics.get("provenance", {})
    if (not provenance.get("runner") or provenance.get("acceptance_run_id") != identity.get("acceptance_run_id") or
            not provenance.get("started_at") or not provenance.get("completed_at") or
            not provenance.get("device_ids_sha256")):
        raise SystemExit("rollout_provenance_missing_or_mismatched")
    try:
        observed_start = datetime.fromisoformat(str(metrics["started_at"]).replace("Z", "+00:00"))
        observed_end = datetime.fromisoformat(str(metrics["completed_at"]).replace("Z", "+00:00"))
    except (KeyError, ValueError) as error:
        raise SystemExit("rollout_observation_window_missing_or_invalid") from error
    observed_hours = (observed_end - observed_start).total_seconds() / 3600
    if observed_start.tzinfo is None or observed_end.tzinfo is None or observed_hours < 0:
        raise SystemExit("rollout_observation_window_missing_or_invalid")
    metrics["observation_hours"] = observed_hours
    action, reason = decide(args.stage, metrics)
    required = {"remote_kill_switch", "kotlin_lite_fallback", "apk_rollback", "data_readable_after_rollback"}
    drill_map = {item.get("id"): item.get("status") for item in drills.get("drills", [])}
    drill_result = required <= drill_map.keys() and all(drill_map[item] == "passed" for item in required)
    incident_rows = incidents.get("incidents", [])
    required_incident_fields = {"diagnostic_id", "severity", "owner", "target_fix_version", "state", "source"}
    incident_shape = bool(incident_rows) and all(
        isinstance(item, dict) and required_incident_fields <= item.keys() and
        all(str(item[field]).strip() for field in required_incident_fields) and
        item["severity"] in {"blocker", "critical", "major", "minor"} and
        item["state"] in {"open", "investigating", "fixed", "verified", "closed"} and
        item["source"] in {"user_feedback", "exercise"}
        for item in incident_rows
    )
    critical_closed = all(
        item.get("severity") not in {"blocker", "critical"} or item.get("state") in {"verified", "closed"}
        for item in incident_rows if isinstance(item, dict)
    )
    closed_loop_exercised = any(item.get("state") in {"verified", "closed"} for item in incident_rows if isinstance(item, dict))
    incident_result = incident_shape and critical_closed and closed_loop_exercised
    value = {
        "schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(), "identity": identity,
        "provenance": provenance,
        "stage": args.stage, "policy_version": args.policy_version, "metrics": metrics,
        "observation_window": {"started_at": metrics["started_at"], "completed_at": metrics["completed_at"],
                               "hours": observed_hours},
        "decision": {"action": action, "reason": reason}, "drills": drills.get("drills", []),
        "incidents": incident_rows,
        "incident_register": {"shape_valid": incident_shape, "critical_closed": critical_closed,
                              "closed_loop_exercised": closed_loop_exercised},
        "result": "passed" if drill_result and incident_result and action == "expand" else "pending",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if value["result"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
