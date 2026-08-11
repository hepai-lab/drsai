"""Run opt-in real deepseek-v4-flash tool calling on an Android physical device."""
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
RUNNER = "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner"
CLASS = "ai.drsai.remote.LiveModelToolCallingInstrumentedTest"
MARKER = "V156_LIVE_PROVIDER_TOOL_CALLING"


def run(command: list[str], timeout: int = 300) -> str:
    result = subprocess.run(
        command, cwd=ROOT, timeout=timeout, capture_output=True, text=True,
        encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW,
    )
    if result.returncode:
        raise RuntimeError(f"command_failed_{result.returncode}: {' '.join(command)}\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "docs/android/reports/evidence/v1.5.6/live-provider-deepseek-v4-flash.json",
    )
    args = parser.parse_args()
    if args.serial.startswith("emulator-"):
        raise RuntimeError("physical_device_required")
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = str(sdk / "platform-tools/adb.exe")
    base = [adb, "-s", args.serial]
    for apk in (APP_APK, TEST_APK):
        run(base + ["install", "-r", "-d", "-t", str(apk)])
    run(base + ["logcat", "-c"], timeout=30)
    output = run(base + [
        "shell", "am", "instrument", "-w", "-r",
        "-e", "runLiveProvider", "true", "-e", "class", CLASS, RUNNER,
    ], timeout=600)
    if "OK (1 test)" not in output:
        raise RuntimeError(f"live_provider_instrumentation_failed\n{output[-6000:]}")
    logs = run(base + ["logcat", "-d", "-s", f"{MARKER}:I", "*:S"], timeout=30)
    matches = re.findall(rf"{MARKER}:\s*(\{{.*\}})", logs)
    if not matches:
        raise RuntimeError("live_provider_marker_missing")
    observed = json.loads(matches[-1])
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "serial": args.serial,
        "device_kind": "physical",
        "apk_sha256": hashlib.sha256(APP_APK.read_bytes()).hexdigest(),
        **observed,
    }
    report["passed"] = (
        observed.get("passed") is True
        and observed.get("model") == "deepseek-v4-flash"
        and observed.get("status") == "passed"
        and int(observed.get("code", 0)) == 200
        and int(observed.get("tool_calls", 0)) >= 5
    )
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps({
        "passed": report["passed"], "model": report.get("model"),
        "status": report.get("status"), "code": report.get("code"),
        "tool_calls": report.get("tool_calls"),
    }, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
