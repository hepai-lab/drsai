"""Run an OEM-independent, forward-compatible APK rollback drill on Android."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

PACKAGE = "ai.drsai.remote.acceptance"
TEST_RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
TEST_CLASS = "ai.drsai.remote.PythonRuntimeUpgradeStateTest"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], cwd: Path) -> str:
    completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True,
                               encoding="utf-8", errors="replace", timeout=240)
    output = completed.stdout + completed.stderr
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}\n{output}")
    return output


def instrument(adb: Path, serial: str, method: str, phase: str, cwd: Path) -> None:
    output = run([str(adb), "-s", serial, "shell", "am", "instrument", "-w", "-r",
                  "-e", "class", f"{TEST_CLASS}#{method}", "-e", "upgradePhase", phase,
                  TEST_RUNNER], cwd)
    if "OK (1 test)" not in output:
        raise RuntimeError(f"instrumentation_not_passed:{method}\n{output}")


def version(adb: Path, serial: str, cwd: Path) -> tuple[int, str]:
    output = run([str(adb), "-s", serial, "shell", "dumpsys", "package", PACKAGE], cwd)
    code = name = None
    for line in output.splitlines():
        value = line.strip()
        if value.startswith("versionCode=") and code is None:
            code = int(value.split("=", 1)[1].split()[0])
        if value.startswith("versionName=") and name is None:
            name = value.split("=", 1)[1]
    if code is None or name is None:
        raise RuntimeError("installed_package_version_missing")
    return code, name


def prop(adb: Path, serial: str, name: str, cwd: Path) -> str:
    return run([str(adb), "-s", serial, "shell", "getprop", name], cwd).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--candidate-apk", type=Path, required=True)
    parser.add_argument("--rollback-apk", type=Path, required=True)
    parser.add_argument("--test-apk", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo, adb = args.repo.resolve(), args.adb.resolve()
    candidate, rollback, test_apk = (path.resolve() for path in (args.candidate_apk, args.rollback_apk, args.test_apk))
    if not all(path.is_file() for path in (adb, candidate, rollback, test_apk)):
        raise SystemExit("compatible_rollback_artifact_missing")
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    if sha256(candidate) != identity["apk_sha256"]:
        raise SystemExit("compatible_rollback_candidate_identity_mismatch")
    started = datetime.now(timezone.utc).isoformat()
    journey: list[dict[str, str]] = []
    try:
        run([str(adb), "-s", args.serial, "install", "-r", "-t", str(candidate)], repo)
        run([str(adb), "-s", args.serial, "install", "-r", "-t", str(test_apk)], repo)
        candidate_version = version(adb, args.serial, repo)
        if candidate_version[0] != identity["version_code"]:
            raise RuntimeError("candidate_installed_version_mismatch")
        instrument(adb, args.serial, "seedUpgradeState", "seed", repo)
        journey.append({"step": "seed_current_schema_with_candidate", "status": "passed"})
        run([str(adb), "-s", args.serial, "install", "-r", "-d", "-t", str(rollback)], repo)
        rollback_version = version(adb, args.serial, repo)
        if rollback_version[0] >= candidate_version[0]:
            raise RuntimeError("rollback_version_not_lower")
        journey.append({"step": "install_forward_compatible_rollback_apk", "status": "passed"})
        instrument(adb, args.serial, "verifyUpgradeState", "verify", repo)
        journey.append({"step": "read_current_schema_after_compatible_rollback", "status": "passed"})
        journey.append({"step": "verify_checkpoint_after_compatible_rollback", "status": "passed"})
        fingerprint = prop(adb, args.serial, "ro.build.fingerprint", repo)
        device_id = hashlib.sha256(
            f"stage7-device-v1\0{identity['acceptance_run_id']}\0{args.serial}\0{fingerprint}".encode()
        ).hexdigest()
        completed = datetime.now(timezone.utc).isoformat()
        value = {
            "schema_version": 2, "report_schema_version": 4, "generated_at": completed,
            "identity": identity,
            "provenance": {"runner": "stage7-forward-compatible-apk-rollback-v1",
                           "acceptance_run_id": identity["acceptance_run_id"],
                           "package_version_code": identity["version_code"],
                           "package_version_name": identity["version_name"],
                           "apk_sha256": identity["apk_sha256"], "started_at": started,
                           "completed_at": completed, "device_ids_sha256": [device_id]},
            "environment": {"kind": "physical_device" if prop(adb, args.serial, "ro.kernel.qemu", repo) != "1" else "emulator",
                            "device_id_sha256": device_id, "device_id_scheme": "stage7-device-v1",
                            "manufacturer": prop(adb, args.serial, "ro.product.manufacturer", repo),
                            "model": prop(adb, args.serial, "ro.product.model", repo),
                            "api": int(prop(adb, args.serial, "ro.build.version.sdk", repo)),
                            "abi": prop(adb, args.serial, "ro.product.cpu.abi", repo), "package": PACKAGE},
            "rollback_strategy": "forward_compatible_apk", "rollback_data_policy": "retain",
            "candidate": {"version_code": candidate_version[0], "version_name": candidate_version[1]},
            "rolled_back": {"version_code": rollback_version[0], "version_name": rollback_version[1]},
            "migration": {"from_room_schema": 11, "to_room_schema": 11},
            "journey": journey,
            "artifacts": {"candidate_apk": sha256(candidate), "candidate_test_apk": sha256(test_apk),
                          "rollback_apk": sha256(rollback)},
            "preserved": {key: True for key in ("encrypted_login_state", "local_session", "remote_association",
                                                   "remote_session", "conversation_history", "python_checkpoint")},
            "errors": [], "result": "passed",
        }
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        completed = datetime.now(timezone.utc).isoformat()
        value = {"schema_version": 2, "report_schema_version": 4, "generated_at": completed,
                 "identity": identity, "journey": journey, "errors": [str(error)], "result": "failed"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if value["result"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
