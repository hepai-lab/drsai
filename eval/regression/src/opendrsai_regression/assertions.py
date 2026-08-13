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
    if "presentation" in expected:
        _presentation(results, expected["presentation"], evidence.get("presentation"), evidence)
    if "image" in expected:
        _image(results, expected["image"], evidence.get("image"), evidence)
    if "test_execution" in expected:
        _test_execution(results, expected["test_execution"], evidence.get("test_execution"))
    if "approval" in expected:
        _approval(results, expected["approval"], evidence.get("approval"))
    for section in ("comparison", "input_evidence", "workspace", "idempotency", "filesystem"):
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
    expected = case.data.get("expect", {})
    requirements = list((expected.get("output", {}) or {}).get("semantic_requirements") or [])
    requirements.extend(((expected.get("presentation") or {}).get("visual") or {}).get("semantic_requirements") or [])
    requirements.extend(
        f"不得存在：{item}"
        for item in ((expected.get("presentation") or {}).get("visual") or {}).get("forbidden_conditions") or []
    )
    image = expected.get("image") or {}
    requirements.extend(image.get("visual_requirements") or [])
    requirements.extend(f"不得包含：{item}" for item in image.get("visual_forbidden") or [])
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
        elif key == "knowledge_search" and isinstance(value, dict):
            _knowledge_search(results, value, evidence)
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


def _knowledge_search(results: list[AssertionResult], spec: dict[str, Any], evidence: dict[str, Any]) -> None:
    calls = evidence.get("knowledge_queries")
    if not isinstance(calls, list) or not calls:
        _missing(results, "behavior.knowledge_search")
        return
    result: Any = calls[-1].get("result") if isinstance(calls[-1], dict) else None
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = None
    if isinstance(result, dict) and isinstance(result.get("result"), dict):
        result = result["result"]
    if not isinstance(result, dict):
        _missing(results, "behavior.knowledge_search.result")
        return
    documents = result.get("documents") if isinstance(result.get("documents"), list) else []
    kb_id = spec.get("knowledge_base_id")
    revision = spec.get("knowledge_base_revision")
    if kb_id is not None:
        actual = {item.get("knowledge_base_id") for item in documents if isinstance(item, dict)}
        _add(results, "behavior.knowledge_search.knowledge_base_id", "contains", kb_id, kb_id if kb_id in actual else None)
    if revision is not None:
        actual = {item.get("knowledge_base_revision") for item in documents if isinstance(item, dict)}
        _add(results, "behavior.knowledge_search.knowledge_base_revision", "contains", revision, revision if revision in actual else None)
    if spec.get("require_completed"):
        completed = result.get("completed") is True and result.get("status") == "completed"
        _add(results, "behavior.knowledge_search.completed", "equals", True, completed)
    if spec.get("require_corpus_complete"):
        complete = result.get("corpus_complete") is True
        _add(results, "behavior.knowledge_search.corpus_complete", "equals", True, complete)
    if spec.get("require_no_supporting_match"):
        no_match = result.get("supporting_match") is False and not (result.get("supporting_matches") or [])
        _add(results, "behavior.knowledge_search.no_supporting_match", "equals", True, no_match)


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
    for pattern in spec.get("required_patterns") or []:
        matched = re.search(str(pattern), text, re.IGNORECASE) is not None
        _add(results, f"output.required_pattern:{pattern}", "matches", True, matched)
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


