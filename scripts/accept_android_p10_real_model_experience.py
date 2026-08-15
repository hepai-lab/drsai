from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
PYTHON_SRC = ROOT / "cores/python/packages/drsai/src"
SUITE_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-tool-selection-v1.json"
POLICY_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p10-real-model-experience-gate-v1.json"
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m10-f03-real-model-experience.json"
DEVICE_OUTPUT = "p9-m04-f06-natural-tool-selection-observations.json"
PACKAGE = "ai.drsai.remote.debug"
TEST_CLASS = "ai.drsai.remote.P9NaturalToolSelectionInstrumentedTest"

sys.path.insert(0, str(PYTHON_SRC))
from drsai.backend.runtime.real_model_statistics import evaluate_real_model_statistics  # noqa: E402
from drsai.backend.runtime.tool_selection_eval import load_tool_selection_suite  # noqa: E402


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


def read_key(path: Path) -> str:
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == "ZHIZENGZENG_API_KEY" and value.strip():
            return value.strip()
    raise RuntimeError("zhizengzeng_api_key_missing")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    options = parser.parse_args()
    adb = Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"
    app_apk = ANDROID / "app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.7.apk"
    test_apk = ANDROID / "app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
    for path in (adb, app_apk, test_apk, options.key_file):
        if not path.is_file():
            raise FileNotFoundError(path)
    base = [str(adb), "-s", options.serial]
    if run(base + ["shell", "getprop", "ro.build.version.sdk"], 30).strip() != "35":
        raise RuntimeError("p10_real_model_api35_emulator_required")
    for apk in (app_apk, test_apk):
        run(base + ["install", "-r", "-t", str(apk)], 300)
    instruments = run(base + ["shell", "pm", "list", "instrumentation"], 30).splitlines()
    runners = [line.removeprefix("instrumentation:").split(" (target=")[0] for line in instruments if PACKAGE in line]
    if len(runners) != 1:
        raise RuntimeError(f"instrumentation_runner_invalid:{runners}")
    runner = runners[0]
    suite = load_tool_selection_suite(SUITE_PATH)
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    canonical = json.dumps(policy, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    policy["sha256"] = hashlib.sha256(canonical).hexdigest()
    api_key = read_key(options.key_file)
    started = datetime.now(timezone.utc).isoformat()
    observations = {}
    try:
        for model in policy["candidate_models"]:
            output = run(base + [
                "shell", "am", "instrument", "-w", "-r",
                "-e", "runP9NaturalToolSelection", "true",
                "-e", "acceptanceProfile", "p10",
                "-e", "acceptanceApiKey", api_key,
                "-e", "p9Attempts", "1",
                "-e", "p9Model", model,
                "-e", "class", TEST_CLASS, runner,
            ], 3600)
            if "OK (1 test)" not in output or "FAILURES!!!" in output:
                raise RuntimeError(f"real_model_instrumentation_failed:{model}\n{output[-8000:]}")
            raw = run(base + ["exec-out", "run-as", PACKAGE, "cat", f"files/{DEVICE_OUTPUT}"], 60)
            document = json.loads(raw)
            if document.get("model") != model or len(document.get("observations", [])) != 30:
                raise RuntimeError(f"real_model_observations_invalid:{model}")
            observations[model] = document
    finally:
        api_key = ""
    setup = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "class",
        "ai.drsai.remote.SetupJourneyStoreInstrumentedTest,ai.drsai.remote.FirstTaskJourneyInstrumentedTest",
        runner,
    ], 600)
    recovery = run(base + [
        "shell", "am", "instrument", "-w", "-r", "-e", "runP9EmulatorLifecycle", "true",
        "-e", "class", "ai.drsai.remote.FullRuntimePhysicalAcceptanceTest", runner,
    ], 900)
    journey_gates = {
        "first_configuration_and_first_task": "OK (3 tests)" in setup and "FAILURES!!!" not in setup,
        "runtime_recovery_lifecycle": "OK (6 tests)" in recovery and "FAILURES!!!" not in recovery,
    }
    scored = evaluate_real_model_statistics(suite, policy, observations)
    report = {
        **scored,
        "schema_version": "opendrsai.p10-real-model-experience-result/1",
        "feature_id": "M10-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "started_at": started,
        "passed": scored["passed"] and all(journey_gates.values()),
        "journey_gates": journey_gates,
        "environment": {"serial": options.serial, "api": 35, "kind": "emulator_preacceptance"},
        "provenance": {
            "app_apk_sha256": sha256(app_apk), "test_apk_sha256": sha256(test_apk),
            "suite_sha256": sha256(SUITE_PATH), "policy_sha256": sha256(POLICY_PATH),
            "credential_source_sha256": sha256(options.key_file), "credential_persisted_in_report": False,
        },
        "raw_observations_by_model": {model: value["observations"] for model, value in observations.items()},
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "models": report["models"], "journeys": journey_gates}, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
