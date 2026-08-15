from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/android/reports/evidence/p10/m10-f05-usability.json"
TASKS = {"first_configuration", "search", "file_task", "error_recovery"}


def evaluate(document: dict) -> dict:
    participants = document.get("participants")
    if not isinstance(participants, list) or len(participants) != 5:
        raise ValueError("exactly_five_participants_required")
    ids = [row.get("participant_id") for row in participants]
    if len(set(ids)) != 5 or any(not isinstance(value, str) or not value for value in ids):
        raise ValueError("five_unique_anonymous_participant_ids_required")
    if any(row.get("is_developer") is not False for row in participants):
        raise ValueError("all_participants_must_be_non_developers")
    successful = []
    durations = []
    critical_misauthorizations = 0
    for row in participants:
        results = row.get("tasks", {})
        if set(results) != TASKS or any(value not in {"completed", "failed"} for value in results.values()):
            raise ValueError(f"complete_task_matrix_required:{row['participant_id']}")
        duration = row.get("first_success_seconds")
        if not isinstance(duration, (int, float)) or duration <= 0:
            raise ValueError(f"positive_first_success_seconds_required:{row['participant_id']}")
        durations.append(float(duration))
        critical_misauthorizations += int(row.get("critical_misauthorizations", 0))
        successful.append(all(value == "completed" for value in results.values()) and int(row.get("assistance_count", 0)) == 0)
    issues = document.get("issues", [])
    if not isinstance(issues, list) or any(not row.get("description") or row.get("status") not in {"closed", "accepted_non_blocking"} for row in issues):
        raise ValueError("every_issue_requires_description_and_closure")
    metrics = {
        "unassisted_complete": sum(successful), "participants": 5,
        "first_success_median_seconds": statistics.median(durations),
        "critical_misauthorizations": critical_misauthorizations,
        "issues_recorded": len(issues), "issues_closed": len(issues),
    }
    gates = {
        "at_least_four_of_five_unassisted": metrics["unassisted_complete"] >= 4,
        "first_success_median_at_most_three_minutes": metrics["first_success_median_seconds"] <= 180,
        "zero_critical_misauthorizations": critical_misauthorizations == 0,
        "all_recorded_issues_closed": True,
    }
    return {"passed": all(gates.values()), "metrics": metrics, "gates": gates}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    options = parser.parse_args()
    raw = options.input.read_bytes()
    source = json.loads(raw.decode("utf-8"))
    result = evaluate(source)
    report = {
        "schema_version": "opendrsai.p10-usability-result/1", "feature_id": "M10-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(), **result,
        "participant_ids": [row["participant_id"] for row in source["participants"]],
        "source_sha256": hashlib.sha256(raw).hexdigest(),
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], **report["metrics"]}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
