from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.evidence import agent_definition_evidence, workspace_revision_evidence
from drsai.backend.runtime.run_inspection import (
    decode_cursor,
    digest_manifest,
    encode_cursor,
    initial_manifest,
    merge_manifest,
    reproducibility,
    safe_inspection_item,
)


@pytest.fixture()
def engine(tmp_path: Path) -> RuntimeEngine:
    return RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-inspection", "instance-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )


def create_run(engine: RuntimeEngine, key: str = "inspection-key") -> tuple[dict, dict]:
    session = engine.create_session("workspace-one", "Inspection")
    run, _ = engine.create_run(session["session_id"], "agent@v1", key, "codex")
    return session, run


def exact_evidence() -> dict:
    return {
        "runtime": {"version": "1.0.0"},
        "backend": {"version": "1.0.0"},
        "protocol": {
            "oaep_version": "1.0",
            "adapter_version": "adapter-1.0.0",
            "mapping_version": "mapping-1.0.0",
        },
        "agent": {"definition_digest": "a" * 64},
        "prompt": {"digest": "p" * 64},
        "model": {
            "provider": "test-provider",
            "version": "test-model-v1",
            "revision_digest": "m" * 64,
        },
        "workspace": {"revision": "w" * 40, "dirty": False},
        "environment": {
            "os": "Windows",
            "arch": "x64",
            "runtime_versions": {"python": "3.12"},
            "image_digest": "e" * 64,
        },
        "security": {"policy_version": "policy-v1"},
        "evidence_declarations": {
            "attachments_recorded": True,
            "tools_recorded": True,
            "skills_recorded": True,
            "external_dependencies_recorded": True,
        },
    }


def test_manifest_digest_and_reproducibility_are_deterministic() -> None:
    manifest = initial_manifest(
        run_id="run-one",
        runtime_id="runtime-one",
        instance_id="instance-one",
        backend_id="codex",
        agent_definition="agent@v1",
        workspace_id="workspace-one",
        worktree_id=None,
    )
    manifest["model"] = {"id": "gpt-test"}
    manifest["input"] = {"sha256": "a" * 64}
    manifest = merge_manifest(manifest, exact_evidence())

    assert digest_manifest(manifest) == digest_manifest(json.loads(json.dumps(manifest)))
    assert reproducibility(manifest) == ("exact", [])
    manifest["external_dependencies"] = [{"url_sha256": "c" * 64, "mutable": True}]
    level, missing = reproducibility(manifest)
    assert level == "partial"
    assert missing == ["external_dependencies.mutable"]


def test_manifest_uses_loaded_asset_evidence_and_never_placeholder_versions() -> None:
    manifest = initial_manifest(
        run_id="run-evidence", runtime_id="runtime-one", instance_id="instance-one",
        backend_id="codex", agent_definition="agent@v1", workspace_id="workspace-one",
        worktree_id=None,
    )
    assert manifest["runtime"]["version"] != "runtime-v1"
    assert "version" not in manifest["backend"]
    assert "definition_digest" not in manifest["agent"]
    assert "adapter_version" not in manifest["protocol"]

    base = {
        "id": "agent", "version": "v1", "backend": "codex", "model": "model-one",
        "model_provider": "openai", "instructions": "Use the verified prompt.",
        "permissions": [], "tools": [{"id": "read", "schema": {"type": "object"}}],
        "skills": ["research@2"], "external_dependencies": [],
    }
    definition = SimpleNamespace(
        raw=base, backend="codex", model="model-one",
        instructions=base["instructions"], reference="agent@v1",
    )
    evidence = agent_definition_evidence(definition)
    changed = agent_definition_evidence(SimpleNamespace(
        raw={**base, "instructions": "Changed content."}, backend="codex", model="model-one",
        instructions="Changed content.", reference="agent@v1",
    ))
    assert evidence["agent"]["definition_digest"] != changed["agent"]["definition_digest"]
    assert evidence["model"]["provider"] == "openai"
    assert evidence["tools"][0]["schema_digest"]
    assert evidence["skills"] == [{"id": "research", "version": "2"}]
    assert evidence["evidence_declarations"] == {
        "tools_recorded": True,
        "skills_recorded": True,
        "external_dependencies_recorded": True,
    }


def test_workspace_revision_evidence_uses_actual_git_results(tmp_path: Path, monkeypatch) -> None:
    results = iter([
        subprocess.CompletedProcess([], 0, stdout="1" * 40 + "\n", stderr=""),
        subprocess.CompletedProcess([], 0, stdout=" M changed.py\n", stderr=""),
    ])
    monkeypatch.setattr(subprocess, "run", lambda *_args, **_kwargs: next(results))
    evidence = workspace_revision_evidence(tmp_path)
    assert evidence == {
        "workspace": {"revision": "1" * 40, "dirty": True, "vcs": "git"},
    }


