from pathlib import Path

from opendrsai_regression.assertions import evaluate, verdict
from opendrsai_regression.case_loader import CaseCatalog


ROOT = Path(__file__).resolve().parents[1]


def test_greeting_passes_deterministic_assertions() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    results = evaluate(case, {
        "run": {"status": "completed"}, "output": "Hello! How can I help?",
        "tool_calls": [], "skill_activations": [], "knowledge_queries": [], "approvals": [], "artifacts": [],
    })
    assert all(item.passed for item in results)
    assert verdict(results, semantic_pending=True) == "inconclusive"


def test_json_rejects_surrounding_text() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.constraints.json"]
    results = evaluate(case, {
        "run": {"status": "completed"},
        "output": '结果：{"name":"张三","age":28,"skills":["Python","TypeScript"]}',
        "tool_calls": [], "skill_activations": [], "knowledge_queries": [], "approvals": [], "artifacts": [],
    })
    assert verdict(results) == "failed"
    assert any(item.path == "output.json" and not item.passed for item in results)


def test_runtime_retry_requires_both_attempts() -> None:
    case = CaseCatalog(ROOT).load_cases()["tool.failure.recovery"]
    results = evaluate(case, {
        "run": {"status": "completed"}, "output": "2026年9月10日至11日，上海。",
        "tool_calls": [{"tool": "web_search"}], "logical_tool_call_count": 1,
        "tool_attempts": [{"tool": "web_search", "status": "completed"}],
        "artifacts": [],
    })
    assert verdict(results) == "failed"


def test_run_comparison_checks_numbers_references_and_causality() -> None:
    case = CaseCatalog(ROOT).load_cases()["run.inspect_compare"]
    requirements = case.data["expect"]["output"]["semantic_requirements"]
    evidence = {
        "run": {"status": "completed"},
        "output": "run-regression-baseline-001 和 run-regression-candidate-001：web_search，耗时增加 1420，Token 增加 39。",
        "operation_calls": [
            {"operation": "run.inspect", "run_id": "run-regression-baseline-001"},
            {"operation": "run.inspect", "run_id": "run-regression-candidate-001"},
            {"operation": "run.manifest.read", "run_id": "run-regression-baseline-001"},
            {"operation": "run.manifest.read", "run_id": "run-regression-candidate-001"},
            {"operation": "run.compare", "baseline_run_id": "run-regression-baseline-001", "candidate_run_id": "run-regression-candidate-001"},
        ],
        "approvals": [], "external_network_calls": [], "external_writes": [], "artifacts": [],
        "comparison": case.data["expect"]["comparison"],
        "references": [{**item, "interactive": True} for item in case.data["expect"]["references"]["required"]],
        "semantic_judgments": {item: True for item in requirements},
    }
    results = evaluate(case, evidence)
    assert all(item.passed for item in results), [item.message for item in results if not item.passed]
