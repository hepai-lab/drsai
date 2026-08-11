from __future__ import annotations

import json
import re
from typing import Any

from jsonschema import Draft202012Validator

from .models import AssertionResult, RegressionCase


COLLECTION_KEYS = {
    "tool_calls": "tool_calls", "logical_tool_calls": "tool_calls", "tool_attempts": "tool_attempts",
    "skill_activations": "skill_activations", "knowledge_queries": "knowledge_queries", "approvals": "approvals",
    "artifacts": "artifacts", "operation_calls": "operation_calls", "shell_commands": "shell_commands",
    "workspace_reads": "workspace_reads", "workspace_writes": "workspace_writes",
}
COUNT_ALIASES = {
    "web_search_calls": ("tool_calls", "web_search"), "image_generation_calls": ("tool_calls", "image_generation"),
    "knowledge_search": ("knowledge_queries", None), "retrieved_documents": ("retrieved_documents", None),
    "unrelated_tool_calls": ("unrelated_tool_calls", None), "unrelated_skill_activations": ("unrelated_skill_activations", None),
    "external_writes": ("external_writes", None), "external_network_calls": ("external_network_calls", None),
    "network_calls": ("network_calls", None), "unauthorized_writes": ("unauthorized_writes", None),
    "writes_outside_allowed_root": ("writes_outside_allowed_root", None), "file_creations": ("file_creations", None),
    "file_deletions": ("file_deletions", None), "patch_operations": ("patch_operations", None),
    "git_write_operations": ("git_write_operations", None),
    "workspace_search_calls": ("workspace_search_calls", None),
}


def evaluate(case: RegressionCase, evidence: dict[str, Any]) -> list[AssertionResult]:
    expected = case.data["expect"]
    results: list[AssertionResult] = []
    run = evidence.get("run") or {}
    output = evidence.get("output")
    text = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False)
    _mapping(results, "run", expected.get("run") or {}, run)
    _behavior(results, expected.get("behavior") or {}, evidence)
    _output(results, expected.get("output") or {}, output, text, evidence)
    for section in ("comparison", "input_evidence", "image", "presentation", "workspace", "test_execution", "approval", "idempotency", "filesystem"):
        if section in expected:
            actual = evidence.get(section)
            _mapping(results, section, expected[section], actual if isinstance(actual, dict) else {})
    _citations(results, expected.get("citations"), evidence)
    _references(results, expected.get("references"), evidence)
    if "artifacts" in expected:
        _collection_spec(results, "artifacts", expected["artifacts"], evidence.get("artifacts"))
    evidence_spec = expected.get("evidence") or {}
    if evidence_spec.get("preserve_failed_attempt_after_success"):
        attempts = evidence.get("tool_attempts")
        if attempts is None:
            _missing(results, "evidence.failed_attempt_preserved")
        else:
            preserved = any(item.get("status") == "failed" for item in attempts) and any(item.get("status") == "completed" for item in attempts)
            _add(results, "evidence.failed_attempt_preserved", "equals", True, preserved)
    return results


def verdict(results: list[AssertionResult], *, semantic_pending: bool = False) -> str:
    if any(not item.passed for item in results):
        return "failed"
    return "inconclusive" if semantic_pending else "passed"


def semantic_pending(case: RegressionCase, evidence: dict[str, Any]) -> bool:
    requirements = (case.data.get("expect", {}).get("output", {}) or {}).get("semantic_requirements") or []
    if not requirements:
        return False
    judgments = evidence.get("semantic_judgments")
    return not isinstance(judgments, dict) or any(judgments.get(item) is not True for item in requirements)


def _behavior(results: list[AssertionResult], spec: dict[str, Any], evidence: dict[str, Any]) -> None:
    for key, value in spec.items():
        if key == "required_capabilities":
            actual = set(evidence.get("capabilities") or [])
            for capability in value:
                _add(results, f"behavior.required_capabilities:{capability}", "contains", capability, capability if capability in actual else None)
        elif key in COLLECTION_KEYS:
            _collection_spec(results, f"behavior.{key}", value, evidence.get(COLLECTION_KEYS[key]))
        elif key in COUNT_ALIASES:
            evidence_key, tool = COUNT_ALIASES[key]
            actual = evidence.get(evidence_key)
            if isinstance(actual, list) and tool:
                actual = [item for item in actual if _item_name(item) == tool]
            _collection_spec(results, f"behavior.{key}", value, actual)
        elif key == "forbidden_operation_calls":
            calls = evidence.get("operation_calls")
            if calls is None:
                _missing(results, "behavior.forbidden_operation_calls")
            else:
                used = {_item_name(item) for item in calls}
                for operation in value:
                    _add(results, f"behavior.forbidden_operation_calls:{operation}", "absent", False, operation in used)
        elif key in {"retry", "source_access"}:
            _mapping(results, f"behavior.{key}", value, evidence.get(key) or {})
        elif key == "require_successful_tool_result":
            calls = evidence.get("tool_calls")
            passed = isinstance(calls, list) and any(item.get("status") in {"completed", "success"} for item in calls)
            _add(results, "behavior.require_successful_tool_result", "equals", bool(value), passed)
        else:
            actual = evidence.get(key)
            if isinstance(value, dict):
                _collection_spec(results, f"behavior.{key}", value, actual)
            else:
                _add(results, f"behavior.{key}", "equals", value, actual)


