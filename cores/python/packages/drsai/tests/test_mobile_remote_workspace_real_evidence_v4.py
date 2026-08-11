from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/assemble_mobile_remote_workspace_real_evidence_v4.py"
SPEC = importlib.util.spec_from_file_location("mobile_real_evidence_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

DIGEST = "a" * 64


def reports():
    checks = [
        {"name": "pre_pair_invisible", "status": "passed", "target_visible": False},
        {
            "name": "pair_and_catalog",
            "status": "passed",
            "target_visible": True,
            "runtime_status": "online",
            "directory_ui_visible": True,
            "session_list_ui_visible": True,
        },
        {
            "name": "two_device_isolation",
            "status": "passed",
            "device_a_revoked_status": 403,
            "device_b_status": 200,
            "credential_copy_rejected": True,
        },
        *[
            {
                "name": name,
                "status": "passed",
                "run_count": 2,
                "duplicate_run_count": 0,
                "missing_sequence_count": 0,
                "delta_run_count": 2,
                "terminal_run_count": 2,
                "p95_seconds": 0.2,
                **(
                    {"tool_run_count": 2}
                    if name == "windows_to_android_two_runs" else {}
                ),
            }
            for name in ("windows_to_android_two_runs", "android_to_windows_two_runs")
        ],
        {
            "name": "oaep_hash_convergence",
            "status": "passed",
            "runtime_sha256": DIGEST,
            "windows_sha256": DIGEST,
            "android_sha256": DIGEST,
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
        {
            "name": "revocation_stream_closed",
            "status": "passed",
            "subsequent_status": 403,
            "stream_closed_immediately": True,
            "other_device_stream_open": True,
            "close_seconds": 0.5,
        },
    ]
    return [{"passed": True, "checks": checks}]


def devices():
    return {
        "passed": True,
        "devices": [
            {"device_proof_sha256": "b" * 64},
            {"device_proof_sha256": "c" * 64},
        ],
    }


def stability():
    return {
        "passed": True,
        "required_duration_seconds": 3600,
        "observed_duration_seconds": 3601,
        "probe_error_count": 0,
        "oaep_hash_stable": True,
        "faults": [
            {
                "name": name,
                "status": "passed",
                "oaep_hash_preserved": True,
                "sequence_preserved": True,
                "duplicate_sequence_count": 0,
                "missing_sequence_count": 0,
            }
            for name in MODULE.REQUIRED_FAULTS
        ],
    }


def test_v4_real_evidence_assembles_all_release_checks() -> None:
    result = MODULE.assemble(reports(), devices(), stability())
    assert result["passed"] is True and result["protocol"] == "oaep/1"
    assert {row["name"] for row in result["checks"]} == MODULE.REQUIRED_CHECKS
    assert {row["id"] for row in result["v3_inherited"]} == MODULE.V3_INHERITED
    assert next(row for row in result["checks"] if row["name"] == "two_device_isolation")["device_a_status"] == 403


@pytest.mark.parametrize(
    "mutation,error",
    [
        ("duplicate_device", "v4_device_proofs_invalid"),
        ("short_duration", "v4_stability_invalid"),
        ("missing_fault", "v4_faults_incomplete"),
        ("hash_drift", "v4_oaep_hash_mismatch"),
        ("slow_delivery", "v4_windows_to_android_two_runs_invalid"),
        ("missing_tool", "v4_windows_to_android_two_runs_invalid"),
        ("missing_delta", "v4_android_to_windows_two_runs_invalid"),
        ("absolute_file_path", "v4_file_change_paths_invalid"),
    ],
)
def test_v4_real_evidence_fails_closed(mutation: str, error: str) -> None:
    report_rows, device_rows, stable = reports(), devices(), stability()
    if mutation == "duplicate_device":
        device_rows["devices"][1]["device_proof_sha256"] = "b" * 64
    elif mutation == "short_duration":
        stable["observed_duration_seconds"] = 3599
    elif mutation == "missing_fault":
        stable["faults"].pop()
    elif mutation == "hash_drift":
        next(row for row in report_rows[0]["checks"] if row["name"] == "oaep_hash_convergence")["android_sha256"] = "d" * 64
    elif mutation == "slow_delivery":
        next(row for row in report_rows[0]["checks"] if row["name"] == "windows_to_android_two_runs")["p95_seconds"] = 2
    elif mutation == "missing_tool":
        next(row for row in report_rows[0]["checks"] if row["name"] == "windows_to_android_two_runs")["tool_run_count"] = 1
    elif mutation == "missing_delta":
        next(row for row in report_rows[0]["checks"] if row["name"] == "android_to_windows_two_runs")["delta_run_count"] = 1
    elif mutation == "absolute_file_path":
        next(row for row in report_rows[0]["checks"] if row["name"] == "file_change_safe_paths")["absolute_path_count"] = 1
    with pytest.raises(RuntimeError, match=error):
        MODULE.assemble(report_rows, device_rows, stable)
