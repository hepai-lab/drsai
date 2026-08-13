#!/usr/bin/env python3
"""Content-free fail-closed preflight for the two physical P6 Android devices."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Callable, Sequence


Runner = Callable[..., subprocess.CompletedProcess[str]]


def _run(runner: Runner, command: Sequence[str]) -> str:
    result = runner(command, capture_output=True, text=True, timeout=15, check=False)
    if result.returncode != 0:
        raise RuntimeError("p6_device_preflight_adb_failed")
    return result.stdout.strip()


def _devices(output: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for line in output.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 2:
            rows.append((fields[0], fields[1]))
    return rows


def collect(adb: Path, required_devices: int = 2, runner: Runner = subprocess.run) -> dict[str, object]:
    if required_devices < 2:
        raise ValueError("p6_device_preflight_two_devices_required")
    rows = _devices(_run(runner, [str(adb), "devices"]))
    physical_proofs: list[str] = []
    emulator_count = unauthorized_count = offline_count = 0
    for serial, state in rows:
        if state != "device":
            if state == "unauthorized":
                unauthorized_count += 1
            else:
                offline_count += 1
            continue
        qemu = _run(runner, [str(adb), "-s", serial, "shell", "getprop", "ro.kernel.qemu"])
        abi = _run(runner, [str(adb), "-s", serial, "shell", "getprop", "ro.product.cpu.abi"])
        manufacturer = _run(runner, [str(adb), "-s", serial, "shell", "getprop", "ro.product.manufacturer"])
        fingerprint = _run(runner, [str(adb), "-s", serial, "shell", "getprop", "ro.build.fingerprint"])
        if serial.startswith("emulator-") or qemu == "1":
            emulator_count += 1
            continue
        if not serial or not abi or not manufacturer or not fingerprint:
            raise RuntimeError("p6_device_preflight_identity_incomplete")
        proof = hashlib.sha256(
            "\0".join(("p6-physical-device", serial, abi, manufacturer, fingerprint)).encode()
        ).hexdigest().upper()
        physical_proofs.append(proof)
    distinct = sorted(set(physical_proofs))
    if len(distinct) != len(physical_proofs):
        raise RuntimeError("p6_device_preflight_duplicate_device")
    passed = len(distinct) >= required_devices
    return {
        "schema_version": "p6-physical-device-preflight/1",
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "required_physical_devices": required_devices,
        "online_physical_devices": len(distinct),
        "physical_device_proof_sha256s": distinct,
        "emulator_count": emulator_count,
        "unauthorized_count": unauthorized_count,
        "offline_count": offline_count,
        "raw_device_identity_exported": False,
        "passed": passed,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", type=Path, required=True)
    parser.add_argument("--required-devices", type=int, default=2)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    report = collect(args.adb.resolve(), args.required_devices)
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(json.dumps({
        "online_physical_devices": report["online_physical_devices"],
        "passed": report["passed"],
        "required_physical_devices": report["required_physical_devices"],
    }, sort_keys=True, separators=(",", ":")))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

