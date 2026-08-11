"""Run the Android P9 M09-F06 two-model statistical gate on one physical arm64 device."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
PYTHON_PACKAGE = ROOT / "cores/python/packages/drsai/src"
SUITE_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-tool-selection-v1.json"
POLICY_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-real-model-statistical-gate-v1.json"
DEFAULT_OUTPUT = ROOT / "docs/android/reports/evidence/p9/m09-f06-real-model-statistics.json"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.P9NaturalToolSelectionInstrumentedTest"
DEVICE_OUTPUT = "p9-m04-f06-natural-tool-selection-observations.json"

sys.path.insert(0, str(PYTHON_PACKAGE))
from drsai.backend.runtime.real_model_statistics import (  # noqa: E402
    evaluate_real_model_statistics,
    load_real_model_policy,
)
from drsai.backend.runtime.tool_selection_eval import load_tool_selection_suite  # noqa: E402


def run(command: list[str], *, timeout: int = 300) -> str:
    completed = subprocess.run(
        command, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}\n{completed.stdout[-8000:]}")
    return completed.stdout


def adb(adb_path: Path, serial: str, *arguments: str, timeout: int = 300) -> str:
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
    physical = prop("ro.kernel.qemu") != "1" and not serial.startswith("emulator-")
    if state != "device" or not physical or not abi.startswith("arm64"):
        raise RuntimeError(f"physical_arm64_gate_failed:state={state}:physical={physical}:abi={abi}")
    fingerprint = prop("ro.build.fingerprint")
    return {
        "kind": "physical_device",
        "device_id_sha256": hashlib.sha256(f"p9-m09-f06\0{serial}\0{fingerprint}".encode()).hexdigest(),
        "manufacturer": prop("ro.product.manufacturer"), "model": prop("ro.product.model"),
        "api": int(prop("ro.build.version.sdk")), "abi": abi,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk_default = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--adb", type=Path, default=sdk_default / "platform-tools/adb.exe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--app-apk", type=Path)
    parser.add_argument("--test-apk", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--timeout-seconds-per-model", type=int, default=7200)
    options = parser.parse_args()

    suite = load_tool_selection_suite(SUITE_PATH)
    policy = load_real_model_policy(POLICY_PATH)
    if int(suite["minimum_attempts_per_case"]) != int(policy["minimum_attempts_per_case"]):
        raise RuntimeError("real_model_attempt_policy_drift")
    app_apk = options.app_apk or find_single(ANDROID / "app/build/outputs/apk/debug", "*.apk")
    test_apk = options.test_apk or find_single(ANDROID / "app/build/outputs/apk/androidTest/debug", "*.apk")
    for path in (options.adb, app_apk, test_apk):
        if not path.is_file():
            raise FileNotFoundError(path)
    environment = device_identity(options.adb, options.serial)
    if not options.skip_install:
        # Preserve the user's encrypted provider configuration. Never use uninstall or pm clear here.
        adb(options.adb, options.serial, "install", "-r", "-t", str(app_apk.resolve()), timeout=300)
        adb(options.adb, options.serial, "install", "-r", "-t", str(test_apk.resolve()), timeout=300)

    started_at = datetime.now(UTC).isoformat()
    observations_by_model: dict[str, dict] = {}
    for model in policy["candidate_models"]:
        instrumentation = adb(
            options.adb, options.serial, "shell", "am", "instrument", "-w", "-r",
            "-e", "runP9NaturalToolSelection", "true", "-e", "p9Model", model,
            "-e", "class", TEST_CLASS, RUNNER, timeout=options.timeout_seconds_per_model,
        )
        if "OK (1 test)" not in instrumentation or "FAILURES!!!" in instrumentation:
            raise RuntimeError(f"real_model_instrumentation_failed:{model}\n{instrumentation[-8000:]}")
        raw = adb(
            options.adb, options.serial, "exec-out", "run-as", PACKAGE,
            "cat", f"files/{DEVICE_OUTPUT}", timeout=60,
        )
        document = json.loads(raw)
        if document.get("model") != model or document.get("suite_id") != suite["suite_id"]:
            raise RuntimeError(f"real_model_observation_identity_invalid:{model}")
        observations_by_model[model] = document

    scored = evaluate_real_model_statistics(suite, policy, observations_by_model)
    completed_at = datetime.now(UTC).isoformat()
    report = {
        **scored, "feature_id": "M09-F06", "generated_at": completed_at,
        "provenance": {
            "started_at": started_at, "completed_at": completed_at, "runner": RUNNER,
            "test_class": TEST_CLASS, "app_apk": app_apk.name, "app_apk_sha256": sha256(app_apk),
            "test_apk": test_apk.name, "test_apk_sha256": sha256(test_apk),
        },
        "environment": environment,
        "runtime_by_model": {
            model: {key: document.get(key) for key in (
                "provider", "provider_id", "model", "model_id", "model_route_sha256", "temperature",
                "attempts_per_case", "tool_manifest_sha256", "host_capabilities_sha256", "kernel_id",
                "kernel_version", "kernel_sha256", "prompt_version", "prompt_sha256", "app_version", "application_id",
            )}
            for model, document in observations_by_model.items()
        },
        "raw_observations_by_model": {
            model: document["observations"] for model, document in observations_by_model.items()
        },
        "source_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): sha256(path)
            for path in (SUITE_PATH, POLICY_PATH, Path(__file__),
                         ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime/real_model_statistics.py",
                         ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/P9NaturalToolSelectionInstrumentedTest.kt")
        },
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "feature_id": report["feature_id"], "passed": report["passed"],
        "raw_counts": report["raw_counts"], "aggregate": report["aggregate"],
        "output": str(options.output),
    }, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
