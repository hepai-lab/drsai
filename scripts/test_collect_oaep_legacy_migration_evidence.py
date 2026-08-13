from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from collect_oaep_legacy_migration_evidence import collect
from p5_legacy_rollback import RollbackArtifactError, build_rollback_artifact


ROOT = Path(__file__).parents[1]


def test_collects_real_up_down_up_evidence_without_exporting_transcript(tmp_path: Path) -> None:
    rollback = tmp_path / "rollback.zip"
    build_rollback_artifact(ROOT, rollback, source_revision="1" * 40)
    output = tmp_path / "migration.json"
    evidence = collect(output, rollback)
    assert set(evidence) == {
        "schema_version", "database_migration_verified",
        "migration_transcript_before_sha256", "migration_transcript_after_sha256",
        "rollback_artifact_sha256",
    }
    assert evidence["schema_version"] == "p5-legacy-migration/1"
    assert evidence["database_migration_verified"] is True
    assert evidence["migration_transcript_before_sha256"] == evidence["migration_transcript_after_sha256"]
    assert evidence["rollback_artifact_sha256"] == hashlib.sha256(rollback.read_bytes()).hexdigest()
    raw = output.read_text(encoding="utf-8")
    assert "P5 migration evidence input" not in raw
    assert "P5 migration evidence output" not in raw


def test_rejects_arbitrary_rollback_artifact_before_database_work(tmp_path: Path) -> None:
    rollback = tmp_path / "rollback.zip"
    rollback.write_bytes(b"not-a-rollback")
    with pytest.raises(RollbackArtifactError, match="archive_invalid"):
        collect(tmp_path / "migration.json", rollback)
    assert not (tmp_path / "migration.json").exists()
