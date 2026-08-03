from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/verify_oaep_stage3_completion_audit.py"
SPEC = importlib.util.spec_from_file_location("oaep_stage3_completion_audit", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _ready_report(ready: bool) -> dict:
    return {
        "ready_for_real_device_e2e": ready,
        "adb": {
            "available": True,
            "path": "adb",
            "devices": [{"serial": "R5GYB3S8ACH", "kind": "physical"}] if ready else [],
        },
        "blockers": [] if ready else [{"code": "physical_android_device_missing", "message": "missing"}],
        "real_device_command": "python scripts/accept_mobile_remote_workspace_real_device_v4.py ...",
    }


def test_completion_audit_covers_all_stage3_features() -> None:
    report = MODULE.build_report(root=ROOT, readiness=_ready_report(False), require_complete=False, real_report=None)
    assert report["audit_valid"] is True
    assert report["feature_total"] == 46
    assert report["expected_feature_total"] == 46
    assert sum(report["counts"].values()) == 46
    assert {row["module"] for row in report["module_summaries"]} == {
        "M01",
        "M02",
        "M03",
        "M04",
        "M05",
        "M06",
        "M07",
        "M08",
    }


def test_windows_package_exposes_progress_and_completion_gates() -> None:
    package = json.loads((ROOT / "apps/desktop/windows/package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]
    assert "verify:oaep-stage3-audit" in scripts
    assert "verify:oaep-stage3-complete" in scripts
    assert "--require-complete" not in scripts["verify:oaep-stage3-audit"]
    assert "--require-complete" in scripts["verify:oaep-stage3-complete"]


def test_completion_audit_does_not_claim_physical_e2e_when_device_missing() -> None:
    report = MODULE.build_report(root=ROOT, readiness=_ready_report(False), require_complete=False, real_report=None)
    assert report["passed"] is True
    assert report["complete"] is False
    assert report["counts"]["needs_physical_e2e"] == 9
    assert any(row["code"] == "physical_android_device_missing" for row in report["blockers"])
    assert any(row["id"] == "M06-F01" for row in report["needs_physical_e2e"])


def test_completion_audit_can_fail_closed_for_release_completion() -> None:
    report = MODULE.build_report(root=ROOT, readiness=_ready_report(False), require_complete=True, real_report=None)
    assert report["passed"] is False
    assert report["complete"] is False


def test_completion_audit_still_requires_feature_e2e_even_when_device_ready() -> None:
    report = MODULE.build_report(root=ROOT, readiness=_ready_report(True), require_complete=True, real_report=None)
    assert report["passed"] is False
    assert report["complete"] is False
    assert report["readiness"]["ready_for_real_device_e2e"] is True
    assert report["counts"]["needs_physical_e2e"] == 9


def test_completion_audit_reports_missing_real_evidence_when_device_is_ready(tmp_path: Path) -> None:
    missing = tmp_path / "real-device-oaep-e2e.json"
    report = MODULE.build_report(
        root=ROOT,
        readiness=_ready_report(True),
        require_complete=True,
        real_report=missing,
    )
    assert report["passed"] is False
    assert report["complete"] is False
    assert report["real_report"] == str(missing)
    assert any(row["code"] == "stage3_real_evidence_missing" for row in report["blockers"])


def _real_report() -> dict:
    digest = "a" * 64
    return {
        "passed": True,
        "protocol": "oaep/1",
        "devices": [
            {"device_proof_sha256": "b" * 64},
            {"device_proof_sha256": "c" * 64},
        ],
        "checks": [
            {"name": "pair_and_catalog", "status": "passed"},
            {"name": "two_device_isolation", "status": "passed"},
            {
                "name": "windows_to_android_two_runs",
                "status": "passed",
                "run_count": 2,
                "duplicate_sequence_count": 0,
                "missing_sequence_count": 0,
            },
            {
                "name": "android_to_windows_two_runs",
                "status": "passed",
                "run_count": 2,
                "duplicate_run_count": 0,
                "missing_sequence_count": 0,
            },
            {
                "name": "oaep_hash_convergence",
                "status": "passed",
                "runtime_sha256": digest,
                "windows_sha256": digest,
                "android_sha256": digest,
            },
            {
                "name": "approval_single_decision",
                "status": "passed",
                "successful_decisions": 1,
                "tool_execution_count": 1,
            },
            {
                "name": "file_change_safe_paths",
                "status": "passed",
                "file_change_count": 1,
                "safe_relative_paths": True,
                "absolute_path_count": 0,
                "sensitive_field_count": 0,
            },
            {"name": "revocation_stream_closed", "status": "passed", "subsequent_status": 403},
        ],
    }


def test_completion_audit_upgrades_physical_features_from_real_evidence(tmp_path: Path) -> None:
    real_path = tmp_path / "real-device-oaep-e2e.json"
    real_path.write_text(__import__("json").dumps(_real_report()), encoding="utf-8")
    report = MODULE.build_report(
        root=ROOT,
        readiness=_ready_report(False),
        require_complete=True,
        real_report=real_path,
    )
    assert report["passed"] is True
    assert report["complete"] is True
    assert report["counts"]["passed_real"] == 9
    assert any(row["module"] == "M06" and row["status"] == "passed_real" for row in report["module_summaries"])
    assert report["needs_physical_e2e"] == []
    assert report["real_evidence"]["oaep_sha256"] == "a" * 64


@pytest.mark.parametrize("mutation,error", [
    ("missing_hash", "stage3_real_evidence_checks_missing"),
    ("non_hex_hash", "stage3_real_evidence_oaep_hash_invalid"),
    ("non_hex_device", "stage3_real_evidence_device_proofs_invalid"),
    ("absolute_file_path", "stage3_real_evidence_file_paths_invalid"),
])
def test_completion_audit_fails_closed_on_invalid_real_evidence(
    tmp_path: Path,
    mutation: str,
    error: str,
) -> None:
    real_path = tmp_path / "real-device-oaep-e2e.json"
    value = _real_report()
    if mutation == "missing_hash":
        value["checks"] = [row for row in value["checks"] if row["name"] != "oaep_hash_convergence"]
    elif mutation == "non_hex_hash":
        next(row for row in value["checks"] if row["name"] == "oaep_hash_convergence")["android_sha256"] = "z" * 64
    elif mutation == "non_hex_device":
        value["devices"][0]["device_proof_sha256"] = "z" * 64
    elif mutation == "absolute_file_path":
        next(row for row in value["checks"] if row["name"] == "file_change_safe_paths")["absolute_path_count"] = 1
    real_path.write_text(__import__("json").dumps(value), encoding="utf-8")
    report = MODULE.build_report(
        root=ROOT,
        readiness=_ready_report(False),
        require_complete=True,
        real_report=real_path,
    )
    assert report["passed"] is False
    assert report["complete"] is False
    assert any(row["code"] == "stage3_real_evidence_invalid" for row in report["blockers"])
    assert any(error in row["message"] for row in report["blockers"])
