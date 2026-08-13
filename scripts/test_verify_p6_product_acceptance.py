from __future__ import annotations

import json
from pathlib import Path

import pytest

import verify_p6_product_acceptance as verifier


def test_product_contract_covers_ten_release_journeys_without_claiming_execution() -> None:
    report = verifier.verify()
    assert report["journey_count"] == 10
    assert report["accessibility_check_count"] == 5
    assert report["release_only"] is True
    assert report["two_physical_devices_required"] is True
    assert report["real_execution_pending"] is True


def test_missing_journey_or_accessibility_check_fails_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.SCHEMA.read_text(encoding="utf-8"))
    value["$defs"]["journey"]["properties"]["name"]["enum"].pop()
    path = tmp_path / "journey.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(verifier.P6ProductAcceptanceError, match="coverage_invalid"):
        verifier.verify(path)
    value = json.loads(verifier.SCHEMA.read_text(encoding="utf-8"))
    value["properties"]["accessibility_checks"]["items"]["enum"].pop()
    path = tmp_path / "accessibility.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(verifier.P6ProductAcceptanceError, match="coverage_invalid"):
        verifier.verify(path)


def test_duplicate_schema_key_fails_closed(tmp_path: Path) -> None:
    source = verifier.SCHEMA.read_text(encoding="utf-8")
    path = tmp_path / "duplicate.json"
    path.write_text(source.replace("{", '{"$schema":"duplicate",', 1), encoding="utf-8")
    with pytest.raises(verifier.P6ProductAcceptanceError, match="duplicate_key"):
        verifier.verify(path)