def test_all_reproducibility_levels_have_stable_explanations() -> None:
    base = initial_manifest(
        run_id="run-levels", runtime_id="runtime-one", instance_id="instance-one",
        backend_id="codex", agent_definition="agent@v1", workspace_id="workspace-one",
        worktree_id=None,
    )
    assert reproducibility(base)[0] == "unavailable"
    partial = json.loads(json.dumps(base))
    partial.update({"model": {"id": "model", "provider": "provider"}, "input": {"sha256": "i" * 64}})
    assert reproducibility(partial)[0] == "partial"
    compatible = merge_manifest(partial, exact_evidence())
    compatible["model"].pop("revision_digest")
    compatible["environment"].pop("image_digest")
    level, reasons = reproducibility(compatible)
    assert level == "compatible"
    assert reasons == ["environment.image_digest", "model.revision_digest"]
    exact = json.loads(json.dumps(compatible))
    exact["model"]["revision_digest"] = "m" * 64
    exact["environment"]["image_digest"] = "e" * 64
    assert reproducibility(exact) == ("exact", [])


def test_inspection_cursor_is_stable_and_rejects_invalid_values() -> None:
    assert decode_cursor(encode_cursor(123)) == 123
    assert decode_cursor(None) == 0
    with pytest.raises(ValueError, match="Invalid Run inspection cursor"):
        decode_cursor("not-base64!")


