"""Record Android v1.5.6 deterministic Tool/Skill acceptance and optional live-provider proof."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
APP_APK = ANDROID / "app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
TEST_APK = ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
RUNNER = "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner"
DEVICE_CLASSES = ",".join((
    "ai.drsai.remote.FullRuntimeToolRegistryInstrumentedTest",
    "ai.drsai.remote.PythonRuntimeCriticalJourneyTest",
))


def run(command: list[str], timeout: int = 240) -> str:
    result = subprocess.run(
        command, cwd=ROOT, timeout=timeout, capture_output=True, text=True,
        encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode:
        raise RuntimeError(f"command_failed_{result.returncode}: {' '.join(command)}\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


def unit_test_status() -> tuple[dict[str, bool], dict[str, int]]:
    required = {
        "ToolSchemaContractTest": False,
        "SkillCatalogTest": False,
        "AndroidPythonHostAdaptersTest": False,
        "ToolApprovalPolicyTest": False,
    }
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for report in (ANDROID / "app/build/test-results/testDebugUnitTest").glob("TEST-*.xml"):
        root = ET.parse(report).getroot()
        for key in totals:
            totals[key] += int(root.attrib.get(key, 0))
        class_name = root.attrib.get("name", "").rsplit(".", 1)[-1]
        if class_name in required:
            required[class_name] = int(root.attrib.get("failures", 0)) == 0 and int(root.attrib.get("errors", 0)) == 0
    return required, totals


def live_provider_status(path: Path | None) -> tuple[bool, dict[str, object] | None]:
    if path is None or not path.is_file():
        return False, None
    report = json.loads(path.read_text(encoding="utf-8"))
    required = {"model", "status", "code", "tool_calls"}
    passed = report.get("passed") is True and required <= report.keys() and int(report["tool_calls"]) >= 5
    return passed, report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument("--provider-report", type=Path)
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "docs/android/reports/evidence/v1.5.6/tool-e2e.json",
    )
    args = parser.parse_args()
    if not APP_APK.is_file() or not TEST_APK.is_file():
        raise FileNotFoundError("v1.5.6_debug_apks_missing")
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = str(sdk / "platform-tools/adb.exe")
    base = [adb, "-s", args.serial]
    run(base + ["install", "-r", "-t", str(APP_APK)], timeout=300)
    run(base + ["install", "-r", "-t", str(TEST_APK)], timeout=300)
    device_output = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "class", DEVICE_CLASSES, RUNNER,
    ], timeout=300)
    device_green = "OK (4 tests)" in device_output
    unit, totals = unit_test_status()
    unit_green = totals["tests"] > 0 and totals["failures"] == totals["errors"] == 0
    provider_green, provider = live_provider_status(args.provider_report)
    checks = {
        "unit_suite_green": unit_green,
        "tool_schema_contract": unit["ToolSchemaContractTest"],
        "skill_capability_pinning": unit["SkillCatalogTest"],
        "model_tool_error_is_explicit": unit["AndroidPythonHostAdaptersTest"],
        "approval_is_single_decision": unit["ToolApprovalPolicyTest"],
        "device_registry_and_python_journey_4_tests": device_green,
        "base_tools_execute_without_saf": "baseToolsExecuteThroughTheSameRegistryWithoutSafPermission" in device_output,
        "forged_saf_fails_closed": "forgedSafCapabilityStillFailsClosedWithoutPersistedGrant" in device_output,
        "live_provider_tool_chain": provider_green,
    }
    features = {
        "M05-F01": checks["unit_suite_green"] and checks["tool_schema_contract"] and device_green,
        "M05-F02": checks["base_tools_execute_without_saf"] and device_green,
        "M05-F03": checks["forged_saf_fails_closed"] and device_green,
        "M05-F04": checks["skill_capability_pinning"] and device_green,
        "M05-F05": checks["approval_is_single_decision"] and device_green,
        "M05-F06": checks["model_tool_error_is_explicit"] and checks["live_provider_tool_chain"],
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "commit": run(["git", "rev-parse", "HEAD"]).strip(),
        "dirty": bool(run(["git", "status", "--porcelain"]).strip()),
        "apk": {"path": str(APP_APK), "sha256": hashlib.sha256(APP_APK.read_bytes()).hexdigest()},
        "package": "ai.drsai.remote.debug",
        "version": "1.5.6",
        "device": {"serial": args.serial},
        "tests": {"jvm": totals, "instrumentation": {"tests": 4, "failures": 0 if device_green else 1}},
        "checks": checks,
        "features": features,
        "provider": provider,
        "passed": all(features.values()),
        "status": "passed" if all(features.values()) else "awaiting_live_provider",
    }
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "status": report["status"], "features": features}, ensure_ascii=False))
    return 0 if all(features[key] for key in ("M05-F01", "M05-F02", "M05-F03", "M05-F04", "M05-F05")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
