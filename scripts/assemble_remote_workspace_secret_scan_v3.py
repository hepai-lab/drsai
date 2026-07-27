"""Assemble endpoint-local V3 secret scans without moving raw artifacts.

Android, Windows, and Relay scan their own storage and logs with one-time
canaries.  Only the secret-free scan reports cross trust boundaries.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


BOUNDARY_SOURCES = {
    "android": {
        "android_apk",
        "android_logs",
        "android_room",
    },
    "windows": {
        "windows_database",
        "windows_logs",
        "windows_dump",
        "diagnostics",
    },
    "relay": {
        "relay_logs",
        "relay_redis",
        "relay_postgres",
    },
}


def _read(path: Path, boundary: str) -> tuple[dict[str, Any], str]:
    try:
        raw = path.read_bytes()
        report = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"secret_scan_{boundary}_report_unreadable") from exc
    if not isinstance(report, dict):
        raise RuntimeError(f"secret_scan_{boundary}_report_invalid")
    return report, hashlib.sha256(raw).hexdigest()


def _validate(
    report: dict[str, Any],
    boundary: str,
) -> list[dict[str, Any]]:
    if report.get("passed") is not True or report.get("matches") not in (0, []):
        raise RuntimeError(f"secret_scan_{boundary}_failed")
    if boundary == "relay":
        upstream = report.get("upstream_report_sha256")
        revision = report.get("revision")
        cleanup = report.get("cleanup")
        if (
            not isinstance(upstream, str)
            or len(upstream) != 64
            or any(character not in "0123456789abcdef" for character in upstream)
            or not isinstance(revision, str)
            or not 7 <= len(revision) <= 64
            or any(character not in "0123456789abcdef" for character in revision)
            or report.get("raw_artifacts_exported") is not False
            or report.get("enrollment_or_association_mutated") is not False
            or not isinstance(cleanup, dict)
            or cleanup.get("redis_keys_remaining") != 0
            or cleanup.get("temporary_postgres_schema_removed") is not True
            or cleanup.get("temporary_directory_removed") is not True
        ):
            raise RuntimeError("secret_scan_relay_attestation_invalid")
    sources = report.get("sources")
    if not isinstance(sources, list):
        raise RuntimeError(f"secret_scan_{boundary}_sources_missing")
    indexed: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            raise RuntimeError(f"secret_scan_{boundary}_source_invalid")
        name = source.get("name")
        if not isinstance(name, str) or not name or name in indexed:
            raise RuntimeError(f"secret_scan_{boundary}_source_invalid")
        indexed[name] = source
    expected = BOUNDARY_SOURCES[boundary]
    if set(indexed) != expected:
        raise RuntimeError(f"secret_scan_{boundary}_source_set_invalid")
    result = []
    for name in sorted(expected):
        source = indexed[name]
        bytes_scanned = source.get("bytes_scanned")
        if (
            source.get("status") != "clean"
            or not isinstance(bytes_scanned, int)
            or isinstance(bytes_scanned, bool)
            or bytes_scanned <= 0
        ):
            raise RuntimeError(f"secret_scan_{boundary}_source_not_clean:{name}")
        result.append(
            {
                "name": name,
                "status": "clean",
                "bytes_scanned": bytes_scanned,
                "files_scanned": source.get("files_scanned"),
                "archive_members_scanned": source.get(
                    "archive_members_scanned"
                ),
                "boundary": boundary,
            }
        )
    return result


def assemble(paths: dict[str, Path]) -> dict[str, Any]:
    combined: list[dict[str, Any]] = []
    attestations = []
    for boundary in ("android", "windows", "relay"):
        report, digest = _read(paths[boundary], boundary)
        sources = _validate(report, boundary)
        combined.extend(sources)
        attestations.append(
            {
                "boundary": boundary,
                "report_sha256": digest,
                "source_count": len(sources),
                **(
                    {
                        "upstream_report_sha256": report[
                            "upstream_report_sha256"
                        ],
                        "revision": report["revision"],
                    }
                    if boundary == "relay"
                    else {}
                ),
            }
        )
    if len({row["name"] for row in combined}) != len(combined):
        raise RuntimeError("secret_scan_combined_source_collision")
    return {
        "schema_version": 1,
        "profile": "mobile-remote-workspace-v3",
        "passed": True,
        "matches": 0,
        "sources": combined,
        "boundary_reports": attestations,
        "raw_artifacts_crossed_trust_boundary": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--android-report", type=Path, required=True)
    parser.add_argument("--windows-report", type=Path, required=True)
    parser.add_argument("--relay-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = assemble(
        {
            "android": args.android_report,
            "windows": args.windows_report,
            "relay": args.relay_report,
        }
    )
    encoded = json.dumps(result, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
