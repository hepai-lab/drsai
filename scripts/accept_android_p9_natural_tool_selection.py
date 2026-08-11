"""Run and score the Android P9 M04-F06 natural tool-selection gate."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
PYTHON_PACKAGE = ROOT / "cores/python/packages/drsai/src"
FIXTURE = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-tool-selection-v1.json"
DEFAULT_OUTPUT = ROOT / "docs/android/reports/evidence/p9/m04-f06-natural-tool-selection.json"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.P9NaturalToolSelectionInstrumentedTest"
DEVICE_OUTPUT = "p9-m04-f06-natural-tool-selection-observations.json"

sys.path.insert(0, str(PYTHON_PACKAGE))
from drsai.backend.runtime.tool_selection_eval import (  # noqa: E402
    evaluate_tool_selection_gate,
    load_tool_selection_suite,
    score_tool_selection_attempt,
)


def run(command: list[str], *, timeout: int = 240) -> str:
    completed = subprocess.run(
        command,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}\n{completed.stdout[-6000:]}")
    return completed.stdout


def adb(adb_path: Path, serial: str, *arguments: str, timeout: int = 240) -> str:
    return run([str(adb_path), "-s", serial, *arguments], timeout=timeout)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def find_single(directory: Path, pattern: str) -> Path:
    candidates = sorted(directory.glob(pattern), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError(f"artifact_missing:{directory}:{pattern}")
    return candidates[0]


def device_identity(adb_path: Path, serial: str) -> dict[str, object]:
    def prop(name: str) -> str:
        return adb(adb_path, serial, "shell", "getprop", name, timeout=20).strip()

    state = adb(adb_path, serial, "get-state", timeout=20).strip()
    abi = prop("ro.product.cpu.abi")
    qemu = prop("ro.kernel.qemu")
    physical = qemu != "1" and not serial.startswith("emulator-")
    if state != "device" or not physical or not abi.startswith("arm64"):
        raise RuntimeError(f"physical_arm64_gate_failed:state={state}:physical={physical}:abi={abi}")
    fingerprint = prop("ro.build.fingerprint")
    return {
        "kind": "physical_device",
        "device_id_sha256": hashlib.sha256(f"p9-m04-f06\0{serial}\0{fingerprint}".encode()).hexdigest(),
        "manufacturer": prop("ro.product.manufacturer"),
        "model": prop("ro.product.model"),
        "api": int(prop("ro.build.version.sdk")),
        "abi": abi,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk_default = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--adb", type=Path, default=sdk_default / "platform-tools/adb.exe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--model", default="deepseek-v4-flash")
    parser.add_argument("--app-apk", type=Path)
    parser.add_argument("--test-apk", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=7200)
    options = parser.parse_args()

    suite = load_tool_selection_suite(FIXTURE)
    app_apk = options.app_apk or find_single(ANDROID / "app/build/outputs/apk/debug", "*.apk")
    test_apk = options.test_apk or find_single(ANDROID / "app/build/outputs/apk/androidTest/debug", "*.apk")
    for path in (options.adb, app_apk, test_apk):
        if not path.is_file():
            raise FileNotFoundError(path)
    environment = device_identity(options.adb, options.serial)
    if not options.skip_install:
        # -r preserves the encrypted provider configuration already present on the test device.
        adb(options.adb, options.serial, "install", "-r", "-t", str(app_apk.resolve()), timeout=300)
        adb(options.adb, options.serial, "install", "-r", "-t", str(test_apk.resolve()), timeout=300)

    started_at = datetime.now(UTC).isoformat()
    instrumentation = adb(
        options.adb,
        options.serial,
        "shell", "am", "instrument", "-w", "-r",
        "-e", "runP9NaturalToolSelection", "true",
        "-e", "p9Model", options.model,
        "-e", "class", TEST_CLASS,
        RUNNER,
        timeout=options.timeout_seconds,
    )
    if "OK (1 test)" not in instrumentation or "FAILURES!!!" in instrumentation:
        raise RuntimeError(f"p9_natural_tool_selection_instrumentation_failed\n{instrumentation[-6000:]}")
    raw = adb(
        options.adb,
        options.serial,
        "exec-out", "run-as", PACKAGE, "cat", f"files/{DEVICE_OUTPUT}",
        timeout=60,
    )
    observations = json.loads(raw)
    if observations.get("schema_version") != "opendrsai.p9-natural-tool-selection-observations/1":
        raise RuntimeError("p9_observation_schema_invalid")
    if observations.get("suite_id") != suite["suite_id"]:
        raise RuntimeError("p9_observation_suite_mismatch")

    case_map = {case["id"]: case for case in suite["cases"]}
    scored = []
    for row in observations.get("observations", []):
        case_id = row.get("case_id")
        if case_id not in case_map:
            raise RuntimeError(f"p9_observation_unknown_case:{case_id}")
        scored.append(score_tool_selection_attempt(
            case_map[case_id],
            int(row["attempt"]),
            list(row.get("selected_tools", [])),
            row.get("provider_error"),
        ))
    expected_count = len(case_map) * int(suite["minimum_attempts_per_case"])
    if len(scored) != expected_count:
        raise RuntimeError(f"p9_observation_count_invalid:{len(scored)}:{expected_count}")
    gate = evaluate_tool_selection_gate(suite, scored)
    completed_at = datetime.now(UTC).isoformat()
    report = {
        **gate,
        "feature_id": "M04-F06",
        "generated_at": completed_at,
        "provenance": {
            "started_at": started_at,
            "completed_at": completed_at,
            "runner": RUNNER,
            "test_class": TEST_CLASS,
            "app_apk": app_apk.name,
            "app_apk_sha256": sha256(app_apk),
            "test_apk": test_apk.name,
            "test_apk_sha256": sha256(test_apk),
            "fixture": str(FIXTURE.relative_to(ROOT)).replace("\\", "/"),
            "fixture_sha256": suite["sha256"],
        },
        "environment": environment,
        "runtime": {key: observations.get(key) for key in (
            "provider", "provider_id", "model", "model_id", "temperature",
            "attempts_per_case", "tool_manifest_sha256", "host_capabilities_sha256",
            "kernel_id", "kernel_version", "kernel_sha256", "prompt_version", "prompt_sha256",
            "app_version", "application_id",
        )},
        "raw_observations": observations["observations"],
        "instrumentation_tests": 1,
        "instrumentation_failures": 0,
    }
    # Defensive evidence check: a successful instrumentation shell line alone is never acceptance.
    report["passed"] = bool(gate["passed"] and re.search(r"OK \(1 test\)", instrumentation))
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({
        "feature_id": report["feature_id"],
        "passed": report["passed"],
        "success_rate": report["success_rate"],
        "provider_errors": report["provider_errors"],
        "behavior_attempts": report["behavior_attempts"],
        "output": str(options.output),
    }, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
