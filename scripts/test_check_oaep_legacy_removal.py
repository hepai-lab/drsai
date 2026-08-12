from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys

from p5_legacy_rollback import REQUIRED_MEMBERS, build_rollback_artifact


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    source = tmp_path / "source"
    for name in REQUIRED_MEMBERS:
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"rollback fixture for {name}\n", encoding="utf-8")
    rollback = tmp_path / "rollback.zip"
    build_rollback_artifact(source, rollback, source_revision="1" * 40)
    report = {
        "release_cycles": 0, "observation_days": 0, "oaep_client_ratio": 0.999,
        "migration_ratio": 1.0, "legacy_request_ratio": 0.0009,
        "fallback_error_rate": 0.001, "rollback_artifact_verified": True,
        "supported_runtime_requires_legacy": False,
        "rollback_artifact_sha256": hashlib.sha256(rollback.read_bytes()).hexdigest(),
        "migration_transcript_before_sha256": "b" * 64,
        "migration_transcript_after_sha256": "b" * 64,
        "database_migration_verified": True,
    }
    report_path = tmp_path / "report.json"
    migration_path = tmp_path / "migration.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")
    migration_path.write_text(json.dumps({
        "schema_version": "p5-legacy-migration/1",
        "database_migration_verified": report["database_migration_verified"],
        "migration_transcript_before_sha256": report["migration_transcript_before_sha256"],
        "migration_transcript_after_sha256": report["migration_transcript_after_sha256"],
        "rollback_artifact_sha256": report["rollback_artifact_sha256"],
    }), encoding="utf-8")
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


def test_any_supported_runtime_dependency_blocks_removal(tmp_path: Path) -> None:
    report, rollback, migration = _fixture(tmp_path)
    value = json.loads(report.read_text())
    value["supported_runtime_requires_legacy"] = True
    report.write_text(json.dumps(value), encoding="utf-8")
    result = _run(report, rollback, migration)
    assert result.returncode == 1
    assert "supported_runtimes_are_oaep_capable" in result.stdout


def test_threshold_boundary_fails_closed(tmp_path: Path) -> None:
    report, rollback, migration = _fixture(tmp_path / "boundary")
    value = json.loads(report.read_text())
    value["legacy_request_ratio"] = 0.001
    report.write_text(json.dumps(value), encoding="utf-8")
    assert _run(report, rollback, migration).returncode != 0


def test_arbitrary_nonempty_rollback_bytes_fail_closed(tmp_path: Path) -> None:
    report, rollback, migration = _fixture(tmp_path)
    raw = b"not-a-real-rollback-bundle"
    rollback.write_bytes(raw)
    value = json.loads(report.read_text())
    value["rollback_artifact_sha256"] = hashlib.sha256(raw).hexdigest()
    report.write_text(json.dumps(value), encoding="utf-8")
    result = _run(report, rollback, migration)
    assert result.returncode != 0
    assert "p5_legacy_rollback_archive_invalid" in result.stderr


def test_migration_evidence_must_bind_the_same_rollback_and_preserved_transcript(tmp_path: Path) -> None:
    report, rollback, migration = _fixture(tmp_path)
    value = json.loads(migration.read_text())
    value["rollback_artifact_sha256"] = "0" * 64
    migration.write_text(json.dumps(value), encoding="utf-8")
    assert "p5_legacy_migration_evidence_invalid" in _run(report, rollback, migration).stderr


def test_duplicate_json_key_is_rejected(tmp_path: Path) -> None:
    report, rollback, migration = _fixture(tmp_path)
    source = report.read_text()
    report.write_text(source.replace("{", '{"oaep_client_ratio":0.999,', 1))
    result = _run(report, rollback, migration)
    assert result.returncode != 0
    assert "oaep_legacy_removal_report_invalid" in result.stderr


def test_migration_transcript_mismatch_fails_closed(tmp_path: Path) -> None:

    report, rollback, migration = _fixture(tmp_path / "transcript")
    value = json.loads(migration.read_text())
    value["migration_transcript_after_sha256"] = "c" * 64
    migration.write_text(json.dumps(value), encoding="utf-8")
    assert "p5_legacy_migration_evidence_invalid" in _run(report, rollback, migration).stderr
