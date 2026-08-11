from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PENDING = ROOT / "docs/android/reports/evidence/p9/pending"
MATRIX_FILES = (
    "m11-f04-api26-x86_64.json",
    "m11-f04-api30-x86_64.json",
    "m11-f04-api35-x86_64.json",
    "m11-f04-api36-arm64-v8a.json",
)
STRESS_FILE = "m11-f04-stress-api36-arm64-v8a.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unit_suite_green(path: Path, minimum: int) -> bool:
    if not path.is_file():
        return False
    suite = ET.parse(path).getroot()
    return (
        int(suite.attrib.get("tests", 0)) >= minimum
        and int(suite.attrib.get("failures", 0)) == 0
        and int(suite.attrib.get("errors", 0)) == 0
    )


def main() -> int:
    budget_path = ROOT / "cores/protocol/android-runtime/p9-performance-budget-v1.json"
    collector_path = ROOT / "scripts/collect_android_p9_runtime_performance.py"
    performance_test_path = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimePerformanceTest.kt"
    service_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeService.kt"
    reliability_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/reliability/RuntimeReliability.kt"
    reliability_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RuntimeReliabilityTest.kt"
    reliability_xml = ROOT / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.RuntimeReliabilityTest.xml"
    raw_paths = tuple(PENDING / name for name in (*MATRIX_FILES, STRESS_FILE))
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in raw_paths[:-1]]
    stress = json.loads(raw_paths[-1].read_text(encoding="utf-8"))
    budget = json.loads(budget_path.read_text(encoding="utf-8"))
    budget_hash = digest(budget_path)
    apk_hashes = {report.get("apk_sha256") for report in reports} | {stress.get("apk_sha256")}
    required_apis = set(budget["device_matrix"]["api_levels"])
    required_abis = set(budget["device_matrix"]["required_abis"])
    observed_apis = {report.get("api_level") for report in reports}
    observed_abis = {report.get("abi") for report in reports}

    gates = {
        "frozen_api_matrix_is_exactly_26_30_35_36": observed_apis == required_apis == {26, 30, 35, 36},
        "frozen_abi_matrix_includes_x86_64_and_arm64_v8a": required_abis <= observed_abis,
        "all_matrix_runs_use_one_current_candidate_apk": len(apk_hashes) == 1 and None not in apk_hashes,
        "all_matrix_runs_bind_the_current_frozen_budget": all(
            report.get("budget_version") == budget["budget_version"]
            and report.get("budget_sha256") == budget_hash
            for report in reports
        ),
        "all_44_device_budget_gates_are_green": all(
            report.get("passed") is True
            and len(report.get("gates", {})) == 11
            and all(report["gates"].values())
            for report in reports
        ),
        "each_device_records_ten_real_runtime_cold_starts": all(
            len(report.get("metrics", {}).get("cold_start_ms", [])) == 10 for report in reports
        ),
        "local_runtime_probe_has_no_unbudgeted_network": all(
            report["gates"].get("local_probe_network_rx") is True
            and report["gates"].get("local_probe_network_tx") is True
            for report in reports
        ),
        "runtime_process_is_released_and_anr_count_is_zero": all(
            report.get("metrics", {}).get("runtime_release_verified") is True
            and report.get("anr_count") == 0
            for report in reports
        ),
        "physical_arm64_run_covers_battery_and_thermal_budget": any(
            report.get("api_level") == 36
            and report.get("abi") == "arm64-v8a"
            and report["gates"].get("ten_start_battery_drop") is True
            and report["gates"].get("thermal_status") is True
            for report in reports
        ),
        "current_apk_passes_500_run_side_effect_and_recovery_stress": (
            stress.get("passed") is True
            and stress.get("stress", {}).get("runs") == budget["stress"]["runs"]
            and stress.get("stress", {}).get("tool_runs") == budget["stress"]["tool_runs"]
            and stress.get("stress", {}).get("recovery_runs") == budget["stress"]["recovery_runs"]
            and stress.get("stress", {}).get("duplicate_side_effects") == 0
            and stress.get("stress", {}).get("data_corruption") == 0
            and stress.get("stress", {}).get("permanent_running") == 0
            and all(stress.get("gates", {}).values())
        ),
        "low_memory_and_thermal_resource_policy_suite_is_green": unit_suite_green(reliability_xml, 8),
        "api26_process_name_path_is_guarded_below_api28": (
            "Build.VERSION.SDK_INT >= Build.VERSION_CODES.P" in service_path.read_text(encoding="utf-8")
            and 'File("/proc/self/cmdline")' in service_path.read_text(encoding="utf-8")
        ),
    }
    source_paths = (
        budget_path,
        collector_path,
        performance_test_path,
        service_path,
        reliability_path,
        reliability_test_path,
        *raw_paths,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M11-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "candidate_apk_sha256": next(iter(apk_hashes)) if len(apk_hashes) == 1 else None,
        "matrix": [
            {
                "api_level": item["api_level"],
                "abi": item["abi"],
                "model": item["model"],
                "cold_start_p95_ms": item["metrics"]["cold_start_p95_ms"],
                "foreground_pss_p95_mb": item["metrics"]["foreground_pss_p95_mb"],
                "passed": item["passed"],
            }
            for item in reports
        ],
        "stress": stress["stress"],
        "gates": gates,
        "source_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in source_paths
        },
    }
    output = ROOT / "docs/android/reports/evidence/p9/m11-f04-runtime-performance.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
