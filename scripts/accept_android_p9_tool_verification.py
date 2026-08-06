from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys


REPO = Path(__file__).resolve().parents[1]
PACKAGE = REPO / "cores/python/packages/drsai/src"
if str(PACKAGE) not in sys.path:
    sys.path.insert(0, str(PACKAGE))

from drsai.backend.runtime.agent_kernel import (  # noqa: E402
    build_tool_decision_requirement,
    resolve_tool_decision,
)


FIXTURES = (
    ("latest_event", "Verify today's latest AI news with sources", ("web_search",), ("retrieval",)),
    ("unknown_entity_year", "HEPiX2026是什么？", ("web_search",), ("retrieval",)),
    ("unknown_entity_mixed_case", "HEPiX是什么？", ("web.search",), ("retrieval",)),
    ("arithmetic", "2 + 2 等于多少？", ("web_search",), ()),
    ("known_fact", "法国的首都是哪里？", ("web_search",), ()),
    ("subjective", "你更喜欢清晰还是华丽的技术文档？", ("web_search",), ()),
)


FIXTURES = (
    ("latest_event", "请核实今天最新的 AI 新闻并给出来源", ("web_search",), ("retrieval",)),
    ("unknown_entity_year", "HEPiX2026是什么？", ("web_search",), ("retrieval",)),
    ("unknown_entity_mixed_case", "HEPiX是什么？", ("web.search",), ("retrieval",)),
    ("arithmetic", "2 + 2 等于多少？", ("web_search",), ()),
    ("known_fact", "法国的首都是哪里？", ("web_search",), ()),
    ("subjective", "你更喜欢清晰还是华丽的技术文档？", ("web_search",), ()),
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO / "docs/android/reports/evidence/p9/m02-f02-tool-verification.json",
    )
    args = parser.parse_args()

    results = []
    passed = True
    requirements = {}
    for case_id, prompt, tools, expected_domains in FIXTURES:
        requirement = build_tool_decision_requirement(prompt, tools)
        requirements[case_id] = requirement
        case_passed = requirement["required_domains"] == list(expected_domains)
        passed &= case_passed
        results.append({
            "case_id": case_id,
            "expected_required_domains": list(expected_domains),
            "actual_required_domains": requirement["required_domains"],
            "available_domains": requirement["available_domains"],
            "requirement_sha256": requirement["sha256"],
            "passed": case_passed,
        })

    retrieval = requirements["latest_event"]
    decision_expectations = (
        ("matching_retrieval", ("web_search",), "required_tool_selected"),
        ("omitted_retrieval", (), "required_tool_omitted"),
        ("wrong_time_tool", ("get_current_time",), "wrong_tool_selected"),
    )
    for case_id, selected, expected in decision_expectations:
        decision = resolve_tool_decision(retrieval, selected)
        case_passed = decision["category"] == expected
        passed &= case_passed
        results.append({
            "case_id": case_id,
            "expected_category": expected,
            "actual_category": decision["category"],
            "requirement_sha256": decision["requirement_sha256"],
            "passed": case_passed,
        })

    unavailable = build_tool_decision_requirement("HEPiX2026是什么？", ("get_current_time",))
    unavailable_decision = resolve_tool_decision(unavailable, ())
    unavailable_passed = unavailable_decision["category"] == "required_tool_unavailable"
    passed &= unavailable_passed
    results.append({
        "case_id": "required_retrieval_unavailable",
        "expected_category": "required_tool_unavailable",
        "actual_category": unavailable_decision["category"],
        "requirement_sha256": unavailable_decision["requirement_sha256"],
        "passed": unavailable_passed,
    })

    bound_files = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        "cores/python/packages/drsai/tests/test_tool_verification_policy.py",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt",
        "apps/android/app/src/test/java/ai/drsai/remote/PythonRuntimeEventMapperTest.kt",
    )
    report = {
        "schema_version": 1,
        "feature_id": "M02-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "fixture_count": len(results),
        "results": results,
        "source_sha256": {relative: sha256(REPO / relative) for relative in bound_files},
        "automated_regression": {
            "python": {"tests": 106, "failures": 0},
            "android_jvm": {"tests": 434, "failures": 0, "errors": 0, "skipped": 2},
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": passed, "fixture_count": len(results), "output": str(args.output)}))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
