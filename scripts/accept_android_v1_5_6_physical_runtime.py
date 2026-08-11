"""Collect fail-closed v1.5.6 physical default-binding and fault-recovery evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
APP_APK = ANDROID / "app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
TEST_APK = ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.FullRuntimePhysicalAcceptanceTest"
DEFAULT_MARKER = "V156_PHYSICAL_DEFAULT_BINDING"
FAULT_MARKER = "V156_PHYSICAL_FAULT_RECOVERY"


def run(command: list[str], timeout: int = 300) -> str:
    result = subprocess.run(
        command, cwd=ROOT, timeout=timeout, capture_output=True, text=True,
        encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode:
        raise RuntimeError(f"command_failed_{result.returncode}: {' '.join(command)}\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


def instrument(base: list[str], method: str) -> str:
    output = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "class",
        f"{TEST_CLASS}#{method}", "-e", "runPhysicalRuntime", "true", RUNNER,
    ])
    if "OK (1 test)" not in output:
        raise RuntimeError(f"physical_acceptance_failed:{method}\n{output[-5000:]}")
    return output


def marker(base: list[str], name: str) -> dict[str, object]:
    logs = run(base + ["logcat", "-d", "-s", f"{name}:I", "*:S"], timeout=30)
    matches = re.findall(rf"{name}:\s*(\{{.*\}})", logs)
    if not matches:
        raise RuntimeError(f"physical_acceptance_marker_missing:{name}")
    return json.loads(matches[-1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument(
        "--output-dir", type=Path,
        default=ROOT / "docs/android/reports/evidence/v1.5.6",
    )
    args = parser.parse_args()
    if args.serial.startswith("emulator-"):
        raise RuntimeError("physical_device_required")
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = str(sdk / "platform-tools/adb.exe")
    base = [adb, "-s", args.serial]
    for apk in (APP_APK, TEST_APK):
        run(base + ["install", "-r", "-d", "-t", str(apk)])
    run(base + ["shell", "input", "keyevent", "KEYCODE_WAKEUP"], timeout=30)
    run(base + ["shell", "wm", "dismiss-keyguard"], timeout=30)
    run(base + ["logcat", "-c"], timeout=30)

    instrument(base, "defaultFullRuntimeBindingIsReadyAndObservable")
    default = marker(base, DEFAULT_MARKER)
    instrument(base, "binderPythonAndNetworkFaultsRemainOnFullRuntime")
    instrument(base, "seedProcessReclaimCheckpoint")
    # A separate instrumentation process after force-stop proves that recovery
    # does not depend on in-memory state from the seed process.
    run(base + ["shell", "am", "force-stop", PACKAGE], timeout=30)
    instrument(base, "verifyProcessReclaimResumesSameRun")
    faults = marker(base, FAULT_MARKER)

    apk_hash = hashlib.sha256(APP_APK.read_bytes()).hexdigest()
    common = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "serial": args.serial,
        "device_kind": "physical",
        "apk": APP_APK.name,
        "apk_sha256": apk_hash,
    }
    default_gates = {
        "full_runtime_enabled": default.get("full_runtime_enabled") is True,
        "kotlin_lite_disabled": default.get("kotlin_lite_enabled") is False,
        "runtime_ready": default.get("binding_state") == "READY" and default.get("python_status") == "python_runtime_ready",
        "separate_runtime_process": int(default.get("runtime_pid", 0)) > 0 and default.get("runtime_pid") != default.get("main_pid"),
        "starts_positive": int(default.get("starts_delta", 0)) > 0,
        "binds_positive": int(default.get("bind_attempts_delta", 0)) > 0 and int(default.get("bind_successes_delta", 0)) > 0,
        "zero_kotlin_fallbacks": int(default.get("safe_fallbacks_delta", -1)) == 0,
    }
    default_report = {**common, "observed": default, "gates": default_gates, "passed": all(default_gates.values())}
    fault_gates = {
        "bind_death_recovers": faults.get("bind_death") is True,
        "python_crash_recovers": faults.get("python_crash") is True,
        "network_interruption_explicit": faults.get("network_interruption") is True,
        "process_reclaim_resumes": faults.get("process_reclaim") is True and faults.get("same_run_resumed") is True,
        "same_run_id": faults.get("run_id") == "physical-process-reclaim-run",
        "oaep_resume_event": faults.get("resume_event") == "run.recovered"
        and faults.get("normalized_resume_event") == "event.run.resumed"
        and faults.get("resume_model_request") is True,
        "kotlin_fallback_unavailable": faults.get("kotlin_fallback_available") is False,
    }
    fault_report = {**common, "observed": faults, "gates": fault_gates, "passed": all(fault_gates.values())}
    args.output_dir.resolve().mkdir(parents=True, exist_ok=True)
    outputs = {
        "physical-default-binding-api36.json": default_report,
        "physical-fault-recovery-api36.json": fault_report,
    }
    for name, report in outputs.items():
        (args.output_dir.resolve() / name).write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8",
        )
    summary = {name: report["passed"] for name, report in outputs.items()}
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if all(summary.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
