from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping, Sequence

from .tool_selection_eval import score_tool_selection_attempt


class RealModelStatisticsError(ValueError):
    pass


def load_real_model_policy(path: Path) -> dict[str, Any]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if raw.get("schema_version") != "opendrsai.p9-real-model-statistical-gate/1":
        raise RealModelStatisticsError("real_model_policy_schema_invalid")
    models = raw.get("candidate_models")
    thresholds = raw.get("thresholds")
    if not isinstance(models, list) or len(models) < 2 or len(set(models)) != len(models):
        raise RealModelStatisticsError("real_model_candidates_invalid")
    if not isinstance(thresholds, Mapping):
        raise RealModelStatisticsError("real_model_thresholds_invalid")
    for key in ("tool_selection_rate", "parameter_correctness_rate", "final_task_success_rate"):
        value = thresholds.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= 1:
            raise RealModelStatisticsError(f"real_model_threshold_invalid:{key}")
    maximum_errors = thresholds.get("maximum_provider_error_rate")
    if isinstance(maximum_errors, bool) or not isinstance(maximum_errors, (int, float)) or not 0 <= maximum_errors < 1:
        raise RealModelStatisticsError("real_model_threshold_invalid:maximum_provider_error_rate")
    canonical = json.dumps(raw, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return {**raw, "sha256": hashlib.sha256(canonical).hexdigest()}


def evaluate_real_model_statistics(
    suite: Mapping[str, Any], policy: Mapping[str, Any], observations_by_model: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    case_map = {case["id"]: case for case in suite["cases"]}
    expected_attempts = len(case_map) * int(policy["minimum_attempts_per_case"])
    schemas = _tool_schemas(observations_by_model)
    model_reports: list[dict[str, Any]] = []
    totals = {"attempts": 0, "provider_errors": 0, "selection_passed": 0, "parameters_passed": 0, "final_passed": 0}
    for model in policy["candidate_models"]:
        document = observations_by_model.get(model)
        if not isinstance(document, Mapping):
            raise RealModelStatisticsError(f"real_model_observations_missing:{model}")
        rows = document.get("observations")
        if not isinstance(rows, list) or len(rows) != expected_attempts:
            raise RealModelStatisticsError(f"real_model_observation_count_invalid:{model}")
        counts = {key: 0 for key in totals}
        counts["attempts"] = len(rows)
        for row in rows:
            case = case_map.get(row.get("case_id"))
            if case is None:
                raise RealModelStatisticsError("real_model_case_unknown")
            provider_error = row.get("provider_error")
            if provider_error:
                counts["provider_errors"] += 1
                continue
            calls = row.get("selected_tool_calls", [])
            if not isinstance(calls, list):
                raise RealModelStatisticsError("real_model_tool_calls_invalid")
            names = [str(call.get("name", "")) for call in calls if isinstance(call, Mapping)]
            selection = score_tool_selection_attempt(case, int(row["attempt"]), names)
            if selection.passed:
                counts["selection_passed"] += 1
            if selection.passed and _parameters_pass(case["id"], calls, schemas, policy):
                counts["parameters_passed"] += 1
            if row.get("terminal") == "run.completed":
                counts["final_passed"] += 1
        report = _rates(model, counts, policy)
        model_reports.append(report)
        for key in totals:
            totals[key] += counts[key]
    aggregate = _rates("aggregate", totals, policy)
    return {
        "schema_version": "opendrsai.p9-real-model-statistical-result/1",
        "suite_id": policy["suite_id"],
        "policy_sha256": policy["sha256"],
        "source_suite_sha256": suite["sha256"],
        "raw_counts": totals,
        "models": model_reports,
        "aggregate": aggregate,
        "passed": aggregate["passed"] and all(report["passed"] for report in model_reports),
    }


def _rates(model: str, counts: Mapping[str, int], policy: Mapping[str, Any]) -> dict[str, Any]:
    attempts = int(counts["attempts"])
    behavior = attempts - int(counts["provider_errors"])
    thresholds = policy["thresholds"]
    def rate(key: str) -> float:
        return int(counts[key]) / behavior if behavior else 0.0
    error_rate = int(counts["provider_errors"]) / attempts if attempts else 1.0
    selection = rate("selection_passed")
    parameters = rate("parameters_passed")
    final = rate("final_passed")
    return {
        "model": model, "raw_counts": dict(counts), "behavior_attempts": behavior,
        "tool_selection_rate": selection, "parameter_correctness_rate": parameters,
        "final_task_success_rate": final, "provider_error_rate": error_rate,
        "passed": selection >= thresholds["tool_selection_rate"]
        and parameters >= thresholds["parameter_correctness_rate"]
        and final >= thresholds["final_task_success_rate"]
        and error_rate <= thresholds["maximum_provider_error_rate"],
    }


def _tool_schemas(documents: Mapping[str, Mapping[str, Any]]) -> dict[str, Mapping[str, Any]]:
    schemas: dict[str, Mapping[str, Any]] = {}
    for document in documents.values():
        for item in document.get("tool_schemas", []):
            if isinstance(item, Mapping) and isinstance(item.get("name"), str) and isinstance(item.get("parameters"), Mapping):
                schemas[item["name"]] = item["parameters"]
    return schemas


def _parameters_pass(
    case_id: str, calls: Sequence[Mapping[str, Any]], schemas: Mapping[str, Mapping[str, Any]], policy: Mapping[str, Any],
) -> bool:
    if not calls:
        return True
    for call in calls:
        name = call.get("name")
        arguments = call.get("arguments")
        if not isinstance(name, str) or not isinstance(arguments, Mapping):
            return False
        schema = schemas.get(name)
        if schema is None or not _matches_schema(arguments, schema):
            return False
    rule = policy.get("semantic_parameter_rules", {}).get(case_id)
    if not isinstance(rule, Mapping):
        return True
    target = next((call.get("arguments") for call in calls if call.get("name") == rule.get("tool")), None)
    if not isinstance(target, Mapping):
        return False
    for key, value in rule.get("equals", {}).items():
        if target.get(key) != value:
            return False
    for key, values in rule.get("contains", {}).items():
        actual = str(target.get(key, "")).casefold()
        if not all(str(value).casefold() in actual for value in values):
            return False
    for key, minimum in rule.get("array_min", {}).items():
        if not isinstance(target.get(key), list) or len(target[key]) < int(minimum):
            return False
    return True


def _matches_schema(value: Any, schema: Mapping[str, Any]) -> bool:
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(value, Mapping):
            return False
        if any(key not in value for key in schema.get("required", [])):
            return False
        properties = schema.get("properties", {})
        return all(key not in properties or _matches_schema(item, properties[key]) for key, item in value.items())
    if expected == "array":
        if not isinstance(value, list) or len(value) < int(schema.get("minItems", 0)) or len(value) > int(schema.get("maxItems", 10**9)):
            return False
        return all(_matches_schema(item, schema.get("items", {})) for item in value)
    if expected == "string":
        return isinstance(value, str) and len(value) <= int(schema.get("maxLength", 10**9)) and value in schema.get("enum", [value])
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool) and schema.get("minimum", value) <= value <= schema.get("maximum", value)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    return True
