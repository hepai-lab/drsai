from __future__ import annotations

from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.goals import clarification_questions, normalize_goal, propose_goal_from_request, render_goal_execution_prompt
from drsai.backend.runtime.registry import RuntimeRegistry


def _runtime(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    registry = RuntimeRegistry(tmp_path / "registry.sqlite3")
    record = registry.open_workspace(str(workspace))
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
        lambda workspace_id: registry.get_workspace(workspace_id) is not None,
    )
    session = engine.create_session(record.workspace_id, "Goal test")
    run, _ = engine.create_run(session["session_id"], "opendrsai@1", "goal-test", "opendrsai")
    return engine, run


def _goal(objective: str = "Summarize the report") -> dict:
    return {
        "objective": objective,
        "materials": ["report.pdf"],
        "outputs": ["A cited executive summary"],
        "constraints": ["Do not modify source files"],
    }


def test_goal_defaults_and_blocking_clarifications_are_bounded() -> None:
    assert [item["field"] for item in clarification_questions({})] == ["objective", "outputs"]
    assert clarification_questions(_goal()) == []
    normalized = normalize_goal(_goal())
    assert normalized["defaults"] == {
        "language": "user_input",
        "length": "appropriate",
        "citation_style": "preserve_sources",
        "format": "best_fit",
    }
    assert normalized["default_sources"] == {
        "language": "user_request_language",
        "length": "opendrsai_task_policy",
        "citation_style": "available_material_provenance",
        "format": "requested_output_inference",
    }


@pytest.mark.parametrize("prompt,materials,expected", [
    ("Summarize the attached report", ["report.pdf"], "ready"),
    ("分析销售数据并给出三条建议", ["sales.csv"], "ready"),
    ("Fix the failing parser tests", [], "ready"),
    ("Create a two-page cited briefing", [], "ready"),
    ("Compare these two proposals", ["a.pdf", "b.pdf"], "ready"),
    ("What caused the build failure?", [], "ready"),
    ("更新 README 并说明变更", [], "ready"),
    ("Review this workspace for security issues", [], "ready"),
    ("Draft an email but do not send it", [], "ready"),
    ("Generate a chart from the attached table", ["table.xlsx"], "ready"),
    ("Refactor the model client without changing its API", [], "ready"),
    ("Explain the test results in Chinese", ["results.xml"], "ready"),
    ("帮我弄一下", [], "clarification_required"),
    ("do it", [], "clarification_required"),
    ("继续", [], "clarification_required"),
    ("看看", [], "clarification_required"),
    ("delete it", [], "clarification_required"),
    ("发布", [], "clarification_required"),
    ("send this", [], "clarification_required"),
    ("merge", [], "clarification_required"),
])
def test_twenty_goal_semantic_cases(prompt: str, materials: list[str], expected: str) -> None:
    result = propose_goal_from_request(prompt, materials=materials)
    assert result["status"] == expected
    assert result["side_effects_allowed"] is False
    assert len(result["questions"]) <= 3
    if expected == "ready":
        assert result["goal"]["objective"] == prompt
        assert result["goal"]["outputs"]
        assert result["goal"]["materials"] == materials
    else:
        assert result["questions"]


@pytest.mark.parametrize("prompt,answers,expected_fields", [
    ("帮我弄一下", {"objective": "Summarize the attached report"}, ["objective"]),
    ("delete", {"scope": "Only temp.txt", "constraints": "Ask once more before deletion"}, ["scope", "constraints"]),
    ("发布", {"objective": "Publish the release notes", "scope": "Draft channel only", "constraints": "Do not notify subscribers"}, ["objective", "scope", "constraints"]),
    ("send", {"scope": "The draft email", "constraints": "Send only to reviewer@example.test"}, ["scope", "constraints"]),
])
def test_goal_clarification_accumulates_missing_fields_without_repeating(
    prompt: str, answers: dict[str, str], expected_fields: list[str],
) -> None:
    accumulated: dict[str, str] = {}
    asked: list[str] = []
    for _round in range(3):
        proposal = propose_goal_from_request(prompt, clarifications=accumulated)
        if proposal["status"] == "ready":
            break
        question = proposal["questions"][0]
        assert question["field"] not in asked
        asked.append(question["field"])
        accumulated[question["field"]] = answers[question["field"]]
    final = propose_goal_from_request(prompt, clarifications=accumulated)
    assert final["status"] == "ready"
    assert asked == expected_fields
    assert len(asked) <= 3
    assert final["goal"]["objective"]
    assert final["goal"]["outputs"]


def test_confirmed_goal_execution_prompt_binds_all_fields_and_defaults() -> None:
    rendered = render_goal_execution_prompt(_goal(), "Please do the report")
    assert "<confirmed_goal>" in rendered
    assert '"objective": "Summarize the report"' in rendered
    assert '"materials": [' in rendered and "report.pdf" in rendered
    assert '"outputs": [' in rendered and "A cited executive summary" in rendered
    assert '"constraints": [' in rendered and "Do not modify source files" in rendered
    assert '"language": "user_input"' in rendered
    assert '"citation_style": "preserve_sources"' in rendered
    assert '"default_sources": {' in rendered
    assert '"language": "user_request_language"' in rendered
    assert "<original_user_request>\nPlease do the report" in rendered


