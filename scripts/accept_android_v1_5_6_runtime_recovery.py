from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APK = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
MARKER = "V156_FULL_RUNTIME_BIND_KILL"


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect v1.5.6 bind/kill/rebind acceptance evidence")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--collect-only", action="store_true")
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/android/reports/evidence/v1.5.6/recovery.json"),
    )
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = sdk / "platform-tools/adb.exe"
    if not args.collect_only:
        app_apk = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
        test_apk = ROOT / "apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
        for apk in (app_apk, test_apk):
            subprocess.run(
                [str(adb), "-s", args.serial, "install", "-r", "-d", "-t", str(apk)],
                check=True, capture_output=True, timeout=240, creationflags=subprocess.CREATE_NO_WINDOW,
            )
        subprocess.run(
            [str(adb), "-s", args.serial, "logcat", "-c"], check=True,
            capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        for batch in range(10):
            if batch > 0:
                time.sleep(2)
            subprocess.run(
                [str(adb), "-s", args.serial, "shell", "am", "force-stop", "ai.drsai.remote.debug"],
                check=True, capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            completed = subprocess.run(
                [
                    str(adb), "-s", args.serial, "shell", "am", "instrument", "-w", "-r",
                    "-e", "class", "ai.drsai.remote.FullRuntimeBindKillStressTest",
                    "-e", "cycles", "10", "-e", "batch", str(batch),
                    "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
                ],
                check=True, text=True, encoding="utf-8", errors="replace", capture_output=True,
                timeout=180, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            if "OK (1 test)" not in completed.stdout:
                raise RuntimeError(f"v156_bind_kill_batch_failed:{batch}:\n{completed.stdout[-4000:]}")
    logcat = subprocess.run(
        [str(adb), "-s", args.serial, "logcat", "-d", "-s", f"{MARKER}:I", "*:S"],
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout
    matches = re.findall(rf"{MARKER}:\s*(\{{.*\}})", logcat)
    if not matches:
        raise RuntimeError("v156_bind_kill_metrics_missing")
    batches = [json.loads(value) for value in matches]
    if len(batches) != 10 or sorted(item.get("batch") for item in batches) != list(range(10)):
        raise RuntimeError("v156_bind_kill_batch_evidence_incomplete")
    bind_samples = [value for item in batches for value in item.get("bind_samples_ms", [])]
    event_samples = [value for item in batches for value in item.get("first_event_samples_ms", [])]
    percentile95 = lambda values: sorted(values)[max(0, (len(values) * 95 + 99) // 100 - 1)]
    metrics = {
        "batches": len(batches),
        "cycles": sum(item.get("cycles", 0) for item in batches),
        "permanent_hangs": sum(item.get("permanent_hangs", 0) for item in batches),
        "duplicate_runtime_processes": sum(item.get("duplicate_runtime_processes", 0) for item in batches),
        "bind_p95_ms": percentile95(bind_samples),
        "first_event_p95_ms": percentile95(event_samples),
        "bind_samples_ms": bind_samples,
        "first_event_samples_ms": event_samples,
    }
    gates = {
        "cycles_100": metrics.get("cycles") == 100,
        "zero_permanent_hangs": metrics.get("permanent_hangs") == 0,
        "zero_duplicate_runtime_processes": metrics.get("duplicate_runtime_processes") == 0,
        "bind_p95_under_2s": metrics.get("bind_p95_ms", 10**9) <= 2_000,
        "first_event_p95_under_5s": metrics.get("first_event_p95_ms", 10**9) <= 5_000,
        "kotlin_fallback_available": False,
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "serial": args.serial,
        "apk": APK.name,
        "apk_sha256": hashlib.sha256(APK.read_bytes()).hexdigest(),
        "metrics": metrics,
        "gates": gates,
        "passed": all(value for key, value in gates.items() if key != "kotlin_fallback_available")
        and gates["kotlin_fallback_available"] is False,
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
