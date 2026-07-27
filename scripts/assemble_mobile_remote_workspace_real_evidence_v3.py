"""Assemble strict real-device V3 evidence from independently executed gates."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


FAULT_TO_CHECK = {
    "android_background": "background_recovery",
    "android_process_death": "process_death_recovery",
    "network_change": "network_recovery",
    "runtime_restart": "runtime_restart_recovery",
    "relay_restart": "relay_restart_recovery",
}


def read_report(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"v3_{label}_report_unreadable") from exc
    if not isinstance(value, dict) or value.get("passed") is not True:
        raise RuntimeError(f"v3_{label}_report_failed")
    return value


def checks(report: dict[str, Any], label: str) -> dict[str, dict[str, Any]]:
    rows = report.get("checks")
    if not isinstance(rows, list):
        raise RuntimeError(f"v3_{label}_checks_missing")
    passed = [
        row
        for row in rows
        if isinstance(row, dict) and row.get("status") == "passed"
    ]
    indexed = {str(row.get("name")): row for row in passed}
    if len(indexed) != len(passed):
        raise RuntimeError(f"v3_{label}_checks_duplicate")
    return indexed


def _catalog_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    indexed = checks(report, "catalog")
    try:
        pre = indexed["pre_pair_invisible"]
        catalog = indexed["pair_and_catalog"]
        approval = indexed["message_stream_approval"]
    except KeyError as exc:
        raise RuntimeError(f"v3_catalog_check_missing:{exc.args[0]}") from exc
    if pre.get("target_visible") is not False:
        raise RuntimeError("v3_pre_pair_invisible_invalid")
    if not (
        catalog.get("target_visible") is True
        and catalog.get("runtime_status") == "online"
        and catalog.get("workspace_lifecycles") == ["active"]
        and catalog.get("directory_ui_visible") is True
        and catalog.get("session_list_ui_visible") is True
    ):
        raise RuntimeError("v3_pair_catalog_invalid")
    if not (
        approval.get("approval_status") == "approved"
        and approval.get("terminal_status") == "completed"
        and int(approval.get("successful_decisions", 0)) == 1
        and int(approval.get("tool_execution_count", 0)) == 1
        and approval.get("session_ui_visible") is True
    ):
        raise RuntimeError("v3_approval_invalid")
    return [
        dict(pre),
        dict(catalog),
        {
            "name": "approval_single_decision",
            "status": "passed",
            "successful_decisions": 1,
            "tool_execution_count": 1,
        },
    ]


def _device_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    indexed = checks(report, "device")
    try:
        isolation = indexed["two_device_isolation"]
        revoked = indexed["revocation_stream_closed"]
    except KeyError as exc:
        raise RuntimeError(f"v3_device_check_missing:{exc.args[0]}") from exc
    if not (
        isolation.get("device_a_revoked_status") == 403
        and isolation.get("device_b_status") == 200
        and isolation.get("credential_copy_rejected") is True
        and isolation.get("independent_association_ids") is True
    ):
        raise RuntimeError("v3_two_device_isolation_invalid")
    if not (
        revoked.get("stream_closed_immediately") is True
        and revoked.get("subsequent_status") == 403
        and revoked.get("other_device_stream_open") is True
    ):
        raise RuntimeError("v3_revocation_stream_invalid")
    return [dict(isolation), dict(revoked)]


def _recovery_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    faults = report.get("faults")
    if not isinstance(faults, list):
        raise RuntimeError("v3_stability_faults_missing")
    indexed = {
        str(row.get("name")): row
        for row in faults
        if isinstance(row, dict) and row.get("status") == "passed"
    }
    if set(indexed) != set(FAULT_TO_CHECK):
        raise RuntimeError("v3_stability_fault_matrix_invalid")
    result = []
    for fault_name, check_name in FAULT_TO_CHECK.items():
        row = indexed[fault_name]
        if not (
            row.get("transcript_hash_preserved") is True
            and row.get("snapshot_sequence_preserved") is True
            and row.get("run_count_preserved") is True
            and row.get("event_count_preserved") is True
            and row.get("identity_transition_valid") is True
            and int(row.get("duplicate_run_count", -1)) == 0
            and int(row.get("duplicate_sequence_count", -1)) == 0
            and int(row.get("missing_sequence_count", -1)) == 0
        ):
            raise RuntimeError(f"v3_stability_fault_invalid:{fault_name}")
        result.append(
            {
                "name": check_name,
                "status": "passed",
                "transcript_hash_preserved": True,
                "run_count_preserved": True,
                "event_count_preserved": True,
                "duplicate_run_count": 0,
                "duplicate_sequence_count": 0,
                "missing_sequence_count": 0,
                "recovery_seconds": row.get("recovery_seconds"),
            }
        )
    return result


def assemble(
    catalog_report: dict[str, Any],
    device_report: dict[str, Any],
    stability_report: dict[str, Any],
) -> dict[str, Any]:
    if stability_report.get("passed") is not True:
        raise RuntimeError("v3_stability_report_failed")
    rows = [
        *_catalog_rows(catalog_report),
        *_device_rows(device_report),
        *_recovery_rows(stability_report),
    ]
    names = [str(row["name"]) for row in rows]
    if len(names) != len(set(names)):
        raise RuntimeError("v3_real_evidence_duplicate")
    return {
        "schema_version": 1,
        "profile": "mobile-remote-workspace-v3",
        "passed": True,
        "checks": rows,
    }


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    evidence = Path("release/product-evidence/mobile-remote-workspace-v3")
    parser.add_argument("--catalog-report", type=Path, required=True)
    parser.add_argument("--device-report", type=Path, required=True)
    parser.add_argument(
        "--stability-report",
        type=Path,
        default=evidence / "real-stability-1h.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=evidence / "real-device-session-e2e.json",
    )
    args = parser.parse_args()
    result = assemble(
        read_report(args.catalog_report, "catalog"),
        read_report(args.device_report, "device"),
        read_report(args.stability_report, "stability"),
    )
    atomic_json(args.output, result)
    print(json.dumps({"passed": True, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
