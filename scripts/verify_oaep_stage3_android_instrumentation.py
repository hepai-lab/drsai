"""Run the OAEP Stage 3 Android Room/instrumentation gate on an emulator.

This is local device evidence, not the physical Android real-device E2E.  It
starts or reuses an emulator, runs the OAEP Room/session cache androidTest, and
validates the produced JUnit XML.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps" / "android"
DEFAULT_CLASS = "ai.drsai.remote.RemoteSessionSyncStoreTest"


def sdk_root() -> Path:
    for raw in (
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        os.environ.get("LOCALAPPDATA") and str(Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk"),
        str(Path.home() / "AppData" / "Local" / "Android" / "Sdk"),
    ):
        if raw and (Path(raw) / "platform-tools").is_dir():
            return Path(raw)
    raise RuntimeError("android_sdk_missing")


def tool_paths() -> dict[str, Path]:
    sdk = sdk_root()
    paths = {
        "adb": sdk / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"),
        "emulator": sdk / "emulator" / ("emulator.exe" if os.name == "nt" else "emulator"),
        "gradle": ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew"),
        "java_home": Path(os.environ.get("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr")),
    }
    for key, path in paths.items():
        if key == "java_home":
            if not (path / "bin" / ("java.exe" if os.name == "nt" else "java")).is_file():
                raise RuntimeError("java_home_missing")
        elif not path.is_file():
            raise RuntimeError(f"android_tool_missing:{key}")
    return paths


def run(command: list[str], *, cwd: Path = ROOT, env: dict[str, str] | None = None, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "command_failed:"
            + " ".join(command[:3])
            + ":"
            + (completed.stdout + completed.stderr)[-2000:]
        )
    return completed


def android_env(java_home: Path) -> dict[str, str]:
    avd_home = Path.home() / ".android" / "avd"
    return {
        **os.environ,
        "JAVA_HOME": str(java_home),
        "ANDROID_AVD_HOME": str(avd_home),
    }


def connected_devices(adb: Path) -> list[str]:
    output = run([str(adb), "devices"], timeout=30).stdout
    devices = []
    for line in output.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            devices.append(parts[0])
    return devices


def avd_names(emulator: Path, env: dict[str, str]) -> list[str]:
    return [
        line.strip()
        for line in run([str(emulator), "-list-avds"], env=env, timeout=30).stdout.splitlines()
        if line.strip()
    ]


def ensure_emulator(adb: Path, emulator: Path, env: dict[str, str], avd: str, serial: str) -> subprocess.Popen[str] | None:
    if serial in connected_devices(adb):
        return None
    names = avd_names(emulator, env)
    if avd not in names:
        raise RuntimeError("avd_missing:" + avd)
    port = serial.removeprefix("emulator-")
    process = subprocess.Popen(
        [
            str(emulator), "-avd", avd, "-port", port, "-no-window", "-no-audio",
            "-no-snapshot-save", "-gpu", "swiftshader_indirect",
        ],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            booted = run(
                [str(adb), "-s", serial, "shell", "getprop", "sys.boot_completed"],
                timeout=10,
            ).stdout.strip()
            if booted == "1":
                return process
        except RuntimeError:
            pass
        time.sleep(3)
    shutdown_emulator(adb, serial, process)
    raise RuntimeError("emulator_boot_timeout")


def shutdown_emulator(adb: Path, serial: str, process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    subprocess.run(
        [str(adb), "-s", serial, "shell", "reboot", "-p"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def latest_junit() -> Path:
    root = ANDROID / "app" / "build" / "outputs" / "androidTest-results" / "connected" / "debug"
    files = sorted(root.glob("TEST-*.xml"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not files:
        raise RuntimeError("android_junit_missing")
    return files[0]


def parse_junit(path: Path, expected_class: str) -> dict[str, Any]:
    root = ET.parse(path).getroot()
    tests = int(root.attrib.get("tests", "0"))
    failures = int(root.attrib.get("failures", "0"))
    errors = int(root.attrib.get("errors", "0"))
    cases = [
        item.attrib.get("name", "")
        for item in root.findall("testcase")
        if item.attrib.get("classname") == expected_class
    ]
    if tests <= 0 or failures or errors or not cases:
        raise RuntimeError("android_junit_failed")
    try:
        junit_path = str(path.relative_to(ROOT))
    except ValueError:
        junit_path = str(path)
    return {
        "tests": tests,
        "failures": failures,
        "errors": errors,
        "testcases": cases,
        "junit": junit_path,
    }


def run_gate(avd: str, serial: str, test_class: str, keep_emulator: bool) -> dict[str, Any]:
    tools = tool_paths()
    env = android_env(tools["java_home"])
    started = ensure_emulator(tools["adb"], tools["emulator"], env, avd, serial)
    try:
        run([str(tools["gradle"]), "--console=plain", ":app:kaptDebugKotlin", "--rerun-tasks"], cwd=ANDROID, env=env, timeout=180)
        run(
            [
                str(tools["gradle"]), "--console=plain", ":app:connectedDebugAndroidTest",
                f"-Pandroid.testInstrumentationRunnerArguments.class={test_class}",
            ],
            cwd=ANDROID,
            env=env,
            timeout=300,
        )
        junit = parse_junit(latest_junit(), test_class)
        return {
            "schema_version": 1,
            "protocol": "oaep/1",
            "passed": True,
            "evidence_kind": "emulator_instrumentation",
            "avd": avd,
            "serial": serial,
            **junit,
        }
    finally:
        if not keep_emulator:
            shutdown_emulator(tools["adb"], serial, started)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--avd", default="OpenDrSai_API_35")
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--class", dest="test_class", default=DEFAULT_CLASS)
    parser.add_argument("--keep-emulator", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run_gate(args.avd, args.serial, args.test_class, args.keep_emulator)
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
