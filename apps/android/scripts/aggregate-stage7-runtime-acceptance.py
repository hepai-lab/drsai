"""Aggregate identity-bound runtime scenarios into four Stage 7 gate reports."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

RECOVERY = {
    "waiting_model_process_death", "waiting_tool_before_execution", "tool_success_before_receipt",
    "waiting_approval", "approval_success_before_resume", "running_process_death", "paused_resume",
    "terminal_rejected", "cold_start_notification_reentry",
}
SIDE_EFFECT = {
    "tool_intent_receipt", "durable_receipt_replay", "approval_first_decision_wins",
    "artifact_operation_id", "needs_reconciliation", "audit_chain_query",
}
UI = {
    "recovery_statuses", "cancel_idempotent", "activity_recreation", "notification_scope",
    "logout_cleanup", "fallback_status",
}
AUDIT_PHASES = {"intent", "approval", "execution", "receipt", "replay", "terminal", "reconciliation"}


def load_bound(path: Path, identity: dict) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("schema_version") != 2 or value.get("identity") != identity or value.get("result") != "passed":
        raise ValueError(f"input_not_passed_or_identity_mismatch:{path.name}")
    provenance = value.get("provenance", {})
    devices = provenance.get("device_ids_sha256", [])
    if not provenance.get("runner") or not provenance.get("started_at") or not provenance.get("completed_at") or not devices:
        raise ValueError(f"input_provenance_missing:{path.name}")
    if "serial" in json.dumps(value).lower():
        raise ValueError(f"raw_serial_field_forbidden:{path.name}")
    return value


def percentile95(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * .95) - 1)]


def provenance(values: list[dict], identity: dict) -> dict:
    entries = [value["provenance"] for value in values]
    return {
        "runner": "+".join(sorted({str(item["runner"]) for item in entries})),
        "acceptance_run_id": identity["acceptance_run_id"],
        "package_version_code": identity["version_code"],
        "package_version_name": identity["version_name"],
        "apk_sha256": identity["apk_sha256"],
        "started_at": min(str(item["started_at"]) for item in entries),
        "completed_at": max(str(item["completed_at"]) for item in entries),
        "device_ids_sha256": sorted({device for item in entries for device in item["device_ids_sha256"]}),
    }


def performance_metrics(value: dict) -> dict:
    direct = value.get("metrics")
    if isinstance(direct, dict):
        return direct
    samples = [item.get("metrics", {}) for item in value.get("samples", []) if isinstance(item, dict)]
    if not samples:
        device_reports = [
            item["performance"] for item in value.get("reports", [])
            if isinstance(item, dict) and isinstance(item.get("performance"), dict)
        ]
        if len(device_reports) > 1:
            raise ValueError("performance_marker_count_invalid")
        samples = device_reports
    if not samples:
        raise ValueError("performance_metrics_missing")
    return {
        "cold_start_p95_ms": max(float(item["cold_start_p95_ms"]) for item in samples),
        "foreground_pss_p95_mb": max(float(item["foreground_pss_p95_mb"]) for item in samples),
        "peak_pss_mb": max(float(item["peak_pss_mb"]) for item in samples),
    }


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--scenario-report", type=Path, action="append", required=True)
    parser.add_argument("--performance-report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    scenarios = [load_bound(path, identity) for path in args.scenario_report]
    performance = [load_bound(path, identity) for path in args.performance_report]
    by_category = {category: {item.get("scenario_id"): item for item in scenarios if item.get("category") == category}
                   for category in ("recovery", "side_effect", "ui")}
    missing = {
        "recovery": sorted(RECOVERY - by_category["recovery"].keys()),
        "side_effect": sorted(SIDE_EFFECT - by_category["side_effect"].keys()),
        "ui": sorted(UI - by_category["ui"].keys()),
    }
    all_values = scenarios + performance
    common = {"schema_version": 2, "identity": identity, "provenance": provenance(all_values, identity)}
    recovery_times = [float(item["interactive_ms"]) for item in by_category["recovery"].values()
                      if isinstance(item.get("interactive_ms"), (int, float))]
    duplicates = sum(int(item.get("duplicate_user_visible_side_effects", 0))
                     for item in by_category["side_effect"].values())
    phases = sorted({phase for item in by_category["side_effect"].values() for phase in item.get("audit_phases", [])})
    normalized_performance = [performance_metrics(item) for item in performance]
    metrics = {
        "cold_start_p95_ms": max(float(item["cold_start_p95_ms"]) for item in normalized_performance),
        "recovery_interactive_p95_ms": percentile95(recovery_times) if recovery_times else None,
        "foreground_pss_p95_mb": max(float(item["foreground_pss_p95_mb"]) for item in normalized_performance),
        "peak_pss_mb": max(float(item["peak_pss_mb"]) for item in normalized_performance),
    }
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    write(output / "recovery-matrix.json", {**common, "scenarios": sorted(by_category["recovery"]),
          "missing": missing["recovery"], "result": "passed" if not missing["recovery"] and recovery_times else "pending"})
    write(output / "side-effect-consistency.json", {**common, "scenarios": sorted(by_category["side_effect"]),
          "missing": missing["side_effect"], "duplicate_user_visible_side_effects": duplicates,
          "audit_chain": phases, "result": "passed" if not missing["side_effect"] and duplicates == 0 and AUDIT_PHASES <= set(phases) else "pending"})
    write(output / "ui-critical-journey.json", {**common, "journeys": sorted(by_category["ui"]),
          "missing": missing["ui"], "result": "passed" if not missing["ui"] else "pending"})
    write(output / "device-performance.json", {**common, "metrics": metrics,
          "result": "passed" if all(value is not None for value in metrics.values()) else "pending"})
    return 0 if all(not value for value in missing.values()) and recovery_times and duplicates == 0 and AUDIT_PHASES <= set(phases) else 2


if __name__ == "__main__":
    raise SystemExit(main())
