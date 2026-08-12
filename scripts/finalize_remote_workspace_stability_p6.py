#!/usr/bin/env python3
"""Fail-closed semantic finalizer for the P6 two-device one-hour stability gate."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import jsonschema

from finalize_remote_workspace_p6 import P6EvidenceError, _path, load_json


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "cores/protocol/relay/remote-workspace-p6-stability.schema.json"
BOUNDARIES = {"android_a", "android_b", "windows", "runtime", "relay"}
FAULTS = {"android_background", "android_process_death", "network_change", "runtime_restart", "relay_restart"}
FAULT_BOUNDARIES = {
    "android_background": {"android_a", "android_b"},
    "android_process_death": {"android_a", "android_b"},
    "network_change": {"android_a", "android_b", "relay"},
    "runtime_restart": {"runtime", "windows", "relay"},
    "relay_restart": {"relay", "android_a", "android_b", "runtime"},
}


def _attest(root: Path, ref: dict[str, Any], seen: set[str]) -> None:
    path = _path(root, ref.get("artifact"))
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if not raw or ref.get("bytes") != len(raw) or ref.get("sha256") != digest:
        raise P6EvidenceError("p6_stability_proof_attestation_invalid")
    if digest in seen:
        raise P6EvidenceError("p6_stability_proof_reused")
    seen.add(digest)


def finalize(value: object, artifact_root: Path) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(value, dict):
        return {"schema_version": "p6-stability-finalization/1", "status": "failed",
                "boundaries": 0, "faults": 0, "errors": ["p6_stability_report_malformed"]}
    try:
        schema = load_json(SCHEMA, "p6_stability_schema_invalid")
        try:
            jsonschema.Draft202012Validator(schema).validate(value)
        except (jsonschema.SchemaError, jsonschema.ValidationError) as exc:
            raise P6EvidenceError("p6_stability_schema_validation_failed") from exc
        boundaries = {row["name"]: row for row in value["boundaries"]}
        faults = {row["name"]: row for row in value["faults"]}
        if len(boundaries) != 5 or set(boundaries) != BOUNDARIES:
            raise P6EvidenceError("p6_stability_boundary_set_invalid")
        if len(faults) != 5 or set(faults) != FAULTS:
            raise P6EvidenceError("p6_stability_fault_set_invalid")
        devices = set(value["device_proof_sha256s"])
        if boundaries["android_a"]["device_proof_sha256"] == boundaries["android_b"]["device_proof_sha256"] \
                or {boundaries["android_a"]["device_proof_sha256"], boundaries["android_b"]["device_proof_sha256"]} != devices \
                or any(boundaries[name]["device_proof_sha256"] is not None for name in {"windows", "runtime", "relay"}):
            raise P6EvidenceError("p6_stability_device_binding_invalid")
        if any(row["transcript_sha256"] != value["transcript_sha256"] \
               or row["last_sequence"] <= row["first_sequence"]
               for row in boundaries.values()):
            raise P6EvidenceError("p6_stability_transcript_or_sequence_mismatch")
        seen: set[str] = set()
        for row in boundaries.values():
            _attest(artifact_root, row["proof"], seen)
        for name, row in faults.items():
            if set(row["affected_boundaries"]) != FAULT_BOUNDARIES[name]:
                raise P6EvidenceError("p6_stability_fault_coverage_invalid")
            _attest(artifact_root, row["proof"], seen)
    except (KeyError, TypeError, P6EvidenceError) as exc:
        errors.append(str(exc) or "p6_stability_report_invalid")
    return {"schema_version": "p6-stability-finalization/1",
            "status": "passed" if not errors else "failed",
            "boundaries": 5 if not errors else 0, "faults": 5 if not errors else 0,
            "errors": sorted(set(errors))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--artifact-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = finalize(load_json(args.report.resolve(), "p6_stability_report_malformed"),
                          args.artifact_root.resolve())
    except P6EvidenceError as exc:
        result = {"schema_version": "p6-stability-finalization/1", "status": "failed",
                  "boundaries": 0, "faults": 0, "errors": [str(exc)]}
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
