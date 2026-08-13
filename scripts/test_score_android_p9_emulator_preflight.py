from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/score_android_p9_emulator_preflight.py"
SPEC = importlib.util.spec_from_file_location("score_android_p9_emulator_preflight", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def observation_document(model: str, *, runtime_failure: bool = False) -> dict:
    suite = MODULE.load_tool_selection_suite(MODULE.SUITE_PATH)
    observations = []
    for case in suite["cases"]:
        for attempt in range(1, 4):
            calls = [
                {"name": name, "arguments": {}}
                for name in case["expected_tools"]
            ]
            row = {
                "case_id": case["id"], "attempt": attempt,
                "selected_tools": list(case["expected_tools"]),
                "selected_tool_calls": calls, "terminal": "run.completed",
            }
            observations.append(row)
    if runtime_failure:
        observations[0].update({
            "selected_tools": [], "selected_tool_calls": [], "terminal": "unknown",
            "provider_error": "runtime_IllegalStateException",
            "error_detail": "python_runtime_failed:context_active_chain_budget_overflow",
        })
    return {
        "suite_id": suite["suite_id"], "model": model,
        "tool_schemas": [], "observations": observations,
    }


def test_formal_evidence_path_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(MODULE.EmulatorPreflightError, match="formal_evidence_forbidden"):
        MODULE.safe_output_path(MODULE.FORMAL_EVIDENCE / "m09-f06-real-model-statistics.json")
    assert MODULE.safe_output_path(tmp_path / "preflight.json") == (tmp_path / "preflight.json").resolve()


def test_runtime_failure_is_not_counted_as_provider_error() -> None:
    documents = {
        "deepseek-v4-flash": observation_document("deepseek-v4-flash", runtime_failure=True),
        "deepseek-v4-pro": observation_document("deepseek-v4-pro"),
    }
    report = MODULE.score_documents(documents)
    assert report["evidence_tier"] == "emulator_preflight"
    assert report["release_evidence"] is False
    assert report["raw_counts"]["provider_errors"] == 0
    assert report["failure_categories_by_model"]["deepseek-v4-flash"] == {"runtime_policy": 1}
    row = report["raw_observations_by_model"]["deepseek-v4-flash"][0]
    assert row["failure_category"] == "runtime_policy"
    assert "provider_error" not in row


def test_explicit_provider_http_remains_provider_error() -> None:
    documents = {
        "deepseek-v4-flash": observation_document("deepseek-v4-flash"),
        "deepseek-v4-pro": observation_document("deepseek-v4-pro"),
    }
    documents["deepseek-v4-pro"]["observations"][0].update({
        "terminal": "unknown", "failure_category": "provider_http", "provider_error": "provider_http_429",
    })
    report = MODULE.score_documents(documents)
    assert report["raw_counts"]["provider_errors"] == 1
    assert report["failure_categories_by_model"]["deepseek-v4-pro"] == {"provider_http": 1}
