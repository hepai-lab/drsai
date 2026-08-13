"""Score Android P9 emulator observations without creating release evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[1]
PYTHON_PACKAGE = ROOT / "cores/python/packages/drsai/src"
SUITE_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-natural-tool-selection-v1.json"
POLICY_PATH = ROOT / "cores/protocol/android-runtime/fixtures/p9-real-model-statistical-gate-v1.json"
DEFAULT_OUTPUT = ROOT / "docs/android/reports/preflight/p9-emulator/real-model-statistics.json"
FORMAL_EVIDENCE = (ROOT / "docs/android/reports/evidence/p9").resolve()

sys.path.insert(0, str(PYTHON_PACKAGE))
from drsai.backend.runtime.real_model_statistics import (  # noqa: E402
    evaluate_real_model_statistics,
    load_real_model_policy,
)
from drsai.backend.runtime.tool_selection_eval import load_tool_selection_suite  # noqa: E402


class EmulatorPreflightError(ValueError):
    pass


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_output_path(path: Path) -> Path:
    resolved = path.resolve()
    if resolved == FORMAL_EVIDENCE or FORMAL_EVIDENCE in resolved.parents:
        raise EmulatorPreflightError("emulator_preflight_formal_evidence_forbidden")
    return resolved


def classify(row: Mapping[str, Any]) -> str | None:
    explicit = row.get("failure_category")
    if explicit in {
        "model_behavior", "provider_http", "runtime_policy", "host_execution", "oaep_projection", "environment",
    }:
        return str(explicit)
    if row.get("provider_error"):
        code = str(row.get("provider_error", "")).lower()
        detail = str(row.get("error_detail", "")).lower()
        if code.startswith("runtime_") or "python_runtime_failed" in detail:
            if any(token in detail for token in ("saf_", "workspace_", "approval_", "artifact_", "tool_execution")):
                return "host_execution"
            if any(token in detail for token in ("oaep_", "event_", "projection_", "terminal_")):
                return "oaep_projection"
            return "runtime_policy"
        return "provider_http"
    if row.get("terminal") not in (None, "run.completed"):
        return "runtime_policy"
    return None


def normalized_document(document: Mapping[str, Any]) -> tuple[dict[str, Any], Counter[str]]:
    normalized = json.loads(json.dumps(document))
    categories: Counter[str] = Counter()
    for row in normalized.get("observations", []):
        category = classify(row)
        if category:
            categories[category] += 1
            row["failure_category"] = category
        # The shared release scorer excludes only genuine provider failures
        # from its behavior denominator. Older Android observations placed
        # Runtime failures in provider_error, which inflated behavior rates.
        if category != "provider_http":
            row.pop("provider_error", None)
    return normalized, categories


def score_documents(
    documents: Mapping[str, Mapping[str, Any]], *, suite_path: Path = SUITE_PATH, policy_path: Path = POLICY_PATH,
) -> dict[str, Any]:
    suite = load_tool_selection_suite(suite_path)
    policy = load_real_model_policy(policy_path)
    expected_models = list(policy["candidate_models"])
    if set(documents) != set(expected_models):
        raise EmulatorPreflightError("emulator_preflight_models_invalid")
    normalized: dict[str, dict[str, Any]] = {}
    categories_by_model: dict[str, dict[str, int]] = {}
    for model in expected_models:
        document = documents[model]
        if document.get("model") != model or document.get("suite_id") != suite["suite_id"]:
            raise EmulatorPreflightError(f"emulator_preflight_identity_invalid:{model}")
        normalized[model], categories = normalized_document(document)
        categories_by_model[model] = dict(sorted(categories.items()))
    result = evaluate_real_model_statistics(suite, policy, normalized)
    return {
        **result,
        "evidence_tier": "emulator_preflight",
        "release_evidence": False,
        "feature_ids": [],
        "generated_at": datetime.now(UTC).isoformat(),
        "failure_categories_by_model": categories_by_model,
        "raw_observations_by_model": {
            model: normalized[model]["observations"] for model in expected_models
        },
        "source_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): digest(path)
            for path in (suite_path, policy_path, Path(__file__))
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flash", type=Path, required=True)
    parser.add_argument("--pro", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    options = parser.parse_args()
    output = safe_output_path(options.output)
    documents = {
        "deepseek-v4-flash": json.loads(options.flash.read_text(encoding="utf-8")),
        "deepseek-v4-pro": json.loads(options.pro.read_text(encoding="utf-8")),
    }
    report = score_documents(documents)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "evidence_tier": report["evidence_tier"], "passed": report["passed"],
        "raw_counts": report["raw_counts"], "output": str(output),
    }, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
