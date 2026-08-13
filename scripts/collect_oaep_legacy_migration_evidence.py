from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.journal import RuntimeConversationJournal
from p5_legacy_rollback import validate_rollback_artifact


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _transcript_hash(snapshot: dict) -> str:
    return _sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def collect(output: Path, rollback_artifact: Path) -> dict[str, object]:
    validate_rollback_artifact(rollback_artifact)
    rollback_sha256 = _sha256(rollback_artifact.read_bytes())
    with tempfile.TemporaryDirectory(prefix="p5-legacy-migration-") as directory:
        database = Path(directory) / "runtime.sqlite3"
        runtime_id = "runtime-p5-migration-evidence"
        workspace_id = "workspace-p5-migration-evidence"
        engine = RuntimeEngine(
            database,
            RuntimeEngineIdentity(runtime_id, "instance-p5-migration-evidence"),
            lambda candidate: candidate == workspace_id,
        )
        journal = engine.conversation_journal
        session = engine.create_session(workspace_id, "P5 migration evidence")
        run, _ = engine.create_run(
            session["session_id"], "opendrsai@1", "p5-migration-evidence-run", "opendrsai"
        )
        engine.set_run_input(
            run["run_id"], "P5 migration evidence input",
            source_client="windows", source_message_id="p5-migration-evidence-source",
        )
        journal.upsert_item(
            session["session_id"], item_id="p5-migration-evidence-output", kind="message",
            role="assistant", revision=1, source_client="runtime",
            payload={"text": "P5 migration evidence output", "status": "completed"},
            run_id=run["run_id"],
        )
        before = journal.snapshot(session["session_id"])
        before_sha256 = _transcript_hash(before)
        if not journal.replay_oaep(session["session_id"]):
            raise RuntimeError("p5_legacy_migration_oaep_projection_missing")

        with journal._connect() as db:
            db.execute("DELETE FROM runtime_oaep_events")
            db.execute("DELETE FROM runtime_oaep_items")
        journal.downgrade_empty_oaep_schema()
        if journal.snapshot(session["session_id"]) != before:
            raise RuntimeError("p5_legacy_migration_legacy_projection_changed_on_down")

        upgraded = RuntimeConversationJournal(database, runtime_id)
        after = upgraded.snapshot(session["session_id"])
        after_sha256 = _transcript_hash(after)
        report = upgraded.oaep_migration_report()
        first_projection = upgraded.projection_hash(upgraded.oaep_items(session["session_id"]))
        restarted = RuntimeConversationJournal(database, runtime_id)
        second_projection = restarted.projection_hash(restarted.oaep_items(session["session_id"]))
        if not (
            before_sha256 == after_sha256
            and report.get("complete") is True
            and upgraded.replay_oaep(session["session_id"])
            and first_projection == second_projection
        ):
            raise RuntimeError("p5_legacy_migration_verification_failed")

    evidence: dict[str, object] = {
        "schema_version": "p5-legacy-migration/1",
        "database_migration_verified": True,
        "migration_transcript_before_sha256": before_sha256,
        "migration_transcript_after_sha256": after_sha256,
        "rollback_artifact_sha256": rollback_sha256,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(
        json.dumps(evidence, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    temporary.replace(output)
    return evidence


def main() -> int:
    parser = argparse.ArgumentParser(description="Collect an isolated OAEP legacy up/down/up migration proof")
    parser.add_argument("output", type=Path)
    parser.add_argument("--rollback-artifact", type=Path, required=True)
    args = parser.parse_args()
    evidence = collect(args.output, args.rollback_artifact)
    print(json.dumps({
        "schema_version": evidence["schema_version"],
        "database_migration_verified": evidence["database_migration_verified"],
        "transcript_preserved": (
            evidence["migration_transcript_before_sha256"]
            == evidence["migration_transcript_after_sha256"]
        ),
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
