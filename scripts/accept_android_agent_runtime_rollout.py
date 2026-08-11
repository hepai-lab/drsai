from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STAGES = {
    "internal": {"percent": 0, "minimum_observation_hours": 48, "minimum_samples": 20},
    "canary": {"percent": 0, "minimum_observation_hours": 72, "minimum_samples": 50},
    "beta_1": {"percent": 1, "minimum_observation_hours": 72, "minimum_samples": 100},
    "beta_5": {"percent": 5, "minimum_observation_hours": 120, "minimum_samples": 500},
    "beta_20": {"percent": 20, "minimum_observation_hours": 168, "minimum_samples": 2_000},
    "beta_50": {"percent": 50, "minimum_observation_hours": 168, "minimum_samples": 5_000},
    "beta_100": {"percent": 100, "minimum_observation_hours": 336, "minimum_samples": 10_000},
}


def decide(stage: str, metrics: dict[str, float]) -> tuple[str, str]:
    for field, reason in (
        ("duplicate_side_effects", "duplicate_side_effect"),
        ("data_corruptions", "data_corruption"),
        ("security_incidents", "security_incident"),
    ):
        if metrics.get(field, 0) > 0:
            return "kill_switch", reason
    samples = max(int(metrics.get("samples", 0)), 1)
    recoveries = max(int(metrics.get("recovery_attempts", 0)), 1)
    for rate, threshold, reason in (
        (metrics.get("crashes", 0) / samples, 0.005, "crash_rate"),
        (metrics.get("anrs", 0) / samples, 0.003, "anr_rate"),
        (metrics.get("recovery_failures", 0) / recoveries, 0.01, "recovery_failure_rate"),
        (metrics.get("resource_failures", 0) / samples, 0.01, "resource_failure_rate"),
        (metrics.get("login_failures", 0) / samples, 0.01, "login_failure_rate"),
    ):
        if rate > threshold:
            return "pause", reason
    policy = STAGES[stage]
    if metrics.get("samples", 0) < policy["minimum_samples"]:
        return "hold", "minimum_samples"
    if metrics.get("observation_hours", 0) < policy["minimum_observation_hours"]:
        return "hold", "observation_window"
    return "expand", "stage_gates_passed"


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 8 Android Agent Runtime rollout gate")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/android/reports/evidence/android-agent-runtime-rollout.json")
    args = parser.parse_args()
    source = (ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RuntimeBetaOperations.kt").read_text(encoding="utf-8")
    source_aligned = all(
        f"{name.upper()}({policy['percent']}, {policy['minimum_observation_hours']}, {policy['minimum_samples']:,}".replace(",", "_") in source.replace(",", "_")
        or f"{name.upper()}({policy['percent']}, {policy['minimum_observation_hours']}, {policy['minimum_samples']}" in source
        for name, policy in STAGES.items()
    )
    cases = {
        "under_sample": ("canary", {"samples": 49, "observation_hours": 72}, ("hold", "minimum_samples")),
        "under_window": ("canary", {"samples": 50, "observation_hours": 71}, ("hold", "observation_window")),
        "healthy_expand": ("canary", {"samples": 50, "observation_hours": 72}, ("expand", "stage_gates_passed")),
        "crash_pause": ("beta_1", {"samples": 100, "observation_hours": 72, "crashes": 1}, ("pause", "crash_rate")),
        "duplicate_kill": ("beta_1", {"samples": 100, "observation_hours": 72, "duplicate_side_effects": 1}, ("kill_switch", "duplicate_side_effect")),
        "corruption_kill": ("beta_1", {"samples": 100, "observation_hours": 72, "data_corruptions": 1}, ("kill_switch", "data_corruption")),
        "security_kill": ("beta_1", {"samples": 100, "observation_hours": 72, "security_incidents": 1}, ("kill_switch", "security_incident")),
    }
    evaluations = {
        name: {"stage": stage, "actual": list(decide(stage, metrics)), "expected": list(expected), "passed": decide(stage, metrics) == expected}
        for name, (stage, metrics, expected) in cases.items()
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "release": "Android Agent Runtime v1.6.0",
        "policy_version": "android-agent-runtime-oaep-rollout-v1",
        "stages": STAGES,
        "evaluations": evaluations,
        "production_policy_source_aligned": source_aligned,
        "passed": source_aligned and all(case["passed"] for case in evaluations.values()),
    }
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
