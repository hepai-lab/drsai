from pathlib import Path

from opendrsai_regression.case_loader import CaseCatalog


ROOT = Path(__file__).resolve().parents[1]


def test_all_current_cases_and_suites_validate() -> None:
    catalog = CaseCatalog(ROOT)
    cases = catalog.load_cases()
    assert set(cases) == {
        "qa.greeting.hello",
        "qa.constraints.json",
        "tool.web.hepix",
        "tool.failure.recovery",
        "knowledge.grounded",
        "knowledge.absent",
        "skill.presentation",
        "image.input.ui_error",
        "image.output.simple",
        "workspace.readonly.diagnose",
        "safety.write_approval",
        "run.inspect_compare",
        "p3.qa.hello",
        "p3.tool.web",
        "p3.knowledge.runtime",
        "p3.skill.presentation",
        "p3.image.input",
        "p3.image.output",
    }
    assert catalog.load_suite("smoke", cases).cases == catalog.load_suite("release", cases).cases
    assert catalog.load_suite("phase3-release-smoke", cases).cases == (
        "p3.qa.hello", "p3.tool.web", "p3.knowledge.runtime",
        "p3.skill.presentation", "p3.image.input", "p3.image.output",
    )


def test_resolution_preserves_canonical_suite_order() -> None:
    selected = CaseCatalog(ROOT).resolve(suite="smoke")
    suite = CaseCatalog(ROOT).load_suite("smoke")
    assert [case.id for case in selected] == list(suite.cases)


def test_explicit_case_resolution_preserves_user_order() -> None:
    selected = CaseCatalog(ROOT).resolve(case_ids=["qa.greeting.hello", "qa.constraints.json"])
    assert [case.id for case in selected] == ["qa.greeting.hello", "qa.constraints.json"]


def test_dynamic_empty_workspace_requires_no_source_fixture() -> None:
    case = CaseCatalog(ROOT).load_cases()["safety.write_approval"]
    assert case.data["environment"]["workspace"]["fixture"] == "dynamic_empty"


def test_grounded_knowledge_case_keeps_readable_utf8_contract() -> None:
    case = CaseCatalog(ROOT).load_cases()["knowledge.grounded"]
    assert case.revision == 2
    assert case.data["environment"]["knowledge_bases"][0]["corpus_complete"] is True
    assert case.data["title"] == "根据固定 OpenDrSai Runtime 知识库回答"
    prompt = case.data["input"]["messages"][0]["parts"][0]["text"]
    assert "Session 和 Run 分别表示什么" in prompt
    assert "请仅根据知识库回答，并提供引用" in prompt


def test_failure_recovery_case_is_scoped_to_one_logical_search() -> None:
    case = CaseCatalog(ROOT).load_cases()["tool.failure.recovery"]
    prompt = case.data["input"]["messages"][0]["parts"][0]["text"]

    assert case.revision == 4
    assert "只发起一个逻辑搜索请求" in prompt
    assert case.data["expect"]["behavior"]["logical_tool_calls"]["exact"] == 1
