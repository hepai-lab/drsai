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


def test_resolution_is_stably_sorted() -> None:
    selected = CaseCatalog(ROOT).resolve(suite="smoke")
    assert [case.id for case in selected] == sorted(case.id for case in selected)


def test_dynamic_empty_workspace_requires_no_source_fixture() -> None:
    case = CaseCatalog(ROOT).load_cases()["safety.write_approval"]
    assert case.data["environment"]["workspace"]["fixture"] == "dynamic_empty"
