from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit(path: Path, minimum: int, devices: int = 0) -> bool:
    if not path.is_file():
        return False
    root = ET.parse(path).getroot()
    properties = root.find("properties")
    recorded_devices = 0 if properties is None else sum(
        1 for item in properties.findall("property") if item.attrib.get("name", "").startswith("device.")
    )
    return (
        int(root.attrib.get("tests", 0)) >= minimum
        and int(root.attrib.get("failures", 0)) == 0
        and int(root.attrib.get("errors", 0)) == 0
        and recorded_devices >= devices
    )


def main() -> int:
    binding_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/FullRuntimeBindingCoordinator.kt"
    client_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeClient.kt"
    service_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeService.kt"
    skill_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/SkillCatalog.kt"
    models_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/data/Models.kt"
    app_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    ui_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    manifest_path = ROOT / "apps/android/app/src/main/AndroidManifest.xml"
    safe_runner_path = ROOT / "scripts/run_android_p9_safe_instrumentation.py"
    service_test_path = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeServiceTest.kt"
    ui_test_path = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/ui/MainInterfaceTest.kt"
    binding_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/FullRuntimeBindingCoordinatorTest.kt"
    skill_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/SkillCatalogTest.kt"
    ui_contract_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/FullRuntimeUiContractTest.kt"
    paths = (
        binding_path, client_path, service_path, skill_path, models_path, app_path, ui_path, manifest_path,
        safe_runner_path, service_test_path, ui_test_path, binding_test_path, skill_test_path, ui_contract_path,
    )
    text = {path: path.read_text(encoding="utf-8") for path in paths}
    unit_dir = ROOT / "apps/android/app/build/test-results/testDebugUnitTest"
    device_dir = ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug"

    gates = {
        "runtime_service_reports_actual_process_name_and_pid": all(value in text[service_path] for value in (
            "Application.getProcessName()", "Process.myPid()", 'put("android_process_name"', 'put("android_pid"',
        )),
        "client_verifies_remote_process_identity_during_health_handshake": all(value in text[client_path] for value in (
            'runtimeProcessName = python.getString("android_process_name")',
            'runtimePid = python.getInt("android_pid")',
        )) and all(value in text[binding_path] for value in (
            'runtimeProcessName.endsWith(":runtime")', "runtimePid > 0",
        )),
        "manifest_and_physical_test_prove_two_distinct_processes": (
            'android:process=":runtime"' in text[manifest_path]
            and "assertNotEquals(Process.myPid(), runtimeProcess!!.pid)" in text[service_test_path]
            and 'runtimeProcess.processName.endsWith(":runtime")' in text[service_test_path]
        ),
        "startup_recovery_and_checkpoint_identity_tests_exist": all(value in text[service_test_path] for value in (
            "runtimeProcessExecutesBundledPythonCoreAndReturnsIdentity",
            "runtimeRecoversAfterUnexpectedProcessDeath",
            "checkpointRestoresIdenticalConversationAfterRuntimeProcessRestart",
            "runtimeIsIsolatedAndShutdownStartsWithCleanState",
        )),
        "upgrade_runner_preserves_app_data": (
            '"install", "-r", "-t"' in text[safe_runner_path]
            and 'adb(options.adb, serial, "uninstall"' not in text[safe_runner_path]
            and 'adb(options.adb, serial, "shell", "pm", "clear"' not in text[safe_runner_path]
        ),
        "skill_manifest_identity_is_versioned_redacted_and_content_sensitive": all(value in text[skill_path] for value in (
            "SkillManifestIdentity", "SkillManifestDigest.VERSION", "skill.digest", "MessageDigest.getInstance(\"SHA-256\")",
        )) and "diagnosticIdentityIsVersionedStableAndChangesWithTheManifest" in text[skill_test_path],
        "diagnostic_model_exports_kernel_prompt_tool_skill_process_and_binding": all(value in text[models_path] for value in (
            "bindingState", "process", "kernelSha256", "promptSha256", "toolManifestVersion",
            "skillManifestVersion", "skillManifestSha256",
        )) and all(value in text[app_path] for value in (
            "runtimeProcessName", "runtimePid", "skillCatalog.diagnosticIdentity()",
        )),
        "compose_displays_all_required_identity_fields": all(value in text[ui_path] for value in (
            'DiagnosticRow("绑定"', 'DiagnosticRow("进程"', 'DiagnosticRow("Kernel digest"',
            'DiagnosticRow("Prompt"', 'DiagnosticRow("Tool manifest"', 'DiagnosticRow("Skill manifest"',
            '"Kernel ${diagnostic.kernelVersion', '"Prompt ${diagnostic.promptVersion', '"Skill ${diagnostic.skillManifestVersion',
        )),
        "binding_skill_and_export_unit_suites_are_green": all((
            junit(unit_dir / "TEST-ai.drsai.remote.FullRuntimeBindingCoordinatorTest.xml", 1),
            junit(unit_dir / "TEST-ai.drsai.remote.SkillCatalogTest.xml", 1),
            junit(unit_dir / "TEST-ai.drsai.remote.FullRuntimeUiContractTest.xml", 1),
        )),
        "emulator_and_sm_x936c_startup_recovery_and_dual_process_suite_is_green": junit(
            device_dir / "TEST-ai.drsai.remote.PythonRuntimeServiceTest.xml", 6, devices=2,
        ),
        "emulator_and_sm_x936c_diagnostic_compose_suite_is_green": junit(
            device_dir / "TEST-ai.drsai.remote.ui.MainInterfaceTest.xml", 1, devices=2,
        ),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M10-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m10-f03-runtime-identity-diagnostics.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
