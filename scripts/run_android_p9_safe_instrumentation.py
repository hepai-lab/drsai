"""Run Android instrumentation with upgrade installs, preserving real-device app data."""

from __future__ import annotations

import argparse
import html
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"


def run(command: list[str], timeout: int = 600) -> str:
    completed = subprocess.run(
        command, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}\n{completed.stdout[-8000:]}")
    return completed.stdout


def adb(adb_path: Path, serial: str, *args: str, timeout: int = 600) -> str:
    return run([str(adb_path), "-s", serial, *args], timeout)


def newest(directory: Path, pattern: str) -> Path:
    values = sorted(directory.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
    if not values:
        raise FileNotFoundError(f"apk_missing:{directory}:{pattern}")
    return values[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--adb", type=Path, default=sdk / "platform-tools/adb.exe")
    parser.add_argument("--serial", action="append", required=True)
    parser.add_argument("--class", dest="test_class", required=True)
    parser.add_argument("--arg", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=int, default=900)
    options = parser.parse_args()
    app_apk = newest(ANDROID / "app/build/outputs/apk/debug", "*.apk")
    test_apk = newest(ANDROID / "app/build/outputs/apk/androidTest/debug", "*.apk")
    arguments: list[str] = []
    for raw in options.arg:
        key, separator, value = raw.partition("=")
        if not separator or not key:
            raise ValueError(f"instrumentation_argument_invalid:{raw}")
        arguments += ["-e", key, value]

    device_cases: dict[str, list[str]] = {}
    outputs: list[str] = []
    for serial in options.serial:
        # Upgrade-only installation is the critical invariant: never uninstall and never pm clear.
        adb(options.adb, serial, "install", "-r", "-t", str(app_apk.resolve()), timeout=300)
        adb(options.adb, serial, "install", "-r", "-t", str(test_apk.resolve()), timeout=300)
        output = adb(
            options.adb, serial, "shell", "am", "instrument", "-w", "-r",
            *arguments, "-e", "class", options.test_class, RUNNER,
            timeout=options.timeout_seconds,
        )
        outputs.append(output)
        if "FAILURES!!!" in output or "INSTRUMENTATION_FAILED" in output:
            raise RuntimeError(f"instrumentation_failed:{serial}\n{output[-8000:]}")
        match = re.search(r"OK \((\d+) tests?\)", output)
        if not match:
            raise RuntimeError(f"instrumentation_result_missing:{serial}\n{output[-8000:]}")
        cases = re.findall(r"INSTRUMENTATION_STATUS: test=([^\r\n]+)", output)
        cases = list(dict.fromkeys(value.strip() for value in cases))
        if len(cases) != int(match.group(1)):
            raise RuntimeError(f"instrumentation_case_count_mismatch:{serial}:{len(cases)}:{match.group(1)}")
        device_cases[serial] = cases
    unique_case_sets = {tuple(values) for values in device_cases.values()}
    if len(unique_case_sets) != 1:
        raise RuntimeError("instrumentation_device_case_drift")
    cases = next(iter(unique_case_sets))
    result_dir = ANDROID / "app/build/outputs/androidTest-results/connected/debug"
    result_dir.mkdir(parents=True, exist_ok=True)
    suite_name = options.test_class.split("#", 1)[0]
    output_path = result_dir / f"TEST-{suite_name}.xml"
    timestamp = datetime.now(UTC).isoformat()
    properties = "".join(
        f'<property name="device.{index}" value="{html.escape(serial)}"/>'
        for index, serial in enumerate(options.serial)
    )
    testcases = "".join(
        f'<testcase name="{html.escape(case)}" classname="{html.escape(options.test_class)}" time="0"/>'
        for case in cases
    )
    xml = (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuite name="{html.escape(suite_name)}" tests="{len(cases)}" failures="0" errors="0" skipped="0" timestamp="{timestamp}">'
        f'<properties>{properties}</properties>{testcases}</testsuite>\n'
    )
    output_path.write_text(xml, encoding="utf-8")
    # Compatibility alias for older acceptance scripts which sort all XML paths lexicographically.
    (result_dir / "TEST-zz-p9-safe-latest.xml").write_text(xml, encoding="utf-8")
    print({"passed": True, "class": options.test_class, "tests": len(cases), "devices": len(options.serial), "output": str(output_path)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
