from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"


def run(command: list[str], *, timeout: int = 240, input_text: str | None = None) -> str:
    return subprocess.run(
        command, check=True, timeout=timeout, input=input_text, text=True,
        encoding="utf-8", errors="replace", stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout


def adb(adb_path: Path, serial: str, *args: str, timeout: int = 120) -> str:
    return run([str(adb_path), "-s", serial, *args], timeout=timeout)


def wait_boot(adb_path: Path, serial: str, timeout_seconds: int = 180) -> None:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            if adb(adb_path, serial, "shell", "getprop", "sys.boot_completed", timeout=10).strip() == "1":
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(f"emulator_boot_timeout:{serial}")


def run_store_suite(adb_path: Path, serial: str, app_apk: Path, test_apk: Path) -> dict[str, object]:
    adb(adb_path, serial, "install", "-r", "-t", str(app_apk), timeout=180)
    adb(adb_path, serial, "install", "-r", "-t", str(test_apk), timeout=180)
    started = time.monotonic()
    output = adb(
        adb_path, serial, "shell", "am", "instrument", "-w", "-r", "-e", "class",
        "ai.drsai.remote.AndroidOaepStoreTest",
        "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
        timeout=180,
    )
    if "OK (11 tests)" not in output:
        raise RuntimeError(f"device_matrix_suite_failed:{serial}:\n{output[-4000:]}")
    return {
        "serial": serial,
        "api": int(adb(adb_path, serial, "shell", "getprop", "ro.build.version.sdk").strip()),
        "abi": adb(adb_path, serial, "shell", "getprop", "ro.product.cpu.abi").strip(),
        "model": adb(adb_path, serial, "shell", "getprop", "ro.product.model").strip(),
        "tests": 11,
        "failures": 0,
        "duration_seconds": round(time.monotonic() - started, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 8 Android Agent Runtime OAEP device matrix")
    parser.add_argument("--physical-serial", required=True)
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/android/reports/evidence/android-agent-runtime-device-matrix.json"),
    )
    args = parser.parse_args()
    os.environ.setdefault("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr")
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb_path = sdk / "platform-tools/adb.exe"
    emulator = sdk / "emulator/emulator.exe"
    avdmanager = sdk / "cmdline-tools/latest/bin/avdmanager.bat"
    app_apk = next((ANDROID / "app/build/outputs/apk/debug").glob("OpenDrSai-Android-*.apk"))
    test_apk = next((ANDROID / "app/build/outputs/apk/androidTest/debug").glob("*.apk"))
    devices: list[dict[str, object]] = []

    existing = set(run([str(emulator), "-list-avds"]).splitlines())
    for api in (26, 30, 35):
        avd_name = f"drsai_stage8_api{api}"
        if avd_name not in existing:
            run([
                str(avdmanager), "create", "avd", "--force", "--name", avd_name,
                "--package", f"system-images;android-{api};google_apis;x86_64",
                "--device", "pixel_5",
            ], input_text="no\n")
        process = subprocess.Popen(
            [str(emulator), "-avd", avd_name, "-port", "5554", "-no-window", "-no-audio",
             "-no-boot-anim", "-wipe-data", "-gpu", "swiftshader_indirect"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        try:
            wait_boot(adb_path, "emulator-5554")
            row = run_store_suite(adb_path, "emulator-5554", app_apk, test_apk)
            if row["api"] != api or row["abi"] != "x86_64":
                raise RuntimeError(f"device_matrix_identity_mismatch:{row}")
            row["kind"] = "emulator"
            devices.append(row)
        finally:
            try:
                adb(adb_path, "emulator-5554", "emu", "kill", timeout=20)
            except Exception:
                process.terminate()
            try:
                process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
            time.sleep(2)

    physical = run_store_suite(adb_path, args.physical_serial, app_apk, test_apk)
    if physical["api"] != 36 or not str(physical["abi"]).startswith("arm64"):
        raise RuntimeError(f"physical_device_identity_mismatch:{physical}")
    physical["kind"] = "physical"
    devices.append(physical)
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "apk": app_apk.name,
        "devices": devices,
        "checks": {
            "api_26_30_35_36": {int(item["api"]) for item in devices} == {26, 30, 35, 36},
            "x86_64": any(item["abi"] == "x86_64" for item in devices),
            "arm64": any(str(item["abi"]).startswith("arm64") for item in devices),
            "physical_device": any(item["kind"] == "physical" for item in devices),
            "zero_failures": all(item["failures"] == 0 for item in devices),
        },
    }
    report["passed"] = all(report["checks"].values())
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
