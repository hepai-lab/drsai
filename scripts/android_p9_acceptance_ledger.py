from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any


EXPECTED_IDS = [f"M{module:02d}-F{feature:02d}" for module in range(1, 13) for feature in range(1, 7)]
RUN_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class LedgerAudit:
    passed: bool
    gates: dict[str, bool]
    accepted: int
    expected_total: int
    evidence_sha256: dict[str, str]
    errors: list[str]


def audit(root: Path, ledger_path: Path, verification_run_id: str) -> LedgerAudit:
    errors: list[str] = []
    evidence_hashes: dict[str, str] = {}
    if not RUN_ID.fullmatch(verification_run_id):
        errors.append("verification_run_id_invalid")
    try:
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    except Exception as error:
        return LedgerAudit(False, {"ledger_json_valid": False}, 0, 72, {}, [f"ledger_invalid:{error}"])
    items = ledger.get("items") if isinstance(ledger.get("items"), list) else []
    ids = [item.get("id") for item in items if isinstance(item, dict)]
    exact_ids = ids == EXPECTED_IDS and len(set(ids)) == 72
    if not exact_ids:
        errors.append("ledger_ids_missing_duplicate_or_out_of_order")
    accepted_items = [item for item in items if isinstance(item, dict) and item.get("status") == "accepted"]
    evidence_owners: dict[str, set[str]] = {}
    for accepted_item in accepted_items:
        for relative in accepted_item.get("evidence", []):
            if str(relative).endswith(".json"):
                evidence_owners.setdefault(str(relative), set()).add(str(accepted_item["id"]))
    valid_status = all(isinstance(item, dict) and item.get("status") in {"pending", "accepted"} for item in items)
    if not valid_status:
        errors.append("ledger_status_invalid")
    files_complete = True
    reports_passed = True
    hashes_current = True
    run_ids_consistent = True
    feature_identity = True
    for item in accepted_items:
        feature_id = str(item["id"])
        tests = item.get("tests") if isinstance(item.get("tests"), list) else []
        evidence = item.get("evidence") if isinstance(item.get("evidence"), list) else []
        if not tests or not evidence:
            files_complete = False
            errors.append(f"accepted_item_missing_binding:{feature_id}")
        for relative in [*tests, *evidence]:
            path = root / str(relative)
            if not path.is_file():
                files_complete = False
                errors.append(f"bound_file_missing:{feature_id}:{relative}")
                continue
            if relative in evidence:
                evidence_hashes[str(relative).replace("\\", "/")] = sha256(path)
                if path.suffix != ".json":
                    continue
                # The M12-F01 report is the transaction output of this audit. Its
                # previous contents cannot be used to decide its replacement.
                if path.name == "m12-f01-machine-ledger.json" and feature_id == "M12-F01":
                    continue
                try:
                    report: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
                except Exception:
                    reports_passed = False
                    errors.append(f"evidence_json_invalid:{feature_id}:{relative}")
                    continue
                if "passed" in report and report["passed"] is not True:
                    reports_passed = False
                    errors.append(f"evidence_not_passed:{feature_id}:{relative}")
                report_feature = report.get("feature_id")
                if report_feature and report_feature != feature_id and report_feature not in evidence_owners.get(str(relative), set()):
                    feature_identity = False
                    errors.append(f"evidence_feature_mismatch:{feature_id}:{report_feature}")
                report_run = report.get("acceptance_run_id")
                if report_run is not None and report_run != verification_run_id:
                    run_ids_consistent = False
                    errors.append(f"evidence_run_id_mismatch:{feature_id}:{report_run}")
                for source, expected in report.get("source_sha256", {}).items():
                    source_path = root / source
                    if not source_path.is_file() or sha256(source_path) != expected:
                        hashes_current = False
                        errors.append(f"source_hash_stale:{feature_id}:{source}")
    expected_total = int(ledger.get("expected_total", 0))
    progress_not_forged = len(accepted_items) < expected_total or all(
        item.get("status") == "accepted" for item in items
    )
    gates = {
        "schema_and_expected_total_are_frozen": ledger.get("schema_version") == 1 and expected_total == 72,
        "all_72_ids_are_unique_complete_and_ordered": exact_ids,
        "statuses_are_closed_enum": valid_status,
        "accepted_items_bind_existing_tests_and_evidence": files_complete,
        "evidence_reports_are_green": reports_passed,
        "evidence_feature_ids_match_ledger": feature_identity,
        "all_declared_source_hashes_are_current": hashes_current,
        "acceptance_run_ids_cannot_be_mixed": run_ids_consistent,
        "progress_cannot_reach_100_while_any_item_is_pending": progress_not_forged,
    }
    return LedgerAudit(all(gates.values()), gates, len(accepted_items), expected_total, evidence_hashes, errors)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    ledger = args.ledger or root / "docs/android/reports/progress/ANDROID_P9_ACCEPTANCE_LEDGER.json"
    result = audit(root, ledger, args.run_id)
    report = {
        "schema_version": 1,
        "feature_id": "M12-F01",
        "acceptance_run_id": args.run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": result.passed,
        "accepted_feature_count": result.accepted,
        "expected_total": result.expected_total,
        "progress_percent": round(result.accepted * 100 / result.expected_total, 2),
        "gates": result.gates,
        "errors": result.errors,
        "evidence_sha256": result.evidence_sha256,
        "source_sha256": {
            str(ledger.relative_to(root)).replace("\\", "/"): sha256(ledger),
            "scripts/android_p9_acceptance_ledger.py": sha256(Path(__file__)),
        },
    }
    output = args.output or root / "docs/android/reports/evidence/p9/m12-f01-machine-ledger.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result.passed, "accepted": result.accepted, "gates": sum(result.gates.values()), "total": len(result.gates)}))
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