def test_goal_revisions_are_immutable_and_new_revision_invalidates_confirmation(tmp_path) -> None:
    engine, run = _runtime(tmp_path)
    first = engine.revise_goal(run["run_id"], _goal(), expected_version=0)
    proposed_item = next(
        item for item in engine.oaep_snapshot(run["session_id"])["items"]
        if item["id"] == f"goal:{run['run_id']}:v1"
    )
    assert proposed_item["type"] == "interaction"
    assert proposed_item["status"] == "waiting"
    assert proposed_item["content"]["interaction_type"] == "confirmation"
    confirmed = engine.confirm_goal(run["run_id"], first["version"])
    assert confirmed["confirmed"] is True
    confirmed_item = next(
        item for item in engine.oaep_snapshot(run["session_id"])["items"]
        if item["id"] == f"goal:{run['run_id']}:v1"
    )
    assert confirmed_item["status"] == "completed"
    assert engine.confirm_goal(run["run_id"], first["version"])["confirmed_at"] == confirmed["confirmed_at"]

    second = engine.revise_goal(run["run_id"], _goal("Create a two-page summary"), expected_version=1)
    assert second["version"] == 2
    assert engine.get_current_goal(run["run_id"])["confirmed"] is False
    with pytest.raises(ValueError, match="latest"):
        engine.confirm_goal(run["run_id"], 1)
    with pytest.raises(ValueError, match="confirmed"):
        engine.require_confirmed_goal(run["run_id"])
    engine.confirm_goal(run["run_id"], 2)
    assert engine.require_confirmed_goal(run["run_id"])["goal"]["objective"] == "Create a two-page summary"

    events = engine.list_events(run["run_id"])
    assert [event["type"] for event in events].count("goal.confirmed") == 2
    assert [event["type"] for event in events].count("goal.revised") == 1
    assert [event["type"] for event in events].count("goal.superseded") == 0


def test_unconfirmed_goal_revision_supersedes_old_waiting_item(tmp_path) -> None:
    engine, run = _runtime(tmp_path)
    engine.revise_goal(run["run_id"], _goal(), expected_version=0)
    engine.revise_goal(run["run_id"], _goal("Create a two-page summary"), expected_version=1)
    old_item = next(
        item for item in engine.oaep_snapshot(run["session_id"])["items"]
        if item["id"] == f"goal:{run['run_id']}:v1"
    )
    new_item = next(
        item for item in engine.oaep_snapshot(run["session_id"])["items"]
        if item["id"] == f"goal:{run['run_id']}:v2"
    )
    assert old_item["status"] == "completed"
    assert old_item["content"]["response"] == {"value": "superseded", "superseded_by": 2}
    assert new_item["status"] == "waiting"
    assert [event["type"] for event in engine.list_events(run["run_id"])].count("goal.superseded") == 1


def test_goal_revision_conflicts_and_post_start_edits_fail_closed(tmp_path) -> None:
    engine, run = _runtime(tmp_path)
    engine.revise_goal(run["run_id"], _goal(), expected_version=0)
    with pytest.raises(ValueError, match="conflict"):
        engine.revise_goal(run["run_id"], _goal(), expected_version=0)
    engine.transition_run(run["run_id"], "running")
    with pytest.raises(ValueError, match="before Run execution"):
        engine.revise_goal(run["run_id"], _goal("Changed too late"), expected_version=1)


def test_corrected_goal_is_the_only_revision_allowed_to_drive_execution(tmp_path) -> None:
    engine, run = _runtime(tmp_path)
    rejected_text = "Publish the draft and notify every subscriber"
    engine.revise_goal(run["run_id"], _goal(rejected_text), expected_version=0)
    corrected = _goal("Create a private reviewed briefing")
    corrected["constraints"] = ["Do not publish", "Do not notify subscribers"]
    revision = engine.revise_goal(run["run_id"], corrected, expected_version=1)

    revision_event = next(event for event in engine.list_events(run["run_id"]) if event["type"] == "goal.revised")
    assert revision_event["data"]["invalidates_goal_version"] == 1
    assert revision_event["data"]["invalidates_plan_for_goal_version"] == 1
    with pytest.raises(ValueError, match="latest"):
        engine.confirm_goal(run["run_id"], 1)

    engine.confirm_goal(run["run_id"], revision["version"])
    final_goal = engine.require_confirmed_goal(run["run_id"])
    execution_prompt = render_goal_execution_prompt(final_goal["goal"], "Please handle the draft")
    assert "Create a private reviewed briefing" in execution_prompt
    assert "Do not notify subscribers" in execution_prompt
    assert rejected_text not in execution_prompt
