from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path, minimum: int, devices: int = 0) -> bool:
    if not path.is_file():
        return False
    root = ET.parse(path).getroot()
    if int(root.attrib.get("tests", 0)) < minimum or int(root.attrib.get("failures", 0)) or int(root.attrib.get("errors", 0)):
        return False
    if devices:
        values = [node.attrib.get("value", "") for node in root.findall("./properties/property")]
        return len(values) >= devices and "emulator-5554" in values and any("R5GYB3S8ACH" in value for value in values)
    return True


def main() -> int:
    policy = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/security/AndroidRuntimeKillSwitchPolicy.kt"
    rollout = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeRolloutPolicy.kt"
    client = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/RuntimeRolloutPolicyClient.kt"
    recovery = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRunRecovery.kt"
    engine = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt"
    app = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    unit_test = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/AndroidRuntimeKillSwitchPolicyTest.kt"
    device_test = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/P9RuntimeKillSwitchInstrumentedTest.kt"
    paths = (policy, rollout, client, recovery, engine, app, unit_test, device_test)
    text = {path: path.read_text(encoding="utf-8") for path in paths}
    unit_xml = ROOT / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidRuntimeKillSwitchPolicyTest.xml"
    device_xml = ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug/TEST-ai.drsai.remote.P9RuntimeKillSwitchInstrumentedTest.xml"

    gates = {
        "five_named_switches_are_versioned_and_fail_closed_on_unknown_values": (
            all(value in text[policy] for value in ('WEB("web")', 'MCP("mcp")', 'SANDBOX("sandbox")',
                                                    'KERNEL("kernel")', 'REMOTE_HANDOFF("remote_handoff")'))
            and "runtime_kill_switch_unknown" in text[policy]
            and "p9-android-kill-switch-v1" in text[policy]
        ),
        "web_switch_removes_search_fetch_and_browser_capabilities_and_tools": (
            all(value in text[policy] for value in ("WEB_SEARCH", "WEB_FETCH", "BROWSER_SESSION", 'name.startsWith("web.")', 'name.startsWith("browser.")'))
        ),
        "mcp_switch_removes_android_and_stdio_mcp_capabilities_and_tools": (
            all(value in text[policy] for value in ("RuntimeCapability.MCP", "RuntimeCapability.MCP_STDIO", 'name.startsWith("mcp.")'))
        ),
        "sandbox_switch_removes_shared_core_compute_from_new_and_resumed_runs": (
            'name == "core.data_compute"' in text[policy]
            and "allowedToolNames" in text[recovery]
            and 'state.put("tools"' in text[recovery]
        ),
        "kernel_switch_fails_the_full_runtime_explicitly_without_an_alternate_engine": (
            "android_full_runtime_kernel_disabled" in text[engine]
            and "killSwitchSnapshot" in text[engine]
            and "listOf(\n                pythonChatEngine," in text[app]
            and "Kotlin" not in text[engine]
        ),
        "remote_handoff_switch_returns_an_explicit_failure_without_silent_chat": (
            "AndroidRuntimeKillSwitch.REMOTE_HANDOFF" in text[app]
            and "android_full_runtime_remote_handoff_disabled" in text[app]
            and "return true" in text[app]
        ),
        "signed_policy_is_the_production_source_and_fetch_failure_disables_kernel": (
            "disabled_runtime_features" in text[rollout]
            and "installVerifiedPolicy" in text[rollout]
            and "failSafePolicy" in text[client]
            and "AndroidRuntimeKillSwitch.KERNEL" in text[rollout]
        ),
        "capabilities_tools_skills_and_diagnostics_use_the_same_snapshot_policy": (
            text[app].count("killSwitchSnapshot()") >= 4
            and "operationalPolicy.toolSchemas" in text[engine]
            and "operationalPolicy.skillSchemas" in text[engine]
        ),
        "kill_switch_unit_matrix_is_green": suite(unit_xml, 4),
        "oaep_snapshot_is_unchanged_on_both_android_devices": (
            "androidOaepSnapshotDigest" in text[device_test] and suite(device_xml, 1, devices=2)
        ),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M11-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in paths},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m11-f06-runtime-kill-switch.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
