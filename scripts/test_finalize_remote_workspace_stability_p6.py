from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

import assemble_remote_workspace_stability_p6 as assembler
import finalize_remote_workspace_stability_p6 as finalizer


def _proof(root: Path, name: str) -> dict:
    relative = f"proofs/{name}.bin"
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(f"authoritative stability proof {name}".encode())
    raw = path.read_bytes()
    return {"artifact": relative, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def fixture(root: Path) -> dict:
    transcript = "f" * 64
    devices = ["a" * 64, "b" * 64]
    boundaries = []
    for name in sorted(finalizer.BOUNDARIES):
        device = devices[0] if name == "android_a" else devices[1] if name == "android_b" else None
        boundaries.append({"name": name, "device_proof_sha256": device,
                           "transcript_sha256": transcript, "first_sequence": 10,
                           "last_sequence": 110, "sample_count": 360,
                           "proof": _proof(root, f"boundary-{name}")})
    faults = [{"name": name, "status": "passed", "recovery_seconds": 10,
               "sequence_preserved": True, "transcript_preserved": True,
               "duplicate_sequence_count": 0, "missing_sequence_count": 0,
               "reexecuted_side_effect_count": 0,
               "affected_boundaries": sorted(finalizer.FAULT_BOUNDARIES[name]),
               "proof": _proof(root, f"fault-{name}")}
              for name in sorted(finalizer.FAULTS)]
    return {"schema_version": "p6-stability/1", "environment_id": "p6-test-environment",
            "source_revision": "4" * 40, "build_sha256s": ["1" * 64, "2" * 64, "3" * 64],
            "device_proof_sha256s": devices, "test_variant": "release",
            "required_duration_seconds": 3600, "observed_duration_seconds": 3601,
            "sample_count": 360, "probe_error_count": 0, "duplicate_sequence_count": 0,
            "missing_sequence_count": 0, "reexecuted_side_effect_count": 0,
            "relay_latency_p95_ms": 500, "windows_memory_slope_bytes_per_second": 100,
            "windows_handle_slope_per_second": 0.001, "transcript_sha256": transcript,
            "boundaries": boundaries, "faults": faults, "passed": True}


def test_two_device_five_boundary_one_hour_report_passes(tmp_path: Path) -> None:
    assert finalizer.finalize(fixture(tmp_path), tmp_path) == {
        "schema_version": "p6-stability-finalization/1", "status": "passed",
        "boundaries": 5, "faults": 5, "errors": [],
    }


def test_assembler_reads_exactly_five_boundary_and_fault_reports(tmp_path: Path) -> None:
    value = fixture(tmp_path)
    boundary_reports = []
    for row in value.pop("boundaries"):
        relative = f"reports/boundary-{row['name']}.json"
        path = tmp_path / relative
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps({"schema_version": "p6-stability-boundary/1", **row}),
                        encoding="utf-8")
        boundary_reports.append(relative)
    fault_reports = []
    for row in value.pop("faults"):
        relative = f"reports/fault-{row['name']}.json"
        (tmp_path / relative).write_text(
            json.dumps({"schema_version": "p6-stability-fault/1", **row}), encoding="utf-8")
        fault_reports.append(relative)
    value.pop("passed")
    value["schema_version"] = "p6-stability-manifest/1"
    value["boundary_reports"] = boundary_reports
    value["fault_reports"] = fault_reports
    report = assembler.assemble(value, tmp_path)
    assert report["passed"] is True and len(report["boundaries"]) == len(report["faults"]) == 5

    manifest_path = tmp_path / "manifest.json"
    output = tmp_path / "stability.json"
    manifest_path.write_text(json.dumps(value), encoding="utf-8")
    result = subprocess.run([
        sys.executable, str(Path(__file__).with_name("assemble_remote_workspace_stability_p6.py")),
        str(manifest_path), str(output), "--artifact-root", str(tmp_path),
    ], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert json.loads(output.read_text())["schema_version"] == "p6-stability/1"


def test_assembler_missing_duplicate_or_escape_report_fails_closed(tmp_path: Path) -> None:
    value = fixture(tmp_path)
    reports = tmp_path / "reports"
    reports.mkdir(exist_ok=True)
    boundary_reports = []
    for row in value.pop("boundaries"):
        relative = f"reports/boundary-{row['name']}.json"
        (tmp_path / relative).write_text(
            json.dumps({"schema_version": "p6-stability-boundary/1", **row}), encoding="utf-8")
        boundary_reports.append(relative)
    fault_reports = []
    for row in value.pop("faults"):
        relative = f"reports/fault-{row['name']}.json"
        (tmp_path / relative).write_text(
            json.dumps({"schema_version": "p6-stability-fault/1", **row}), encoding="utf-8")
        fault_reports.append(relative)
    value.pop("passed")
    value.update(schema_version="p6-stability-manifest/1",
                 boundary_reports=boundary_reports, fault_reports=fault_reports)
    missing = deepcopy(value)
    missing["boundary_reports"].pop()
    with pytest.raises(finalizer.P6EvidenceError, match="report_set_invalid"):
        assembler.assemble(missing, tmp_path)
    duplicate = deepcopy(value)
    duplicate["boundary_reports"][1] = duplicate["boundary_reports"][0]
    with pytest.raises(finalizer.P6EvidenceError, match="report_set_invalid"):
        assembler.assemble(duplicate, tmp_path)
    escaped = deepcopy(value)
    escaped["boundary_reports"][0] = "../outside.json"
    with pytest.raises(finalizer.P6EvidenceError, match="artifact"):
        assembler.assemble(escaped, tmp_path)


@pytest.mark.parametrize(("mutate", "code"), [
    (lambda v: v.__setitem__("observed_duration_seconds", 3599), "schema_validation_failed"),
    (lambda v: v.__setitem__("test_variant", "debug"), "schema_validation_failed"),
    (lambda v: v.__setitem__("probe_error_count", 1), "schema_validation_failed"),
    (lambda v: v["boundaries"].pop(), "schema_validation_failed"),
    (lambda v: v["faults"].pop(), "schema_validation_failed"),
    (lambda v: v["boundaries"][0].__setitem__("transcript_sha256", "e" * 64),
     "transcript_or_sequence_mismatch"),
    (lambda v: v["boundaries"][1].__setitem__(
        "device_proof_sha256", v["boundaries"][0]["device_proof_sha256"]
    ), "device_binding_invalid"),
    (lambda v: v["faults"][0].__setitem__("affected_boundaries", ["relay"]),
     "fault_coverage_invalid"),
])
def test_duration_debug_error_boundary_transcript_device_or_fault_fails_closed(
    tmp_path: Path, mutate, code: str,
) -> None:
    value = fixture(tmp_path)
    mutate(value)
    assert any(code in error for error in finalizer.finalize(value, tmp_path)["errors"])


def test_tampered_or_reused_proof_and_duplicate_json_fail_closed(tmp_path: Path) -> None:
    value = fixture(tmp_path)
    proof = value["boundaries"][0]["proof"]
    (tmp_path / proof["artifact"]).write_bytes(b"tampered")
    assert "p6_stability_proof_attestation_invalid" in finalizer.finalize(value, tmp_path)["errors"]
    root = tmp_path / "reuse"
    value = fixture(root)
    value["faults"][0]["proof"] = deepcopy(value["boundaries"][0]["proof"])
    assert "p6_stability_proof_reused" in finalizer.finalize(value, root)["errors"]
    report = root / "report.json"
    report.write_text('{"schema_version":"p6-stability/1","schema_version":"x"}', encoding="utf-8")
    result = subprocess.run([sys.executable, str(Path(__file__).with_name(
        "finalize_remote_workspace_stability_p6.py")), str(report), "--artifact-root", str(root)],
        capture_output=True, text=True, check=False)
    assert result.returncode == 1 and "p6_duplicate_json_key" in result.stdout