def _output(results: list[AssertionResult], spec: dict[str, Any], output: Any, text: str, evidence: dict[str, Any]) -> None:
    parsed = None
    if spec.get("type") == "json":
        try:
            parsed = json.loads(output) if isinstance(output, str) else output
        except (TypeError, json.JSONDecodeError):
            pass
        _add(results, "output.json", "valid_json", True, parsed is not None)
        if parsed is not None and spec.get("schema"):
            errors = [error.message for error in Draft202012Validator(spec["schema"]).iter_errors(parsed)]
            _add(results, "output.schema", "json_schema", [], errors)
    if spec.get("allow_markdown_fence") is False:
        _add(results, "output.markdown_fence", "absent", False, "```" in text)
    if spec.get("allow_surrounding_text") is False:
        stripped = text.strip()
        _add(results, "output.surrounding_text", "absent", True, stripped.startswith("{") and stripped.endswith("}"))
    if "min_length" in spec:
        _add(results, "output.length.min", "gte", spec["min_length"], len(text), passed=len(text) >= spec["min_length"])
    if "max_length" in spec:
        _add(results, "output.length.max", "lte", spec["max_length"], len(text), passed=len(text) <= spec["max_length"])
    for literal in spec.get("required_literals") or []:
        _add(results, f"output.required:{literal}", "contains", literal, literal if str(literal).casefold() in text.casefold() else None)
    for claim in spec.get("forbidden_claims") or []:
        _add(results, f"output.forbidden:{claim}", "absent", False, str(claim).casefold() in text.casefold())
    for pattern in spec.get("forbidden_patterns") or []:
        matched = re.search(str(pattern), text, re.IGNORECASE) is not None
        _add(results, f"output.forbidden_pattern:{pattern}", "absent", False, matched)
    if spec.get("require_artifact_link"):
        linked = any(item.get("linked_in_output") is True for item in evidence.get("artifacts") or [])
        _add(results, "output.artifact_link", "equals", True, linked)
    if spec.get("artifact_link_interactive"):
        interactive = any(item.get("linked_in_output") is True and item.get("interactive") is True for item in evidence.get("artifacts") or [])
        _add(results, "output.artifact_link_interactive", "equals", True, interactive)
    judgments = evidence.get("semantic_judgments")
    for requirement in spec.get("semantic_requirements") or []:
        if isinstance(judgments, dict) and requirement in judgments:
            actual = judgments[requirement]
            _add(results, f"output.semantic:{requirement}", "judged_true", True, actual, passed=actual is True)


def _citations(results: list[AssertionResult], spec: Any, evidence: dict[str, Any]) -> None:
    if not spec:
        return
    actual = evidence.get("citations")
    _collection_spec(results, "citations", spec, actual)
    if not isinstance(actual, list):
        return
    urls = {str(item.get("url")) for item in actual if item.get("url")}
    for url in spec.get("required_urls") or []:
        _add(results, f"citations.url:{url}", "contains", url, url if url in urls else None)
    for wanted in spec.get("required_sources") or []:
        matched = any(all(item.get(key) == value for key, value in wanted.items()) for item in actual)
        _add(results, f"citations.source:{wanted}", "contains_subset", wanted, wanted if matched else None)
    if spec.get("presentation") == "interactive":
        _add(results, "citations.presentation", "all", True, all(item.get("interactive") is True for item in actual))
    if spec.get("require_claim_support"):
        _add(results, "citations.claim_support", "all", True, all(bool(item.get("claim_ids") or item.get("markdownPartId") or item.get("markdown_part_id")) for item in actual))
    oaep = spec.get("oaep") or {}
    if oaep.get("require_stable_citation_id"):
        _add(results, "citations.stable_ids", "all", True, all(bool(item.get("citationId") or item.get("citation_id")) for item in actual))
    if oaep.get("require_markdown_relation"):
        _add(results, "citations.markdown_relation", "all", True, all(bool(item.get("markdownPartId") or item.get("markdown_part_id")) for item in actual))


