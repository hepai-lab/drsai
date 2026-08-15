from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m01-f06-upgrade-compatibility.json"
APP_APK = ANDROID / "app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.7.apk"
TEST_APK = ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
PACKAGE = "ai.drsai.remote.debug"
TEST_CLASS = "ai.drsai.remote.P10UpgradeCompatibilityInstrumentedTest"


def run(command: list[str], timeout: int = 600) -> str:
    result = subprocess.run(
        command, cwd=ROOT, timeout=timeout, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    output = result.stdout + result.stderr
    if result.returncode:
        raise RuntimeError(f"command_failed:{result.returncode}\n{output[-8000:]}")
    return output


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    options = parser.parse_args()
    adb = Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"
    for path in (adb, APP_APK, TEST_APK):
        if not path.is_file():
            raise FileNotFoundError(path)
    base = [str(adb), "-s", options.serial]
    api = int(run(base + ["shell", "getprop", "ro.build.version.sdk"], 30).strip())
    for apk in (APP_APK, TEST_APK):
        run(base + ["install", "-r", "-t", str(apk)], 300)
    runners = [
        line.removeprefix("instrumentation:").split(" (target=")[0]
        for line in run(base + ["shell", "pm", "list", "instrumentation"], 30).splitlines()
        if PACKAGE in line
    ]
    if len(runners) != 1:
        raise RuntimeError(f"instrumentation_runner_invalid:{runners}")
    output = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "class", TEST_CLASS, runners[0],
    ], 600)
    expected = {
        "v1.5.5": "v155Schema11SnapshotUpgradesWithoutDataLossOrDuplicateSetup",
        "v1.5.6": "v156Schema13SnapshotUpgradesWithoutDataLossOrDuplicateSetup",
    }
    tests = {
        version: {
            "source_schema": 11 if version == "v1.5.5" else 13,
            "target_schema": 16,
            "test": test,
            "passed": test in output and re.search(rf"test={re.escape(test)}[\s\S]*?STATUS_CODE: 0", output) is not None,
        }
        for version, test in expected.items()
    }
    preserved = [
        "conversations_and_messages", "oaep", "model_configuration", "credential_reference",
        "saf_workspace_reference", "memory", "tool_artifact", "setup_completion_without_duplicate_wizard",
    ]
    passed = "OK (2 tests)" in output and "FAILURES!!!" not in output and all(row["passed"] for row in tests.values())
    report = {
        "schema_version": "opendrsai.p10-upgrade-compatibility-result/1",
        "feature_id": "M01-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "environment": {"serial": options.serial, "api": api, "kind": "emulator_preacceptance"},
        "upgrade_paths": tests,
        "preserved_capabilities": {name: passed for name in preserved},
        "fail_closed": True,
        "provenance": {
            "app_apk_sha256": sha256(APP_APK),
            "test_apk_sha256": sha256(TEST_APK),
            "instrumented_test_sha256": sha256(
                ANDROID / "app/src/androidTest/java/ai/drsai/remote/P10UpgradeCompatibilityInstrumentedTest.kt"
            ),
        },
        "instrumentation_summary": "OK (2 tests)" if passed else output[-4000:],
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": passed, "upgrade_paths": tests, "preserved": len(preserved)}, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
