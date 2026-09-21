from __future__ import annotations

import json
from pathlib import Path

from opendrsai_dsh_runtime.release_gate import build_real_dsh_matrix, build_release_report, scan_release_artifacts


def _probe(*, eligible: bool = False) -> dict:
    return {
        "source_commit": "a" * 40,
        "carrier": {"kind": "executable" if eligible else "development-node"},
        "native_identity": {
            "server_name": "deepseek-harness-sdk-runtime", "server_version": "0.0.1",
            "contract_sha256": "b" * 64, "methods": ["initialize"], "notifications": ["session.event"],
        },
        "compatibility": {
            "state": "available" if eligible else "probe_only", "profile_id": "dsh-sdk/0.1.0-rc.5",
            "missing_methods": [], "missing_notifications": [],
            "missing_capabilities": [] if eligible else ["run.cancel"],
        },
        "production_eligible": eligible,
    }


def test_real_matrix_records_real_probe_and_honest_no_go() -> None:
    matrix = build_real_dsh_matrix(_probe())
    assert matrix["source"] == "real-dsh-process"
    assert matrix["deployment_verdict"] == "no_go"
    assert matrix["missing"]["capabilities"] == ["run.cancel"]


def test_security_scan_reports_only_fingerprint_not_secret(tmp_path: Path) -> None:
    clean = tmp_path / "clean.txt"
    clean.write_text("DEEPSEEK_API_KEY is resolved from the environment", encoding="utf-8")
    assert scan_release_artifacts([clean])["passed"] is True
    bad = tmp_path / "bad.txt"
    token = "sk-" + "x" * 32
    bad.write_text(token, encoding="utf-8")
    report = scan_release_artifacts([bad])
    assert report["passed"] is False
    assert report["findings"][0]["kind"] == "provider_token"
    assert token not in json.dumps(report)


def test_release_report_separates_delivery_acceptance_from_deployment_go() -> None:
    matrix = build_real_dsh_matrix(_probe())
    report = build_release_report(
        ledger={"progress": {"accepted_features": 50, "total_features": 50}}, real_matrix=matrix,
        wheel={"wheel_sha256": "c" * 64}, security={"passed": True}, pressure={"passed": True},
    )
    assert report["delivery_verdict"] == "accepted"
    assert report["deployment_verdict"] == "no_go"
    assert report["deployment_blockers"] == ["run.cancel"]
