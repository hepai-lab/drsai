from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    rollback = tmp_path / "rollback.zip"
    rollback.write_bytes(b"rollback-artifact")
    report = {
        "release_cycles": 0, "observation_days": 0, "oaep_client_ratio": 0.999,
        "migration_ratio": 1.0, "legacy_request_ratio": 0.0009,
        "fallback_error_rate": 0.001, "rollback_artifact_verified": True,
        "rollback_artifact_sha256": hashlib.sha256(rollback.read_bytes()).hexdigest(),
        "migration_transcript_before_sha256": "b" * 64,
        "migration_transcript_after_sha256": "b" * 64,
        "database_migration_verified": True,
    }
    report_path = tmp_path / "report.json"
    migration_path = tmp_path / "migration.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    migration_path.write_text(json.dumps({key: report[key] for key in (
        "database_migration_verified", "migration_transcript_before_sha256",
        "migration_transcript_after_sha256",
    )}), encoding="utf-8")
    return report_path, rollback, migration_path


def _run(report: Path, rollback: Path, migration: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([
        sys.executable, str(Path(__file__).with_name("check-oaep-legacy-removal.py")),
        str(report), "--rollback-artifact", str(rollback), "--migration-evidence", str(migration),
    ], capture_output=True, text=True, check=False)


def test_physical_rollback_and_migration_evidence_allow_removal(tmp_path: Path) -> None:
    assert _run(*_fixture(tmp_path)).returncode == 0


def test_digest_mismatch_and_threshold_boundary_fail_closed(tmp_path: Path) -> None:
    report, rollback, migration = _fixture(tmp_path)
    rollback.write_bytes(b"changed")
    assert _run(report, rollback, migration).returncode != 0
    report, rollback, migration = _fixture(tmp_path / "boundary")
    value = json.loads(report.read_text())
    value["legacy_request_ratio"] = 0.001
    report.write_text(json.dumps(value), encoding="utf-8")
    assert _run(report, rollback, migration).returncode != 0
