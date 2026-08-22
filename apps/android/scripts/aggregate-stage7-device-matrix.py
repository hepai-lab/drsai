"""Aggregate identity-bound device reports into the Stage 7 compatibility matrix."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

REQUIRED_APIS = {26, 30, 35, 36}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    devices, errors, provenances = [], [], []
    for path in args.report:
        report = json.loads(path.read_text(encoding="utf-8"))
        environment = report.get("environment", report.get("device", {}))
        if report.get("schema_version") != 2:
            errors.append(f"schema_version_invalid:{path.name}")
        if report.get("identity") != identity:
            errors.append(f"identity_mismatch:{path.name}")
        provenance = report.get("provenance")
        if (not isinstance(provenance, dict) or not provenance.get("device_ids_sha256") or
                not provenance.get("runner") or not provenance.get("started_at") or not provenance.get("completed_at") or
                provenance.get("acceptance_run_id", identity["acceptance_run_id"]) != identity["acceptance_run_id"]):
            errors.append(f"provenance_missing:{path.name}")
        else:
            if environment.get("device_id_sha256") not in provenance["device_ids_sha256"]:
                errors.append(f"provenance_device_mismatch:{path.name}")
            provenances.append(provenance)
        if "serial" in environment:
            errors.append(f"raw_device_serial_forbidden:{path.name}")
        devices.append({
            "source": path.name,
            "device_id_sha256": environment.get("device_id_sha256"),
            "device_id_scheme": environment.get("device_id_scheme"),
            "manufacturer": environment.get("manufacturer"),
            "model": environment.get("model"),
            "api": environment.get("api"),
            "abi": environment.get("abi"),
            "memory_mb": environment.get("memory_mb"),
            "physical": environment.get("kind") == "physical_device",
            "result": report.get("result"),
        })
    apis = {item["api"] for item in devices}
    checks = {
        "api_26_30_35_36": REQUIRED_APIS <= apis,
        "arm64": any(item["abi"] == "arm64-v8a" for item in devices),
        "x86_64": any(item["abi"] == "x86_64" for item in devices),
        "physical_device": any(item["physical"] for item in devices),
        "all_reports_passed": all(item["result"] == "passed" for item in devices),
        "public_device_ids_hashed": all(
            isinstance(item["device_id_sha256"], str) and len(item["device_id_sha256"]) == 64 and
            item["device_id_scheme"] == "stage7-device-v1" for item in devices
        ),
    }
    result = "passed" if checks and all(checks.values()) and not errors else "failed"
    merged_provenance = None if len(provenances) != len(devices) else {
        "runner": "+".join(sorted({str(item.get("runner")) for item in provenances})),
        "acceptance_run_id": identity["acceptance_run_id"],
        "package_version_code": identity["version_code"], "package_version_name": identity["version_name"],
        "apk_sha256": identity["apk_sha256"],
        "started_at": min(str(item.get("started_at")) for item in provenances),
        "completed_at": max(str(item.get("completed_at")) for item in provenances),
        "device_ids_sha256": sorted({device for item in provenances for device in item["device_ids_sha256"]}),
    }
    value = {
        "schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(),
        "identity": identity, "provenance": merged_provenance,
        "devices": devices, "checks": checks, "errors": errors, "result": result,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