def _presentation(results: list[AssertionResult], spec: dict[str, Any], actual: Any, evidence: dict[str, Any]) -> None:
    if not isinstance(actual, dict):
        _missing(results, "presentation")
        return
    for key in ("format", "editable"):
        if key in spec:
            _add(results, f"presentation.{key}", "equals", spec[key], actual.get(key))
    ratio = spec.get("aspect_ratio") or {}
    actual_ratio = actual.get("aspect_ratio") if isinstance(actual.get("aspect_ratio"), dict) else {}
    if ratio:
        target = float(ratio["width"]) / float(ratio["height"])
        measured = actual_ratio.get("value")
        if not isinstance(measured, (int, float)) and actual_ratio.get("width") and actual_ratio.get("height"):
            measured = float(actual_ratio["width"]) / float(actual_ratio["height"])
        tolerance = float(ratio.get("tolerance", 0))
        passed = isinstance(measured, (int, float)) and abs(float(measured) - target) <= tolerance
        _add(results, "presentation.aspect_ratio", "within_tolerance", {"value": target, "tolerance": tolerance}, measured, passed=passed)
    if "slide_count" in spec:
        _collection_spec(results, "presentation.slide_count", spec["slide_count"], actual.get("slide_count"))
    if "page_numbers" in spec:
        _mapping(results, "presentation.page_numbers", spec["page_numbers"], actual.get("page_numbers") or {})
    slides = actual.get("slides") if isinstance(actual.get("slides"), list) else []
    for wanted in spec.get("required_slides") or []:
        index = int(wanted.get("index") or 0)
        slide = next((item for item in slides if isinstance(item, dict) and item.get("index") == index), None)
        combined = " ".join(str(value) for value in (slide or {}).get("text", []))
        for required in wanted.get("required_text") or []:
            normalized_required = _normalize_text(required)
            normalized_actual = _normalize_text(combined)
            _add(results, f"presentation.slide[{index}].text:{required}", "contains", required, required if normalized_required in normalized_actual else None)
    visual = spec.get("visual") or {}
    actual_visual = actual.get("visual") if isinstance(actual.get("visual"), dict) else {}
    if visual.get("require_render_all_slides"):
        slide_count = int(actual.get("slide_count") or 0)
        rendered = actual_visual.get("rendered_slide_count")
        passed = actual_visual.get("render_all_slides") is True or (isinstance(rendered, int) and rendered == slide_count and slide_count > 0)
        _add(results, "presentation.visual.render_all_slides", "equals", True, passed)
    forbidden = visual.get("forbidden_conditions") or []
    observed = set(actual_visual.get("conditions") or []) if isinstance(actual_visual.get("conditions"), list) else None
    judgments = evidence.get("semantic_judgments")
    for condition in forbidden:
        requirement = f"不得存在：{condition}"
        judgment = judgments.get(requirement) if isinstance(judgments, dict) else None
        passed = (observed is not None and condition not in observed) or judgment is True
        actual_value = (condition in observed) if observed is not None else judgment
        _add(results, f"presentation.visual.forbidden:{condition}", "absent", False, actual_value, passed=passed)
    for requirement in visual.get("semantic_requirements") or []:
        actual_judgment = judgments.get(requirement) if isinstance(judgments, dict) else None
        _add(results, f"presentation.visual.semantic:{requirement}", "judged_true", True, actual_judgment, passed=actual_judgment is True)


def _normalize_text(value: Any) -> str:
    return re.sub(r"[\s、，。；：,.!?！？—_-]+", "", str(value)).casefold()


def _image(results: list[AssertionResult], spec: dict[str, Any], actual: Any, evidence: dict[str, Any]) -> None:
    if not isinstance(actual, dict):
        _missing(results, "image")
        return
    for key in ("format", "orientation"):
        if key in spec:
            _add(results, f"image.{key}", "equals", spec[key], actual.get(key))
    color = spec.get("color_mode")
    if isinstance(color, dict) and isinstance(color.get("any_of"), list):
        _add(results, "image.color_mode", "in", color["any_of"], actual.get("color_mode"), passed=actual.get("color_mode") in color["any_of"])
    dimensions = spec.get("dimensions") or {}
    if "min_width" in dimensions:
        width = actual.get("width")
        _add(results, "image.dimensions.min_width", "gte", dimensions["min_width"], width, passed=isinstance(width, int) and width >= dimensions["min_width"])
    if "min_height" in dimensions:
        height = actual.get("height")
        _add(results, "image.dimensions.min_height", "gte", dimensions["min_height"], height, passed=isinstance(height, int) and height >= dimensions["min_height"])
    ratio = spec.get("aspect_ratio") or {}
    if ratio:
        width, height = actual.get("width"), actual.get("height")
        measured = width / height if isinstance(width, int) and isinstance(height, int) and height else None
        target = float(ratio["width"]) / float(ratio["height"])
        tolerance = float(ratio.get("tolerance", 0))
        _add(results, "image.aspect_ratio", "within_tolerance", {"value": target, "tolerance": tolerance}, measured, passed=isinstance(measured, float) and abs(measured - target) <= tolerance)
    judgments = evidence.get("semantic_judgments")
    for requirement in spec.get("visual_requirements") or []:
        value = judgments.get(requirement) if isinstance(judgments, dict) else None
        _add(results, f"image.visual:{requirement}", "judged_true", True, value, passed=value is True)
    for forbidden in spec.get("visual_forbidden") or []:
        requirement = f"不得包含：{forbidden}"
        value = judgments.get(requirement) if isinstance(judgments, dict) else None
        _add(results, f"image.visual_forbidden:{forbidden}", "judged_true", True, value, passed=value is True)
    ocr = spec.get("ocr") or {}
    if "max_recognized_characters" in ocr:
        actual_ocr = actual.get("ocr") if isinstance(actual.get("ocr"), dict) else {}
        count = actual_ocr.get("recognized_characters")
        maximum = ocr["max_recognized_characters"]
        visual_no_characters = all(
            isinstance(judgments, dict) and judgments.get(f"不得包含：{item}") is True
            for item in ("可识别文字", "字母", "数字")
        )
        _add(
            results, "image.ocr.recognized_characters", "lte", maximum,
            count if isinstance(count, int) else 0 if visual_no_characters else None,
            passed=(isinstance(count, int) and count <= maximum) or (maximum == 0 and visual_no_characters),
        )


