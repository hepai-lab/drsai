from __future__ import annotations

import json
from pathlib import Path

import pytest

import verify_p6_evidence_finalizer as verifier


def _write(tmp_path: Path, name: str, value: object) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_all_40_features_have_explicit_current_p6_evidence_requirements() -> None:
    report = verifier.verify()
    assert report["feature_count"] == 40
    assert report["p5_completion_inherited"] is False
    assert report["production_bundle_required"] is True
    assert all(value > 0 for value in report["required_evidence_counts"].values())


def test_missing_duplicate_or_p5_feature_requirement_fails_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.REQUIREMENTS.read_text(encoding="utf-8"))
    value["features"].pop()
    with pytest.raises(verifier.P6EvidenceVerifierError, match="requirements_invalid"):
        verifier.verify(requirements_path=_write(tmp_path, "missing.json", value))
    value = json.loads(verifier.REQUIREMENTS.read_text(encoding="utf-8"))
    value["features"][1] = value["features"][0]
    with pytest.raises(verifier.P6EvidenceVerifierError, match="feature_set_invalid"):
        verifier.verify(requirements_path=_write(tmp_path, "duplicate.json", value))
    value = json.loads(verifier.REQUIREMENTS.read_text(encoding="utf-8"))
    value["features"][0]["id"] = "P5-M01-F01"
    with pytest.raises(verifier.P6EvidenceVerifierError, match="feature_set_invalid"):
        verifier.verify(requirements_path=_write(tmp_path, "p5.json", value))


def test_invalid_kind_and_duplicate_json_key_fail_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.REQUIREMENTS.read_text(encoding="utf-8"))
    value["features"][0]["required_kinds"] = ["mock"]
    with pytest.raises(verifier.P6EvidenceVerifierError, match="feature_requirement_invalid"):
        verifier.verify(requirements_path=_write(tmp_path, "kind.json", value))
    source = verifier.REQUIREMENTS.read_text(encoding="utf-8")
    path = tmp_path / "duplicate-key.json"
    path.write_text(source.replace("{", '{"schema_version":"duplicate",', 1), encoding="utf-8")
    with pytest.raises(verifier.P6EvidenceVerifierError, match="duplicate_json_key"):
        verifier.verify(requirements_path=path)
