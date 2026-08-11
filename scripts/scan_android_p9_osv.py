"""Query the official OSV batch API for the current Android runtime graph."""

from __future__ import annotations

import argparse
import json
import os
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from accept_android_p9_supply_chain import ANDROID, ROOT, resolved_maven_dependencies, run


OSV_BATCH_API = "https://api.osv.dev/v1/querybatch"
DEFAULT_OUTPUT = ROOT / "docs/android/reports/evidence/p9/m11-f03-osv-maven-scan.json"


def query_batch(packages: list[dict[str, str]], *, timeout: int = 60) -> list[dict]:
    findings: list[dict] = []
    for start in range(0, len(packages), 100):
        batch = packages[start:start + 100]
        body = json.dumps({"queries": [
            {"package": {"ecosystem": "Maven", "name": item["name"]}, "version": item["version"]}
            for item in batch
        ]}).encode()
        request = urllib.request.Request(
            OSV_BATCH_API, data=body, headers={"Content-Type": "application/json", "User-Agent": "OpenDrSai-P9-SBOM/1"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        results = payload.get("results")
        if not isinstance(results, list) or len(results) != len(batch):
            raise RuntimeError("osv_batch_response_invalid")
        for package, result in zip(batch, results, strict=True):
            for vulnerability in result.get("vulns", []):
                findings.append({
                    "package": package,
                    "id": vulnerability.get("id"),
                    "modified": vulnerability.get("modified"),
                    "aliases": sorted(vulnerability.get("aliases", [])),
                })
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    options = parser.parse_args()
    gradle = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    dependencies = resolved_maven_dependencies(run(
        [str(gradle), ":app:dependencies", "--configuration", "debugRuntimeClasspath"], cwd=ANDROID,
    ))
    findings = query_batch(dependencies)
    report = {
        "schema_version": 1,
        "ecosystem": "Maven",
        "configuration": "debugRuntimeClasspath",
        "provider": "OSV",
        "provider_api": OSV_BATCH_API,
        "generated_at": datetime.now(UTC).isoformat(),
        "packages": dependencies,
        "findings": findings,
        "gates": {
            "all_runtime_dependencies_resolved": len(dependencies) >= 100,
            "zero_known_osv_vulnerabilities": not findings,
        },
        "passed": len(dependencies) >= 100 and not findings,
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "packages": len(dependencies), "findings": len(findings), "passed": report["passed"],
        "output": str(options.output),
    }, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
