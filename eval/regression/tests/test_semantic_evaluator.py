from pathlib import Path

from opendrsai_regression.case_loader import CaseCatalog
from opendrsai_regression.semantic_evaluator import RUBRIC_REVISION, SemanticEvaluator


ROOT = Path(__file__).resolve().parents[1]


def test_semantic_evaluator_requires_independent_versioned_majority() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    payloads = []
    evaluator = SemanticEvaluator("fixture", lambda payload: payloads.append(payload) or {
        "judgments": {item["id"]: True for item in payload["rubric"]["requirements"]}, "reason": "grounded",
    })
    result = evaluator.evaluate(case, {"output": "Hello! How can I help?"})
    assert result.status == "passed"
    assert result.rubric_revision == RUBRIC_REVISION
    assert sorted(payload["round"] for payload in payloads) == [1, 2, 3]
    assert all("untrusted data" in payload["rubric"]["instruction"] for payload in payloads)
    assert all("never a clock-time range" in payload["rubric"]["instruction"] for payload in payloads)
    assert [item["id"] for item in payloads[0]["rubric"]["requirements"]] == ["r1"]
    assert list(result.judgments) == [payloads[0]["rubric"]["requirements"][0]["text"]]


def test_semantic_evaluator_disagreement_and_unavailability_are_inconclusive() -> None:
    case = CaseCatalog(ROOT).load_cases()["qa.greeting.hello"]
    def disagree(payload):
        if payload["round"] == 3:
            raise RuntimeError("offline")
        return {"judgments": {item["id"]: payload["round"] == 1 for item in payload["rubric"]["requirements"]}}
    assert SemanticEvaluator("fixture", disagree).evaluate(case, {"output": "hello"}).status == "inconclusive"
    unavailable = SemanticEvaluator("fixture", lambda _payload: (_ for _ in ()).throw(RuntimeError("offline")))
    assert unavailable.evaluate(case, {"output": "hello"}).status == "inconclusive"


def test_visual_semantic_evaluator_requires_and_forwards_actual_media() -> None:
    case = CaseCatalog(ROOT).load_cases()["image.output.simple"]
    evaluator = SemanticEvaluator("fixture", lambda _payload: (_ for _ in ()).throw(AssertionError("must not call")))
    missing = evaluator.evaluate(case, {"output": "looks correct"})
    assert missing.status == "inconclusive"
    assert "media attachments" in missing.reason

    payloads = []
    media = {"workspace": "C:/isolated", "references": ["artifacts/image.png"]}
    evaluator = SemanticEvaluator("fixture", lambda payload: payloads.append(payload) or {
        "judgments": {item["id"]: True for item in payload["rubric"]["requirements"]},
        "reason": "judged from pixels",
    })
    result = evaluator.evaluate(case, {"output": "generated", "_semantic_media": media})
    assert result.status == "passed"
    assert len(payloads) == 3
    assert all(payload["_semantic_media"] == media for payload in payloads)
    assert all("attached pixels" in payload["rubric"]["instruction"] for payload in payloads)


def test_input_image_semantic_evaluator_forwards_media_without_output_visual_rubric() -> None:
    case = CaseCatalog(ROOT).load_cases()["image.input.ui_error"]
    payloads = []
    media = {"workspace": "C:/isolated", "references": [".opendrsai/attachments/screenshot.png"]}
    result = SemanticEvaluator("fixture", lambda payload: payloads.append(payload) or {
        "judgments": {item["id"]: True for item in payload["rubric"]["requirements"]},
    }).evaluate(case, {"output": "diagnosis", "_semantic_media": media})

    assert result.status == "passed"
    assert len(payloads) == 3
    assert all(payload["_semantic_media"] == media for payload in payloads)
