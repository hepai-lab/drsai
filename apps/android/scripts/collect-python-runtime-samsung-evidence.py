"""Fail-closed Samsung arm64 physical-device acceptance collector."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


PACKAGE = "ai.drsai.remote.acceptance"
RUNNER = f"{PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner"
PERF_MARKER = "PYTHON_RUNTIME_PERF="


def run(command: list[str], *, timeout: int = 240) -> str:
    completed = subprocess.run(
        command, text=True, encoding="utf-8", errors="replace",
        capture_output=True, timeout=timeout,
    )
    output = completed.stdout + completed.stderr
    if completed.returncode:
        raise RuntimeError(f"command_failed:{completed.returncode}\n{output}")
    return output


def adb(adb_path: Path, serial: str, *command: str, timeout: int = 240) -> str:
    return run([str(adb_path), "-s", serial, *command], timeout=timeout)


def prop(adb_path: Path, serial: str, name: str) -> str:
    return adb(adb_path, serial, "shell", "getprop", name, timeout=20).strip()


def require_physical_samsung_arm64(adb_path: Path, serial: str, acceptance_run_id: str) -> dict[str, object]:
    state = adb(adb_path, serial, "get-state", timeout=20).strip()
    manufacturer = prop(adb_path, serial, "ro.product.manufacturer")
    brand = prop(adb_path, serial, "ro.product.brand")
    model = prop(adb_path, serial, "ro.product.model")
    abi = prop(adb_path, serial, "ro.product.cpu.abi")
    api = int(prop(adb_path, serial, "ro.build.version.sdk"))
    qemu = prop(adb_path, serial, "ro.kernel.qemu")
    checks = {
        "adb_online": state == "device",
        "physical": qemu != "1" and not serial.startswith("emulator-"),
        "samsung": manufacturer.lower() == "samsung" or brand.lower() == "samsung",
        "arm64": abi == "arm64-v8a",
        "supported_api": api >= 26,
    }
    if not all(checks.values()):
        raise RuntimeError(f"samsung_arm64_identity_gate_failed:{json.dumps(checks, sort_keys=True)}")
    meminfo = adb(adb_path, serial, "shell", "cat", "/proc/meminfo", timeout=20)
    memory_match = re.search(r"MemTotal:\s+(\d+)\s+kB", meminfo)
    return {
        "kind": "physical_device",
        "device_id_sha256": hashlib.sha256(
            f"stage7-device-v1\0{acceptance_run_id}\0{serial}\0{prop(adb_path, serial, 'ro.build.fingerprint')}".encode()
        ).hexdigest(),
        "device_id_scheme": "stage7-device-v1",
        "manufacturer": manufacturer,
        "brand": brand,
        "model": model,
        "api": api,
        "abi": abi,
        "memory_mb": int(memory_match.group(1)) // 1024 if memory_match else 0,
        "physical_samsung_arm64_verified": True,
        "identity_checks": checks,
    }


def parse_performance(logcat: str) -> dict[str, object]:
    rows = [line.split(PERF_MARKER, 1)[1].strip() for line in logcat.splitlines() if PERF_MARKER in line]
    if not rows:
        raise RuntimeError("python_runtime_performance_marker_missing")
    return json.loads(rows[-1])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--app-apk", type=Path, required=True)
    parser.add_argument("--test-apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument(
        "--reuse-completed-run",
        action="store_true",
        help="Reuse the current logcat only when it contains a completed zero-failure run.",
    )
    args = parser.parse_args()

    started_at = datetime.now(timezone.utc).isoformat()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    environment = require_physical_samsung_arm64(args.adb, args.serial, identity["acceptance_run_id"])
    for path in (args.app_apk, args.test_apk):
        if not path.is_file():
            raise FileNotFoundError(path)
    if hashlib.sha256(args.app_apk.read_bytes()).hexdigest() != identity.get("apk_sha256"):
        raise RuntimeError("samsung_candidate_apk_identity_mismatch")
    if args.reuse_completed_run:
        logs = adb(args.adb, args.serial, "logcat", "-d", timeout=60)
        match = re.search(r"run finished: (\d+) tests, 0 failed", logs)
        if match is None:
            raise RuntimeError("completed_zero_failure_test_run_missing_from_logcat")
        if f"STAGE7_ACCEPTANCE_RUN_ID={identity['acceptance_run_id']}" not in logs:
            raise RuntimeError("reused_logcat_acceptance_run_id_mismatch")
    else:
        adb(args.adb, args.serial, "install", "-r", "-t", str(args.app_apk.resolve()))
        adb(args.adb, args.serial, "install", "-r", "-t", str(args.test_apk.resolve()))
        adb(args.adb, args.serial, "logcat", "-c", timeout=20)
        instrumentation = adb(
            args.adb, args.serial, "shell", "am", "instrument", "-w", "-r", RUNNER,
            timeout=600,
        )
        match = re.search(r"OK \((\d+) tests?\)", instrumentation)
        if match is None or "FAILURES!!!" in instrumentation:
            raise RuntimeError(f"physical_instrumentation_failed\n{instrumentation}")
        logs = adb(args.adb, args.serial, "logcat", "-d", timeout=60)
    metrics = parse_performance(logs)
    anr_dump = adb(args.adb, args.serial, "shell", "dumpsys", "activity", "lastanr", timeout=30)
    anr = len(re.findall(rf"ANR in {re.escape(PACKAGE)}", logs))
    if "<no ANR has occurred since boot>" not in anr_dump and PACKAGE in anr_dump:
        anr += 1
    crashes = len(re.findall(rf"(?:FATAL EXCEPTION|Fatal signal).*{re.escape(PACKAGE)}", logs))
    metrics.update({"anr": anr, "crashes": crashes})
    gates = {
        "instrumentation": int(match.group(1)) >= 90,
        "cold_start_p95_under_3s": float(metrics["cold_start_p95_ms"]) <= 3000,
        "foreground_pss_p95_under_220mb": float(metrics["foreground_pss_p95_mb"]) <= 220,
        "peak_pss_under_320mb": float(metrics["peak_pss_mb"]) <= 320,
        "storage_under_220mb": float(metrics["storage_mb"]) <= 220,
        "zero_anr": anr == 0,
        "zero_crashes": crashes == 0,
        "runtime_release_verified": metrics.get("runtime_release_verified") is True,
        "device_secret_scan": "PYTHON_RUNTIME_SECURITY={\"app_data_canary_findings\":0}" in logs,
    }
    completed_at = datetime.now(timezone.utc).isoformat()
    result = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "identity": identity,
        "provenance": {
            "runner": RUNNER, "acceptance_run_id": identity["acceptance_run_id"],
            "package_version_code": identity["version_code"], "package_version_name": identity["version_name"],
            "apk_sha256": identity["apk_sha256"], "started_at": started_at, "completed_at": completed_at,
            "device_ids_sha256": [environment["device_id_sha256"]],
        },
        "environment": environment,
        "sample_count": len(metrics.get("cold_start_ms", [])),
        "instrumentation_tests": int(match.group(1)),
        "metrics": metrics,
        "gates": gates,
        "result": "passed" if all(gates.values()) else "failed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result["result"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
