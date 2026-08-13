from __future__ import annotations

import json
from pathlib import Path

import pytest

import verify_p6_two_device_stability as verifier


def test_two_device_stability_contract_is_complete_but_execution_is_pending() -> None:
    report = verifier.verify()
    assert report["required_duration_seconds"] == 3600
    assert report["boundary_count"] == 5 and report["fault_count"] == 5
    assert report["physical_device_count"] == 2
    assert report["release_only"] is True and report["real_execution_pending"] is True


def test_missing_boundary_or_fault_fails_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.SCHEMA.read_text(encoding="utf-8"))
    value["$defs"]["boundary"]["properties"]["name"]["enum"].pop()
    path = tmp_path / "boundary.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(verifier.P6StabilityVerifierError, match="coverage_invalid"):
        verifier.verify(path)
    value = json.loads(verifier.SCHEMA.read_text(encoding="utf-8"))
    value["$defs"]["fault"]["properties"]["name"]["enum"].pop()
    path = tmp_path / "fault.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(verifier.P6StabilityVerifierError, match="coverage_invalid"):
        verifier.verify(path)


def test_duplicate_schema_key_fails_closed(tmp_path: Path) -> None:
    source = verifier.SCHEMA.read_text(encoding="utf-8")
    path = tmp_path / "duplicate.json"
    path.write_text(source.replace("{", '{"$schema":"duplicate",', 1), encoding="utf-8")
    with pytest.raises(verifier.P6StabilityVerifierError, match="duplicate_key"):
        verifier.verify(path)
