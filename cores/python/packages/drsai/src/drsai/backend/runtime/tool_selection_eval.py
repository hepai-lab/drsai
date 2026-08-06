from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


class ToolSelectionEvaluationError(ValueError):
    pass


@dataclass(frozen=True)
class ToolSelectionCaseResult:
    case_id: str
    attempt: int
    passed: bool
    failure_codes: tuple[str, ...]
    tool_calls: tuple[str, ...]
    provider_error: str | None = None


def load_tool_selection_suite(path: Path) -> dict[str, Any]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if raw.get("schema_version") != "opendrsai.p9-natural-tool-selection/1":
        raise ToolSelectionEvaluationError("tool_selection_schema_invalid")
    cases = raw.get("cases")
    if not isinstance(cases, list) or len(cases) != 30:
        raise ToolSelectionEvaluationError("tool_selection_case_count_invalid")
    ids: set[str] = set()
    for case in cases:
        _validate_case(case)
        if case["id"] in ids:
            raise ToolSelectionEvaluationError("tool_selection_case_duplicate")
        ids.add(case["id"])
        # A natural prompt must not reveal an implementation tool identifier.
        prompt = case["prompt"].casefold()
        for tool in set(case["expected_tools"]) | set(case["allowed_tools"]):
            if tool.casefold() in prompt:
                raise ToolSelectionEvaluationError(f"tool_selection_prompt_leaks_tool:{case['id']}")
    canonical = json.dumps(raw, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return {**raw, "sha256": hashlib.sha256(canonical).hexdigest()}


def score_tool_selection_attempt(
    case: Mapping[str, Any], attempt: int, tool_calls: Sequence[str], provider_error: str | None = None,
) -> ToolSelectionCaseResult:
    _validate_case(case)
    if attempt < 1:
        raise ToolSelectionEvaluationError("tool_selection_attempt_invalid")
    calls = tuple(str(value) for value in tool_calls)
    if provider_error:
        return ToolSelectionCaseResult(str(case["id"]), attempt, False, ("provider_error",), calls, provider_error)
    expected, allowed = set(case["expected_tools"]), set(case["allowed_tools"])
    observed = set(calls)
    failures: list[str] = []
    if not expected.issubset(observed):
        failures.append("missing_required_tool")
    if any(value not in allowed for value in calls):
        failures.append("wrong_tool")
    if not allowed and calls:
        failures.append("meaningless_tool_call")
    if len(calls) != len(observed):
        failures.append("duplicate_tool_call")
    return ToolSelectionCaseResult(str(case["id"]), attempt, not failures, tuple(failures), calls)


def evaluate_tool_selection_gate(
    suite: Mapping[str, Any], results: Sequence[ToolSelectionCaseResult],
) -> dict[str, Any]:
    cases = {case["id"]: case for case in suite["cases"]}
    minimum_attempts = int(suite["minimum_attempts_per_case"])
    by_case: dict[str, list[ToolSelectionCaseResult]] = {case_id: [] for case_id in cases}
    for result in results:
        if result.case_id not in cases:
            raise ToolSelectionEvaluationError(f"tool_selection_unknown_case:{result.case_id}")
        by_case[result.case_id].append(result)
    case_reports: list[dict[str, Any]] = []
    behavior_total = behavior_passed = provider_errors = 0
    for case_id, case in cases.items():
        attempts = by_case[case_id]
        behavior = [value for value in attempts if value.provider_error is None]
        provider_errors += len(attempts) - len(behavior)
        behavior_total += len(behavior)
        behavior_passed += sum(value.passed for value in behavior)
        rate = sum(value.passed for value in behavior) / len(behavior) if behavior else 0.0
        case_reports.append({
            "case_id": case_id,
            "attempts": len(attempts),
            "behavior_attempts": len(behavior),
            "passed": sum(value.passed for value in behavior),
            "success_rate": rate,
            "threshold": float(case["minimum_success_rate"]),
            "gate_passed": len(behavior) >= minimum_attempts and rate >= float(case["minimum_success_rate"]),
            "failure_counts": _failure_counts(attempts),
        })
    suite_rate = behavior_passed / behavior_total if behavior_total else 0.0
    return {
        "schema_version": "opendrsai.p9-tool-selection-result/1",
        "suite_id": suite["suite_id"],
        "suite_sha256": suite["sha256"],
        "case_count": len(cases),
        "behavior_attempts": behavior_total,
        "provider_errors": provider_errors,
        "success_rate": suite_rate,
        "minimum_success_rate": float(suite["minimum_suite_success_rate"]),
        "cases": case_reports,
        "passed": all(item["gate_passed"] for item in case_reports)
        and suite_rate >= float(suite["minimum_suite_success_rate"]),
    }


def _validate_case(case: Mapping[str, Any]) -> None:
    if not isinstance(case, Mapping):
        raise ToolSelectionEvaluationError("tool_selection_case_invalid")
    for key in ("id", "category", "prompt"):
        if not isinstance(case.get(key), str) or not case[key] or len(case[key]) > 1000:
            raise ToolSelectionEvaluationError(f"tool_selection_case_{key}_invalid")
    expected, allowed = case.get("expected_tools"), case.get("allowed_tools")
    if not isinstance(expected, list) or not isinstance(allowed, list):
        raise ToolSelectionEvaluationError("tool_selection_tools_invalid")
    if not all(isinstance(value, str) and value for value in expected + allowed):
        raise ToolSelectionEvaluationError("tool_selection_tool_name_invalid")
    if not set(expected).issubset(set(allowed)):
        raise ToolSelectionEvaluationError("tool_selection_expected_not_allowed")
    threshold = case.get("minimum_success_rate")
    if isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or not 0 < threshold <= 1:
        raise ToolSelectionEvaluationError("tool_selection_threshold_invalid")


def _failure_counts(results: Sequence[ToolSelectionCaseResult]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        for code in result.failure_codes:
            counts[code] = counts.get(code, 0) + 1
    return dict(sorted(counts.items()))
