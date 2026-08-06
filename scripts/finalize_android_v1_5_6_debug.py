from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/android/plans/runtime/ANDROID_V1_5_6_FULL_RUNTIME_DEFAULT_DEVELOPMENT_TEST_PLAN.md"
EVIDENCE = ROOT / "docs/android/reports/evidence/v1.5.6"
APK = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
OUTPUT = EVIDENCE / "final-debug-go-no-go.json"


def load(name: str) -> dict[str, Any] | None:
    path = EVIDENCE / name
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def evidence_hash(value: dict[str, Any] | None) -> str | None:
    if not value:
        return None
    direct = value.get("apk_sha256")
    if isinstance(direct, str):
        return direct.lower()
    for key in ("apk", "candidate"):
        nested = value.get(key)
        if isinstance(nested, dict) and isinstance(nested.get("sha256"), str):
            return str(nested["sha256"]).lower()
    return None


def bound_passed(name: str, apk_hash: str) -> tuple[bool, dict[str, Any] | None]:
    value = load(name)
    return bool(value and value.get("passed") is True and evidence_hash(value) == apk_hash), value


def feature_file(name: str, ids: list[str], apk_hash: str) -> dict[str, tuple[bool, str]]:
    value = load(name)
    valid = bool(value and evidence_hash(value) == apk_hash)
    features = value.get("features", {}) if value else {}
    return {feature_id: (bool(valid and features.get(feature_id) is True), name) for feature_id in ids}


def main() -> int:
    apk_hash = hashlib.sha256(APK.read_bytes()).hexdigest()
    plan_ids = sorted(set(re.findall(r"\bM\d{2}-F\d{2}\b", PLAN.read_text(encoding="utf-8"))))
    expected_ids = [f"M{module:02d}-F{feature:02d}" for module in range(1, 11) for feature in range(1, 7)]
    if plan_ids != expected_ids:
        raise RuntimeError(f"v156_plan_feature_set_invalid:{len(plan_ids)}")

    results: dict[str, tuple[bool, str]] = {}
    results.update(feature_file("build-identity.json", expected_ids[0:6], apk_hash))
    results.update(feature_file("architecture-gate.json", expected_ids[6:18], apk_hash))
    results.update(feature_file("oaep-parity.json", expected_ids[18:24] + expected_ids[36:42], apk_hash))
    results.update(feature_file("tool-e2e-emulator-api35.json", expected_ids[24:29], apk_hash))
    results.update(feature_file("ui-diagnostics.json", expected_ids[30:36], apk_hash))
    results.update(feature_file("security-emulator-api35.json", expected_ids[48:54], apk_hash))

    tool_physical_ok, tool_physical = bound_passed("tool-e2e-physical-api36.json", apk_hash)
    results["M05-F06"] = (
        bool(tool_physical_ok and tool_physical.get("features", {}).get("M05-F06") is True),
        "tool-e2e-physical-api36.json",
    )

    recovery_ok, recovery = bound_passed("runtime-recovery-emulator-api35.json", apk_hash)
    recovery_gates = recovery.get("gates", {}) if recovery else {}
    results["M08-F01"] = (
        bool(recovery_ok and recovery_gates.get("cycles_100") is True
             and recovery_gates.get("zero_permanent_hangs") is True
             and recovery_gates.get("zero_duplicate_runtime_processes") is True),
        "runtime-recovery-emulator-api35.json",
    )
    lifecycle_ok, lifecycle = bound_passed("lifecycle-recovery-emulator-api35.json", apk_hash)
    results["M08-F02"] = (lifecycle_ok, "lifecycle-recovery-emulator-api35.json")
    stress_ok, stress = bound_passed("stress-performance-emulator-api35.json", apk_hash)
    stress_gates = stress.get("gates", {}) if stress else {}
    results["M08-F03"] = (
        bool(stress_ok and all(stress_gates.get(key) is True for key in (
            "runs_500", "tools_50", "recoveries_20", "zero_duplicate_side_effects", "zero_data_corruption",
        ))),
        "stress-performance-emulator-api35.json",
    )
    physical_perf_ok, physical_perf = bound_passed("stress-performance-physical-api36.json", apk_hash)
    physical_serial = str(physical_perf.get("serial", "")) if physical_perf else ""
    physical_gates = physical_perf.get("gates", {}) if physical_perf else {}
    is_physical = physical_perf_ok and physical_serial and not physical_serial.startswith("emulator-")
    results["M08-F04"] = (
        bool(is_physical and physical_gates.get("cold_start_p95_under_3s") is True
             and physical_gates.get("recovery_p95_under_2s") is True),
        "stress-performance-physical-api36.json",
    )
    results["M08-F05"] = (
        bool(is_physical and physical_gates.get("foreground_pss_under_220mb") is True),
        "stress-performance-physical-api36.json",
    )
    results["M08-F06"] = (
        bool(stress_ok and stress_gates.get("database_growth_under_64mb") is True
             and stress_gates.get("zero_data_corruption") is True),
        "stress-performance-emulator-api35.json",
    )

    build_ok, _ = bound_passed("build-identity.json", apk_hash)
    results["M10-F01"] = (build_ok, "build-identity.json")
    results["M10-F02"] = bound_passed("physical-default-binding-api36.json", apk_hash)[0], "physical-default-binding-api36.json"
    results["M10-F03"] = tool_physical_ok, "tool-e2e-physical-api36.json"
    results["M10-F04"] = bound_passed("physical-fault-recovery-api36.json", apk_hash)[0], "physical-fault-recovery-api36.json"
    results["M10-F05"] = bound_passed("oaep-cross-end-emulator-api35.json", apk_hash)[0], "oaep-cross-end-emulator-api35.json"

    missing_before_final = [feature_id for feature_id in expected_ids if feature_id != "M10-F06" and not results.get(feature_id, (False, ""))[0]]
    results["M10-F06"] = (not missing_before_final, "final-debug-go-no-go.json")
    ledger = [
        {
            "id": feature_id,
            "module": feature_id.split("-", 1)[0],
            "passed": bool(results.get(feature_id, (False, "missing"))[0]),
            "evidence": results.get(feature_id, (False, "missing"))[1],
        }
        for feature_id in expected_ids
    ]
    passed_count = sum(1 for item in ledger if item["passed"])
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "release": {"version": "1.5.6", "version_code": 10506, "package": "ai.drsai.remote.debug"},
        "apk": {"path": str(APK), "sha256": apk_hash, "bytes": APK.stat().st_size},
        "feature_count": len(ledger),
        "passed_count": passed_count,
        "completion_percent": round(passed_count * 100 / len(ledger), 2),
        "missing": [item["id"] for item in ledger if not item["passed"]],
        "ledger": ledger,
        "decision": "GO" if passed_count == 60 else "NO-GO",
        "passed": passed_count == 60,
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("passed", "decision", "passed_count", "feature_count", "completion_percent", "missing")}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
