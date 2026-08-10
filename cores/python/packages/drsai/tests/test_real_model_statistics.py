from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

from drsai.backend.runtime.real_model_statistics import (
    evaluate_real_model_statistics,
    load_real_model_policy,
)
from drsai.backend.runtime.tool_selection_eval import load_tool_selection_suite


ROOT = Path(__file__).resolve().parents[5]
SUITE_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-tool-selection-v1.json"
POLICY_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-real-model-statistical-gate-v1.json"
RUNNER_PATH = ROOT / "scripts/accept_android_p9_real_model_statistics.py"
RUNNER_SPEC = importlib.util.spec_from_file_location("p9_real_model_runner", RUNNER_PATH)
assert RUNNER_SPEC and RUNNER_SPEC.loader
RUNNER = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(RUNNER)


def _arguments(case_id: str, tool: str) -> dict:
    special = {
        "workspace.list_docs": {"path": "docs"},
        "workspace.read_readme": {"path": "README.md"},
        "workspace.read_config": {"path": "settings.json"},
        "workspace.find_settings": {"query": "settings"},
        "workspace.find_gradle": {"query": "gradle"},
        "workspace.create_note": {"path": "notes/today.txt", "content": "完成运行时检查"},
        "workspace.change_endpoint": {"path": "config/test.txt", "content": "https://test.example"},
    }
    if case_id in special:
        return special[case_id]
    if tool == "save_memory":
        return {"content": "用户偏好"}
    if tool == "search_memory":
        return {"query": "用户偏好"}
    if tool == "workspace.list":
        return {"path": ""}
    if tool == "core.text_stats":
        return {"text": "fixture"}
    if tool == "core.update_plan":
        return {"expected_version": 0, "steps": [{"title": str(index), "status": "pending"} for index in range(3)]}
    if tool == "delegate":
        return {"tasks": [{"task_id": str(index), "prompt": "分析"} for index in range(3)]}
    return {}


def _documents() -> tuple[dict, dict, dict]:
    suite = load_tool_selection_suite(SUITE_PATH)
    policy = load_real_model_policy(POLICY_PATH)
    names = sorted({name for case in suite["cases"] for name in case["allowed_tools"]})
    schemas = [{"name": name, "parameters": {"type": "object", "properties": {}}} for name in names]
    rows = []
    for case in suite["cases"]:
        for attempt in range(1, 4):
            calls = [
                {"name": name, "arguments": _arguments(case["id"], name)}
                for name in case["expected_tools"]
            ]
            rows.append({
                "case_id": case["id"], "attempt": attempt,
                "selected_tools": list(case["expected_tools"]), "selected_tool_calls": calls,
                "terminal": "run.completed", "provider_error": None,
            })
    documents = {
        model: {"model": model, "tool_schemas": schemas, "observations": copy.deepcopy(rows)}
        for model in policy["candidate_models"]
    }
    return suite, policy, documents


def test_frozen_policy_requires_two_models_and_reports_raw_counts():
    suite, policy, documents = _documents()
    result = evaluate_real_model_statistics(suite, policy, documents)
    assert result["passed"] is True
    assert result["raw_counts"] == {
        "attempts": 180, "provider_errors": 0, "selection_passed": 180,
        "parameters_passed": 180, "final_passed": 180,
    }
    assert [row["model"] for row in result["models"]] == ["deepseek-v4-flash", "deepseek-v4-pro"]


def test_wrong_tool_fails_selection_and_parameter_rates():
    suite, policy, documents = _documents()
    row = documents["deepseek-v4-flash"]["observations"][0]
    row["selected_tool_calls"] = [{"name": "get_device_info", "arguments": {}}]
    result = evaluate_real_model_statistics(suite, policy, documents)
    assert result["models"][0]["raw_counts"]["selection_passed"] == 89
    assert result["models"][0]["raw_counts"]["parameters_passed"] == 89


def test_semantically_wrong_workspace_parameter_is_counted():
    suite, policy, documents = _documents()
    row = next(row for row in documents["deepseek-v4-pro"]["observations"] if row["case_id"] == "workspace.read_readme")
    row["selected_tool_calls"][0]["arguments"]["path"] = "OTHER.md"
    result = evaluate_real_model_statistics(suite, policy, documents)
    assert result["models"][1]["raw_counts"]["selection_passed"] == 90
    assert result["models"][1]["raw_counts"]["parameters_passed"] == 89


def test_provider_error_and_missing_terminal_are_separate_raw_failures():
    suite, policy, documents = _documents()
    documents["deepseek-v4-flash"]["observations"][0]["provider_error"] = "provider_http_503"
    documents["deepseek-v4-flash"]["observations"][1]["terminal"] = "run.failed"
    result = evaluate_real_model_statistics(suite, policy, documents)
    counts = result["models"][0]["raw_counts"]
    assert counts["provider_errors"] == 1
    assert counts["final_passed"] == 88


def test_m04_reuses_the_exact_90_flash_observations_from_m09():
    suite, _, documents = _documents()

    result = RUNNER.score_m04_observations(suite, documents["deepseek-v4-flash"])

    assert result["passed"] is True
    assert result["behavior_attempts"] == 90


def test_m04_reuse_rejects_missing_or_unknown_observations():
    import pytest

    suite, _, documents = _documents()
    missing = copy.deepcopy(documents["deepseek-v4-flash"])
    missing["observations"].pop()
    unknown = copy.deepcopy(documents["deepseek-v4-flash"])
    unknown["observations"][0]["case_id"] = "unknown-case"

    with pytest.raises(RuntimeError, match="m04_observation_count_invalid"):
        RUNNER.score_m04_observations(suite, missing)
    with pytest.raises(RuntimeError, match="m04_observation_unknown_case"):
        RUNNER.score_m04_observations(suite, unknown)
