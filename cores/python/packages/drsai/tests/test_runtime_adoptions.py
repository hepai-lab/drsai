from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.experiments import ExperimentConflict


def _store(tmp_path: Path):
    engine = RuntimeEngine(
        tmp_path / "adoptions.sqlite3",
        RuntimeEngineIdentity("runtime-adoption", "instance-adoption"),
        lambda _: True,
    )
    session = engine.create_session("workspace-one", "Adoption")
    baseline, _ = engine.create_run(session["session_id"], "agent@v1", "adoption-base", "codex")
    candidate, _ = engine.create_run(session["session_id"], "agent@v1", "adoption-candidate", "codex")
    for run in (baseline, candidate):
        engine.transition_run(run["run_id"], "running")
        engine.transition_run(run["run_id"], "completed")
    comparison = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    return engine.adoptions, comparison


def test_preview_and_apply_produce_immutable_content_safe_receipt(tmp_path: Path) -> None:
    store, comparison = _store(tmp_path)
    preview = store.record_preview(comparison["comparison_id"], "workspace-one", "worktree-one", {
        "preview_digest": "sha256:" + "a" * 64,
        "changes": [{"status": "modified", "path": "src/app.py"}],
        "content": "must-not-be-stored",
        "can_apply": True,
    })
    assert "content" not in preview["preview"]
    applied = store.mark_applied(preview["adoption_id"], ["src/app.py"], {
        "source_path": "repo", "audit_event": "adoption.applied",
    })
    assert applied["status"] == "applied"
    assert applied["selected_paths"] == ["src/app.py"]
    assert store.mark_applied(preview["adoption_id"], ["src/app.py"], {})["status"] == "applied"
    with pytest.raises(ExperimentConflict):
        store.mark_discarded(preview["adoption_id"], {})


def test_discard_is_idempotent_and_cannot_be_reversed(tmp_path: Path) -> None:
    store, comparison = _store(tmp_path)
    preview = store.record_preview(comparison["comparison_id"], "workspace-one", "worktree-one", {
        "preview_digest": "sha256:" + "b" * 64, "changes": [], "can_apply": False,
    })
    discarded = store.mark_discarded(preview["adoption_id"], {"cleanup_requested": True})
    assert discarded["status"] == "discarded"
    assert store.mark_discarded(preview["adoption_id"], {})["status"] == "discarded"
    with pytest.raises(ExperimentConflict):
        store.mark_applied(preview["adoption_id"], ["README.md"], {})


def test_adoption_operation_intent_survives_restart_and_is_binding_stable(tmp_path: Path) -> None:
    store, comparison = _store(tmp_path)
    preview = store.record_preview(comparison["comparison_id"], "workspace-one", "worktree-one", {
        "preview_digest": "sha256:" + "c" * 64,
        "changes": [{"status": "modified", "path": "README.md"}], "can_apply": True,
    })
    prepared = store.begin_apply(preview["adoption_id"], ["README.md"])
    assert prepared["operation"] == {
        "kind": "apply", "payload": {"selected_paths": ["README.md"]},
        "status": "prepared", "started_at": prepared["operation"]["started_at"],
    }
    restarted = type(store)(store.database)
    assert restarted.begin_apply(preview["adoption_id"], ["README.md"])["operation"]["status"] == "prepared"
    with pytest.raises(ExperimentConflict, match="another decision"):
        restarted.begin_discard(preview["adoption_id"], cleanup=True)
    completed = restarted.mark_applied(preview["adoption_id"], ["README.md"], {"commit": "abc"})
    assert completed["status"] == "applied"
    assert completed["operation"]["status"] == "completed"
