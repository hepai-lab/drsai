from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

from accept_android_agent_runtime_device_matrix import adb, run, wait_boot

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
TEST_CLASSES = ",".join(
    (
        "ai.drsai.remote.AndroidOaepStoreTest",
        "ai.drsai.remote.PythonRuntimeServiceTest",
        "ai.drsai.remote.FullRuntimeToolRegistryInstrumentedTest",
    )
)
EXPECTED_TESTS = 17


def suite(adb_path: Path, serial: str, app_apk: Path, test_apk: Path) -> dict[str, object]:
    adb(adb_path, serial, "install", "-r", "-t", str(app_apk), timeout=240)
    adb(adb_path, serial, "install", "-r", "-t", str(test_apk), timeout=240)
    started = time.monotonic()
    output = adb(
        adb_path,
        serial,
        "shell",
        "am",
        "instrument",
        "-w",
        "-r",
        "-e",
        "class",
        TEST_CLASSES,
        "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
        timeout=600,
    )
    if f"OK ({EXPECTED_TESTS} tests)" not in output:
        raise RuntimeError(f"device_matrix_suite_failed:{serial}:\n{output[-4000:]}")
    return {
        "serial": serial,
        "api": int(adb(adb_path, serial, "shell", "getprop", "ro.build.version.sdk").strip()),
        "abi": adb(adb_path, serial, "shell", "getprop", "ro.product.cpu.abi").strip(),
        "model": adb(adb_path, serial, "shell", "getprop", "ro.product.model").strip(),
        "tests": EXPECTED_TESTS,
        "failures": 0,
        "duration_seconds": round(time.monotonic() - started, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Android v1.5.6 Full Runtime device matrix")
    parser.add_argument("--physical-serial")
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/android/reports/evidence/v1.5.6/device-matrix.json"),
    )
    args = parser.parse_args()
    os.environ.setdefault("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr")
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb_path = sdk / "platform-tools/adb.exe"
    emulator = sdk / "emulator/emulator.exe"
    app_apk = ANDROID / "app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
    test_apk = ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    if not app_apk.is_file() or not test_apk.is_file():
        raise FileNotFoundError("v1.5.6_debug_apks_missing")

    devices: list[dict[str, object]] = []
    available = set(run([str(emulator), "-list-avds"]).splitlines())
    for api, port in ((26, 5560), (30, 5562), (35, 5564)):
        serial = f"emulator-{port}"
        # `adb emu kill` acknowledges before the process and console port are fully gone.
        try:
            adb(adb_path, serial, "emu", "kill", timeout=10)
        except Exception:
            pass
        for _ in range(60):
            if serial not in run([str(adb_path), "devices"], timeout=10):
                break
            time.sleep(0.5)
        else:
            raise RuntimeError(f"stale_{serial}_did_not_exit")
        avd_name = f"drsai_stage8_api{api}"
        if avd_name not in available:
            raise RuntimeError(f"required_avd_missing:{avd_name}")
        process = subprocess.Popen(
            [
                str(emulator), "-avd", avd_name, "-port", str(port), "-no-window", "-no-audio",
                "-no-boot-anim", "-no-snapshot", "-wipe-data", "-gpu", "swiftshader_indirect",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        try:
            wait_boot(adb_path, serial, timeout_seconds=240)
            row = suite(adb_path, serial, app_apk, test_apk)
            if row["api"] != api or row["abi"] != "x86_64":
                raise RuntimeError(f"device_matrix_identity_mismatch:{row}")
            row["kind"] = "emulator"
            devices.append(row)
        finally:
            try:
                adb(adb_path, serial, "emu", "kill", timeout=20)
            except Exception:
                process.terminate()
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
            time.sleep(2)

    if args.physical_serial:
        physical = suite(adb_path, args.physical_serial, app_apk, test_apk)
        if physical["api"] != 36 or not str(physical["abi"]).startswith("arm64"):
            raise RuntimeError(f"physical_device_identity_mismatch:{physical}")
        physical["kind"] = "physical"
        devices.append(physical)

    checks = {
        "api_26_30_35": {int(item["api"]) for item in devices} >= {26, 30, 35},
        "x86_64": any(item["abi"] == "x86_64" for item in devices),
        "api_36_arm64_physical": any(
            item["kind"] == "physical" and item["api"] == 36 and str(item["abi"]).startswith("arm64")
            for item in devices
        ),
        "zero_failures": all(item["failures"] == 0 for item in devices),
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "apk": app_apk.name,
        "apk_sha256": hashlib.sha256(app_apk.read_bytes()).hexdigest(),
        "devices": devices,
        "checks": checks,
        "passed": all(checks.values()),
        "status": "passed" if all(checks.values()) else "awaiting_physical_device",
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if checks["api_26_30_35"] and checks["zero_failures"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
