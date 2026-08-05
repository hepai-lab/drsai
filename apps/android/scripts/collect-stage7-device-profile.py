"""Collect a privacy-safe device profile bound to a passed Stage 7 device run."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def adb(path: Path, serial: str, *args: str) -> str:
    result = subprocess.run([str(path), "-s", serial, *args], capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=30)
    if result.returncode:
        raise RuntimeError(f"adb_failed:{result.returncode}:{result.stdout}{result.stderr}")
    return result.stdout.strip()


def prop(path: Path, serial: str, name: str) -> str:
    return adb(path, serial, "shell", "getprop", name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--run-report", type=Path, required=True)
    parser.add_argument("--expected-kind", choices=("physical_device", "emulator"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    run_report = json.loads(args.run_report.read_text(encoding="utf-8"))
    if run_report.get("schema_version") != 2 or run_report.get("identity") != identity or run_report.get("result") != "passed":
        raise RuntimeError("device_run_report_not_passed_or_identity_mismatch")
    manufacturer = prop(args.adb, args.serial, "ro.product.manufacturer")
    model = prop(args.adb, args.serial, "ro.product.model")
    api = int(prop(args.adb, args.serial, "ro.build.version.sdk"))
    abi = prop(args.adb, args.serial, "ro.product.cpu.abi")
    qemu = prop(args.adb, args.serial, "ro.kernel.qemu")
    kind = "emulator" if qemu == "1" or args.serial.startswith("emulator-") else "physical_device"
    if kind != args.expected_kind or api < 26 or abi not in {"arm64-v8a", "x86_64"}:
        raise RuntimeError("device_profile_gate_failed")
    meminfo = adb(args.adb, args.serial, "shell", "cat", "/proc/meminfo")
    memory = re.search(r"MemTotal:\s+(\d+)\s+kB", meminfo)
    fingerprint = prop(args.adb, args.serial, "ro.build.fingerprint")
    device_hash = hashlib.sha256(
        f"stage7-device-v1\0{identity['acceptance_run_id']}\0{args.serial}\0{fingerprint}".encode()
    ).hexdigest()
    run_provenance = run_report.get("provenance", {})
    if device_hash not in run_provenance.get("device_ids_sha256", []):
        raise RuntimeError("device_run_provenance_hash_mismatch")
    value = {
        "schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(), "identity": identity,
        "provenance": run_provenance,
        "environment": {"device_id_sha256": device_hash, "device_id_scheme": "stage7-device-v1", "api": api, "abi": abi,
                        "manufacturer": manufacturer, "model": model, "kind": kind,
                        "memory_mb": int(memory.group(1)) // 1024 if memory else 0},
        "run_report_sha256": hashlib.sha256(args.run_report.read_bytes()).hexdigest(),
        "result": "passed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
