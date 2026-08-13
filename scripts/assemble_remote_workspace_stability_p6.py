#!/usr/bin/env python3
"""Assemble five endpoint-local reports into the P6 one-hour stability report."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from finalize_remote_workspace_p6 import P6EvidenceError, _path, load_json
from finalize_remote_workspace_stability_p6 import BOUNDARIES, FAULTS, finalize


MANIFEST_KEYS = {
    "schema_version", "environment_id", "source_revision", "build_sha256s",
    "device_proof_sha256s", "test_variant", "required_duration_seconds",
    "observed_duration_seconds", "sample_count", "probe_error_count",
    "duplicate_sequence_count", "missing_sequence_count",
    "reexecuted_side_effect_count", "relay_latency_p95_ms",
    "windows_memory_slope_bytes_per_second", "windows_handle_slope_per_second",
    "transcript_sha256", "boundary_reports", "fault_reports",
}


def _rows(root: Path, paths: object, expected_schema: str,
          expected_names: set[str]) -> list[dict[str, Any]]:
    if not isinstance(paths, list) or len(paths) != len(expected_names) \
            or len(paths) != len(set(paths)):
        raise P6EvidenceError("p6_stability_manifest_report_set_invalid")
    rows = []
    for raw_path in paths:
        if not isinstance(raw_path, str):
            raise P6EvidenceError("p6_stability_manifest_report_path_invalid")
        path = _path(root, raw_path)
        row = load_json(path, "p6_stability_endpoint_report_invalid")
        if row.pop("schema_version", None) != expected_schema:
            raise P6EvidenceError("p6_stability_endpoint_report_invalid")
        rows.append(row)
    names = {row.get("name") for row in rows}
    if names != expected_names or len(rows) != len(names):
        raise P6EvidenceError("p6_stability_manifest_report_set_invalid")
    return rows


def assemble(manifest: dict[str, Any], artifact_root: Path) -> dict[str, Any]:
    if set(manifest) != MANIFEST_KEYS or manifest.get("schema_version") != "p6-stability-manifest/1":
        raise P6EvidenceError("p6_stability_manifest_shape_invalid")
    boundaries = _rows(artifact_root, manifest["boundary_reports"],
                       "p6-stability-boundary/1", BOUNDARIES)
    faults = _rows(artifact_root, manifest["fault_reports"],
                   "p6-stability-fault/1", FAULTS)
    report = {key: value for key, value in manifest.items()
              if key not in {"boundary_reports", "fault_reports"}}
    report["schema_version"] = "p6-stability/1"
    report["boundaries"] = boundaries
    report["faults"] = faults
    report["passed"] = True
    result = finalize(report, artifact_root)
    if result["status"] != "passed":
        raise P6EvidenceError("p6_stability_assembly_failed:" + ",".join(result["errors"]))
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--artifact-root", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = assemble(load_json(args.manifest.resolve(), "p6_stability_manifest_malformed"),
                          args.artifact_root.resolve())
    except P6EvidenceError as exc:
        print(json.dumps({"passed": False, "error": str(exc)}, sort_keys=True, separators=(",", ":")))
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"boundaries": 5, "faults": 5, "passed": True}, sort_keys=True,
                     separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
