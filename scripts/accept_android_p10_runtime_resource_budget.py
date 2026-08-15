from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "docs/android/reports/evidence/p10/pending/m09-f06-runtime-performance-api35.json"
STRESS = ROOT / "docs/android/reports/evidence/p10/pending/m09-f06-stress-performance-api35.json"
BASELINE = ROOT / "docs/android/reports/evidence/v1.5.6/performance-emulator-api35.json"
BUDGET = ROOT / "cores/protocol/android-runtime/p9-performance-budget-v1.json"
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m09-f06-runtime-resource-budget.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    runtime, stress, baseline, budget = map(load, (RUNTIME, STRESS, BASELINE, BUDGET))
    metrics = runtime["metrics"]
    limits = budget["limits"]
    baseline_perf = baseline["performance"]
    gates = {
        "one_candidate_apk": runtime["apk_sha256"] == stress["apk_sha256"],
        "runtime_collector_all_gates_green": runtime.get("passed") is True and all(runtime["gates"].values()),
        "stress_collector_all_gates_green": stress.get("passed") is True and all(stress["gates"].values()),
        "runtime_pss_under_220mb": metrics["foreground_pss_p95_mb"] <= limits["runtime_foreground_pss_p95_mb"],
        "runtime_peak_pss_under_256mb": metrics["peak_pss_mb"] <= limits["runtime_peak_pss_mb"],
        "installed_apk_plus_data_under_256mb": metrics["storage_mb"] <= limits["installed_apk_plus_data_mb"],
        "database_growth_under_64mb": stress["stress"]["database_bytes"] <= limits["database_growth_mb"] * 1024 * 1024,
        "cpu_under_frozen_budget": metrics["cpu_p95_percent"] <= limits["runtime_cpu_p95_percent"],
        "battery_and_thermal_under_frozen_budget": metrics["battery_drop_percent"] <= limits["ten_start_battery_drop_percent"] and metrics["thermal_status"] <= limits["maximum_thermal_status"],
        "zero_anr_network_and_runtime_leak": runtime["gates"]["anr_zero"] and runtime["gates"]["runtime_process_released"] and runtime["gates"]["local_probe_network_rx"] and runtime["gates"]["local_probe_network_tx"],
        "p9_relative_delta_attributed": baseline_perf["cold_start_p95_ms"] > 0 and baseline_perf["foreground_pss_mb"] > 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M09-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "candidate_apk_sha256": runtime["apk_sha256"],
        "environment": {"serial": runtime["serial"], "api": runtime["api_level"], "abi": runtime["abi"], "model": runtime["model"]},
        "frozen_budget": budget["limits"],
        "metrics": metrics,
        "stress": stress["stress"],
        "p9_relative_attribution": {
            "baseline": "v1.5.6 API35 emulator",
            "runtime_cold_start_p95_delta_ms": metrics["cold_start_p95_ms"] - baseline_perf["cold_start_p95_ms"],
            "runtime_pss_p95_delta_mb": metrics["foreground_pss_p95_mb"] - baseline_perf["foreground_pss_mb"],
            "attribution": "P10 carries the productized Full Runtime, OAEP journals, readiness/diagnostic projections, and expanded tool/skill surfaces; all absolute P9 frozen limits remain green.",
        },
        "gates": gates,
        "source_sha256": {str(p.relative_to(ROOT)).replace("\\", "/"): sha256(p) for p in (RUNTIME, STRESS, BASELINE, BUDGET)},
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
