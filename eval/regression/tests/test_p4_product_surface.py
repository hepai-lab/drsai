from pathlib import Path

from opendrsai_regression.case_loader import CaseCatalog


REPO_ROOT = Path(__file__).resolve().parents[3]
REGRESSION_ROOT = REPO_ROOT / "eval" / "regression"
DESKTOP_ROOT = REPO_ROOT / "apps" / "desktop"
SKILL_FILE = REPO_ROOT / "skills" / "skills" / "opendrsai-regression-testing" / "SKILL.md"


def test_p4_has_no_dedicated_desktop_regression_entrypoint() -> None:
    forbidden_files = {
        "RegressionPanel.tsx",
        "RegressionTab.tsx",
        "regressionControlBridge.ts",
        "regressionControlService.ts",
    }
    source_roots = (
        DESKTOP_ROOT / "shared" / "renderer" / "src",
        DESKTOP_ROOT / "shared" / "main",
        DESKTOP_ROOT / "shared" / "api",
    )
    present = {
        path.name
        for source_root in source_roots
        for path in source_root.rglob("*")
        if path.is_file() and path.name in forbidden_files
    }
    assert present == set()

    renderer_sources = [
        path for path in (DESKTOP_ROOT / "shared" / "renderer" / "src").rglob("*")
        if path.suffix in {".ts", ".tsx", ".css"}
    ]
    rendered = "\n".join(path.read_text(encoding="utf-8") for path in renderer_sources)
    for forbidden_marker in (
        'data-testid="regression-tab"',
        'data-testid="regression-panel"',
        "regressionComposerAutofill",
        "regressionAutoSend",
    ):
        assert forbidden_marker not in rendered


def test_p4_skill_does_not_hardcode_the_representative_case_catalog() -> None:
    skill = SKILL_FILE.read_text(encoding="utf-8")
    catalog = CaseCatalog(REGRESSION_ROOT)
    cases = catalog.load_cases()
    suite = catalog.load_suite("p3-desktop", cases)

    assert len(suite.cases) == 12
    assert all(case_id not in skill for case_id in suite.cases)
    assert "regression_list_suites" in skill
    assert "regression_list_cases" in skill
    assert "regression_get_case" in skill
