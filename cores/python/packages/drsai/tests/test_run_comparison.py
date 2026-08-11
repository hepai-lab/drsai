from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.experiments import ExperimentError


def _pair(tmp_path: Path):
    engine = RuntimeEngine(
        tmp_path / "comparison.sqlite3",
        RuntimeEngineIdentity("runtime-comparison", "instance-comparison"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
    )
    session = engine.create_session("workspace-one", "Comparison")
    baseline, _ = engine.create_run(session["session_id"], "agent@v1", "baseline", "codex")
    engine.set_run_input(baseline["run_id"], "baseline")
    engine.transition_run(baseline["run_id"], "running")
    engine.append_event(baseline["run_id"], "agent.item.file_change", {
        "item_id": "baseline-file", "phase": "completed", "item": {
            "id": "baseline-file", "type": "file_change",
            "changes": [{"path": "result.txt", "sha256": "a" * 64, "operation": "modify"}],
        },
    })
    engine.transition_run(baseline["run_id"], "completed")
    draft, _ = engine.experiments.create(
        baseline["run_id"], created_by="user-one", idempotency_key="comparison-draft",
    )
    changed = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="comparison-override",
        patch={"overrides": {"input": {"message": "candidate"}}},
    )
    candidate, _ = engine.create_run(
        session["session_id"], "agent@v1", "comparison-candidate", "codex",
        parent_run_id=baseline["run_id"],
    )
    engine.set_run_input(candidate["run_id"], changed["overrides"]["input"]["message"])
    engine.experiments.mark_executed(draft["experiment_id"], candidate["run_id"])
    engine.transition_run(candidate["run_id"], "running")
    engine.append_event(candidate["run_id"], "agent.item.file_change", {
        "item_id": "candidate-file", "phase": "completed", "item": {
            "id": "candidate-file", "type": "file_change",
            "changes": [{"path": "result.txt", "sha256": "b" * 64, "operation": "modify"}],
        },
    })
    engine.transition_run(candidate["run_id"], "completed")
    return engine, baseline, engine.get_run(candidate["run_id"])


def test_comparison_prioritizes_outcome_files_usage_and_honest_attribution(tmp_path: Path) -> None:
    engine, baseline, candidate = _pair(tmp_path)
    comparison = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    assert comparison["outcome"]["baseline_status"] == "completed"
    assert comparison["outcome"]["candidate_status"] == "completed"
    file_diff = next(item for item in comparison["files"] if item["identity"] == "result.txt")
    assert file_diff["change"] == "modified"
    assert comparison["usage"]["baseline"]["known"] is True
    assert comparison["usage"]["candidate"]["known"] is True
    assert any(item["kind"] == "known_configuration" for item in comparison["attribution"])
    assert all(item["alignment"] in {"provenance", "same_id", "unmatched_baseline", "unmatched_candidate"} for item in comparison["steps"])


def test_comparison_digest_is_deterministic_and_corrupt_cache_rebuilds(tmp_path: Path) -> None:
    engine, baseline, candidate = _pair(tmp_path)
    first = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    second = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    assert second["comparison_id"] == first["comparison_id"]
    assert second["comparison_digest"] == first["comparison_digest"]
    assert second["cached"] is True
    with sqlite3.connect(engine.database) as db:
        db.execute(
            "UPDATE runtime_run_comparisons SET comparison_json='corrupt' WHERE comparison_id=?",
            (first["comparison_id"],),
        )
    rebuilt = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    assert rebuilt["comparison_id"] != first["comparison_id"]
    assert rebuilt["comparison_digest"] == first["comparison_digest"]
    assert rebuilt["cached"] is False


def test_comparison_rejects_same_cross_workspace_and_nonterminal_runs(tmp_path: Path) -> None:
    engine, baseline, _ = _pair(tmp_path)
    with pytest.raises(ExperimentError):
        engine.run_comparisons.create(baseline["run_id"], baseline["run_id"])
    session = engine.create_session("workspace-two", "Other")
    other, _ = engine.create_run(session["session_id"], "agent@v1", "other", "codex")
    with pytest.raises(ExperimentError):
        engine.run_comparisons.create(baseline["run_id"], other["run_id"])


def test_comparison_pages_file_changes_beyond_first_500_items(tmp_path: Path) -> None:
    engine = RuntimeEngine(
        tmp_path / "large-comparison.sqlite3",
        RuntimeEngineIdentity("runtime-large-comparison", "instance-large-comparison"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Large comparison")
    baseline, _ = engine.create_run(session["session_id"], "agent@v1", "large-baseline", "codex")
    candidate, _ = engine.create_run(session["session_id"], "agent@v1", "large-candidate", "codex")
    draft, _ = engine.experiments.create(
        baseline["run_id"], created_by="user-one", idempotency_key="large-comparison-draft",
    )
    engine.experiments.mark_executed(draft["experiment_id"], candidate["run_id"])
    for run in (baseline, candidate):
        engine.transition_run(run["run_id"], "running")
    for index in range(1_000):
        engine.append_event(candidate["run_id"], "agent.item.file_change", {
            "item_id": f"file-{index}", "phase": "completed", "item": {
                "id": f"file-{index}", "type": "file_change",
                "changes": [{"path": f"generated/{index}.txt", "sha256": f"{index:064x}"[-64:], "operation": "add"}],
            },
        })
    for run in (baseline, candidate):
        engine.transition_run(run["run_id"], "completed")

    started = time.perf_counter()
    comparison = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    elapsed = time.perf_counter() - started
    assert len(comparison["files"]) == 1_000
    assert elapsed < 1.0
