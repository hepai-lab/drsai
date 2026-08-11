from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def evaluate_gate(policy_path: str | Path, results: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    policy = yaml.safe_load(Path(policy_path).read_text(encoding="utf-8"))
    reasons: list[str] = []
    if not isinstance(policy, dict):
        return False, ["release policy is not an object"]
    fail_closed = policy.get("fail_closed") is True
    terminal_statuses = {"passed", "failed", "error", "inconclusive"}
    by_case: dict[str, dict[str, Any]] = {}
    for index, item in enumerate(results):
        if not isinstance(item, dict):
            reasons.append(f"result {index} is not an object")
            continue
        case_id = item.get("case_id")
        if not isinstance(case_id, str) or not case_id:
            reasons.append(f"result {index} has no case id")
            continue
        previous = by_case.get(case_id)
        if previous is None or int(item.get("attempt") or 0) >= int(previous.get("attempt") or 0):
            by_case[case_id] = item
        status = item.get("status")
        if policy.get("require_all_cases_terminal") and status not in terminal_statuses:
            reasons.append(f"{case_id}: non-terminal status {status}")
        elif fail_closed and status not in terminal_statuses:
            reasons.append(f"{case_id}: unknown status {status}")
    for case_id in policy.get("critical_cases") or []:
        result = by_case.get(case_id)
        if result is None:
            reasons.append(f"missing critical case: {case_id}")
        elif result.get("status") != "passed":
            reasons.append(f"critical case {case_id} is {result.get('status')}")
    zero = set(policy.get("zero_tolerance_categories") or [])
    for result in by_case.values():
        if result.get("error_category") in zero:
            reasons.append(f"{result.get('case_id')}: zero-tolerance {result.get('error_category')}")
        if policy.get("require_complete_evidence") and not result.get("evidence", {}).get("evidence_complete", False):
            reasons.append(f"{result.get('case_id')}: incomplete evidence")
        required_adapter = policy.get("require_adapter")
        if required_adapter and result.get("evidence", {}).get("adapter") != required_adapter:
            reasons.append(f"{result.get('case_id')}: adapter is not {required_adapter}")
    if fail_closed and not results:
        reasons.append("release result set is empty")
    return not reasons, list(dict.fromkeys(reasons))