def _references(results: list[AssertionResult], spec: Any, evidence: dict[str, Any]) -> None:
    if not spec:
        return
    actual = evidence.get("references")
    if not isinstance(actual, list):
        _missing(results, "references")
        return
    for wanted in spec.get("required") or []:
        matched = any(all(item.get(key) == value for key, value in wanted.items()) for item in actual)
        _add(results, f"references:{wanted.get('type')}:{wanted.get('id')}", "contains_subset", wanted, wanted if matched else None)
    if spec.get("interactive"):
        _add(results, "references.interactive", "all", True, all(item.get("interactive") is True for item in actual))


def _collection_spec(results: list[AssertionResult], path: str, spec: Any, actual: Any) -> None:
    if not isinstance(spec, dict):
        _add(results, path, "equals", spec, actual)
        return
    if actual is None:
        _missing(results, path)
        return
    values = actual if isinstance(actual, list) else [None] * int(actual) if isinstance(actual, int) else []
    _count(results, path, spec, len(values))
    if spec.get("tool"):
        _add(results, f"{path}.tool", "all", spec["tool"], [_item_name(item) for item in values], passed=all(_item_name(item) == spec["tool"] for item in values))
    for index, wanted in enumerate(spec.get("ordered") or []):
        item = values[index] if index < len(values) and isinstance(values[index], dict) else {}
        _mapping(results, f"{path}[{index}]", wanted, item)
    required = spec.get("required")
    if isinstance(required, dict):
        matched = any(isinstance(item, dict) and _matches_required(item, required) for item in values)
        _add(results, f"{path}.required", "contains_constraints", required, required if matched else None)


def _mapping(results: list[AssertionResult], path: str, spec: dict[str, Any], actual: dict[str, Any]) -> None:
    for key, wanted in spec.items():
        value = actual.get(key)
        child = f"{path}.{key}"
        if key == "any_of" and isinstance(wanted, list):
            _add(results, child, "in", wanted, actual if not isinstance(actual, dict) else value, passed=(actual if not isinstance(actual, dict) else value) in wanted)
        elif key.startswith("min_") and isinstance(wanted, (int, float)):
            _add(results, child, "gte", wanted, value, passed=isinstance(value, (int, float)) and value >= wanted)
        elif key.startswith("max_") and isinstance(wanted, (int, float)):
            _add(results, child, "lte", wanted, value, passed=isinstance(value, (int, float)) and value <= wanted)
        elif isinstance(wanted, dict) and "any_of" in wanted:
            _add(results, child, "in", wanted["any_of"], value, passed=value in wanted["any_of"])
        elif isinstance(wanted, dict) and any(name in wanted for name in ("exact", "min", "max")):
            _collection_spec(results, child, wanted, value)
        elif isinstance(wanted, dict):
            _mapping(results, child, wanted, value if isinstance(value, dict) else {})
        elif isinstance(wanted, list):
            _add(results, child, "equals", wanted, value)
        else:
            _add(results, child, "equals", wanted, value)


def _matches_required(actual: dict[str, Any], required: dict[str, Any]) -> bool:
    for key, wanted in required.items():
        value = actual.get(key)
        if key.startswith("min_"):
            if not isinstance(value, (int, float)) or value < wanted:
                return False
        elif key.endswith("_required"):
            base = key.removesuffix("_required")
            if wanted is True and not (actual.get(base) or actual.get(key) is True):
                return False
        elif value != wanted:
            return False
    return True


def _count(results: list[AssertionResult], path: str, spec: dict[str, Any], actual: int) -> None:
    if "exact" in spec:
        _add(results, path, "equals", spec["exact"], actual)
    if "min" in spec:
        _add(results, path, "gte", spec["min"], actual, passed=actual >= spec["min"])
    if "max" in spec:
        _add(results, path, "lte", spec["max"], actual, passed=actual <= spec["max"])


def _item_name(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("tool") or item.get("tool_name") or item.get("skill") or item.get("skill_id") or item.get("operation") or item.get("name") or item.get("id") or "")


def _missing(results: list[AssertionResult], path: str) -> None:
    _add(results, path, "evidence_present", True, None, passed=False)


def _add(results: list[AssertionResult], path: str, operator: str, expected: Any, actual: Any, *, passed: bool | None = None) -> None:
    ok = expected == actual if passed is None else passed
    results.append(AssertionResult(path, operator, expected, actual, ok, "" if ok else f"expected {expected!r}, got {actual!r}"))
