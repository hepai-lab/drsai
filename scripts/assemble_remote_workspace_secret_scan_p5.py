"""Fail-closed assembly of endpoint-local P5 secret scans.

Raw artifacts never cross Android, Windows or Relay trust boundaries.  Only
content-free counts and hashes are assembled here, bound to one environment
and one one-time canary run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from p5_secret_canary import expected_canary_set_sha256


BOUNDARY_SOURCES = {
    "android": {"android_apk", "android_logs", "android_room", "android_backup"},
    "windows": {"windows_database", "windows_dpapi", "windows_logs", "windows_dump"},
    "relay": {"relay_postgres", "relay_redis", "relay_logs"},
}
ALL_SOURCES = set().union(*BOUNDARY_SOURCES.values())
ANDROID_STORAGE_ASSERTIONS = {
    "android_logs": "sha256_only",
    "android_room": "sha256_only",
    "android_backup": "keystore_encrypted_only",
}


def _read(path: Path, boundary: str) -> tuple[dict[str, Any], str]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"p5_secret_{boundary}_report_unreadable") from exc
    if not raw or not isinstance(value, dict):
        raise RuntimeError(f"p5_secret_{boundary}_report_invalid")
    return value, hashlib.sha256(raw).hexdigest()


def _validate(value: dict[str, Any], boundary: str, environment_id: str,
              canary_run_id: str, canary_set_sha256: str) -> tuple[list[dict[str, Any]], str | None]:
    if value.get("schema_version") != "p5-secret/1":
        raise RuntimeError(f"p5_secret_{boundary}_schema_invalid")
    if value.get("boundary") != boundary:
        raise RuntimeError(f"p5_secret_{boundary}_boundary_invalid")
    if value.get("environment_id") != environment_id:
        raise RuntimeError("p5_secret_mixed_environment")
    if value.get("canary_run_id") != canary_run_id:
        raise RuntimeError("p5_secret_mixed_canary_run")
    if value.get("canary_set_sha256") != canary_set_sha256:
        raise RuntimeError("p5_secret_mixed_canary_set")
    if value.get("passed") is not True or value.get("matches") != 0:
        raise RuntimeError(f"p5_secret_{boundary}_failed")
    if value.get("raw_artifacts_exported") is not False:
        raise RuntimeError(f"p5_secret_{boundary}_raw_export_forbidden")
    sources = value.get("sources")
    if not isinstance(sources, list):
        raise RuntimeError(f"p5_secret_{boundary}_sources_missing")
    indexed: dict[str, dict[str, Any]] = {}
    for item in sources:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise RuntimeError(f"p5_secret_{boundary}_source_invalid")
        name = item["name"]
        if name in indexed:
            raise RuntimeError(f"p5_secret_{boundary}_source_duplicate")
        indexed[name] = item
    if set(indexed) != BOUNDARY_SOURCES[boundary]:
        raise RuntimeError(f"p5_secret_{boundary}_source_set_invalid")
    normalized = []
    for name in sorted(indexed):
        item = indexed[name]
        byte_count = item.get("bytes_scanned")
        file_count = item.get("files_scanned")
        if (item.get("status") != "clean" or not isinstance(byte_count, int)
                or isinstance(byte_count, bool) or byte_count <= 0
                or not isinstance(file_count, int) or isinstance(file_count, bool)
                or file_count <= 0):
            raise RuntimeError(f"p5_secret_{boundary}_source_not_clean:{name}")
        normalized.append({
            "name": name, "boundary": boundary, "status": "clean",
            "bytes_scanned": byte_count, "files_scanned": file_count,
        })
    artifact_sha256 = value.get("artifact_sha256")
    if boundary == "android":
        if not isinstance(artifact_sha256, str) or len(artifact_sha256) != 64 \
                or any(ch not in "0123456789abcdef" for ch in artifact_sha256):
            raise RuntimeError("p5_secret_android_artifact_attestation_invalid")
        if value.get("storage_assertions") != ANDROID_STORAGE_ASSERTIONS:
            raise RuntimeError("p5_secret_android_storage_assertions_invalid")
    elif artifact_sha256 is not None:
        raise RuntimeError(f"p5_secret_{boundary}_unexpected_artifact_attestation")
    return normalized, artifact_sha256


def assemble(paths: dict[str, Path], *, environment_id: str,
             canary_run_id: str) -> dict[str, Any]:
    if not environment_id.strip() or not canary_run_id.strip():
        raise RuntimeError("p5_secret_identity_required")
    sources: list[dict[str, Any]] = []
    reports = []
    canary_set_digest = expected_canary_set_sha256(canary_run_id)
    for boundary in ("android", "windows", "relay"):
        value, digest = _read(paths[boundary], boundary)
        rows, artifact_sha256 = _validate(
            value, boundary, environment_id, canary_run_id, canary_set_digest
        )
        sources.extend(rows)
        report = {"boundary": boundary, "report_sha256": digest, "source_count": len(rows)}
        if artifact_sha256 is not None:
            report["artifact_sha256"] = artifact_sha256
        reports.append(report)
    if {item["name"] for item in sources} != ALL_SOURCES or len(sources) != len(ALL_SOURCES):
        raise RuntimeError("p5_secret_source_coverage_invalid")
    return {
        "schema_version": "p5-secret/1", "profile": "mobile-remote-workspace-p5",
        "environment_id": environment_id, "canary_run_id": canary_run_id,
        "canary_set_sha256": canary_set_digest,
        "passed": True, "matches": 0, "raw_artifacts_crossed_trust_boundary": False,
        "sources": sources, "boundary_reports": reports,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--android-report", type=Path, required=True)
    parser.add_argument("--windows-report", type=Path, required=True)
    parser.add_argument("--relay-report", type=Path, required=True)
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--canary-run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = assemble(
        {"android": args.android_report, "windows": args.windows_report, "relay": args.relay_report},
        environment_id=args.environment_id, canary_run_id=args.canary_run_id,
    )
    encoded = json.dumps(result, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
