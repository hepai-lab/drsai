"""Aggregate fresh, identity-bound Stage 7 performance runs."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    samples, errors, provenances = [], [], []
    for path in args.report:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("schema_version") != 2 or value.get("identity") != identity or value.get("result") != "passed":
            errors.append(f"performance_run_invalid:{path.name}")
            continue
        provenance = value.get("provenance", {})
        environment = value.get("environment", {})
        if (provenance.get("apk_sha256") != identity["apk_sha256"] or
                environment.get("device_id_sha256") not in provenance.get("device_ids_sha256", [])):
            errors.append(f"performance_provenance_invalid:{path.name}")
            continue
        performance_reports = [item for item in value.get("reports", []) if isinstance(item.get("performance"), dict)]
        if len(performance_reports) != 1:
            errors.append(f"performance_marker_count_invalid:{path.name}")
            continue
        metrics = performance_reports[0]["performance"]
        samples.append({"source": path.name, "environment": environment, "metrics": metrics})
        provenances.append(provenance)

    checks = {
        "physical_device_measured": any(item["environment"].get("kind") == "physical_device" for item in samples),
        "cold_start_p95_le_3000_ms": bool(samples) and all(
            isinstance(item["metrics"].get("cold_start_p95_ms"), (int, float)) and
            item["metrics"]["cold_start_p95_ms"] <= 3000 for item in samples),
        "foreground_pss_p95_le_220_mb": bool(samples) and all(
            isinstance(item["metrics"].get("foreground_pss_p95_mb"), (int, float)) and
            item["metrics"]["foreground_pss_p95_mb"] <= 220 for item in samples),
        "peak_pss_le_320_mb": bool(samples) and all(
            isinstance(item["metrics"].get("peak_pss_mb"), (int, float)) and
            item["metrics"]["peak_pss_mb"] <= 320 for item in samples),
        "runtime_release_verified": bool(samples) and all(
            item["metrics"].get("runtime_release_verified") is True for item in samples),
    }
    result = "passed" if all(checks.values()) and not errors else "failed"
    merged = None if len(provenances) != len(samples) or not samples else {
        "runner": "+".join(sorted({str(item["runner"]) for item in provenances})),
        "acceptance_run_id": identity["acceptance_run_id"], "package_version_code": identity["version_code"],
        "package_version_name": identity["version_name"], "apk_sha256": identity["apk_sha256"],
        "started_at": min(str(item["started_at"]) for item in provenances),
        "completed_at": max(str(item["completed_at"]) for item in provenances),
        "device_ids_sha256": sorted({device for item in provenances for device in item["device_ids_sha256"]}),
    }
    output = {"schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(),
              "identity": identity, "provenance": merged, "samples": samples,
              "checks": checks, "errors": errors, "result": result}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
