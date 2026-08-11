from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "ai.drsai.remote.acceptance"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.AndroidOaepStage8RollbackTest"


def run(command: list[str], timeout: int = 240, check: bool = True) -> str:
    result = subprocess.run(command, timeout=timeout, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW)
    if check and result.returncode:
        raise RuntimeError(f"command_failed_{result.returncode}: {' '.join(command)}\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 8 physical APK upgrade and rollback drill")
    parser.add_argument("--serial", required=True)
    parser.add_argument("--baseline-apk", type=Path, required=True)
    parser.add_argument("--baseline-test-apk", type=Path, required=True)
    parser.add_argument("--candidate-apk", type=Path, required=True)
    parser.add_argument("--candidate-test-apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/android/reports/evidence/android-agent-runtime-rollback.json")
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = str(sdk / "platform-tools/adb.exe")
    base = [adb, "-s", args.serial]
    for path in (args.baseline_apk, args.baseline_test_apk, args.candidate_apk, args.candidate_test_apk):
        if not path.resolve().is_file():
            raise SystemExit(f"rollback_artifact_missing:{path}")
    run(base + ["uninstall", PACKAGE], check=False)

    steps = []
    def install(apk: Path, *flags: str) -> None:
        output = run(base + ["install", *flags, "-t", str(apk.resolve())], timeout=300)
        if "Success" not in output:
            raise RuntimeError("adb_install_not_successful:" + output)

    def instrument(method: str, phase: str) -> None:
        output = run(base + [
            "shell", "am", "instrument", "-w", "-r",
            "-e", "class", f"{TEST_CLASS}#{method}",
            "-e", "rollbackPhase", phase,
            RUNNER,
        ], timeout=180)
        passed = "OK (1 test)" in output
        steps.append({"method": method, "passed": passed})
        if not passed:
            raise RuntimeError("rollback_instrumentation_failed:\n" + output[-5000:])

    install(args.baseline_apk)
    install(args.baseline_test_apk)
    instrument("seed_v155_oaep_state", "seed-v155")
    baseline_version = run(base + ["shell", "dumpsys", "package", PACKAGE])

    install(args.candidate_apk, "-r")
    install(args.candidate_test_apk, "-r")
    instrument("verify_v156_upgrade_preserves_oaep_and_kill_switch_is_safe", "verify-v156")
    candidate_version = run(base + ["shell", "dumpsys", "package", PACKAGE])

    install(args.baseline_apk, "-r", "-d")
    install(args.baseline_test_apk, "-r", "-d")
    instrument("verify_v155_rollback_preserves_oaep_state", "verify-v155-rollback")
    rollback_version = run(base + ["shell", "dumpsys", "package", PACKAGE])
    preferences = run(base + ["shell", "run-as", PACKAGE, "cat", "shared_prefs/stage8_rollback_evidence.xml"])
    digests = re.findall(r"[0-9a-f]{64}", preferences)
    checks = {
        "baseline_1_5_5": "versionName=1.5.5" in baseline_version and "versionCode=10505" in baseline_version,
        "candidate_1_5_6": "versionName=1.5.6" in candidate_version and "versionCode=10506" in candidate_version,
        "rollback_1_5_5": "versionName=1.5.5" in rollback_version and "versionCode=10505" in rollback_version,
        "all_device_assertions": all(step["passed"] for step in steps),
        "snapshot_digest_persisted": bool(digests),
    }
    report = {
        "schema_version": 1, "generated_at": datetime.now(UTC).isoformat(), "serial": args.serial,
        "transition": ["1.5.5", "1.5.6", "1.5.5"], "steps": steps,
        "snapshot_digest": digests[-1] if digests else None,
        "checks": checks, "passed": all(checks.values()),
    }
    args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
