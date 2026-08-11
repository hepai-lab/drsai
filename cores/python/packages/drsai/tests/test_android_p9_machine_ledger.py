import hashlib
import json
from pathlib import Path
import sys


ROOT = Path(__file__).parents[5]
sys.path.insert(0, str(ROOT / "scripts"))
from android_p9_acceptance_ledger import EXPECTED_IDS, audit  # noqa: E402


def write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def fixture(tmp_path: Path) -> Path:
    source = tmp_path / "source.txt"
    source.write_text("current", encoding="utf-8")
    test = tmp_path / "test.py"
    test.write_text("pass", encoding="utf-8")
    evidence = tmp_path / "evidence.json"
    write(evidence, {
        "feature_id": "M01-F01", "passed": True, "acceptance_run_id": "run-round99",
        "source_sha256": {"source.txt": hashlib.sha256(source.read_bytes()).hexdigest()},
    })
    ledger = tmp_path / "ledger.json"
    write(ledger, {"schema_version": 1, "expected_total": 72, "items": [
        {"id": value, "status": "accepted" if index == 0 else "pending",
         "tests": ["test.py"] if index == 0 else [], "evidence": ["evidence.json"] if index == 0 else []}
        for index, value in enumerate(EXPECTED_IDS)
    ]})
    return ledger


def test_valid_partial_ledger_is_green_but_never_claims_100_percent(tmp_path: Path) -> None:
    result = audit(tmp_path, fixture(tmp_path), "run-round99")
    assert result.passed and result.accepted == 1 and result.expected_total == 72


def test_missing_duplicate_false_stale_and_mixed_run_evidence_fail_closed(tmp_path: Path) -> None:
    ledger = fixture(tmp_path)
    value = json.loads(ledger.read_text(encoding="utf-8"))
    value["items"][1]["id"] = value["items"][0]["id"]
    write(ledger, value)
    assert not audit(tmp_path, ledger, "run-round99").passed

    ledger = fixture(tmp_path)
    (tmp_path / "test.py").unlink()
    assert not audit(tmp_path, ledger, "run-round99").passed

    ledger = fixture(tmp_path)
    report = json.loads((tmp_path / "evidence.json").read_text(encoding="utf-8"))
    report["passed"] = False
    write(tmp_path / "evidence.json", report)
    assert not audit(tmp_path, ledger, "run-round99").passed

    ledger = fixture(tmp_path)
    (tmp_path / "source.txt").write_text("changed", encoding="utf-8")
    assert not audit(tmp_path, ledger, "run-round99").passed

    ledger = fixture(tmp_path)
    report = json.loads((tmp_path / "evidence.json").read_text(encoding="utf-8"))
    report["acceptance_run_id"] = "run-another"
    write(tmp_path / "evidence.json", report)
    assert not audit(tmp_path, ledger, "run-round99").passed
