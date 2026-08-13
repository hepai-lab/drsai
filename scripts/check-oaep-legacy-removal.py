from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from drsai.oaep.compatibility import LegacyRemovalMetrics, legacy_removal_decision
from p5_legacy_rollback import RollbackArtifactError, validate_rollback_artifact


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("oaep_legacy_removal_duplicate_json_key")
        value[key] = item
    return value


def _load_json(path: Path, code: str) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as failure:
        raise SystemExit(code) from failure
    if not isinstance(value, dict):
        raise SystemExit(code)
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    parser.add_argument("--rollback-artifact", type=Path, required=True)
    parser.add_argument("--migration-evidence", type=Path, required=True)
    args = parser.parse_args()
    if not args.report.is_file() or not args.report.read_bytes():
        raise SystemExit("oaep_legacy_removal_report_missing")
    if not args.rollback_artifact.is_file() or not args.rollback_artifact.read_bytes():
        raise SystemExit("oaep_legacy_rollback_artifact_missing")
    if not args.migration_evidence.is_file() or not args.migration_evidence.read_bytes():
        raise SystemExit("oaep_legacy_migration_evidence_missing")
    report = _load_json(args.report, "oaep_legacy_removal_report_invalid")
    evidence = _load_json(args.migration_evidence, "p5_legacy_migration_evidence_invalid")
    try:
        validate_rollback_artifact(args.rollback_artifact)
    except RollbackArtifactError as exc:
        raise SystemExit(str(exc)) from exc
    rollback_digest = hashlib.sha256(args.rollback_artifact.read_bytes()).hexdigest()
    if rollback_digest != report.get("rollback_artifact_sha256"):
        raise SystemExit("oaep_legacy_rollback_artifact_digest_mismatch")
    if not isinstance(evidence, dict) or set(evidence) != {
        "schema_version", "database_migration_verified",
        "migration_transcript_before_sha256", "migration_transcript_after_sha256",
        "rollback_artifact_sha256",
    } or not (
        evidence.get("schema_version") == "p5-legacy-migration/1"
        and evidence.get("database_migration_verified") is True
        and evidence.get("rollback_artifact_sha256") == rollback_digest
        and evidence.get("migration_transcript_before_sha256")
        == evidence.get("migration_transcript_after_sha256")
    ):
        raise SystemExit("p5_legacy_migration_evidence_invalid")
    for name in (
        "database_migration_verified", "migration_transcript_before_sha256",
        "migration_transcript_after_sha256",
    ):
        if evidence.get(name) != report.get(name):
            raise SystemExit(f"oaep_legacy_migration_evidence_mismatch:{name}")
    metrics = LegacyRemovalMetrics.from_mapping(report)
    decision = legacy_removal_decision(metrics)
    print(json.dumps(decision, sort_keys=True, separators=(",", ":")))
    return 0 if decision["allowed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
