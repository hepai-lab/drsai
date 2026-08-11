from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parity_report = ROOT / "docs/android/reports/evidence/p9/m12-f02-production-behavior-parity.json"
    fixture = ROOT / "cores/protocol/android-runtime/fixtures/p9-production-behavior-parity-v1.json"
    desktop_test = ROOT / "cores/python/packages/drsai/tests/test_p9_production_behavior_parity.py"
    android_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/P9ProductionBehaviorParityInstrumentedTest.kt"
    parity = json.loads(parity_report.read_text(encoding="utf-8"))
    devices = parity.get("devices", [])
    gates = {
        "runner_uses_both_production_agent_entries": (
            parity["gates"]["desktop_uses_an_actual_drsai_assistant_instance_and_production_adapter"]
            and parity["gates"]["android_uses_the_bundled_isolated_runtime_process"]
        ),
        "same_model_prompt_and_capability_fixture_is_bound": parity["gates"]["fixture_is_versioned_and_contains_no_provider_or_secret"],
        "kernel_prompt_tool_and_skill_digests_match": all(parity["gates"][key] for key in (
            "kernel_and_prompt_identity_are_frozen_for_both_surfaces",
            "shared_tool_schema_digest_is_identical", "skill_manifest_digest_is_identical",
        )),
        "plan_tool_intent_terminal_and_semantic_events_are_equivalent": parity["gates"]["tool_call_result_decision_and_terminal_sequence_are_exact"],
        "user_visible_result_is_equivalent": parity["gates"]["user_visible_result_is_exact"],
        "desktop_production_suite_is_green": parity["gates"]["desktop_production_and_cross_runtime_suites_are_green"],
        "api35_and_real_arm64_runner_are_green": (
            "emulator-5554" in devices and any("R5GYB3S8ACH" in value for value in devices)
            and parity["gates"]["api35_emulator_and_api36_arm64_device_are_green"]
        ),
        "runner_evidence_is_bound_to_fixture_hash": parity.get("fixture_sha256") == digest(fixture),
    }
    paths = (parity_report, fixture, desktop_test, android_test)
    report = {
        "schema_version": 1, "feature_id": "M01-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(), "passed": all(gates.values()),
        "gates": gates, "devices": devices,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m01-f06-production-parity-runner.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
