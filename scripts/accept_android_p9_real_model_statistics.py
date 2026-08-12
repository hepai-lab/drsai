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
DEFAULT_M04_OUTPUT = ROOT / "docs/android/reports/evidence/p9/m04-f06-natural-tool-selection.json"
DEFAULT_DRY_RUN_OUTPUT = ROOT / "docs/android/reports/preflight/p9-emulator/p9-physical-device-handoff-dry-run.json"
PACKAGE = "ai.drsai.remote.debug"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.P9NaturalToolSelectionInstrumentedTest"
DEVICE_OUTPUT = "p9-m04-f06-natural-tool-selection-observations.json"

sys.path.insert(0, str(PYTHON_PACKAGE))
from drsai.backend.runtime.real_model_statistics import (  # noqa: E402
    evaluate_real_model_statistics,
    load_real_model_policy,
)
from drsai.backend.runtime.tool_selection_eval import (  # noqa: E402
    evaluate_tool_selection_gate,
    load_tool_selection_suite,
    score_tool_selection_attempt,
)


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


def score_m04_observations(suite: dict, document: dict) -> dict:
    """Score M04 from the flash subset already collected for M09."""
    cases = {case["id"]: case for case in suite["cases"]}
    scored = []
    for row in document["observations"]:
        case_id = row.get("case_id")
        if case_id not in cases:
            raise RuntimeError(f"m04_observation_unknown_case:{case_id}")
        scored.append(score_tool_selection_attempt(
            cases[case_id], int(row["attempt"]), list(row.get("selected_tools", [])), row.get("provider_error"),
        ))
    expected_count = len(cases) * int(suite["minimum_attempts_per_case"])
    if len(scored) != expected_count:
        raise RuntimeError(f"m04_observation_count_invalid:{len(scored)}:{expected_count}")
    return evaluate_tool_selection_gate(suite, scored)


def build_device_handoff_dry_run(
    *, serial: str, adb_path: Path, app_apk: Path, test_apk: Path,
    suite: dict, policy: dict, output: Path, m04_output: Path,
) -> dict[str, object]:
    """Validate the formal handoff without contacting or mutating a device."""
    if not serial.strip() or serial.startswith("emulator-"):
        raise ValueError("physical_device_serial_required_for_dry_run")
    formal_root = (ROOT / "docs/android/reports/evidence/p9").resolve()
    for path in (output.resolve(), m04_output.resolve()):
        if formal_root != path.parent and formal_root not in path.parents:
            raise ValueError("formal_output_path_invalid")
    models = list(policy["candidate_models"])
    attempts = int(policy["minimum_attempts_per_case"])
    case_count = len(suite["cases"])
    return {
        "schema_version": "opendrsai.p9-physical-device-handoff-dry-run/1",
        "evidence_tier": "emulator_preflight",
        "release_evidence": False,
        "passed": True,
        "device_requirements": {
            "serial": serial, "state": "device", "kind": "physical_device", "abi_prefix": "arm64",
            "user_actions": ["authorize_adb", "confirm_zhizengzeng_provider_configuration", "run_formal_command"],
        },
        "artifacts": {
            "app_apk": {"path": str(app_apk.resolve()), "sha256": sha256(app_apk)},
            "test_apk": {"path": str(test_apk.resolve()), "sha256": sha256(test_apk)},
        },
        "inputs": {
            "adb": str(adb_path.resolve()),
            "suite": str(SUITE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "suite_sha256": suite["sha256"],
            "policy": str(POLICY_PATH.relative_to(ROOT)).replace("\\", "/"),
            "policy_sha256": sha256(POLICY_PATH),
            "models": models, "case_count": case_count, "attempts_per_case": attempts,
            "expected_observations": case_count * attempts * len(models),
        },
        "outputs": {"m09": str(output.resolve()), "m04": str(m04_output.resolve())},
        "formal_command": [
            sys.executable, str(Path(__file__).resolve()), "--serial", serial,
            "--adb", str(adb_path.resolve()), "--app-apk", str(app_apk.resolve()),
            "--test-apk", str(test_apk.resolve()), "--output", str(output.resolve()),
            "--m04-output", str(m04_output.resolve()),
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sdk_default = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    parser.add_argument("--adb", type=Path, default=sdk_default / "platform-tools/adb.exe")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--app-apk", type=Path)
    parser.add_argument("--test-apk", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--m04-output", type=Path, default=DEFAULT_M04_OUTPUT)
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--dry-run-output", type=Path, default=DEFAULT_DRY_RUN_OUTPUT)
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
    if options.dry_run:
        report = build_device_handoff_dry_run(
            serial=options.serial, adb_path=options.adb, app_apk=app_apk, test_apk=test_apk,
            suite=suite, policy=policy, output=options.output, m04_output=options.m04_output,
        )
        dry_run_output = options.dry_run_output.resolve()
        formal_root = (ROOT / "docs/android/reports/evidence/p9").resolve()
        if dry_run_output == formal_root or formal_root in dry_run_output.parents:
            raise ValueError("dry_run_cannot_write_formal_evidence")
        dry_run_output.parent.mkdir(parents=True, exist_ok=True)
        dry_run_output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8",
        )
        print(json.dumps({"passed": True, "dry_run": True, "output": str(dry_run_output)}, indent=2))
        return 0
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

    # M09 includes the exact 90 deepseek-v4-flash attempts required by M04.
    # Re-score those same raw observations instead of issuing 90 duplicate paid
    # requests. Both reports remain bound to the same APK, fixture and runtime.
    flash_model = "deepseek-v4-flash"
    flash_document = observations_by_model[flash_model]
    m04_gate = score_m04_observations(suite, flash_document)
    m04_report = {
        **m04_gate,
        "feature_id": "M04-F06",
        "generated_at": completed_at,
        "passed": bool(m04_gate["passed"]),
        "provenance": {
            **report["provenance"],
            "reused_from_feature": "M09-F06",
            "fixture": str(SUITE_PATH.relative_to(ROOT)).replace("\\", "/"),
            "fixture_sha256": suite["sha256"],
        },
        "environment": environment,
        "runtime": report["runtime_by_model"][flash_model],
        "raw_observations": flash_document["observations"],
        "instrumentation_tests": 1,
        "instrumentation_failures": 0,
        "source_sha256": report["source_sha256"],
    }
    options.m04_output.parent.mkdir(parents=True, exist_ok=True)
    options.m04_output.write_text(
        json.dumps(m04_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(json.dumps({
        "feature_id": report["feature_id"], "passed": report["passed"],
        "raw_counts": report["raw_counts"], "aggregate": report["aggregate"],
        "output": str(options.output), "m04_passed": m04_report["passed"],
        "m04_output": str(options.m04_output),
    }, ensure_ascii=False, indent=2))
    return 0 if report["passed"] and m04_report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
