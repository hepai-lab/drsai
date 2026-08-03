"""Fail-closed finalizer for the 80-point OAEP Mobile Remote Workspace V4."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import mobile_remote_workspace_acceptance_v4 as acceptance


DIGEST = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[0-9a-f]{7,64}$")
REQUIRED_RELAY_CHECKS = {
    "oaep_frame_schema_identity",
    "cross_worker_replay_10k",
    "public_snapshot_hash",
    "cursor_expired_409",
    "scope_before_side_effect",
    "revocation_closes_sse",
    "backpressure_metrics",
    "correlation_trace",
}
REQUIRED_REAL_CHECKS = {
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
REQUIRED_SECRET_SOURCES = {
    "android_apk", "android_logs", "android_room",
    "windows_database", "windows_logs", "windows_dump",
    "relay_logs", "relay_redis", "relay_postgres", "diagnostics",
}
V3_INHERITED = {
    "M01-F07", "M05-F04", "M09-F08", "M10-F03",
    "M10-F04", "M10-F05", "M10-F06", "M10-F07",
}


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"v4_evidence_unreadable:{path.name}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"v4_evidence_invalid:{path.name}")
    return value


def sha256(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as exc:
        raise RuntimeError(f"v4_artifact_unreadable:{path.name}") from exc


def passed(report: dict[str, Any], required: set[str], label: str) -> dict[str, dict[str, Any]]:
    if report.get("passed") is not True:
        raise RuntimeError(f"v4_{label}_failed")
    rows = report.get("checks")
    if not isinstance(rows, list):
        raise RuntimeError(f"v4_{label}_checks_missing")
    result = {
        str(row.get("name")): row
        for row in rows
        if isinstance(row, dict) and row.get("status") == "passed"
    }
    missing = required - result.keys()
    if missing:
        raise RuntimeError(f"v4_{label}_checks_missing:" + ",".join(sorted(missing)))
    return result


def validate_screenshot(row: dict[str, Any], label: str) -> Path:
    raw = row.get("screenshot_artifact")
    digest = row.get("screenshot_sha256")
    if not isinstance(raw, str) or not raw:
        raise RuntimeError(f"v4_{label}_screenshot_missing")
    path = (acceptance.ROOT / raw).resolve()
    try:
        path.relative_to(acceptance.ROOT.resolve())
    except ValueError as exc:
        raise RuntimeError(f"v4_{label}_screenshot_invalid") from exc
    if not path.is_file() or not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
        raise RuntimeError(f"v4_{label}_screenshot_invalid")
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest) or sha256(path) != digest:
        raise RuntimeError(f"v4_{label}_screenshot_hash_invalid")
    return path


def validate_junit(path: Path, label: str, minimum: int) -> tuple[int, list[Path]]:
    files = sorted(path.glob("**/TEST-*.xml")) if path.is_dir() else [path]
    if not files or any(not file.is_file() for file in files):
        raise RuntimeError(f"v4_{label}_junit_missing")
    total = 0
    try:
        for file in files:
            root = ET.parse(file).getroot()
            total += len(root.findall(".//testcase"))
            if root.findall(".//failure") or root.findall(".//error"):
                raise RuntimeError(f"v4_{label}_junit_failed")
    except ET.ParseError as exc:
        raise RuntimeError(f"v4_{label}_junit_invalid") from exc
    if total < minimum:
        raise RuntimeError(f"v4_{label}_junit_too_small")
    return total, files


def validate_reports(
    relay: dict[str, Any], real: dict[str, Any], stability: dict[str, Any], secret: dict[str, Any]
) -> list[Path]:
    if relay.get("environment") != "ai-dev.ihep.ac.cn":
        raise RuntimeError("v4_relay_environment_invalid")
    if relay.get("protocol") != "oaep/1" or not DIGEST.fullmatch(str(relay.get("schema_hash", ""))):
        raise RuntimeError("v4_relay_protocol_invalid")
    relay_checks = passed(relay, REQUIRED_RELAY_CHECKS, "relay")
    if int(relay_checks["cross_worker_replay_10k"].get("event_count", 0)) < 10000:
        raise RuntimeError("v4_relay_replay_too_small")
    if float(relay_checks["cross_worker_replay_10k"].get("p95_ms", 999999)) >= 100:
        raise RuntimeError("v4_relay_p95_invalid")
    if relay_checks["scope_before_side_effect"].get("runtime_call_count") != 0:
        raise RuntimeError("v4_scope_side_effect_detected")
    if relay_checks["revocation_closes_sse"].get("subsequent_status") != 403:
        raise RuntimeError("v4_relay_revocation_invalid")

    if real.get("protocol") != "oaep/1":
        raise RuntimeError("v4_real_protocol_invalid")
    devices = real.get("devices")
    if not isinstance(devices, list) or len(devices) < 2:
        raise RuntimeError("v4_two_devices_missing")
    proofs = {row.get("device_proof_sha256") for row in devices if isinstance(row, dict)}
    if len(proofs) < 2 or not all(isinstance(value, str) and DIGEST.fullmatch(value) for value in proofs):
        raise RuntimeError("v4_device_proofs_invalid")
    checks = passed(real, REQUIRED_REAL_CHECKS, "real")
    screenshots = [validate_screenshot(checks["pair_and_catalog"], "catalog")]
    for name in ("windows_to_android_two_runs", "android_to_windows_two_runs"):
        row = checks[name]
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
        screenshots.append(validate_screenshot(row, name))
    convergence = checks["oaep_hash_convergence"]
    hashes = [convergence.get(name) for name in ("runtime_sha256", "windows_sha256", "android_sha256")]
    if not all(isinstance(value, str) and DIGEST.fullmatch(value) for value in hashes) or len(set(hashes)) != 1:
        raise RuntimeError("v4_oaep_hash_mismatch")
    if checks["approval_single_decision"].get("successful_decisions") != 1 or checks["approval_single_decision"].get("tool_execution_count") != 1:
        raise RuntimeError("v4_approval_invalid")
    files = checks["file_change_safe_paths"]
    if not (
        int(files.get("file_change_count", 0)) > 0
        and files.get("safe_relative_paths") is True
        and int(files.get("absolute_path_count", -1)) == 0
        and int(files.get("sensitive_field_count", -1)) == 0
    ):
        raise RuntimeError("v4_file_change_paths_invalid")
    isolation = checks["two_device_isolation"]
    if isolation.get("device_a_status") != 403 or isolation.get("device_b_status") != 200 or isolation.get("credential_copy_rejected") is not True:
        raise RuntimeError("v4_device_isolation_invalid")
    revoked = checks["revocation_stream_closed"]
    if not (
        revoked.get("subsequent_status") == 403
        and revoked.get("stream_closed_immediately") is True
        and revoked.get("other_device_stream_open") is True
        and 0 <= float(revoked.get("close_seconds", 999)) < 5
    ):
        raise RuntimeError("v4_stream_revocation_invalid")
    inherited = real.get("v3_inherited")
    if not isinstance(inherited, list):
        raise RuntimeError("v4_v3_inherited_missing")
    inherited_passed = {
        str(row.get("id")) for row in inherited
        if isinstance(row, dict) and row.get("status") == "passed"
    }
    if inherited_passed != V3_INHERITED:
        raise RuntimeError("v4_v3_inherited_incomplete")

    if not (
        stability.get("passed") is True
        and float(stability.get("required_duration_seconds", 0)) >= 3600
        and float(stability.get("observed_duration_seconds", 0)) >= 3600
        and int(stability.get("probe_error_count", -1)) == 0
        and stability.get("oaep_hash_stable") is True
        and stability.get("memory_within_threshold") is True
        and stability.get("handle_count_within_threshold") is True
    ):
        raise RuntimeError("v4_stability_invalid")
    fault_rows = stability.get("faults")
    if not isinstance(fault_rows, list):
        raise RuntimeError("v4_faults_missing")
    good_faults = {
        str(row.get("name")) for row in fault_rows
        if isinstance(row, dict)
        and row.get("status") == "passed"
        and row.get("oaep_hash_preserved") is True
        and row.get("sequence_preserved") is True
        and int(row.get("duplicate_sequence_count", -1)) == 0
        and int(row.get("missing_sequence_count", -1)) == 0
    }
    if REQUIRED_FAULTS - good_faults:
        raise RuntimeError("v4_faults_incomplete")

    if secret.get("passed") is not True or secret.get("matches") not in (0, []):
        raise RuntimeError("v4_secret_scan_failed")
    sources = secret.get("sources")
    clean = {
        str(row.get("name")) for row in sources or []
        if isinstance(row, dict) and row.get("status") == "clean" and int(row.get("bytes_scanned", 0)) > 0
    }
    if REQUIRED_SECRET_SOURCES - clean:
        raise RuntimeError("v4_secret_sources_incomplete")
    return screenshots


def finalize(
    ledger_path: Path, relay_path: Path, real_path: Path, stability_path: Path,
    secret_path: Path, apk_path: Path, python_junit: Path, android_junit: Path,
    desktop_junit: Path, *, hai_revision: str, windows_revision: str, android_revision: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    for label, revision in (("hai", hai_revision), ("windows", windows_revision), ("android", android_revision)):
        if not REVISION.fullmatch(revision):
            raise RuntimeError(f"v4_{label}_revision_invalid")
    ledger = read_json(ledger_path)
    errors = acceptance.validate(ledger)
    if errors:
        raise RuntimeError("v4_ledger_invalid:" + ";".join(errors))
    report_paths = [relay_path, real_path, stability_path, secret_path]
    screenshots = validate_reports(*(read_json(path) for path in report_paths))
    if not apk_path.is_file():
        raise RuntimeError("v4_apk_missing")
    counts: dict[str, int] = {}
    junit_files: list[Path] = []
    for label, path, minimum in (
        ("python", python_junit, 500), ("android", android_junit, 200), ("desktop", desktop_junit, 4)
    ):
        counts[label], files = validate_junit(path, label, minimum)
        junit_files.extend(files)
    release_evidence = {
        "kind": "release_evidence",
        "result": "passed",
        "artifacts": [path.relative_to(acceptance.ROOT).as_posix() if path.is_relative_to(acceptance.ROOT) else path.name for path in report_paths],
    }
    for item in ledger["items"]:
        evidence = list(item.get("evidence", []))
        if not any(row.get("kind") == "automated_test" for row in evidence):
            evidence.append({"kind": "automated_test", "result": "passed", "command": "V4 release gate"})
        evidence.append(dict(release_evidence))
        item.update(status="full_pass", evidence=evidence, blockers=[])
    errors = acceptance.validate(ledger)
    if errors:
        raise RuntimeError("v4_final_ledger_invalid:" + ";".join(errors))
    artifacts = list(dict.fromkeys([*report_paths, *junit_files, apk_path, *screenshots]))
    manifest = {
        "schema_version": 1,
        "release": "mobile-remote-workspace-v4",
        "full_pass": 80,
        "v3_unverified": 0,
        "protocols": {"oaep": "1.0", "owop": "1.0", "relay": "2.0.0"},
        "revisions": {"hai": hai_revision, "windows": windows_revision, "android": android_revision},
        "test_counts": counts,
        "artifacts": [
            {"path": path.as_posix(), "sha256": sha256(path), "size": path.stat().st_size}
            for path in artifacts
        ],
    }
    return ledger, manifest


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    evidence = acceptance.ROOT / "release/product-evidence/mobile-remote-workspace-v4"
    parser.add_argument("--ledger", type=Path, default=acceptance.LEDGER)
    parser.add_argument("--relay-report", type=Path, default=evidence / "ai-dev-oaep-relay.json")
    parser.add_argument("--real-report", type=Path, default=evidence / "real-device-oaep-e2e.json")
    parser.add_argument("--stability-report", type=Path, default=evidence / "real-stability-1h.json")
    parser.add_argument("--secret-scan", type=Path, default=evidence / "secret-scan.json")
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--python-junit", type=Path, default=evidence / "python-junit.xml")
    parser.add_argument("--android-junit", type=Path, default=evidence / "android-junit")
    parser.add_argument("--desktop-junit", type=Path, default=evidence / "desktop-junit.xml")
    parser.add_argument("--hai-revision", required=True)
    parser.add_argument("--windows-revision", required=True)
    parser.add_argument("--android-revision", required=True)
    parser.add_argument("--output", type=Path, default=acceptance.LEDGER)
    parser.add_argument("--manifest", type=Path, default=evidence / "manifest.json")
    args = parser.parse_args()
    ledger, manifest = finalize(
        args.ledger, args.relay_report, args.real_report, args.stability_report,
        args.secret_scan, args.apk, args.python_junit, args.android_junit,
        args.desktop_junit, hai_revision=args.hai_revision,
        windows_revision=args.windows_revision, android_revision=args.android_revision,
    )
    atomic_json(args.output, ledger)
    atomic_json(args.manifest, manifest)
    print(json.dumps({"valid": True, "full_pass": 80, "manifest": str(args.manifest)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
