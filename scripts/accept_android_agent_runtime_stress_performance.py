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
ANDROID = ROOT / "apps/android"
MARKER = "STAGE8_OAEP_STRESS"


def run(command: list[str], *, timeout: int = 240) -> str:
    return subprocess.run(
        command, check=True, timeout=timeout, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 8 OAEP stress and physical performance gate")
    parser.add_argument("--serial", required=True)
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/android/reports/evidence/android-agent-runtime-stress-performance.json"),
    )
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = sdk / "platform-tools/adb.exe"
    app_apk = next((ANDROID / "app/build/outputs/apk/debug").glob("OpenDrSai-Android-*.apk"))
    test_apk = next((ANDROID / "app/build/outputs/apk/androidTest/debug").glob("*.apk"))
    base = [str(adb), "-s", args.serial]
    run(base + ["install", "-r", "-t", str(app_apk)], timeout=180)
    run(base + ["install", "-r", "-t", str(test_apk)], timeout=180)
    run(base + ["shell", "am", "force-stop", "ai.drsai.remote.debug"], timeout=20)
    run(base + ["shell", "am", "force-stop", "ai.drsai.remote.debug.test"], timeout=20)
    run(base + ["logcat", "-c"], timeout=30)
    output = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "class",
        "ai.drsai.remote.AndroidOaepStage8StressTest",
        "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
    ], timeout=600)
    if "OK (1 test)" not in output:
        raise RuntimeError("stage8_stress_instrumentation_failed:\n" + output[-4000:])
    logs = run(base + ["logcat", "-d", "-s", f"{MARKER}:I", "*:S"], timeout=30)
    matches = re.findall(rf"{MARKER}:\s*(\{{.*\}})", logs)
    if not matches:
        raise RuntimeError("stage8_stress_metrics_missing")
    stress = json.loads(matches[-1])

    cold_start_ms: list[int] = []
    for _ in range(10):
        run(base + ["shell", "input", "keyevent", "224"], timeout=20)
        run(base + ["shell", "wm", "dismiss-keyguard"], timeout=20)
        run(base + ["shell", "am", "force-stop", "ai.drsai.remote.debug"], timeout=20)
        launch = run(base + [
            "shell", "am", "start", "-W", "-n", "ai.drsai.remote.debug/ai.drsai.remote.ExternalEntryActivity",
        ], timeout=30)
        value = re.search(r"(?:TotalTime|WaitTime):\s*(\d+)", launch)
        if not value:
            raise RuntimeError("cold_start_metric_missing")
        cold_start_ms.append(int(value.group(1)))
    pss_output = run(base + ["shell", "dumpsys", "meminfo", "ai.drsai.remote.debug"], timeout=30)
    total = re.search(r"TOTAL\s+(\d+)", pss_output)
    if not total:
        raise RuntimeError("pss_metric_missing")
    pss_mb = int(total.group(1)) / 1024.0
    sorted_cold = sorted(cold_start_ms)
    cold_p95 = sorted_cold[min(len(sorted_cold) - 1, int(len(sorted_cold) * 0.95))]
    gates = {
        "runs_500": stress.get("runs") == 500,
        "tools_50": stress.get("tool_runs") == 50 and stress.get("side_effect_executions") == 50,
        "recoveries_20": stress.get("recovery_runs") == 20,
        "zero_duplicate_side_effects": stress.get("duplicate_side_effects") == 0,
        "zero_data_corruption": stress.get("data_corruption") == 0,
        "zero_permanent_running": stress.get("permanent_running") == 0,
        "cold_start_p95_under_3s": cold_p95 <= 3000,
        "foreground_pss_under_220mb": pss_mb <= 220,
        "database_growth_under_64mb": int(stress.get("database_bytes", 1 << 60)) <= 64 * 1024 * 1024,
        "recovery_p95_under_2s": float(stress.get("recovery_p95_ms", 1e9)) <= 2000,
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "serial": args.serial,
        "apk": app_apk.name,
        "apk_sha256": hashlib.sha256(app_apk.read_bytes()).hexdigest(),
        "stress": stress,
        "performance": {
            "cold_start_ms": cold_start_ms,
            "cold_start_p95_ms": cold_p95,
            "foreground_pss_mb": round(pss_mb, 3),
        },
        "stage7_thresholds": {
            "cold_start_p95_ms": 3000,
            "foreground_pss_mb": 220,
            "database_growth_mb": 64,
            "recovery_p95_ms": 2000,
        },
        "gates": gates,
        "passed": all(gates.values()),
    }
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
