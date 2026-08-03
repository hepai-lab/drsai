"""Collect only irreversible device-proof digests from two Android endpoints."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


DIGEST = re.compile(r"^[0-9a-f]{64}$")
PROOF_PREFIXES = (
    "OPENDRSAI_REAL_DEVICE_PROOF=",
    "INSTRUMENTATION_STATUS: realDeviceProof=",
)
TEST_CLASS = "ai.drsai.remote.RealRemoteWorkspaceE2ETest"


def parse_proof(output: str) -> str:
    encoded = next(
        (
            line.split(prefix, 1)[1].strip()
            for line in output.splitlines()
            for prefix in PROOF_PREFIXES
            if prefix in line
        ),
        None,
    )
    try:
        proof = json.loads(encoded) if encoded is not None else None
    except json.JSONDecodeError as exc:
        raise RuntimeError("v4_device_proof_invalid") from exc
    digest = proof.get("device_proof_sha256") if isinstance(proof, dict) else None
    if proof is None or proof.get("phase") != "device-proof" or not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        raise RuntimeError("v4_device_proof_invalid")
    return digest


def collect_one(
    adb: str,
    device: str,
    package: str,
    timeout_seconds: int,
) -> str:
    completed = subprocess.run(
        [
            adb,
            "-s",
            device,
            "shell",
            "am",
            "instrument",
            "-w",
            "-r",
            "-e",
            "class",
            TEST_CLASS,
            "-e",
            "phase",
            "device-proof",
            "-e",
            "runtimeId",
            "device-proof",
            f"{package}.test/androidx.test.runner.AndroidJUnitRunner",
        ],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode or "OK (1 test)" not in completed.stdout:
        raise RuntimeError("v4_device_proof_instrumentation_failed")
    return parse_proof(completed.stdout)


def report(digests: list[str]) -> dict[str, Any]:
    if len(digests) < 2 or len(set(digests)) != len(digests) or any(not DIGEST.fullmatch(value) for value in digests):
        raise RuntimeError("v4_device_proofs_invalid")
    return {
        "schema_version": 1,
        "passed": True,
        "devices": [{"device_proof_sha256": value} for value in digests],
    }


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", action="append", required=True)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--package", default="ai.drsai.remote.acceptance")
    parser.add_argument("--timeout-seconds", type=int, default=120)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = report(
        [
            collect_one(args.adb, device, args.package, args.timeout_seconds)
            for device in args.device
        ]
    )
    atomic_json(args.output, result)
    print(json.dumps({"passed": True, "device_count": len(result["devices"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
