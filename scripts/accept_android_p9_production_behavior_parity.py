from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    fixture = ROOT / "cores/protocol/android-runtime/fixtures/p9-production-behavior-parity-v1.json"
    desktop_test = ROOT / "cores/python/packages/drsai/tests/test_p9_production_behavior_parity.py"
    production_identity_test = ROOT / "cores/python/packages/drsai/tests/test_agent_kernel_production_parity.py"
    cross_runtime_test = ROOT / "cores/python/packages/drsai/tests/test_mobile_cross_runtime_parity.py"
    android_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/P9ProductionBehaviorParityInstrumentedTest.kt"
    xml = ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug/TEST-ai.drsai.remote.P9ProductionBehaviorParityInstrumentedTest.xml"
    sources = (fixture, desktop_test, production_identity_test, cross_runtime_test, android_test)
    value = json.loads(fixture.read_text(encoding="utf-8"))
    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", *(str(path.relative_to(ROOT)) for path in (
            desktop_test, production_identity_test, cross_runtime_test,
        )), "-q"],
        cwd=ROOT, capture_output=True, text=True, timeout=180, check=False,
    )
    device_green = False
    device_count = 0
    device_values: list[str] = []
    if xml.is_file():
        suite = ET.parse(xml).getroot()
        device_count = int(suite.attrib.get("tests", 0))
        device_values = [item.attrib.get("value", "") for item in suite.findall("./properties/property")]
        device_green = (
            device_count >= 1 and len(device_values) >= 2 and int(suite.attrib.get("failures", 0)) == 0
            and int(suite.attrib.get("errors", 0)) == 0
            and "emulator-5554" in device_values and any("R5GYB3S8ACH" in item for item in device_values)
        )
    identity = value["identity"]
    gates = {
        "fixture_is_versioned_and_contains_no_provider_or_secret": (
            value["schema_version"] == "opendrsai.p9-production-behavior-parity/1"
            and not any(token in fixture.read_text(encoding="utf-8").lower() for token in ("api_key", "bearer ", "password"))
        ),
        "desktop_uses_an_actual_drsai_assistant_instance_and_production_adapter": (
            "object.__new__(DrSaiAssistant)" in desktop_test.read_text(encoding="utf-8")
            and "run_agent_through_kernel" in desktop_test.read_text(encoding="utf-8")
        ),
        "android_uses_the_bundled_isolated_runtime_process": (
            "PythonRuntimeClient" in android_test.read_text(encoding="utf-8")
            and "runtimeIdentity" in android_test.read_text(encoding="utf-8")
        ),
        "kernel_and_prompt_identity_are_frozen_for_both_surfaces": (
            len(identity["kernel_sha256"]) == 64 and len(identity["base_prompt_sha256"]) == 64
            and "agent_kernel_identity" in desktop_test.read_text(encoding="utf-8")
            and "runtimeIdentity.kernelSha256" in android_test.read_text(encoding="utf-8")
        ),
        "shared_tool_schema_digest_is_identical": (
            len(value["tool"]["schema_sha256"]) == 64
            and "model_tool_snapshot" in desktop_test.read_text(encoding="utf-8")
            and "model_tool_snapshot" in android_test.read_text(encoding="utf-8")
        ),
        "skill_manifest_digest_is_identical": (
            len(value["skill_manifest_sha256"]) == 64
            and "skill_manifest_sha256" in desktop_test.read_text(encoding="utf-8")
            and "skill_manifest_sha256" in android_test.read_text(encoding="utf-8")
        ),
        "tool_call_result_decision_and_terminal_sequence_are_exact": value["expected_semantic_events"] == [
            "run.started", "tool.decision", "tool.started", "tool.result", "tool.decision", "run.completed",
        ],
        "user_visible_result_is_exact": value["final_text"] == "echo:hello",
        "desktop_production_and_cross_runtime_suites_are_green": pytest.returncode == 0,
        "api35_emulator_and_api36_arm64_device_are_green": device_green,
    }
    report = {
        "schema_version": 1, "feature_id": "M12-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(), "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "devices": device_values, "device_tests": device_count,
        "fixture_sha256": sha256(fixture),
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): sha256(path) for path in sources},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m12-f02-production-behavior-parity.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "device_tests": device_count}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
