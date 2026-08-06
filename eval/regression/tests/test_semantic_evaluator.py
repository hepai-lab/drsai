from pathlib import Path

from opendrsai_regression.case_loader import CaseCatalog
from opendrsai_regression.semantic_evaluator import RUBRIC_REVISION, SemanticEvaluator


ROOT = Path(__file__).resolve().parents[1]


def test_semantic_evaluator_requires_two_agreeing_versioned_rounds() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    payloads = []
    evaluator = SemanticEvaluator("fixture", lambda payload: payloads.append(payload) or {
        "judgments": {item: True for item in payload["rubric"]["requirements"]}, "reason": "grounded",
    })
    result = evaluator.evaluate(case, {"output": "Hello! How can I help?"})
    assert result.status == "passed"
    assert result.rubric_revision == RUBRIC_REVISION
    assert [payload["round"] for payload in payloads] == [1, 2]
    assert all("untrusted data" in payload["rubric"]["instruction"] for payload in payloads)


def test_semantic_evaluator_disagreement_and_unavailability_are_inconclusive() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    calls = 0
    def disagree(payload):
        nonlocal calls
        calls += 1
        return {"judgments": {item: calls == 1 for item in payload["rubric"]["requirements"]}}
    assert SemanticEvaluator("fixture", disagree).evaluate(case, {"output": "hello"}).status == "inconclusive"
    unavailable = SemanticEvaluator("fixture", lambda _payload: (_ for _ in ()).throw(RuntimeError("offline")))
    assert unavailable.evaluate(case, {"output": "hello"}).status == "inconclusive"