def test_run_item_event_identity_is_unique_across_runs_and_duplicate_delivery(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one", "Identity")
    first, _ = engine.create_run(session["session_id"], "agent@v1", "identity-first", "codex")
    second, _ = engine.create_run(session["session_id"], "agent@v1", "identity-second", "codex")
    first_event = engine.append_backend_event(
        first["run_id"], "agent.item.command.delta",
        {"item_id": "backend-shared-item", "delta": "first"}, "backend-event-shared",
    )
    duplicate = engine.append_backend_event(
        first["run_id"], "agent.item.command.delta",
        {"item_id": "backend-shared-item", "delta": "MUST-NOT-APPEAR"}, "backend-event-shared",
    )
    engine.append_backend_event(
        second["run_id"], "agent.item.command.delta",
        {"item_id": "backend-shared-item", "delta": "second"}, "backend-event-shared",
    )
    assert duplicate["event_id"] == first_event["event_id"]
    first_item = engine.inspect_run(first["run_id"])["timeline"][0]
    second_item = engine.inspect_run(second["run_id"])["timeline"][0]
    assert first_item["run_id"] == first["run_id"]
    assert second_item["run_id"] == second["run_id"]
    assert first_item["id"] != second_item["id"]
    assert first_item["content"]["output"] == "first"
    assert second_item["content"]["output"] == "second"
    assert first_item["event_refs"] != second_item["event_refs"]


def test_run_creation_atomically_stores_encrypted_manifest(engine: RuntimeEngine) -> None:
    _, run = create_run(engine)
    manifest = engine.get_run_manifest(run["run_id"], safe=True)

    assert manifest["run_id"] == run["run_id"]
    assert manifest["reproducibility_level"] == "unavailable"
    assert "input.sha256" in manifest["missing_evidence"]
    with engine._connect() as db:
        row = db.execute(
            "SELECT manifest_json_encrypted,safe_summary_json FROM runtime_run_manifests WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()
    assert str(row["manifest_json_encrypted"]).startswith("enc:v1:")
    assert "agent@v1" in str(row["safe_summary_json"])


def test_run_creation_rolls_back_when_manifest_persistence_fails(
    engine: RuntimeEngine, monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = engine.create_session("workspace-one", "Atomic manifest")
    monkeypatch.setattr(
        engine._checkpoint_cipher,
        "encrypt",
        lambda _value: (_ for _ in ()).throw(RuntimeError("manifest fault")),
    )
    with pytest.raises(RuntimeError, match="manifest fault"):
        engine.create_run(session["session_id"], "agent@v1", "atomic-fault", "codex")
    with engine._connect() as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_runs WHERE idempotency_key='atomic-fault'"
        ).fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM runtime_run_manifests").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM runtime_events").fetchone()[0] == 0


def test_manifest_migration_is_repeatable_and_preserves_old_runtime_events(engine: RuntimeEngine) -> None:
    _, run = create_run(engine, "old-database")
    engine.append_event(run["run_id"], "trace.old", {"value": 1})
    with engine._connect() as db:
        before = [tuple(row) for row in db.execute(
            "SELECT event_id,run_id,sequence,event_type,data_json,created_at FROM runtime_events ORDER BY sequence"
        ).fetchall()]
        db.execute("DROP TABLE runtime_run_manifests")

    first = RuntimeEngine(
        engine.database,
        RuntimeEngineIdentity("runtime-inspection", "migration-one"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    second = RuntimeEngine(
        engine.database,
        RuntimeEngineIdentity("runtime-inspection", "migration-two"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    assert first.get_run_manifest(run["run_id"], safe=True)["reproducibility_level"] == "unavailable"
    assert second.get_run_manifest(run["run_id"], safe=True)["run_id"] == run["run_id"]
    with second._connect() as db:
        after = [tuple(row) for row in db.execute(
            "SELECT event_id,run_id,sequence,event_type,data_json,created_at FROM runtime_events ORDER BY sequence"
        ).fetchall()]
    assert after == before


def test_input_evidence_can_reach_exact_and_final_manifest_is_immutable(engine: RuntimeEngine) -> None:
    _, run = create_run(engine)
    engine.set_run_input(
        run["run_id"],
        "hello api_key=super-secret",
        model="gpt-test",
        evidence=exact_evidence(),
    )
    manifest = engine.get_run_manifest(run["run_id"], safe=False)
    assert manifest["reproducibility_level"] == "exact"
    assert manifest["manifest"]["input"]["length"] == 26
    assert "hello" not in json.dumps(manifest["manifest"])

    engine.transition_run(run["run_id"], "running")
    engine.transition_run(run["run_id"], "completed")
    finalized = engine.get_run_manifest(run["run_id"], safe=True)
    assert finalized["finalized_at"]
    with pytest.raises(ValueError, match="immutable"):
        engine.update_run_manifest(run["run_id"], {"model": {"id": "other"}})


def test_manifest_corruption_fails_closed(engine: RuntimeEngine) -> None:
    _, run = create_run(engine)
    with engine._connect() as db:
        db.execute(
            "UPDATE runtime_run_manifests SET manifest_json_encrypted='enc:v1:broken' WHERE run_id=?",
            (run["run_id"],),
        )
    manifest = engine.get_run_manifest(run["run_id"], safe=True)
    assert manifest["reproducibility_level"] == "unavailable"
    assert manifest["missing_evidence"] == ["manifest.corrupt"]


def test_manifest_and_checkpoint_key_rotation_preserves_evidence(engine: RuntimeEngine) -> None:
    _, run = create_run(engine, "key-rotation")
    engine.set_run_input(run["run_id"], "rotation secret", model="gpt-test")
    engine.save_checkpoint(run["run_id"], {"cursor": 7, "private": "checkpoint-secret"})
    before_manifest = engine.get_run_manifest(run["run_id"], safe=False)
    with engine._connect() as db:
        before_ciphertext = str(db.execute(
            "SELECT manifest_json_encrypted FROM runtime_run_manifests WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()[0])

    rotated = engine.rotate_evidence_encryption_key()

    assert rotated == {"manifests": 1, "checkpoints": 1}
    assert engine.get_run_manifest(run["run_id"], safe=False)["manifest_digest"] == before_manifest["manifest_digest"]
    assert engine.latest_checkpoint(run["run_id"])["state"] == {
        "cursor": 7, "private": "checkpoint-secret",
    }
    with engine._connect() as db:
        after_ciphertext = str(db.execute(
            "SELECT manifest_json_encrypted FROM runtime_run_manifests WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()[0])
    assert after_ciphertext != before_ciphertext
    keyring = json.loads(engine._checkpoint_cipher.path.read_text(encoding="utf-8"))
    assert keyring["version"] == 2 and len(keyring["keys"]) == 1


def test_missing_manifest_key_fails_closed_without_exposing_plaintext(engine: RuntimeEngine) -> None:
    _, run = create_run(engine, "missing-key")
    engine.set_run_input(run["run_id"], "missing-key-secret", model="gpt-test")
    engine._checkpoint_cipher.path.unlink()

    restarted = RuntimeEngine(
        engine.database,
        RuntimeEngineIdentity("runtime-inspection", "instance-two"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    public = restarted.get_run_manifest(run["run_id"], safe=True)
    assert public["reproducibility_level"] == "unavailable"
    assert public["missing_evidence"] == ["manifest.corrupt"]
    assert "missing-key-secret" not in json.dumps(public)


def test_public_manifest_redacts_prompts_headers_url_credentials_and_absolute_paths(
    engine: RuntimeEngine,
) -> None:
    _, run = create_run(engine, "manifest-redaction")
    engine.set_run_input(
        run["run_id"],
        "Bearer input-secret-canary",
        model="gpt-test",
        evidence={
            "system_prompt": "prompt-secret-canary",
            "prompt": {"digest": "p" * 64, "content": "nested-prompt-secret-canary"},
            "input": {"text": "nested-input-secret-canary"},
            "transport": {"authorization": "Bearer header-secret-canary"},
            "headers": {"cookie": "session=cookie-secret-canary"},
            "workspace": {"root": r"C:\Users\private-user\project"},
            "paths": [
                {"path": r"\\server\private-share\secret.txt"},
                {"path": "../outside/secret.txt"},
                {"path": "ssh://private-host/home/private-user/file.txt"},
            ],
            "external_dependencies": [
                {"url": "https://url-user:url-secret-canary@example.test/data"}
            ],
        },
    )
    public = engine.get_run_manifest(run["run_id"], safe=True)
    serialized = json.dumps(public)
    for secret in (
        "input-secret-canary", "prompt-secret-canary", "header-secret-canary",
        "url-secret-canary", "private-user", "cookie-secret-canary", "private-host",
        "nested-prompt-secret-canary", "nested-input-secret-canary",
    ):
        assert secret not in serialized
    assert public["manifest"]["workspace"]["root"] == "[REDACTED ABSOLUTE PATH]"
    assert all(row["path"] == "[REDACTED ABSOLUTE PATH]" for row in public["manifest"]["paths"])
    assert "[REDACTED]@example.test" in serialized

    with engine._connect() as db:
        row = db.execute(
            "SELECT manifest_json_encrypted,safe_summary_json FROM runtime_run_manifests WHERE run_id=?",
            (run["run_id"],),
        ).fetchone()
    assert "secret-canary" not in str(row["manifest_json_encrypted"])
    assert "secret-canary" not in str(row["safe_summary_json"])


@pytest.mark.parametrize(
    ("terminal", "expected_reason"),
    (("failed", None), ("cancelled", "user_requested")),
)
def test_failed_and_cancelled_runs_finalize_manifest(
    engine: RuntimeEngine, terminal: str, expected_reason: str | None,
) -> None:
    _, run = create_run(engine, f"terminal-{terminal}")
    engine.set_run_input(run["run_id"], "terminal evidence", model="gpt-test")
    engine.transition_run(run["run_id"], "running")
    if terminal == "cancelled":
        engine.cancel_run(run["run_id"])
    else:
        engine.transition_run(run["run_id"], "failed", reason="model_failed")
    manifest = engine.get_run_manifest(run["run_id"], safe=False)
    assert manifest["finalized_at"]
    assert manifest["manifest"]["outcome"]["status"] == terminal
    assert manifest["manifest"]["outcome"].get("reason") == (expected_reason or "model_failed")


@pytest.mark.parametrize(("decision", "terminal"), (("denied", "cancelled"), ("timeout", "failed")))
def test_approval_terminal_runs_finalize_manifest(
    engine: RuntimeEngine, decision: str, terminal: str,
) -> None:
    _, run = create_run(engine, f"approval-{decision}")
    engine.set_run_input(run["run_id"], "approval evidence", model="gpt-test")
    engine.transition_run(run["run_id"], "running")
    approval = engine.request_approval(run["run_id"], {"operation": "tool.read"})
    waiting = engine.get_run_manifest(run["run_id"], safe=True)
    assert waiting["finalized_at"] is None
    engine.resolve_approval(approval["approval_id"], decision)
    finalized = engine.get_run_manifest(run["run_id"], safe=False)
    assert finalized["manifest"]["outcome"]["status"] == terminal
    assert finalized["manifest"]["outcome"]["reason"] == f"approval_{decision}"
    assert finalized["finalized_at"]


def test_session_run_pagination_and_status_filter(engine: RuntimeEngine) -> None:
    session = engine.create_session("workspace-one", "Many runs")
    runs = [engine.create_run(session["session_id"], "agent@v1", f"key-{index}", "codex")[0] for index in range(5)]
    engine.transition_run(runs[0]["run_id"], "running")
    engine.transition_run(runs[0]["run_id"], "completed")

    first = engine.list_session_runs_page(session["session_id"], limit=2)
    second = engine.list_session_runs_page(session["session_id"], cursor=first["next_cursor"], limit=2)
    third = engine.list_session_runs_page(session["session_id"], cursor=second["next_cursor"], limit=2)
    assert [row["run_id"] for row in [*first["data"], *second["data"], *third["data"]]] == [row["run_id"] for row in runs]
    assert third["has_more"] is False
    completed = engine.list_session_runs_page(session["session_id"], status="completed")
    assert [row["run_id"] for row in completed["data"]] == [runs[0]["run_id"]]


def test_session_run_cursor_covers_5000_rows_with_concurrent_append(
    engine: RuntimeEngine, monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = engine.create_session("workspace-one", "Large run catalog")
    created = "2026-08-04T10:00:00+00:00"
    rows = [
        (
            f"run-bulk-{index:05d}", session["session_id"], "workspace-one", None,
            "runtime-inspection", "instance-one", "agent@v1", "codex",
            "completed" if index % 2 == 0 else "failed", f"bulk-key-{index:05d}",
            created, created, created,
        )
        for index in range(5_000)
    ]
    with engine._connect() as db:
        db.executemany(
            "INSERT INTO runtime_runs(run_id,session_id,workspace_id,worktree_id,runtime_id,instance_id,"
            "agent_definition,backend_id,status,idempotency_key,created_at,started_at,completed_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            rows,
        )
    monkeypatch.setattr(engine, "get_run_manifest", lambda run_id, safe=True: {"run_id": run_id})

    seen: list[str] = []
    cursor = None
    while True:
        page = engine.list_session_runs_page(session["session_id"], cursor=cursor, limit=137)
        seen.extend(row["run_id"] for row in page["data"])
        if len(seen) == 137:
            with engine._connect() as db:
                db.execute(
                    "INSERT INTO runtime_runs(run_id,session_id,workspace_id,runtime_id,instance_id,"
                    "agent_definition,backend_id,status,idempotency_key,created_at,started_at,completed_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    ("run-bulk-concurrent", session["session_id"], "workspace-one", "runtime-inspection",
                     "instance-one", "agent@v1", "codex", "completed", "bulk-key-concurrent",
                     created, created, created),
                )
        if not page["has_more"]:
            break
        cursor = page["next_cursor"]
    assert len(seen) == 5_001
    assert len(set(seen)) == len(seen)
    assert seen[:2] == ["run-bulk-00000", "run-bulk-00001"]
    assert seen[-1] == "run-bulk-concurrent"

    completed_ids: list[str] = []
    cursor = None
    while True:
        page = engine.list_session_runs_page(
            session["session_id"], cursor=cursor, limit=211, status="completed",
        )
        completed_ids.extend(row["run_id"] for row in page["data"])
        if not page["has_more"]:
            break
        cursor = page["next_cursor"]
    assert len(completed_ids) == 2_501
    assert all(run_id.endswith("concurrent") or int(run_id[-5:]) % 2 == 0 for run_id in completed_ids)


def test_historical_run_manifest_read_is_pure_and_recovery_explicitly_repairs(
    engine: RuntimeEngine,
) -> None:
    session = engine.create_session("workspace-one", "Imported")
    run, _ = engine.import_backend_run(
        session["session_id"], "codex", "backend-turn-old", status="failed",
    )
    with engine._connect() as db:
        assert db.execute(
            "SELECT 1 FROM runtime_run_manifests WHERE run_id=?", (run["run_id"],),
        ).fetchone() is None

    manifest = engine.get_run_manifest(run["run_id"], safe=True)
    assert manifest["reproducibility_level"] == "unavailable"
    assert manifest["finalized_at"] is None
    assert manifest["repair_required"] is True
    assert "input.sha256" in manifest["missing_evidence"]
    with engine._connect() as db:
        assert db.execute(
            "SELECT 1 FROM runtime_run_manifests WHERE run_id=?", (run["run_id"],),
        ).fetchone() is None

    assert engine.reconcile_terminal_run_manifests() == 1
    repaired = engine.get_run_manifest(run["run_id"], safe=True)
    assert repaired["finalized_at"]


def test_terminal_recovery_seals_existing_manifest_without_get_side_effect(
    engine: RuntimeEngine,
) -> None:
    _, run = create_run(engine, "normalized-terminal-writer")
    engine.set_run_input(run["run_id"], "normalized evidence", model="gpt-test")
    with engine._connect() as db:
        db.execute(
            "UPDATE runtime_runs SET status='completed',completed_at=? WHERE run_id=?",
            ("2026-08-04T10:00:00+00:00", run["run_id"]),
        )

    before = engine.get_run_manifest(run["run_id"], safe=False)
    assert before["finalized_at"] is None
    assert "outcome" not in before["manifest"]
    with engine._connect() as db:
        stored_before = tuple(db.execute(
            "SELECT manifest_digest,finalized_at FROM runtime_run_manifests WHERE run_id=?",
            (run["run_id"],),
        ).fetchone())
    engine.get_run_manifest(run["run_id"], safe=False)
    with engine._connect() as db:
        stored_after = tuple(db.execute(
            "SELECT manifest_digest,finalized_at FROM runtime_run_manifests WHERE run_id=?",
            (run["run_id"],),
        ).fetchone())
    assert stored_after == stored_before

    assert engine.reconcile_terminal_run_manifests() == 1
    manifest = engine.get_run_manifest(run["run_id"], safe=False)
    assert manifest["finalized_at"]
    assert manifest["manifest"]["outcome"]["status"] == "completed"
    assert manifest["manifest"]["outcome"]["completed_at"] == "2026-08-04T10:00:00+00:00"
    assert manifest["manifest"]["outcome"]["counts_by_item_type"] == {"message": 1}
    assert manifest["manifest"]["outcome"]["usage"] == {
        "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
    }


def test_run_inspection_projects_timeline_and_manifest(engine: RuntimeEngine) -> None:
    _, run = create_run(engine)
    engine.set_run_input(run["run_id"], "hello", model="gpt-test")
    engine.append_event(run["run_id"], "agent.message.delta", {"delta": "hello"})
    engine.append_event(run["run_id"], "agent.completed", {"content": "hello"})
    inspection = engine.inspect_run(run["run_id"], limit=1)

    assert inspection["schema_version"] == "opendrsai.run-inspection/1"
    assert inspection["run"]["run_id"] == run["run_id"]
    assert inspection["timeline"]
    first_ref = inspection["timeline"][0]["event_refs"][0]
    assert first_ref["event_id"]
    assert first_ref["sequence"] > 0
    assert inspection["page"]["has_more"] is True
    next_page = engine.inspect_run(
        run["run_id"], timeline_cursor=inspection["page"]["next_cursor"], limit=50,
    )
    sequences = [item["sequence"] for item in [*inspection["timeline"], *next_page["timeline"]]]
    assert sequences == sorted(set(sequences))
    assert inspection["manifest"]["manifest_digest"]


def test_timeline_combined_filters_page_to_the_authoritative_order(engine: RuntimeEngine) -> None:
    _, run = create_run(engine, "combined-filters")
    engine.set_run_input(run["run_id"], "filters", model="gpt-test")
    for index in range(12):
        engine.append_event(
            run["run_id"], "agent.item.command.delta",
            {"item_id": f"command-{index:02d}", "delta": str(index)},
        )
        engine.append_event(
            run["run_id"], "agent.item.file_change",
            {"item": {"id": f"file-{index:02d}", "status": "completed", "changes": [{"path": f"file-{index}.txt"}]}},
        )
    expected = [
        item["id"] for item in engine.conversation_journal.oaep_run_items(
            run["session_id"], run["run_id"],
        ) if item["type"] == "command_execution" and item["status"] == "running"
    ]
    actual: list[str] = []
    cursor = None
    while True:
        page = engine.inspect_run(
            run["run_id"], timeline_cursor=cursor, limit=3,
            item_type="command_execution", status="running",
        )
        actual.extend(item["id"] for item in page["timeline"])
        assert page["summary"]["counts_by_item_type"]["file_change"] == 12
        if not page["page"]["has_more"]:
            break
        cursor = page["page"]["next_cursor"]
    assert actual == expected


def test_inspection_uses_database_keyset_pages_and_constant_time_item_locator(
    engine: RuntimeEngine, monkeypatch,
) -> None:
    _, run = create_run(engine, "keyset-locator")
    engine.set_run_input(run["run_id"], "keyset", model="gpt-test")
    for index in range(12):
        engine.append_event(
            run["run_id"], "agent.item.command.delta",
            {"item_id": f"locator-command-{index:02d}", "delta": str(index)},
        )
    authoritative = engine.conversation_journal.oaep_run_items(
        run["session_id"], run["run_id"],
    )
    target = authoritative[-3]

    def forbid_full_timeline(*_args, **_kwargs):
        raise AssertionError("Inspection must not materialize the complete Run timeline")

    monkeypatch.setattr(engine.conversation_journal, "oaep_run_items", forbid_full_timeline)
    first = engine.inspect_run(run["run_id"], limit=2)
    second = engine.inspect_run(
        run["run_id"], timeline_cursor=first["page"]["next_cursor"], limit=2,
    )
    assert {item["id"] for item in first["timeline"]}.isdisjoint(
        item["id"] for item in second["timeline"]
    )

    locator = engine.locate_run_item(run["run_id"], target["id"])
    located = engine.inspect_run(
        run["run_id"], timeline_cursor=locator["timeline_cursor"], limit=1,
    )
    assert located["timeline"][0]["id"] == target["id"]
    assert locator["item_sequence"] == target["sequence"]

    with pytest.raises(KeyError):
        engine.locate_run_item(run["run_id"], "missing-item")


def test_inspection_aggregates_usage_error_and_hides_private_reasoning(
    engine: RuntimeEngine,
) -> None:
    _, run = create_run(engine, "safe-aggregate")
    engine.set_run_input(run["run_id"], "hello", model="gpt-test")
    engine.update_run_manifest(
        run["run_id"],
        {"outcome": {"usage": {"prompt_tokens": 7, "completion_tokens": 5}}},
    )
    engine.append_event(
        run["run_id"], "agent.item.reasoning.delta",
        {"delta": "private-reasoning-secret-canary", "item_id": "reasoning-one"},
    )
    engine.transition_run(run["run_id"], "running")
    engine.transition_run(
        run["run_id"], "failed",
        error={"code": "provider.failed", "message": "Bearer error-secret-canary", "retryable": True},
    )

    inspection = engine.inspect_run(run["run_id"])
    assert inspection["summary"]["usage"] == {
        "input_tokens": 7, "output_tokens": 5, "total_tokens": 12,
    }
    assert inspection["summary"]["error"] == {
        "code": "provider.failed", "message": "[REDACTED]", "retryable": True,
    }
    reasoning = next(item for item in inspection["timeline"] if item["type"] == "reasoning")
    assert reasoning["content"] == {"segments": []}
    assert "private-reasoning-secret-canary" not in json.dumps(inspection)


def test_reasoning_requires_an_explicit_public_summary() -> None:
    safe = safe_inspection_item({
        "id": "reasoning-public", "type": "reasoning", "status": "completed",
        "content": {
            "segments": [{"id": "private", "text": "raw-private-chain"}],
            "unknown_reasoning": "also-private",
            "public_summary": "Checked the requested constraints.",
        },
    })
    assert safe["content"] == {
        "segments": [], "summary": "Checked the requested constraints.",
    }
    assert "raw-private-chain" not in json.dumps(safe)
    assert "also-private" not in json.dumps(safe)


def test_public_inspection_scrubs_embedded_private_paths_and_reasoning_aliases() -> None:
    safe = safe_inspection_item({
        "id": "reasoning-paths", "type": "reasoning", "status": "completed",
        "content": {
            "segments": [{"text": "private-chain"}],
            "chain_of_thought": "hidden-chain",
            "reasoning_trace": "hidden-trace",
            "public_summary": (
                "Read C:\\Users\\private-user\\OpenDrSai\\secret.txt and "
                "/home/private-user/opendrsai/secret.txt; verified the public result."
            ),
        },
        "event_refs": [],
    })
    serialized = json.dumps(safe)
    assert safe["content"]["segments"] == []
    assert "verified the public result" in safe["content"]["summary"]
    assert "private-chain" not in serialized
    assert "hidden-chain" not in serialized
    assert "hidden-trace" not in serialized
    assert "C:\\\\Users" not in serialized
    assert "/home/private-user" not in serialized
    assert serialized.count("REDACTED PRIVATE PATH") == 2


def test_inspection_uses_run_index_and_bounds_a_10k_timeline(
    engine: RuntimeEngine,
) -> None:
    session, run = create_run(engine, "ten-thousand-items")
    created = "2026-08-04T10:00:00+00:00"
    conversation_rows = []
    oaep_rows = []
    for index in range(10_000):
        item_id = f"bulk-{index:05d}"
        envelope = {
            "id": item_id,
            "session_id": session["session_id"],
            "run_id": run["run_id"],
            "type": "notice" if index % 2 else "message",
            "status": "completed",
            "sequence": index + 1,
            "created_at": created,
            "updated_at": created,
            "source": {"backend": "fixture", "backend_event_id": f"event-{index:05d}"},
            "content": (
                {"level": "info", "code": "fixture", "message": f"item {index}"}
                if index % 2 else {"role": "assistant", "text": f"item {index}"}
            ),
        }
        conversation_rows.append((item_id, session["session_id"], run["run_id"], "notice", None, 1, index + 1, "fixture", None, created, created, "{}"))
        oaep_rows.append((
            item_id, session["session_id"], run["run_id"], index + 1, 1, index + 1,
            envelope["type"], "completed", 0, 0, 0, 0, json.dumps(envelope),
        ))
    with engine._connect() as db:
        db.executemany(
            "INSERT INTO runtime_conversation_items(item_id,session_id,run_id,item_kind,role,revision,latest_sequence,source_client,source_message_id,created_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            conversation_rows,
        )
        db.executemany(
            "INSERT INTO runtime_oaep_items(item_id,session_id,run_id,run_sequence,revision,latest_sequence,item_type,item_status,warning_count,input_tokens,output_tokens,total_tokens,envelope_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            oaep_rows,
        )
        plan = db.execute(
            "EXPLAIN QUERY PLAN SELECT envelope_json FROM runtime_oaep_items WHERE run_id=? ORDER BY run_sequence,item_id",
            (run["run_id"],),
        ).fetchall()
    assert "idx_runtime_oaep_items_run_inspection" in " ".join(str(row[3]) for row in plan)

    started = time.perf_counter()
    first = engine.inspect_run(run["run_id"], limit=100, item_type="message", status="completed")
    elapsed = time.perf_counter() - started
    assert elapsed < 0.5, f"10k Inspection took {elapsed * 1000:.1f} ms"
    assert len(first["timeline"]) == 100
    assert first["page"]["has_more"] is True
    assert len(json.dumps(first)) < 500_000
    # Synthetic projection rows deliberately have no forged Event identities.
    assert all(item["event_refs"] == [] for item in first["timeline"])
    engine.record_projection_violation()
    metrics = engine.inspection_metrics()
    assert metrics["reads"] == 1
    assert metrics["incomplete_evidence"] == 1
    assert metrics["projection_violations"] == 1
    assert metrics["latency_ms_max"] >= metrics["latency_ms_average"] > 0
    assert metrics["response_bytes_max"] < 500_000
    assert "content" not in metrics and "message" not in metrics
    reopened = RuntimeEngine(engine.database, engine.identity, lambda _: True)
    persisted = reopened.inspection_metrics()
    assert persisted["reads"] == metrics["reads"]
    assert persisted["projection_violations"] == metrics["projection_violations"]

    samples = []
    for _ in range(20):
        sample_started = time.perf_counter()
        engine.inspect_run(run["run_id"], limit=100)
        samples.append((time.perf_counter() - sample_started) * 1_000)
    p95 = sorted(samples)[int(len(samples) * 0.95) - 1]
    assert p95 <= 500, f"1k/10k local Inspection P95 was {p95:.1f} ms"


def test_inspection_100k_timeline_keeps_first_page_and_locator_bounded(
    engine: RuntimeEngine,
) -> None:
    session, run = create_run(engine, "hundred-thousand-items")
    created = "2026-08-04T10:00:00+00:00"

    def conversation_rows():
        for index in range(100_000):
            item_id = f"scale-{index:06d}"
            yield (
                item_id, session["session_id"], run["run_id"], "notice", None,
                1, index + 1, "fixture", None, created, created, "{}",
            )

    def oaep_rows():
        for index in range(100_000):
            item_id = f"scale-{index:06d}"
            envelope = {
                "id": item_id,
                "session_id": session["session_id"],
                "run_id": run["run_id"],
                "type": "message",
                "status": "completed",
                "sequence": index + 1,
                "created_at": created,
                "updated_at": created,
                "content": {"role": "assistant", "text": "bounded"},
            }
            yield (
                item_id, session["session_id"], run["run_id"], index + 1, 1,
                index + 1, "message", "completed", 0, 0, 0, 0,
                json.dumps(envelope, separators=(",", ":")),
            )

    with engine._connect() as db:
        db.executemany(
            "INSERT INTO runtime_conversation_items(item_id,session_id,run_id,item_kind,role,revision,latest_sequence,source_client,source_message_id,created_at,updated_at,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            conversation_rows(),
        )
        db.executemany(
            "INSERT INTO runtime_oaep_items(item_id,session_id,run_id,run_sequence,revision,latest_sequence,item_type,item_status,warning_count,input_tokens,output_tokens,total_tokens,envelope_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
            oaep_rows(),
        )

    samples = []
    for _ in range(20):
        started = time.perf_counter()
        page = engine.inspect_run(run["run_id"], limit=100)
        samples.append((time.perf_counter() - started) * 1_000)
        assert len(page["timeline"]) == 100
        assert page["summary"]["counts_by_item_type"] == {"message": 100_000}
    p95 = sorted(samples)[int(len(samples) * 0.95) - 1]
    assert p95 <= 500, f"100k local Inspection P95 was {p95:.1f} ms"

    locator_started = time.perf_counter()
    locator = engine.locate_run_item(run["run_id"], "scale-099999")
    located = engine.inspect_run(
        run["run_id"], timeline_cursor=locator["timeline_cursor"], limit=1,
    )
    locator_ms = (time.perf_counter() - locator_started) * 1_000
    assert located["timeline"][0]["id"] == "scale-099999"
    assert locator_ms <= 500, f"100k deep link took {locator_ms:.1f} ms"


def test_inspection_truncates_a_10mb_tool_output_before_serialization(engine: RuntimeEngine) -> None:
    _, run = create_run(engine, "large-tool-output")
    engine.append_event(
        run["run_id"], "tool.completed",
        {"tool_id": "large-tool", "status": "completed", "result": "x" * 10_000_000},
    )
    inspection = engine.inspect_run(run["run_id"])
    serialized = json.dumps(inspection)
    assert len(serialized) < 100_000
    assert "TRUNCATED sha256=" in serialized
