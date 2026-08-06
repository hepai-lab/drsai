from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit_summary(paths: list[Path]) -> dict[str, int]:
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for path in paths:
        root = ET.parse(path).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
        for suite in suites:
            for key in totals:
                totals[key] += int(suite.attrib.get(key, 0))
    return totals


def main() -> int:
    python_xml = ROOT / "docs/android/reports/evidence/p9/pending/m12-f04-python-full.xml"
    unit_dir = ROOT / "apps/android/app/build/test-results/testDebugUnitTest"
    unit_xmls = sorted(unit_dir.glob("TEST-*.xml"))
    matrix_xml = ROOT / (
        "apps/android/app/build/outputs/androidTest-results/connected/debug/"
        "TEST-ai.drsai.remote.AndroidOaepStoreTest,ai.drsai.remote.PythonRuntimeServiceTest,"
        "ai.drsai.remote.FullRuntimeToolRegistryInstrumentedTest.xml"
    )
    report_paths = {
        "ui_and_runtime_identity": ROOT / "docs/android/reports/evidence/p9/m10-f03-runtime-identity-diagnostics.json",
        "security": ROOT / "docs/android/reports/evidence/p9/m11-f01-unified-tool-security.json",
        "recovery": ROOT / "docs/android/reports/evidence/p9/m11-f02-exactly-once-recovery.json",
        "supply_chain": ROOT / "docs/android/reports/evidence/p9/m11-f03-supply-chain.json",
        "performance": ROOT / "docs/android/reports/evidence/p9/m11-f04-runtime-performance.json",
    }
    raw_performance = [
        ROOT / f"docs/android/reports/evidence/p9/pending/m11-f04-api{api}-{abi}.json"
        for api, abi in ((26, "x86_64"), (30, "x86_64"), (35, "x86_64"), (36, "arm64-v8a"))
    ]
    python = junit_summary([python_xml])
    android = junit_summary(unit_xmls)
    matrix = junit_summary([matrix_xml])
    matrix_root = ET.parse(matrix_xml).getroot()
    properties = matrix_root.find("properties")
    serials = [] if properties is None else [
        item.attrib.get("value", "") for item in properties.findall("property")
        if item.attrib.get("name", "").startswith("device.")
    ]
    performance_rows = [json.loads(path.read_text(encoding="utf-8")) for path in raw_performance]
    component_reports = {
        name: json.loads(path.read_text(encoding="utf-8")) for name, path in report_paths.items()
    }
    apk_hashes = {row.get("apk_sha256") for row in performance_rows}
    performance_candidate = component_reports["performance"].get("candidate_apk_sha256")

    gates = {
        "shared_python_full_suite_is_green": (
            python["tests"] >= 1791 and python["failures"] == 0 and python["errors"] == 0
        ),
        "android_jvm_full_suite_is_green": (
            android["tests"] >= 548 and android["failures"] == 0 and android["errors"] == 0
        ),
        "four_device_oaep_runtime_and_tool_registry_suite_is_green": (
            matrix["tests"] >= 21 and matrix["failures"] == 0 and matrix["errors"] == 0
            and len(serials) == 4
        ),
        "matrix_has_api_26_30_35_36": {row.get("api_level") for row in performance_rows} == {26, 30, 35, 36},
        "matrix_has_x86_64_and_physical_arm64": (
            {row.get("abi") for row in performance_rows} >= {"x86_64", "arm64-v8a"}
            and any(row.get("model") == "SM-X936C" and row.get("api_level") == 36 for row in performance_rows)
        ),
        "all_devices_and_stress_use_one_candidate_apk": (
            len(apk_hashes) == 1 and next(iter(apk_hashes), None) == performance_candidate
        ),
        "ui_and_runtime_identity_are_green_on_emulator_and_physical": component_reports["ui_and_runtime_identity"].get("passed") is True,
        "security_and_supply_chain_are_green": (
            component_reports["security"].get("passed") is True
            and component_reports["supply_chain"].get("passed") is True
        ),
        "exactly_once_recovery_is_green": component_reports["recovery"].get("passed") is True,
        "performance_resource_and_anr_matrix_is_green": component_reports["performance"].get("passed") is True,
    }
    bound_paths = [python_xml, matrix_xml, *unit_xmls, *report_paths.values(), *raw_performance]
    report = {
        "schema_version": 1,
        "feature_id": "M12-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "candidate_apk_sha256": performance_candidate,
        "python_junit": python,
        "android_jvm_junit": android,
        "device_instrumentation_junit": {**matrix, "serials": serials},
        "devices": [
            {"serial": row["serial"], "api": row["api_level"], "abi": row["abi"], "model": row["model"]}
            for row in performance_rows
        ],
        "gates": gates,
        "source_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in bound_paths
        },
    }
    output = ROOT / "docs/android/reports/evidence/p9/m12-f04-device-matrix.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "python": python, "android": android, "devices": len(serials)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