def _test_execution(results: list[AssertionResult], spec: dict[str, Any], actual: Any) -> None:
    if not isinstance(actual, dict):
        _missing(results, "test_execution")
        return
    if spec.get("required"):
        _add(results, "test_execution.required", "evidence_present", True, True)
    if "command" in spec:
        _mapping(results, "test_execution.command", spec["command"], actual.get("command") or {})
    expected = spec.get("expected") or {}
    if "exit_code" in expected:
        _add(results, "test_execution.exit_code", "equals", expected["exit_code"], actual.get("exit_code"))
    output = str(actual.get("output") or "")
    for text in expected.get("output_contains") or []:
        _add(results, f"test_execution.output_contains:{text}", "contains", text, text if str(text) in output else None)
    for text in expected.get("output_not_contains") or []:
        _add(results, f"test_execution.output_not_contains:{text}", "absent", False, str(text) in output)


def _approval(results: list[AssertionResult], spec: dict[str, Any], actual: Any) -> None:
    if not isinstance(actual, dict):
        _missing(results, "approval")
        return
    if spec.get("required"):
        _add(results, "approval.required", "evidence_present", True, True)
    _mapping(results, "approval", {key: value for key, value in spec.items() if key != "required"}, actual)


def _citations(results: list[AssertionResult], spec: Any, evidence: dict[str, Any]) -> None:
    if not spec:
        return
    actual = evidence.get("citations")
    _collection_spec(
        results, "citations",
        {key: value for key, value in spec.items() if key in {"exact", "min", "max", "ordered", "required"}},
        actual,
    )
    if not isinstance(actual, list):
        return
    urls = {str(item.get("url")) for item in actual if item.get("url")}
    for url in spec.get("required_urls") or []:
        matched = next((candidate for candidate in urls if _canonical_citation_url(candidate) == _canonical_citation_url(str(url))), None)
        _add(results, f"citations.url:{url}", "contains", url, matched, passed=matched is not None)
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
    if oaep.get("require_citation_parts"):
        _add(results, "citations.citation_parts", "all", True, all(bool(item.get("citationId") or item.get("citation_id")) for item in actual))
    if oaep.get("require_openable_target"):
        _add(results, "citations.openable_target", "all", True, all(bool(item.get("url")) and item.get("interactive") is True for item in actual))
    if oaep.get("require_bidirectional_navigation"):
        _add(results, "citations.bidirectional_navigation", "all", True, all(
            bool(item.get("markdownPartId") or item.get("markdown_part_id"))
            and bool(item.get("claim_ids") or item.get("claimIds"))
            and item.get("interactive") is True
            for item in actual
        ))


def _canonical_citation_url(value: str) -> str:
    normalized = value.rstrip("/")
    if normalized.startswith("https://indico.cern.ch/event/") and normalized.endswith("/overview"):
        normalized = normalized.removesuffix("/overview")
    return normalized


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
    for key, required_value in spec.items():
        if not key.startswith("require_") or key == "required":
            continue
        field = key.removeprefix("require_")
        passed = all(
            isinstance(item, dict) and (
                item.get(field) == required_value if required_value is not True else bool(item.get(field))
            ) for item in values
        )
        _add(results, f"{path}.{key}", "all", required_value, [item.get(field) if isinstance(item, dict) else None for item in values], passed=passed)
    for index, wanted in enumerate(spec.get("ordered") or []):
        item = values[index] if index < len(values) and isinstance(values[index], dict) else {}
        _mapping(results, f"{path}[{index}]", wanted, item)
    required = spec.get("required")
    if isinstance(required, dict):
        matched = any(isinstance(item, dict) and _matches_required(item, required) for item in values)
        _add(results, f"{path}.required", "contains_constraints", required, required if matched else None)
    elif isinstance(required, list):
        for index, wanted in enumerate(required):
            matched = isinstance(wanted, dict) and any(
                isinstance(item, dict) and _matches_required(item, wanted) for item in values
            )
            _add(results, f"{path}.required[{index}]", "contains_constraints", wanted, wanted if matched else None)


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
            passed = (
                any(item in wanted["any_of"] for item in value)
                if isinstance(value, list)
                else value in wanted["any_of"]
            )
            _add(results, child, "in", wanted["any_of"], value, passed=passed)
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
        if key == "required_steps" and isinstance(wanted, list):
            if not isinstance(value, list) or not all(step in value for step in wanted):
                return False
        elif key.startswith("min_"):
            value = actual.get(key.removeprefix("min_"))
            if not isinstance(value, (int, float)) or value < wanted:
                return False
        elif key.startswith("max_"):
            value = actual.get(key.removeprefix("max_"))
            if not isinstance(value, (int, float)) or value > wanted:
                return False
        elif key.startswith("require_"):
            base = key.removeprefix("require_")
            if wanted is True and not (actual.get(base) or actual.get(key) is True):
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
