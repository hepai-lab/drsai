from __future__ import annotations

from pathlib import Path

from opendrsai_regression.catalog_api import RegressionCatalogApi


ROOT = Path(__file__).resolve().parents[1]


def test_p3_catalog_preserves_suite_order_and_projects_dynamic_summaries() -> None:
    api = RegressionCatalogApi(ROOT)
    payload = api.list_cases("p3-desktop")
    assert [item["id"] for item in payload["cases"]] == [
        "qa.greeting.hello", "qa.constraints.json", "tool.web.hepix", "tool.failure.recovery",
        "knowledge.grounded", "knowledge.absent", "skill.presentation", "image.input.ui_error",
        "image.output.simple", "workspace.readonly.diagnose", "safety.write_approval", "run.inspect_compare",
    ]
    assert len(payload["catalog_revision"]) == 64
    assert payload["cases"][0]["description"].startswith("验证简单问候")


def test_case_detail_exposes_input_and_human_readable_expectations_without_paths() -> None:
    api = RegressionCatalogApi(ROOT)
    detail = api.get_case("image.input.ui_error")
    assert detail["input"]["messages"]
    attachment = next(
        part for message in detail["input"]["messages"] for part in message["parts"] if part["type"] == "image"
    )
    assert attachment["asset_name"].endswith(".png")
    assert "path" not in attachment and "sha256" not in attachment
    assert any(item["group"] == "output" for item in detail["expectation_summary"])


def test_catalog_revision_changes_when_case_definition_changes(tmp_path: Path) -> None:
    source = ROOT
    target = tmp_path / "regression"
    for directory in ("schemas", "cases/question_answering", "suites"):
        (target / directory).mkdir(parents=True, exist_ok=True)
    for schema in (source / "schemas").glob("*.json"):
        (target / "schemas" / schema.name).write_bytes(schema.read_bytes())
    case_source = source / "cases/question_answering/greeting_hello.yaml"
    case_target = target / "cases/question_answering/greeting_hello.yaml"
    case_target.write_bytes(case_source.read_bytes())
    suite = """schema_version: opendrsai.agent-regression-suite/1
id: tiny
title: Tiny
cases: [qa.greeting.hello]
"""
    (target / "suites/tiny.yaml").write_text(suite, encoding="utf-8")
    api = RegressionCatalogApi(target)
    before = api.list_cases("tiny")["catalog_revision"]
    case_target.write_text(case_target.read_text(encoding="utf-8").replace("revision: 1", "revision: 2"), encoding="utf-8")
    after = api.list_cases("tiny")["catalog_revision"]
    assert before != after
