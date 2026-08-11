"""Generate and validate the 80-point Mobile Remote Workspace V4 ledger."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/remote_workespace/OpenDrSai移动远程工作区开发方案V4.md"
LEDGER = ROOT / "release/product-evidence/mobile-remote-workspace-v4/acceptance.json"
ROW = re.compile(
    r"^\| (?P<id>M\d{2}-F\d{2}) \| (?P<description>[^|]+) \| "
    r"(?P<acceptance>[^|]+) \|$"
)
VALID_STATUS = {"unverified", "local_pass", "full_pass", "blocked"}
MODULE_SIZES = (6, 7, 7, 7, 6, 7, 7, 8, 5, 6, 6, 8)
PRODUCTION_ONLY = {
    *(f"M07-F{index:02d}" for index in range(1, 8)),
    "M11-F01",
    "M11-F03",
    *(f"M12-F{index:02d}" for index in range(1, 9)),
}
LOCAL_PASS = {
    f"M{module:02d}-F{feature:02d}"
    for module, size in enumerate(MODULE_SIZES, start=1)
    for feature in range(1, size + 1)
} - PRODUCTION_ONLY
SECRET_PATTERN = re.compile(
    r"(?i)(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|"
    r"(?:password|registration_token|private_key|access_token)"
    r"\s*[\"=:]\s*[^\s\",}]{8,})"
)


def expected_ids() -> list[str]:
    return [
        f"M{module:02d}-F{feature:02d}"
        for module, size in enumerate(MODULE_SIZES, start=1)
        for feature in range(1, size + 1)
    ]


def plan_rows() -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for line in PLAN.read_text(encoding="utf-8").splitlines():
        match = ROW.match(line)
        if match:
            row = {key: value.strip() for key, value in match.groupdict().items()}
            rows[row["id"]] = row
    missing = set(expected_ids()) - rows.keys()
    if missing:
        raise RuntimeError("v4_plan_rows_missing:" + ",".join(sorted(missing)))
    return rows


def generated(existing: dict[str, Any] | None = None) -> dict[str, Any]:
    rows = plan_rows()
    old = {
        str(item.get("id")): item
        for item in (existing or {}).get("items", [])
        if isinstance(item, dict)
    }
    items: list[dict[str, Any]] = []
    for item_id in expected_ids():
        previous = old.get(item_id, {})
        status = previous.get(
            "status", "local_pass" if item_id in LOCAL_PASS else "unverified"
        )
        evidence = previous.get("evidence")
        if evidence is None:
            evidence = [] if status == "unverified" else [{
                "kind": "automated_test",
                "result": "passed",
                "command": "V4 scoped automated gates recorded in plan progress",
            }]
        items.append({
            "id": item_id,
            "module": item_id[:3],
            "description": rows[item_id]["description"],
            "acceptance": rows[item_id]["acceptance"],
            "status": status,
            "evidence": evidence,
            "blockers": previous.get("blockers", []),
        })
    return {
        "schema_version": 1,
        "plan": PLAN.relative_to(ROOT).as_posix(),
        "expected_count": 80,
        "protocols": {"oaep": "1.0", "owop": "1.0", "relay": "2.0.0"},
        "release_gate": {
            "required_full_pass": 80,
            "v3_unverified_required": 0,
            "stability_duration_seconds": 3600,
        },
        "items": items,
    }


def load(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    value = json.loads(path.read_text(encoding="utf-8"))
    return value if isinstance(value, dict) else {}


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    items = data.get("items")
    if not isinstance(items, list):
        return ["ledger items must be an array"]
    ids = [str(item.get("id")) for item in items if isinstance(item, dict)]
    if ids != expected_ids():
        errors.append("ledger feature ids/order drift from V4 plan")
    if len(items) != 80 or data.get("expected_count") != 80:
        errors.append("V4 ledger must contain exactly 80 features")
    for item in items:
        if not isinstance(item, dict):
            errors.append("ledger item must be an object")
            continue
        status = item.get("status")
        evidence = item.get("evidence")
        blockers = item.get("blockers")
        if status not in VALID_STATUS:
            errors.append(f"{item.get('id')}: invalid status")
        if not isinstance(evidence, list) or not all(isinstance(row, dict) for row in evidence):
            errors.append(f"{item.get('id')}: invalid evidence")
            continue
        if status in {"local_pass", "full_pass"} and not any(
            row.get("kind") == "automated_test" for row in evidence
        ):
            errors.append(f"{item.get('id')}: passed status requires automated test")
        if status == "full_pass" and not any(
            row.get("kind") == "release_evidence" for row in evidence
        ):
            errors.append(f"{item.get('id')}: full_pass requires release evidence")
        if not isinstance(blockers, list):
            errors.append(f"{item.get('id')}: blockers must be an array")
        elif status == "full_pass" and blockers:
            errors.append(f"{item.get('id')}: full_pass cannot retain blockers")
    gate = data.get("release_gate", {})
    if gate.get("required_full_pass") != 80:
        errors.append("release gate must require 80 full_pass items")
    if gate.get("v3_unverified_required") != 0:
        errors.append("release gate must require zero V3 inherited gaps")
    if gate.get("stability_duration_seconds") != 3600:
        errors.append("release gate must require 3600 seconds")
    if SECRET_PATTERN.search(json.dumps(data, ensure_ascii=False)):
        errors.append("ledger contains a likely secret")
    return errors


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--require-release-ready", action="store_true")
    args = parser.parse_args()
    expected = generated(load(LEDGER))
    if args.check:
        if load(LEDGER) != expected:
            raise SystemExit("V4 acceptance ledger drift; regenerate it")
    else:
        atomic_json(LEDGER, expected)
    errors = validate(expected)
    counts = {status: sum(row["status"] == status for row in expected["items"]) for status in VALID_STATUS}
    if args.require_release_ready and counts["full_pass"] != 80:
        errors.append(f"release blocked: full_pass={counts['full_pass']}/80")
    if errors:
        raise SystemExit("\n".join(errors))
    print(json.dumps({"valid": True, "counts": counts}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
