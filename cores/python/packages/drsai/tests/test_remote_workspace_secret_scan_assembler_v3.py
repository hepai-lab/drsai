from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/assemble_remote_workspace_secret_scan_v3.py"
SPEC = importlib.util.spec_from_file_location("secret_scan_assembler_v3", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def report(path: Path, boundary: str) -> Path:
    relay_attestation = (
        {
            "upstream_report_sha256": "a" * 64,
            "revision": "b" * 40,
            "raw_artifacts_exported": False,
            "enrollment_or_association_mutated": False,
            "cleanup": {
                "redis_keys_remaining": 0,
                "temporary_postgres_schema_removed": True,
                "temporary_directory_removed": True,
            },
        }
        if boundary == "relay"
        else {}
    )
    path.write_text(
        json.dumps(
            {
                "passed": True,
                "matches": 0,
                **relay_attestation,
                "sources": [
                    {
                        "name": name,
                        "status": "clean",
                        "bytes_scanned": 17,
                        "files_scanned": 1,
                        "archive_members_scanned": 0,
                    }
                    for name in sorted(MODULE.BOUNDARY_SOURCES[boundary])
                ],
            }
        ),
        encoding="utf-8",
    )
    return path


def reports(tmp_path: Path) -> dict[str, Path]:
    return {
        boundary: report(tmp_path / f"{boundary}.json", boundary)
        for boundary in MODULE.BOUNDARY_SOURCES
    }


def test_assembler_requires_clean_nonempty_endpoint_local_sources(
    tmp_path: Path,
) -> None:
    result = MODULE.assemble(reports(tmp_path))
    assert result["passed"] is True
    assert result["matches"] == 0
    assert result["raw_artifacts_crossed_trust_boundary"] is False
    assert {row["name"] for row in result["sources"]} == {
        name
        for names in MODULE.BOUNDARY_SOURCES.values()
        for name in names
    }
    assert {
        row["boundary"] for row in result["boundary_reports"]
    } == set(MODULE.BOUNDARY_SOURCES)
    assert all(len(row["report_sha256"]) == 64 for row in result["boundary_reports"])


@pytest.mark.parametrize(
    ("boundary", "mutation", "error"),
    [
        (
            "android",
            lambda value: value.update(passed=False),
            "secret_scan_android_failed",
        ),
        (
            "windows",
            lambda value: value["sources"].pop(),
            "secret_scan_windows_source_set_invalid",
        ),
        (
            "relay",
            lambda value: value["sources"][0].update(bytes_scanned=0),
            "secret_scan_relay_source_not_clean",
        ),
    ],
)
def test_assembler_fails_closed_on_weak_boundary_report(
    tmp_path: Path,
    boundary: str,
    mutation,
    error: str,
) -> None:
    paths = reports(tmp_path)
    value = json.loads(paths[boundary].read_text(encoding="utf-8"))
    mutation(value)
    paths[boundary].write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(RuntimeError, match=error):
        MODULE.assemble(paths)


def test_assembler_rejects_unreadable_report(tmp_path: Path) -> None:
    paths = reports(tmp_path)
    paths["relay"].write_text("not-json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="secret_scan_relay_report_unreadable"):
        MODULE.assemble(paths)


def test_assembler_rejects_weak_remote_relay_attestation(tmp_path: Path) -> None:
    paths = reports(tmp_path)
    value = json.loads(paths["relay"].read_text(encoding="utf-8"))
    value["upstream_report_sha256"] = "not-a-digest"
    paths["relay"].write_text(json.dumps(value), encoding="utf-8")
    with pytest.raises(RuntimeError, match="secret_scan_relay_attestation_invalid"):
        MODULE.assemble(paths)
