"""Assemble endpoint-local stability attestations into the P5 release report.

The input reports are content-free.  Raw transcripts stay at their trust
boundary; only their canonical SHA-256 and environment binding are merged.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from finalize_remote_workspace_p5 import REQUIRED_FAULTS, _digest


def _read(path: Path) -> dict[str, Any]:
    if not path.is_file() or not path.read_bytes():
        raise RuntimeError(f"p5_stability_input_missing:{path.name}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"p5_stability_input_invalid:{path.name}")
    return value


def assemble(base: dict[str, Any], endpoints: list[dict[str, Any]], environment_id: str) -> dict[str, Any]:
    if base.get("passed") is not True:
        raise RuntimeError("p5_base_stability_not_passed")
    if int(base.get("required_duration_seconds", 0)) < 3600 or float(base.get("observed_duration_seconds", 0)) < 3600:
        raise RuntimeError("p5_base_stability_duration_incomplete")
    faults = base.get("faults")
    if not isinstance(faults, list):
        raise RuntimeError("p5_base_stability_faults_missing")
    indexed = {row.get("name"): row for row in faults if isinstance(row, dict)}
    if set(indexed) != REQUIRED_FAULTS or len(faults) != len(REQUIRED_FAULTS):
        raise RuntimeError("p5_base_stability_faults_incomplete")
    hashes: dict[str, str] = {}
    for endpoint in endpoints:
        boundary = endpoint.get("boundary")
        digest = endpoint.get("transcript_sha256")
        if endpoint.get("schema_version") != "p5-stability-endpoint/1" or endpoint.get("passed") is not True:
            raise RuntimeError("p5_stability_endpoint_invalid")
        if endpoint.get("environment_id") != environment_id:
            raise RuntimeError("p5_stability_mixed_environment")
        if boundary not in {"android", "desktop", "runtime"} or not _digest(digest):
            raise RuntimeError("p5_stability_endpoint_attestation_invalid")
        if boundary in hashes:
            raise RuntimeError("p5_stability_duplicate_boundary")
        hashes[str(boundary)] = str(digest)
    if set(hashes) != {"android", "desktop", "runtime"} or len(set(hashes.values())) != 1:
        raise RuntimeError("p5_stability_transcript_mismatch")
    normalized_faults = []
    for name in sorted(REQUIRED_FAULTS):
        row = indexed[name]
        normalized_faults.append({
            "name": name,
            "status": row.get("status"),
            "sequence_preserved": bool(row.get("sequence_preserved")),
            "transcript_preserved": bool(row.get("transcript_preserved", row.get("oaep_hash_preserved"))),
            "duplicate_sequence_count": int(row.get("duplicate_sequence_count", -1)),
            "missing_sequence_count": int(row.get("missing_sequence_count", -1)),
            "reexecuted_side_effect_count": int(row.get("reexecuted_side_effect_count", -1)),
        })
    report = {
        "schema_version": "p5-stability/1",
        "environment_id": environment_id,
        "passed": True,
        "required_duration_seconds": int(base["required_duration_seconds"]),
        "observed_duration_seconds": float(base["observed_duration_seconds"]),
        "probe_error_count": int(base.get("probe_error_count", -1)),
        "duplicate_sequence_count": int(base.get("duplicate_sequence_count", 0)),
        "missing_sequence_count": int(base.get("missing_sequence_count", 0)),
        "reexecuted_side_effect_count": int(base.get("reexecuted_side_effect_count", 0)),
        "relay_latency_p95_ms": float(base.get("relay_latency_p95_ms", 999999)),
        "windows_memory_slope_bytes_per_second": float(base.get("windows_memory_slope_bytes_per_second", 999999)),
        "windows_handle_slope_per_second": float(base.get("windows_handle_slope_per_second", 999999)),
        "transcript_hashes": hashes,
        "faults": normalized_faults,
    }
    # Reuse the release validator's exact policy without accepting the rest of a ledger.
    from finalize_remote_workspace_p5 import finalize
    validation_report = {
        **report,
        # The final ledger assembler binds this report to its physical output.
        # These placeholders only let this stage reuse the semantic policy.
        "artifact": "stability-report.json",
        "artifact_bytes": 1,
        "artifact_sha256": "0" * 64,
    }
    skeleton = {
        "schema_version": "p5/1", "environment": {"environment_id": environment_id},
        "stability_report": validation_report,
    }
    stability_errors = [error for error in finalize(skeleton)["errors"] if error.startswith("p5_stability")]
    if stability_errors:
        raise RuntimeError(";".join(stability_errors))
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--android", type=Path, required=True)
    parser.add_argument("--desktop", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = assemble(_read(args.base), [_read(args.android), _read(args.desktop), _read(args.runtime)], args.environment_id)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
