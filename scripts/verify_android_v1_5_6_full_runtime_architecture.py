"""Fail the build if Android v1.5.6 can reach a Kotlin Lite Agent authority."""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps/android/app"
MAIN = APP / "src/main"
APK = APP / "build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
OUTPUT = ROOT / "docs/android/reports/evidence/v1.5.6/architecture-gate.json"
BANNED = (
    "LocalAgentRuntime",
    "LocalChatEngine",
    "SelectableLocalChatEngine",
    "safePythonFallback",
    "mayFallbackToKotlin",
    "KOTLIN_LITE",
    "kotlin_lite",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest


def test_cases() -> dict[str, str]:
    cases: dict[str, str] = {}
    for report in (APP / "build/test-results/testDebugUnitTest").glob("TEST-*.xml"):
        suite = ET.parse(report).getroot()
        for case in suite.findall("testcase"):
            key = f"{case.attrib.get('classname')}.{case.attrib.get('name')}"
            cases[key] = "failed" if case.find("failure") is not None or case.find("error") is not None else "passed"
    return cases


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path, default=APK)
    args = parser.parse_args()
    apk = args.apk.resolve()
    if not apk.is_file():
        raise SystemExit(f"missing Debug APK: {apk}")

    source_files = list(MAIN.rglob("*.kt"))
    source = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
    app_vm = (MAIN / "java/ai/drsai/remote/AppViewModel.kt").read_text(encoding="utf-8")
    engine = (MAIN / "java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt").read_text(encoding="utf-8")
    binding = (MAIN / "java/ai/drsai/remote/runtime/python/FullRuntimeBindingCoordinator.kt").read_text(encoding="utf-8")
    client = (MAIN / "java/ai/drsai/remote/runtime/python/PythonRuntimeClient.kt").read_text(encoding="utf-8")
    policy = (MAIN / "java/ai/drsai/remote/runtime/python/PythonRuntimeRolloutPolicy.kt").read_text(encoding="utf-8")
    build_config = (APP / "build/generated/source/buildConfig/debug/ai/drsai/remote/BuildConfig.java").read_text(encoding="utf-8")
    cases = test_cases()

    with zipfile.ZipFile(apk) as archive:
        dex = b"".join(archive.read(name) for name in archive.namelist() if name.endswith(".dex"))
    dex_hits = {symbol: dex.count(symbol.encode()) for symbol in BANNED}
    # The single expected uppercase KOTLIN_LITE string is the false BuildConfig
    # diagnostic field. Lowercase route literals are never legitimate.
    dex_hits_without_diagnostic = dict(dex_hits)
    dex_hits_without_diagnostic["KOTLIN_LITE"] = max(0, dex_hits["KOTLIN_LITE"] - 1)

    coordinator_cases = {name: status for name, status in cases.items() if "FullRuntimeBindingCoordinatorTest" in name}
    checks = {
        "debug_full_true": "FULL_AGENT_RUNTIME_ENABLED = true" in build_config,
        "debug_lite_false": "KOTLIN_LITE_RUNTIME_ENABLED = false" in build_config,
        "no_banned_main_source": all(symbol not in source for symbol in BANNED),
        "no_banned_apk_symbols": all(count == 0 for count in dex_hits_without_diagnostic.values()),
        "diagnostic_lite_flag_is_only_apk_occurrence": dex_hits["KOTLIN_LITE"] == 1,
        "direct_full_local_engine": "listOf(\n                pythonChatEngine," in app_vm,
        "remote_engine_remains_explicit": "PlatformChatEngine(platformRuntime)" in app_vm,
        "readiness_before_run_mutation": engine.index("readiness.ensureReady(request.accountSubject)") < engine.index("dao.saveMessage("),
        "proactive_bind_after_login": "fullRuntimeBinding.bind(user.id)" in app_vm,
        "logout_releases_account_binding": "fullRuntimeBinding.release(subject)" in app_vm,
        "binding_state_machine_complete": all(
            f"FullRuntimeBindingState.{state}" in binding
            for state in ("UNINITIALIZED", "BINDING", "READY", "RECOVERING", "UNAVAILABLE")
        ),
        "binding_state_durable_diagnostic": "full_runtime_binding_v1" in binding and "recorded_at" in binding,
        "binder_death_notifies_coordinator": "onBindingDied" in client and "onConnectionLost" in client,
        "active_request_prevents_idle_close": "if (pending.isEmpty()) close()" in client and "deferred.await()" in client,
        "policy_has_no_alternate_local_route": "FULL_RUNTIME_BLOCKED" in policy and "KOTLIN" not in policy,
        "binding_unit_matrix_green": len(coordinator_cases) == 4 and all(value == "passed" for value in coordinator_cases.values()),
        "side_effect_reconciliation_present": "PythonRuntimeReconciliation.envelope" in engine,
    }
    features = {
        "M02-F01": checks["direct_full_local_engine"] and checks["no_banned_main_source"],
        "M02-F02": checks["no_banned_apk_symbols"],
        "M02-F03": checks["policy_has_no_alternate_local_route"],
        "M02-F04": checks["no_banned_main_source"] and dex_hits["safePythonFallback"] == 0,
        "M02-F05": checks["direct_full_local_engine"] and checks["remote_engine_remains_explicit"],
        "M02-F06": checks["no_banned_main_source"] and checks["no_banned_apk_symbols"],
        "M03-F01": checks["proactive_bind_after_login"],
        "M03-F02": checks["binding_state_machine_complete"] and checks["binding_state_durable_diagnostic"],
        "M03-F03": checks["readiness_before_run_mutation"],
        "M03-F04": checks["binder_death_notifies_coordinator"] and checks["side_effect_reconciliation_present"] and checks["binding_unit_matrix_green"],
        "M03-F05": checks["active_request_prevents_idle_close"],
        "M03-F06": checks["logout_releases_account_binding"] and checks["binding_unit_matrix_green"],
    }
    result = {
        "schema_version": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True).strip()),
        "apk": {"path": str(apk), "sha256": sha256(apk)},
        "banned_symbols": list(BANNED),
        "dex_hits": dex_hits,
        "binding_test_cases": coordinator_cases,
        "checks": checks,
        "features": features,
        "passed": all(checks.values()) and all(features.values()),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"evidence": str(OUTPUT), "passed": result["passed"], "features": features, "failed": [k for k, v in checks.items() if not v]}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
