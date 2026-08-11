from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.experiment_export import (
    build_experiment_package,
    verify_experiment_package,
)
from drsai.backend.runtime.experiments import (
    ExperimentConflict,
    ExperimentError,
    ExperimentImmutable,
    ExperimentNotFound,
)


@pytest.fixture()
def engine(tmp_path: Path) -> RuntimeEngine:
    return RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-experiments", "instance-one"),
        lambda workspace_id: workspace_id in {"workspace-one", "workspace-two"},
    )


def _run(engine: RuntimeEngine, *, workspace: str = "workspace-one", key: str = "base"):
    session = engine.create_session(workspace, "Experiment source")
    run, _ = engine.create_run(session["session_id"], "agent@v1", key, "codex")
    engine.set_run_input(run["run_id"], "source prompt")
    return session, engine.get_run(run["run_id"])


def test_create_is_idempotent_and_never_mutates_base_run_or_manifest(engine: RuntimeEngine) -> None:
    _, run = _run(engine)
    before_run = engine.get_run(run["run_id"])
    before_manifest = engine.get_run_manifest(run["run_id"], safe=False)

    draft, created = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key="create-one",
    )
    repeated, repeated_created = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key="create-one",
    )

    assert created is True and repeated_created is False
    assert repeated["experiment_id"] == draft["experiment_id"]
    assert draft["workspace_id"] == run["workspace_id"]
    assert engine.get_run(run["run_id"]) == before_run
    assert engine.get_run_manifest(run["run_id"], safe=False) == before_manifest
    with pytest.raises(ExperimentConflict):
        engine.experiments.create(
            run["run_id"], created_by="user-two", idempotency_key="create-one",
        )
    with pytest.raises(ExperimentNotFound):
        engine.experiments.create(
            "run-missing", created_by="user-one", idempotency_key="missing",
        )
    legacy, _ = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key="legacy-mode", replay_mode="fresh",
    )
    assert legacy["replay_mode"] == "rerun_from_start"


@pytest.mark.parametrize("terminal", ["completed", "failed", "cancelled"])
def test_historical_terminal_runs_remain_valid_experiment_sources(
    engine: RuntimeEngine, terminal: str,
) -> None:
    _, run = _run(engine, key=f"source-{terminal}")
    if terminal == "completed":
        engine.transition_run(run["run_id"], "running")
        engine.transition_run(run["run_id"], terminal)
    else:
        engine.transition_run(run["run_id"], terminal)
    draft, created = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key=f"draft-{terminal}",
    )
    assert created and draft["base_run_id"] == run["run_id"]


def test_item_fork_is_atomic_and_bound_to_base_run(engine: RuntimeEngine) -> None:
    _, first = _run(engine, key="first")
    _, second = _run(engine, workspace="workspace-two", key="second")
    first_item = f"user:{first['run_id']}"
    second_item = f"user:{second['run_id']}"

    draft, _ = engine.experiments.create(
        first["run_id"], created_by="user-one", idempotency_key="from-item",
        forked_from_item_id=first_item,
    )
    assert draft["forked_from_item_id"] == first_item

    with pytest.raises(ExperimentError):
        engine.experiments.create(
            first["run_id"], created_by="user-one", idempotency_key="wrong-item",
            forked_from_item_id=second_item,
        )
    with pytest.raises(ExperimentError):
        engine.experiments.create(
            first["run_id"], created_by="user-one", idempotency_key="missing-item",
            forked_from_item_id="item-missing",
        )
    with sqlite3.connect(engine.database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_run_experiments WHERE create_idempotency_key IN ('wrong-item','missing-item')"
        ).fetchone()[0] == 0


