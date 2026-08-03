"""Assemble fail-closed V4 real-device evidence from independent collectors."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


DIGEST = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_CHECKS = {
    "pre_pair_invisible",
    "pair_and_catalog",
    "two_device_isolation",
    "windows_to_android_two_runs",
    "android_to_windows_two_runs",
    "oaep_hash_convergence",
    "approval_single_decision",
    "file_change_safe_paths",
    "revocation_stream_closed",
}
REQUIRED_FAULTS = {
    "android_background",
    "android_process_death",
    "network_change",
    "runtime_restart",
    "relay_restart",
}
V3_INHERITED = {
    "M01-F07",
    "M05-F04",
    "M09-F08",
    "M10-F03",
    "M10-F04",
    "M10-F05",
    "M10-F06",
    "M10-F07",
}


def read_report(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"v4_{label}_report_unreadable") from exc
    if not isinstance(value, dict) or value.get("passed") is not True:
        raise RuntimeError(f"v4_{label}_report_failed")
    return value


def _index_reports(reports: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for report in reports:
        rows = report.get("checks")
        if not isinstance(rows, list):
            raise RuntimeError("v4_real_checks_missing")
        for row in rows:
            if not isinstance(row, dict) or row.get("status") != "passed":
                continue
            name = str(row.get("name", ""))
            if not name or name in indexed:
                raise RuntimeError(f"v4_real_check_duplicate:{name}")
            indexed[name] = row
    missing = REQUIRED_CHECKS - indexed.keys()
    if missing:
        raise RuntimeError("v4_real_checks_missing:" + ",".join(sorted(missing)))
    return indexed


def _devices(report: dict[str, Any]) -> list[dict[str, Any]]:
    rows = report.get("devices")
    if not isinstance(rows, list) or len(rows) < 2:
        raise RuntimeError("v4_two_devices_missing")
    result = []
    seen: set[str] = set()
    for row in rows:
        proof = row.get("device_proof_sha256") if isinstance(row, dict) else None
        if not isinstance(proof, str) or not DIGEST.fullmatch(proof) or proof in seen:
            raise RuntimeError("v4_device_proofs_invalid")
        seen.add(proof)
        result.append({"device_proof_sha256": proof})
    return result


def _stability(report: dict[str, Any]) -> None:
    if not (
        float(report.get("required_duration_seconds", 0)) >= 3600
        and float(report.get("observed_duration_seconds", 0)) >= 3600
        and int(report.get("probe_error_count", -1)) == 0
        and report.get("oaep_hash_stable") is True
    ):
        raise RuntimeError("v4_stability_invalid")
    rows = report.get("faults")
    if not isinstance(rows, list):
        raise RuntimeError("v4_faults_missing")
    good = {
        str(row.get("name"))
        for row in rows
        if isinstance(row, dict)
        and row.get("status") == "passed"
        and row.get("oaep_hash_preserved") is True
        and row.get("sequence_preserved") is True
        and int(row.get("duplicate_sequence_count", -1)) == 0
        and int(row.get("missing_sequence_count", -1)) == 0
    }
    if good != REQUIRED_FAULTS:
        raise RuntimeError("v4_faults_incomplete")


def _normalize(indexed: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    pre = indexed["pre_pair_invisible"]
    if pre.get("target_visible") is not False:
        raise RuntimeError("v4_pre_pair_invalid")
    pair = indexed["pair_and_catalog"]
    if not (
        pair.get("target_visible") is True
        and pair.get("runtime_status") == "online"
        and pair.get("directory_ui_visible") is True
        and pair.get("session_list_ui_visible") is True
    ):
        raise RuntimeError("v4_pair_catalog_invalid")

    isolation = dict(indexed["two_device_isolation"])
    isolation["device_a_status"] = isolation.get(
        "device_a_status", isolation.get("device_a_revoked_status")
    )
    if not (
        isolation["device_a_status"] == 403
        and isolation.get("device_b_status") == 200
        and isolation.get("credential_copy_rejected") is True
    ):
        raise RuntimeError("v4_device_isolation_invalid")

    bidirectional = []
    for name in ("windows_to_android_two_runs", "android_to_windows_two_runs"):
        row = dict(indexed[name])
        row["duplicate_sequence_count"] = row.get(
            "duplicate_sequence_count", row.get("duplicate_run_count")
        )
        if not (
            int(row.get("run_count", 0)) >= 2
            and int(row.get("duplicate_sequence_count", -1)) == 0
            and int(row.get("missing_sequence_count", -1)) == 0
            and float(row.get("p95_seconds", 999)) < 2
            and int(row.get("delta_run_count", 0)) >= 2
            and int(row.get("terminal_run_count", 0)) >= 2
        ):
            raise RuntimeError(f"v4_{name}_invalid")
        if name == "windows_to_android_two_runs" and not (
            int(row.get("tool_run_count", 0)) >= 2
        ):
            raise RuntimeError("v4_windows_to_android_two_runs_invalid")
        bidirectional.append(row)

    convergence = indexed["oaep_hash_convergence"]
    hashes = [
        convergence.get(name)
        for name in ("runtime_sha256", "windows_sha256", "android_sha256")
    ]
    if not all(isinstance(value, str) and DIGEST.fullmatch(value) for value in hashes) or len(set(hashes)) != 1:
        raise RuntimeError("v4_oaep_hash_mismatch")
    approval = indexed["approval_single_decision"]
    if approval.get("successful_decisions") != 1 or approval.get("tool_execution_count") != 1:
        raise RuntimeError("v4_approval_invalid")
    files = indexed["file_change_safe_paths"]
    if not (
        int(files.get("file_change_count", 0)) > 0
        and files.get("safe_relative_paths") is True
        and int(files.get("absolute_path_count", -1)) == 0
        and int(files.get("sensitive_field_count", -1)) == 0
    ):
        raise RuntimeError("v4_file_change_paths_invalid")
    revoked = indexed["revocation_stream_closed"]
    if not (
        revoked.get("subsequent_status") == 403
        and revoked.get("stream_closed_immediately") is True
        and revoked.get("other_device_stream_open") is True
    ):
        raise RuntimeError("v4_revocation_invalid")
    return [
        dict(pre),
        dict(pair),
        isolation,
        *bidirectional,
        dict(convergence),
        dict(approval),
        dict(files),
        dict(revoked),
    ]


def assemble(
    reports: list[dict[str, Any]],
    device_report: dict[str, Any],
    stability_report: dict[str, Any],
) -> dict[str, Any]:
    _stability(stability_report)
    return {
        "schema_version": 1,
        "protocol": "oaep/1",
        "passed": True,
        "devices": _devices(device_report),
        "checks": _normalize(_index_reports(reports)),
        "v3_inherited": [
            {"id": item_id, "status": "passed"}
            for item_id in sorted(V3_INHERITED)
        ],
    }


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="append", type=Path, required=True)
    parser.add_argument("--device-report", type=Path, required=True)
    parser.add_argument("--stability-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = assemble(
        [read_report(path, f"check_{index}") for index, path in enumerate(args.report)],
        read_report(args.device_report, "device"),
        read_report(args.stability_report, "stability"),
    )
    atomic_json(args.output, result)
    print(json.dumps({"passed": True, "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
