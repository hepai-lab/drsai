from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
BUDGET_PATH = ROOT / "cores/protocol/android-runtime/p9-performance-budget-v1.json"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.PythonRuntimePerformanceTest"


def run(command: list[str], timeout: int = 300) -> str:
    return subprocess.run(
        command, check=True, timeout=timeout, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout


def run_with_retries(command: list[str], timeout: int = 30, attempts: int = 3) -> str:
    """Retry transient adb failures without weakening the final assertion."""
    last_error: subprocess.CalledProcessError | None = None
    for attempt in range(attempts):
        try:
            return run(command, timeout)
        except subprocess.CalledProcessError as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(1)
    assert last_error is not None
    raise last_error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", required=True)
    parser.add_argument("--output", required=True)
    options = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = sdk / "platform-tools/adb.exe"
    app_apk = next((ANDROID / "app/build/outputs/apk/debug").glob("OpenDrSai-Android-*.apk"))
    test_apk = next((ANDROID / "app/build/outputs/apk/androidTest/debug").glob("*.apk"))
    base = [str(adb), "-s", options.serial]
    run(base + ["install", "-r", "-t", str(app_apk.resolve())])
    run(base + ["install", "-r", "-t", str(test_apk.resolve())])
    api_level = int(run(base + ["shell", "getprop", "ro.build.version.sdk"], 30).strip())
    abi = run(base + ["shell", "getprop", "ro.product.cpu.abi"], 30).strip()
    model = run(base + ["shell", "getprop", "ro.product.model"], 30).strip()
    # API 26's host-side `adb logcat -c` can fail to clear the main buffer even
    # on a rooted emulator; executing logcat in the device shell is portable.
    run_with_retries(base + ["shell", "logcat", "-b", "all", "-c"])
    output = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "class", TEST_CLASS, RUNNER,
    ], 600)
    if "OK (1 test)" not in output:
        raise RuntimeError("p9_runtime_performance_instrumentation_failed:\n" + output[-5000:])
    logs = run(base + ["logcat", "-d", "-s", "PythonRuntimePerf:I", "*:S"], 30)
    matches = re.findall(r"PYTHON_RUNTIME_PERF=(\{.*\})", logs)
    if not matches:
        raise RuntimeError("p9_runtime_performance_metrics_missing")
    metrics = json.loads(matches[-1])
    event_logs = run(base + ["logcat", "-d", "-b", "events"], 30)
    anr_count = sum(1 for line in event_logs.splitlines() if "am_anr" in line and PACKAGE in line)
    budget = json.loads(BUDGET_PATH.read_text(encoding="utf-8"))
    limits = budget["limits"]

    def supported_limit(value: int | float, maximum: int | float) -> bool:
        return value < 0 or value <= maximum

    gates = {
        "runtime_cold_start_p95": metrics["cold_start_p95_ms"] <= limits["runtime_cold_start_p95_ms"],
        "runtime_foreground_pss_p95": metrics["foreground_pss_p95_mb"] <= limits["runtime_foreground_pss_p95_mb"],
        "runtime_peak_pss": metrics["peak_pss_mb"] <= limits["runtime_peak_pss_mb"],
        "runtime_cpu_p95": metrics["cpu_p95_percent"] <= limits["runtime_cpu_p95_percent"],
        "local_probe_network_rx": supported_limit(metrics["network_rx_bytes"], limits["local_probe_network_rx_bytes"]),
        "local_probe_network_tx": supported_limit(metrics["network_tx_bytes"], limits["local_probe_network_tx_bytes"]),
        "installed_apk_plus_data": metrics["storage_mb"] <= limits["installed_apk_plus_data_mb"],
        "ten_start_battery_drop": metrics.get("battery_drop_percent") is None or metrics["battery_drop_percent"] <= limits["ten_start_battery_drop_percent"],
        "thermal_status": metrics.get("thermal_status") is None or metrics["thermal_status"] <= limits["maximum_thermal_status"],
        "runtime_process_released": metrics["runtime_release_verified"] is True,
        "anr_zero": anr_count == limits["anr_count"],
    }
    report = {
        "schema_version": 1,
        "feature_id": "M11-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "serial": options.serial,
        "api_level": api_level,
        "abi": abi,
        "model": model,
        "budget_version": budget["budget_version"],
        "budget_sha256": hashlib.sha256(BUDGET_PATH.read_bytes()).hexdigest(),
        "apk": app_apk.name,
        "apk_sha256": hashlib.sha256(app_apk.read_bytes()).hexdigest(),
        "metrics": metrics,
        "anr_count": anr_count,
        "gates": gates,
        "passed": all(gates.values()),
        "source_sha256": {
            "cores/protocol/android-runtime/p9-performance-budget-v1.json": hashlib.sha256(BUDGET_PATH.read_bytes()).hexdigest(),
            "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimePerformanceTest.kt": hashlib.sha256(
                (ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimePerformanceTest.kt").read_bytes()
            ).hexdigest(),
        },
    }
    output_path = Path(options.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "api": api_level, "abi": abi, "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
