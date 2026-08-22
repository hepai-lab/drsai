"""Run a fail-closed historical APK upgrade and platform rollback drill."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


PACKAGE = "ai.drsai.remote.acceptance"
TEST_PACKAGE = f"{PACKAGE}.test"
TEST_RUNNER = f"{TEST_PACKAGE}/androidx.test.runner.AndroidJUnitRunner"
BASELINE_TEST_CLASS = "ai.drsai.remote.BaselineUpgradeSeedTest"
CANDIDATE_TEST_CLASS = "ai.drsai.remote.PythonRuntimeUpgradeStateTest"


def run(command: list[str], *, cwd: Path, timeout: int = 240) -> str:
    completed = subprocess.run(
        command, cwd=cwd, text=True, capture_output=True, timeout=timeout,
        encoding="utf-8", errors="replace",
    )
    output = completed.stdout + completed.stderr
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}\n{output}")
    return output


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def instrument(adb: Path, serial: str, test_class: str, method: str, phase: str, cwd: Path) -> None:
    output = run(
        [str(adb), "-s", serial, "shell", "am", "instrument", "-w", "-r",
         "-e", "upgradePhase", phase, "-e", "class", f"{test_class}#{method}", TEST_RUNNER],
        cwd=cwd,
    )
    if "OK (1 test)" not in output:
        raise RuntimeError(f"instrumentation_not_passed:{phase}:{method}\n{output}")


def package_version(adb: Path, serial: str, cwd: Path) -> tuple[int, str]:
    output = run([str(adb), "-s", serial, "shell", "dumpsys", "package", PACKAGE], cwd=cwd)
    code = name = None
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("versionCode=") and code is None:
            code = int(stripped.split("=", 1)[1].split()[0])
        if stripped.startswith("versionName=") and name is None:
            name = stripped.split("=", 1)[1]
    if code is None or name is None:
        raise RuntimeError("installed_package_version_missing")
    return code, name


def wait_for_version(adb: Path, serial: str, expected_code: int, cwd: Path) -> tuple[int, str]:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            installed = package_version(adb, serial, cwd)
            if installed[0] == expected_code:
                return installed
        except RuntimeError:
            pass
        time.sleep(1)
    raise RuntimeError(f"rollback_version_timeout:expected={expected_code}")


def device_environment(adb: Path, serial: str, cwd: Path, acceptance_run_id: str) -> dict[str, object]:
    def getprop(name: str) -> str:
        return run([str(adb), "-s", serial, "shell", "getprop", name], cwd=cwd).strip()

    qemu = getprop("ro.kernel.qemu") == "1"
    return {
        "kind": "android_emulator" if qemu else "physical_device",
        "device_id_sha256": hashlib.sha256(
            f"stage7-device-v1\0{acceptance_run_id}\0{serial}\0{getprop('ro.build.fingerprint')}".encode()
        ).hexdigest(),
        "device_id_scheme": "stage7-device-v1",
        "manufacturer": getprop("ro.product.manufacturer"),
        "model": getprop("ro.product.model"),
        "api": int(getprop("ro.build.version.sdk")),
        "abi": getprop("ro.product.cpu.abi"),
        "package": PACKAGE,
    }


def require_file(path: Path, label: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_file():
        raise ValueError(f"{label}_missing:{resolved}")
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--baseline-apk", type=Path, required=True)
    parser.add_argument("--baseline-test-apk", type=Path, required=True)
    parser.add_argument("--candidate-apk", type=Path, required=True)
    parser.add_argument("--candidate-test-apk", type=Path, required=True)
    parser.add_argument("--baseline-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    args = parser.parse_args()
    started_at = datetime.now(timezone.utc).isoformat()
    repo = args.repo.resolve()
    baseline_apk = require_file(args.baseline_apk, "baseline_apk")
    baseline_test_apk = require_file(args.baseline_test_apk, "baseline_test_apk")
    candidate_apk = require_file(args.candidate_apk, "candidate_apk")
    candidate_test_apk = require_file(args.candidate_test_apk, "candidate_test_apk")
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    if not re.fullmatch(r"[0-9a-f]{40,64}", args.baseline_commit):
        raise ValueError("baseline_commit_must_be_full_hash")
    resolved_baseline_commit = run(
        ["git", "rev-parse", "--verify", f"{args.baseline_commit}^{{commit}}"], cwd=repo
    ).strip()
    if resolved_baseline_commit != args.baseline_commit:
        raise ValueError("baseline_commit_not_canonical")
    hashes = {label: sha256(path) for label, path in {
        "baseline_apk": baseline_apk, "baseline_test_apk": baseline_test_apk,
        "candidate_apk": candidate_apk, "candidate_test_apk": candidate_test_apk,
    }.items()}
    if hashes["baseline_apk"] == hashes["candidate_apk"]:
        raise ValueError("baseline_and_candidate_apk_must_be_distinct")
    identity_apk = identity.get("apk_sha256") or identity.get("apk", {}).get("sha256")
    if identity_apk != hashes["candidate_apk"]:
        raise ValueError("candidate_apk_identity_hash_mismatch")

    adb = args.adb.resolve()
    run([str(adb), "-s", args.serial, "uninstall", PACKAGE], cwd=repo)
    run([str(adb), "-s", args.serial, "install", "-t", str(baseline_apk)], cwd=repo)
    baseline_version = package_version(adb, args.serial, repo)
    run([str(adb), "-s", args.serial, "install", "-t", str(baseline_test_apk)], cwd=repo)
    instrument(adb, args.serial, BASELINE_TEST_CLASS, "seedLegacyState", "seed_legacy", repo)
    instrument(adb, args.serial, BASELINE_TEST_CLASS, "verifyLegacyState", "verify_legacy_baseline", repo)

    snapshot_marker = f"STAGE7_ROLLBACK_SNAPSHOT_{identity['acceptance_run_id']}"
    run([str(adb), "-s", args.serial, "shell", "log", "-t", "Stage7Evidence", snapshot_marker], cwd=repo)
    run([str(adb), "-s", args.serial, "install", "-r", "-t", "--enable-rollback", "0", str(candidate_apk)], cwd=repo)
    candidate_version = package_version(adb, args.serial, repo)
    if candidate_version[0] <= baseline_version[0]:
        raise RuntimeError(f"candidate_version_not_newer:{baseline_version[0]}->{candidate_version[0]}")
    rollback_log = run([str(adb), "-s", args.serial, "logcat", "-d", "-v", "threadtime"], cwd=repo)
    marker_offset = rollback_log.rfind(snapshot_marker)
    if marker_offset < 0:
        raise RuntimeError("rollback_snapshot_log_boundary_missing")
    rollback_log = rollback_log[marker_offset:]
    snapshot_failed = (
        f"Unable to create app data snapshot for: {PACKAGE}" in rollback_log or
        ("Failed copying" in rollback_log and PACKAGE in rollback_log)
    )
    if snapshot_failed:
        environment = device_environment(adb, args.serial, repo, identity["acceptance_run_id"])
        completed_at = datetime.now(timezone.utc).isoformat()
        report = {
            "schema_version": 2, "report_schema_version": 3, "generated_at": completed_at,
            "identity": identity,
            "provenance": {
                "runner": "stage7-historical-upgrade-platform-rollback-v3",
                "acceptance_run_id": identity["acceptance_run_id"],
                "package_version_code": identity["version_code"],
                "package_version_name": identity["version_name"],
                "apk_sha256": identity["apk_sha256"], "started_at": started_at,
                "completed_at": completed_at, "device_ids_sha256": [environment["device_id_sha256"]],
            },
            "environment": environment,
            "baseline": {"git_commit": args.baseline_commit, "version_code": baseline_version[0], "version_name": baseline_version[1]},
            "candidate": {"version_code": candidate_version[0], "version_name": candidate_version[1]},
            "journey": [
                {"step": "seed_room_7_with_historical_code", "status": "passed"},
                {"step": "platform_app_data_snapshot", "status": "failed", "reason": "platform_snapshot_creation_failed"},
            ],
            "artifacts": hashes, "rollback_data_policy": "restore",
            "errors": ["platform_snapshot_creation_failed"], "result": "failed",
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 2
    run([str(adb), "-s", args.serial, "install", "-r", "-t", str(candidate_test_apk)], cwd=repo)
    instrument(adb, args.serial, CANDIDATE_TEST_CLASS, "verifyLegacyUpgradeState", "verify_legacy", repo)

    rollback_output = run([str(adb), "-s", args.serial, "shell", "pm", "rollback-app", PACKAGE], cwd=repo)
    rolled_back_version = wait_for_version(adb, args.serial, baseline_version[0], repo)
    run([str(adb), "-s", args.serial, "uninstall", TEST_PACKAGE], cwd=repo)
    run([str(adb), "-s", args.serial, "install", "-t", str(baseline_test_apk)], cwd=repo)
    instrument(adb, args.serial, BASELINE_TEST_CLASS, "verifyLegacyState", "verify_legacy_rollback", repo)

    environment = device_environment(adb, args.serial, repo, identity["acceptance_run_id"])
    completed_at = datetime.now(timezone.utc).isoformat()
    report = {
        "schema_version": 2,
        "report_schema_version": 3,
        "generated_at": completed_at,
        "identity": identity,
        "provenance": {
            "runner": "stage7-historical-upgrade-platform-rollback-v3",
            "acceptance_run_id": identity["acceptance_run_id"],
            "package_version_code": identity["version_code"],
            "package_version_name": identity["version_name"],
            "apk_sha256": identity["apk_sha256"],
            "started_at": started_at,
            "completed_at": completed_at,
            "device_ids_sha256": [environment["device_id_sha256"]],
        },
        "environment": environment,
        "baseline": {"git_commit": args.baseline_commit, "version_code": baseline_version[0], "version_name": baseline_version[1]},
        "candidate": {"version_code": candidate_version[0], "version_name": candidate_version[1]},
        "rolled_back": {"version_code": rolled_back_version[0], "version_name": rolled_back_version[1]},
        "journey": [
            {"step": "seed_room_7_with_historical_code", "status": "passed"},
            {"step": "migrate_room_7_to_11_and_read_with_candidate", "status": "passed"},
            {"step": "platform_rollback_restore_snapshot", "status": "passed", "command_output": rollback_output.strip()},
            {"step": "read_restored_room_7_with_historical_code", "status": "passed"},
        ],
        "artifacts": hashes,
        "preserved": {"encrypted_login_state": True, "local_session": True, "remote_association": True, "remote_session": True, "conversation_history": True},
        "migration": {"from_room_schema": 7, "to_room_schema": 11},
        "rollback_data_policy": "restore",
        "result": "passed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
