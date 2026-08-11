from __future__ import annotations

from pathlib import Path

import pytest

from drsai.backend.runtime.tool_selection_eval import (
    ToolSelectionCaseResult,
    ToolSelectionEvaluationError,
    evaluate_tool_selection_gate,
    load_tool_selection_suite,
    score_tool_selection_attempt,
)


ROOT = Path(__file__).parents[5]
FIXTURE = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-tool-selection-v1.json"


def test_frozen_suite_has_thirty_natural_non_leaking_cases() -> None:
    suite = load_tool_selection_suite(FIXTURE)
    assert len(suite["cases"]) == 30
    assert len(suite["sha256"]) == 64
    assert len({case["category"] for case in suite["cases"]}) >= 10
    assert any(not case["allowed_tools"] for case in suite["cases"])
    assert any(case["expected_tools"] == ["workspace.write"] for case in suite["cases"])


def test_attempt_scoring_counts_missing_wrong_meaningless_and_duplicate_calls() -> None:
    suite = load_tool_selection_suite(FIXTURE)
    time_case = next(case for case in suite["cases"] if case["id"] == "time.current")
    no_tool = next(case for case in suite["cases"] if case["id"] == "none.greeting")
    assert score_tool_selection_attempt(time_case, 1, ["get_current_time"]).passed
    assert score_tool_selection_attempt(time_case, 1, []).failure_codes == ("missing_required_tool",)
    wrong = score_tool_selection_attempt(time_case, 1, ["get_device_info"])
    assert set(wrong.failure_codes) == {"missing_required_tool", "wrong_tool"}
    meaningless = score_tool_selection_attempt(no_tool, 1, ["get_current_time"])
    assert set(meaningless.failure_codes) == {"wrong_tool", "meaningless_tool_call"}
    duplicate = score_tool_selection_attempt(time_case, 1, ["get_current_time", "get_current_time"])
    assert duplicate.failure_codes == ("duplicate_tool_call",)


def test_gate_requires_multiple_behavior_attempts_per_case_and_separates_provider_errors() -> None:
    suite = load_tool_selection_suite(FIXTURE)
    results: list[ToolSelectionCaseResult] = []
    for case in suite["cases"]:
        calls = case["expected_tools"]
        results.extend(score_tool_selection_attempt(case, attempt, calls) for attempt in range(1, 4))
    results[0] = score_tool_selection_attempt(suite["cases"][0], 1, [], provider_error="timeout")
    report = evaluate_tool_selection_gate(suite, results)
    assert report["provider_errors"] == 1
    assert report["passed"] is False
    first = report["cases"][0]
    assert first["behavior_attempts"] == 2
    assert first["failure_counts"] == {"provider_error": 1}


def test_gate_passes_only_when_every_case_and_suite_threshold_pass() -> None:
    suite = load_tool_selection_suite(FIXTURE)
    results = [
        score_tool_selection_attempt(case, attempt, case["expected_tools"])
        for case in suite["cases"] for attempt in range(1, 4)
    ]
    report = evaluate_tool_selection_gate(suite, results)
    assert report["behavior_attempts"] == 90
    assert report["success_rate"] == 1.0
    assert report["passed"] is True


def test_loader_rejects_prompt_that_names_expected_implementation_tool(tmp_path: Path) -> None:
    suite = load_tool_selection_suite(FIXTURE)
    suite.pop("sha256")
    suite["cases"][0]["prompt"] = "Please call get_current_time"
    path = tmp_path / "leak.json"
    import json
    path.write_text(json.dumps(suite, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ToolSelectionEvaluationError, match="prompt_leaks_tool"):
        load_tool_selection_suite(path)
