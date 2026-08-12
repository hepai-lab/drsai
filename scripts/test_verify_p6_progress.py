from __future__ import annotations

import json
from pathlib import Path

import pytest

import verify_p6_progress as verifier


def _write(tmp_path: Path, name: str, value: object) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_current_ledger_is_exact_and_matches_plan() -> None:
    report = verifier.verify()
    assert report["feature_count"] == 40
    assert report["completed_count"] == 18
    assert report["progress_percent"] == 45.0
    assert report["pending_count"] == 22
    assert report["passed"] is True


def test_summary_tampering_fails_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    value["completed_count"] += 1
    with pytest.raises(verifier.P6ProgressError, match="summary_invalid"):
        verifier.verify(ledger_path=_write(tmp_path, "summary.json", value))


def test_pending_feature_cannot_be_marked_complete(tmp_path: Path) -> None:
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    row = next(item for item in value["features"] if item["pending_kinds"])
    row["completed"] = True
    with pytest.raises(verifier.P6ProgressError, match="completion_invalid"):
        verifier.verify(ledger_path=_write(tmp_path, "complete.json", value))


def test_requirement_drift_and_invalid_partition_fail_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    value["features"][0]["required_kinds"] = ["local"]
    with pytest.raises(verifier.P6ProgressError, match="requirement_drift"):
        verifier.verify(ledger_path=_write(tmp_path, "drift.json", value))
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    row = next(item for item in value["features"] if item["pending_kinds"])
    row["verified_kinds"].append(row["pending_kinds"][0])
    with pytest.raises(verifier.P6ProgressError, match="evidence_partition_invalid"):
        verifier.verify(ledger_path=_write(tmp_path, "partition.json", value))


def test_missing_blocker_and_plan_drift_fail_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    row = next(item for item in value["features"] if item["pending_kinds"])
    row["blockers"] = []
    with pytest.raises(verifier.P6ProgressError, match="blocker_missing"):
        verifier.verify(ledger_path=_write(tmp_path, "blocker.json", value))
    plan = tmp_path / "plan.md"
    plan.write_text("P6 共 **8 个模块、40 个功能点**\n当前完成 **17/40（42.50%）**", encoding="utf-8")
    with pytest.raises(verifier.P6ProgressError, match="plan_summary_drift"):
        verifier.verify(plan_path=plan)


def test_wrong_blocker_and_underreported_state_fail_closed(tmp_path: Path) -> None:
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    row = next(item for item in value["features"] if item["pending_kinds"] == ["physical"])
    row["blockers"] = ["production_evidence_pending"]
    with pytest.raises(verifier.P6ProgressError, match="blocker_evidence_mismatch"):
        verifier.verify(ledger_path=_write(tmp_path, "wrong-blocker.json", value))
    value = json.loads(verifier.LEDGER.read_text(encoding="utf-8"))
    row = next(item for item in value["features"] if item["verification_state"] == "release_pass")
    row["verification_state"] = "local_pass"
    with pytest.raises(verifier.P6ProgressError, match="state_summary_invalid"):
        verifier.verify(ledger_path=_write(tmp_path, "state.json", value))


def test_duplicate_json_key_fails_closed(tmp_path: Path) -> None:
    source = verifier.LEDGER.read_text(encoding="utf-8")
    path = tmp_path / "duplicate.json"
    path.write_text(source.replace("{", '{"schema_version":"duplicate",', 1), encoding="utf-8")
    with pytest.raises(verifier.P6ProgressError, match="duplicate_json_key"):
        verifier.verify(ledger_path=path)
