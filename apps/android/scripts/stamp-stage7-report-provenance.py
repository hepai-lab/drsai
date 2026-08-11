"""Attach execution provenance to an already-passed, identity-bound Stage 7 report."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

SHA256 = re.compile(r"^[0-9a-f]{64}$")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--runner", required=True)
    parser.add_argument("--started-at", required=True)
    parser.add_argument("--completed-at", required=True)
    parser.add_argument("--device-id-sha256", action="append", required=True)
    args = parser.parse_args()
    report = json.loads(args.report.read_text(encoding="utf-8"))
    identity = json.loads(args.identity_from.read_text(encoding="utf-8")).get("identity")
    if report.get("result") != "passed":
        raise SystemExit("report_not_passed")
    if not isinstance(identity, dict) or report.get("identity") != identity:
        raise SystemExit("report_identity_mismatch")
    if not args.runner.strip() or any(not SHA256.fullmatch(value) for value in args.device_id_sha256):
        raise SystemExit("provenance_runner_or_device_invalid")
    started = datetime.fromisoformat(args.started_at.replace("Z", "+00:00"))
    completed = datetime.fromisoformat(args.completed_at.replace("Z", "+00:00"))
    if started.tzinfo is None or completed.tzinfo is None or completed < started:
        raise SystemExit("provenance_time_invalid")
    report["provenance"] = {
        "runner": args.runner, "acceptance_run_id": identity["acceptance_run_id"],
        "package_version_code": identity["version_code"], "package_version_name": identity["version_name"],
        "apk_sha256": identity["apk_sha256"], "started_at": args.started_at,
        "completed_at": args.completed_at, "device_ids_sha256": sorted(set(args.device_id_sha256)),
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
