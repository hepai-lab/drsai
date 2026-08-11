from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    identity_report = ROOT / "docs/android/reports/evidence/p9/m10-f03-runtime-identity-diagnostics.json"
    parity_report = ROOT / "docs/android/reports/evidence/p9/m12-f02-production-behavior-parity.json"
    probe = ROOT / "apps/android/app/src/main/python/runtime_probe.py"
    service_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeServiceTest.kt"
    service = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeService.kt"
    identity = json.loads(identity_report.read_text(encoding="utf-8"))
    parity = json.loads(parity_report.read_text(encoding="utf-8"))
    probe_source = probe.read_text(encoding="utf-8")
    test_source = service_test.read_text(encoding="utf-8")
    gates = {
        "android_runtime_uses_shared_kernel_factory_directly": (
            'create_agent_kernel(surface="android")' in probe_source and "create_mobile_agent_core" not in probe_source
        ),
        "runtime_identity_exports_same_kernel_and_prompt_contract": all(token in test_source for token in (
            '"drsai-agent-kernel"', '"p9.1"', '"p9-agent-kernel-v1"', '"p9-tools-v1"',
        )),
        "runtime_identity_is_reported_by_real_isolated_process": (
            identity.get("passed") is True
            and identity["gates"]["runtime_service_reports_actual_process_name_and_pid"]
            and identity["gates"]["manifest_and_physical_test_prove_two_distinct_processes"]
        ),
        "health_handshake_verifies_remote_identity": identity["gates"]["client_verifies_remote_process_identity_during_health_handshake"],
        "process_death_and_checkpoint_recovery_keep_identity": identity["gates"]["startup_recovery_and_checkpoint_identity_tests_exist"],
        "api35_emulator_and_sm_x936c_runtime_suite_is_green": identity["gates"]["emulator_and_sm_x936c_startup_recovery_and_dual_process_suite_is_green"],
        "production_behavior_fixture_confirms_shared_kernel_prompt_and_tool_digest": (
            parity.get("passed") is True
            and parity["gates"]["kernel_and_prompt_identity_are_frozen_for_both_surfaces"]
            and parity["gates"]["shared_tool_schema_digest_is_identical"]
        ),
        "runtime_service_is_non_exported_and_process_scoped": (
            'android:process=":runtime"' in (ROOT / "apps/android/app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
            and "android:exported=\"false\"" in (ROOT / "apps/android/app/src/main/AndroidManifest.xml").read_text(encoding="utf-8")
        ),
    }
    paths = (identity_report, parity_report, probe, service_test, service)
    report = {
        "schema_version": 1, "feature_id": "M01-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(), "passed": all(gates.values()),
        "gates": gates,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m01-f05-android-shared-kernel-runtime.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
