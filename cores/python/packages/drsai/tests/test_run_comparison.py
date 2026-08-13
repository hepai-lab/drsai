from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.experiments import ExperimentConflict, ExperimentError


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
    engine.append_event(baseline["run_id"], "tool.complete", {
        "tool_id": "baseline-tool", "name": "search", "result": "ok",
    })
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
    engine.append_event(candidate["run_id"], "tool.failed", {
        "tool_id": "candidate-tool", "name": "search", "error": "fixture failure",
    })
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
    assert comparison["metrics"]["baseline"]["duration_ms"] is not None
    assert comparison["metrics"]["candidate"]["artifacts"] == 0
    assert comparison["metrics"]["baseline"]["tool_errors"] == 0
    assert comparison["metrics"]["candidate"]["tool_errors"] == 1
    assert comparison["metrics"]["delta"]["tool_calls"] == 0
    assert comparison["metrics"]["delta"]["tool_errors"] == 1
    assert any(item["kind"] == "known_configuration" for item in comparison["attribution"])
    assert all(item["alignment"] in {"provenance", "same_id", "unmatched_baseline", "unmatched_candidate"} for item in comparison["steps"])


def test_comparison_metric_deltas_preserve_positive_negative_zero_and_unknown(tmp_path: Path) -> None:
    engine, _, _ = _pair(tmp_path)
    baseline = {
        "run": {"status": "completed"},
        "summary": {
            "duration_ms": 100, "counts_by_item_type": {"tool_call": 2, "interaction": 1},
            "usage": {"input_tokens": 10, "output_tokens": 2, "total_tokens": 12},
            "warning_count": 0,
        },
    }
    candidate = {
        "run": {"status": "completed"},
        "summary": {
            "duration_ms": None, "counts_by_item_type": {"tool_call": 2, "interaction": 0},
            "usage": {"input_tokens": 5, "output_tokens": 5, "total_tokens": 10},
            "warning_count": 0,
        },
    }
    metrics = engine.run_comparisons._metrics(
        baseline, candidate, baseline_tool_errors=0, candidate_tool_errors=1,
    )
    assert metrics["delta"]["duration_ms"] is None
    assert metrics["delta"]["input_tokens"] == -5
    assert metrics["delta"]["output_tokens"] == 3
    assert metrics["delta"]["tool_calls"] == 0
    assert metrics["delta"]["tool_errors"] == 1


def _evaluation_scores(baseline: int = 3, candidate: int = 4) -> dict[str, dict[str, int]]:
    return {
        criterion: {"baseline": baseline, "candidate": candidate}
        for criterion in ("outcome_quality", "execution_quality", "safety_reproducibility")
    }


def test_comparison_evaluations_are_append_only_idempotent_and_durable(tmp_path: Path) -> None:
    engine, baseline, candidate = _pair(tmp_path)
    comparison = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    candidate_item_id = engine.inspect_run(candidate["run_id"])["timeline"][0]["id"]
    assert engine.run_comparison_evaluations.list(comparison["comparison_id"])["latest_revision"] == 0
    first = engine.run_comparison_evaluations.create(
        comparison["comparison_id"], expected_latest_revision=0,
        scores=_evaluation_scores(), verdict="candidate_better",
        note="Candidate is more complete. Bearer secret-value-must-not-survive",
        evidence_refs=[{"run_id": candidate["run_id"], "item_id": candidate_item_id}],
        created_by="user-one", idempotency_key="evaluation-one",
    )
    repeated = engine.run_comparison_evaluations.create(
        comparison["comparison_id"], expected_latest_revision=0,
        scores=_evaluation_scores(), verdict="candidate_better",
        note="Candidate is more complete. Bearer secret-value-must-not-survive",
        evidence_refs=[{"run_id": candidate["run_id"], "item_id": candidate_item_id}],
        created_by="user-one", idempotency_key="evaluation-one",
    )
    assert repeated == first
    assert first["revision"] == 1
    assert "secret-value-must-not-survive" not in first["note"]
    second = engine.run_comparison_evaluations.create(
        comparison["comparison_id"], expected_latest_revision=1,
        scores=_evaluation_scores(4, 4), verdict="tie", note="Rechecked.",
        evidence_refs=[], created_by="user-one", idempotency_key="evaluation-two",
    )
    assert second["revision"] == 2
    reopened = RuntimeEngine(
        engine.database, RuntimeEngineIdentity("runtime-comparison", "instance-comparison"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
    )
    history = reopened.run_comparison_evaluations.list(comparison["comparison_id"])
    assert history["latest_revision"] == 2
    assert [item["revision"] for item in history["evaluations"]] == [1, 2]
    assert history["evaluations"][0]["verdict"] == "candidate_better"


def test_comparison_evaluation_rejects_invalid_or_stale_input(tmp_path: Path) -> None:
    engine, baseline, candidate = _pair(tmp_path)
    comparison = engine.run_comparisons.create(baseline["run_id"], candidate["run_id"])
    create = lambda **changes: engine.run_comparison_evaluations.create(
        comparison["comparison_id"], expected_latest_revision=changes.pop("expected", 0),
        scores=changes.pop("scores", _evaluation_scores()),
        verdict=changes.pop("verdict", "candidate_better"),
        note=changes.pop("note", ""), evidence_refs=changes.pop("evidence_refs", []),
        created_by="user-one", idempotency_key=changes.pop("key", "evaluation"),
    )
    with pytest.raises(ExperimentError, match="score"):
        create(scores=_evaluation_scores(candidate=6))
    with pytest.raises(ExperimentError, match="verdict"):
        create(verdict="automatic_winner")
    with pytest.raises(ExperimentError, match="Item was not found"):
        create(evidence_refs=[{"run_id": baseline["run_id"], "item_id": "candidate-file"}])
    create()
    with pytest.raises(ExperimentConflict, match="revision changed"):
        create(key="stale")
    with pytest.raises(ExperimentConflict, match="Idempotency-Key"):
        create(expected=1, key="evaluation", verdict="tie")


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
