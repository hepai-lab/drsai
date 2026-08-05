"""Bind green local JUnit reports to one Stage 7 acceptance identity."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--junit", type=Path, action="append", required=True)
    parser.add_argument("--runner", required=True)
    parser.add_argument("--max-age-hours", type=float, default=2.0)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    reports, errors, times = [], [], []
    now = datetime.now(timezone.utc)
    for path in args.junit:
        root = ET.parse(path).getroot()
        suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
        clean = bool(suites) and all(
            int(suite.get("failures", "0")) == 0 and int(suite.get("errors", "0")) == 0
            for suite in suites
        ) and next(root.iter("failure"), None) is None and next(root.iter("error"), None) is None
        if not clean:
            errors.append(f"junit_failed:{path.name}")
        modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        age_seconds = (now - modified).total_seconds()
        if age_seconds < -300 or age_seconds > args.max_age_hours * 3600:
            errors.append(f"junit_outside_freshness_window:{path.name}")
        reports.append({"name": path.name, "sha256": digest(path)})
        times.append(modified)
    result = "passed" if reports and not errors else "failed"
    host_hash = hashlib.sha256(platform.node().encode()).hexdigest()
    provenance = {"runner": args.runner, "acceptance_run_id": identity["acceptance_run_id"],
                  "package_version_code": identity.get("version_code"),
                  "package_version_name": identity.get("version_name"), "apk_sha256": identity.get("apk_sha256"),
                  "started_at": min(times).isoformat(), "completed_at": max(times).isoformat(),
                  "device_ids_sha256": [host_hash]}
    value = {"schema_version": 2, "generated_at": now.isoformat(),
             "identity": identity, "provenance": provenance, "junit": reports,
             "errors": errors, "result": result}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