def test_optimistic_updates_preserve_versions_and_network_retries(engine: RuntimeEngine) -> None:
    _, run = _run(engine)
    draft, _ = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key="create-versioned",
    )
    updated = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="save-one",
        patch={"title": "Try another model", "overrides": {"model": {"provider_id": "test", "model_id": "gpt-test"}}},
    )
    repeated = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="save-one",
        patch={"title": "Try another model", "overrides": {"model": {"provider_id": "test", "model_id": "gpt-test"}}},
    )
    assert updated["draft_version"] == repeated["draft_version"] == 2
    assert engine.experiments.get(draft["experiment_id"], version=1)["overrides"] == {}
    assert updated["overrides_digest"].startswith("sha256:")
    with pytest.raises(ExperimentConflict):
        engine.experiments.update(
            draft["experiment_id"], expected_version=1, idempotency_key="stale-window",
            patch={"title": "Lost update"},
        )
    with pytest.raises(ExperimentConflict):
        engine.experiments.update(
            draft["experiment_id"], expected_version=1, idempotency_key="save-one",
            patch={"title": "Changed retry"},
        )


def test_relations_cover_branches_and_executed_lineage_is_immutable(engine: RuntimeEngine) -> None:
    session, base = _run(engine)
    child, _ = engine.create_run(
        session["session_id"], "agent@v1", "child-run", "codex", parent_run_id=base["run_id"],
    )
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="lineage-draft",
    )
    replay, _ = engine.create_run(
        session["session_id"], "agent@v1", "replay-run", "codex", parent_run_id=base["run_id"],
    )
    engine.experiments.mark_executed(draft["experiment_id"], replay["run_id"])

    base_relations = engine.experiments.relations(base["run_id"])
    replay_relations = engine.experiments.relations(replay["run_id"])
    assert {row["run_id"] for row in base_relations["children"]} >= {child["run_id"], replay["run_id"]}
    assert replay_relations["parent"]["source_run_id"] == base["run_id"]
    assert replay_relations["parent"]["relation_type"] == "experiment_replay"
    with pytest.raises(ExperimentImmutable):
        engine.experiments.delete(draft["experiment_id"])
    with pytest.raises(ExperimentImmutable):
        engine.experiments.update(
            draft["experiment_id"], expected_version=1, idempotency_key="after-run",
            patch={"title": "No longer editable"},
        )

    disposable, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="disposable",
    )
    engine.experiments.delete(disposable["experiment_id"])
    with pytest.raises(ExperimentNotFound):
        engine.experiments.get(disposable["experiment_id"])


def test_cleanup_policy_excludes_pinned_and_nonterminal_experiments(engine: RuntimeEngine) -> None:
    session, base = _run(engine, key="cleanup-base")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-one", idempotency_key="cleanup-draft",
    )
    replay, _ = engine.create_run(session["session_id"], "agent@v1", "cleanup-replay", "codex")
    engine.experiments.mark_executed(draft["experiment_id"], replay["run_id"])
    future = "2999-01-01T00:00:00+00:00"
    assert engine.experiments.cleanup_candidates(older_than=future) == []

    engine.transition_run(replay["run_id"], "failed")
    assert [row["experiment_id"] for row in engine.experiments.cleanup_candidates(older_than=future)] == [draft["experiment_id"]]
    pinned = engine.experiments.set_pinned(draft["experiment_id"], True)
    assert pinned["pinned"] is True
    assert engine.experiments.cleanup_candidates(older_than=future) == []

    engine.experiments.set_pinned(draft["experiment_id"], False)
    cleaned = engine.experiments.mark_resources_cleaned(draft["experiment_id"])
    assert cleaned["resources_cleaned_at"]
    assert engine.experiments.cleanup_candidates(older_than=future) == []


def test_experiment_package_is_redacted_and_offline_verifiable(engine: RuntimeEngine) -> None:
    _, base = _run(engine, key="export-base")
    draft, _ = engine.experiments.create(
        base["run_id"], created_by="user-sensitive", idempotency_key="export-draft",
    )
    private_input = "private customer incident narrative"
    updated = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="export-update",
        patch={"overrides": {"input": {"message": private_input}}},
    )
    engine.replay_plans.create(
        draft["experiment_id"], expected_draft_version=updated["draft_version"],
    )

    package = build_experiment_package(engine, draft["experiment_id"])
    serialized = str(package)
    assert verify_experiment_package(package)
    assert private_input not in serialized
    assert "user-sensitive" not in serialized
    assert "credential_refs" not in serialized
    assert package["experiment"]["safe_summary"]["input"]["characters"] == len(private_input)
    assert package["replay_plan"]["plan_digest"]

    package["experiment"]["title"] = "tampered"
    assert not verify_experiment_package(package)
