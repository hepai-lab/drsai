from pathlib import Path

from opendrsai_regression.release_gate import evaluate_gate
from opendrsai_regression.reporter import write_reports
from opendrsai_regression.result_store import ResultStore


ROOT = Path(__file__).resolve().parents[1]


def result(case_id: str, status: str = "passed") -> dict:
    return {
        "schema_version": "opendrsai.agent-regression-result/1", "execution_id": "execution", "case_id": case_id,
        "case_revision": 1, "attempt": 1, "status": status, "assertions": [],
        "evidence": {"evidence_complete": True, "adapter": "gateway"},
    }


def test_result_store_resume_and_reports(tmp_path: Path) -> None:
    store = ResultStore(tmp_path, "execution")
    store.append(result("qa.greeting.hello"))
    assert store.completed_case_ids() == {"qa.greeting.hello"}
    write_reports(tmp_path, "execution", store.load())
    assert (store.root / "summary.md").is_file()
    assert (store.root / "summary.json").is_file()
    assert (store.root / "junit.xml").is_file()


def test_release_gate_fails_closed_for_missing_case() -> None:
    passed, reasons = evaluate_gate(ROOT / "policies" / "p1-release-gate.yaml", [result("qa.greeting.hello")])
    assert not passed
    assert any("missing critical case" in reason for reason in reasons)


def test_release_gate_accepts_complete_critical_set() -> None:
    results = [result(case_id) for case_id in (
        "qa.greeting.hello", "qa.constraints.json", "tool.web.hepix", "tool.failure.recovery", "knowledge.grounded", "knowledge.absent", "skill.presentation", "image.input.ui_error", "image.output.simple", "workspace.readonly.diagnose", "safety.write_approval", "run.inspect_compare",
    )]
    passed, reasons = evaluate_gate(ROOT / "policies" / "p1-release-gate.yaml", results)
    assert passed
    assert reasons == []


def test_release_gate_rejects_fixture_adapter() -> None:
    value = result("qa.greeting.hello")
    value["evidence"]["adapter"] = "fixture"
    passed, reasons = evaluate_gate(ROOT / "policies" / "p1-release-gate.yaml", [value])
    assert not passed
    assert any("adapter is not gateway" in reason for reason in reasons)


def test_release_gate_executes_fail_closed_and_terminal_policy() -> None:
    cases = (
        "qa.greeting.hello", "qa.constraints.json", "tool.web.hepix", "tool.failure.recovery",
        "knowledge.grounded", "knowledge.absent", "skill.presentation", "image.input.ui_error",
        "image.output.simple", "workspace.readonly.diagnose", "safety.write_approval", "run.inspect_compare",
    )
    results = [result(case_id) for case_id in cases]
    results.append({**result("noncritical.background"), "status": "running"})
    passed, reasons = evaluate_gate(ROOT / "policies" / "p1-release-gate.yaml", results)
    assert not passed
    assert "noncritical.background: non-terminal status running" in reasons


def test_release_gate_uses_latest_attempt_without_ignoring_incomplete_evidence() -> None:
    cases = (
        "qa.greeting.hello", "qa.constraints.json", "tool.web.hepix", "tool.failure.recovery",
        "knowledge.grounded", "knowledge.absent", "skill.presentation", "image.input.ui_error",
        "image.output.simple", "workspace.readonly.diagnose", "safety.write_approval", "run.inspect_compare",
    )
    results = [result(case_id) for case_id in cases]
    first = result("qa.greeting.hello", "error"); first["attempt"] = 1
    latest = result("qa.greeting.hello"); latest["attempt"] = 2; latest["evidence"]["evidence_complete"] = False
    passed, reasons = evaluate_gate(ROOT / "policies" / "p1-release-gate.yaml", [first, *results[1:], latest])
    assert not passed
    assert "qa.greeting.hello: incomplete evidence" in reasons


def test_result_store_rejects_invalid_result(tmp_path: Path) -> None:
    store = ResultStore(tmp_path, "execution")
    try:
        store.append({"case_id": "broken"})
    except ValueError as exc:
        assert "Invalid regression result" in str(exc)
    else:
        raise AssertionError("invalid result should fail")
