from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
OUTPUT = ROOT / "docs/android/reports/evidence/v1.5.6/osv-maven-scan.json"
GRADLE = Path.home() / ".gradle/wrapper/dists/gradle-8.9-bin/90cnw93cvbtalezasaz0blq0a/gradle-8.9/bin/gradle.bat"


def dependencies() -> list[dict[str, str]]:
    environment = dict(os.environ)
    environment.setdefault("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr")
    output = subprocess.run(
        [str(GRADLE), ":app:dependencies", "--configuration", "debugRuntimeClasspath", "--no-daemon"],
        cwd=ANDROID,
        env=environment,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=300,
        creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout
    resolved: dict[str, str] = {}
    pattern = re.compile(r"(?:\+---|\\---)\s+([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^\s(]+)(?:\s+->\s+([^\s(]+))?")
    for match in pattern.finditer(output):
        group, artifact, declared, selected = match.groups()
        version = selected or declared
        if version in {"FAILED", "project"} or version.startswith("{"):
            continue
        resolved[f"{group}:{artifact}"] = version
    if not resolved:
        raise RuntimeError("gradle_runtime_dependencies_missing")
    return [{"name": name, "version": version} for name, version in sorted(resolved.items())]


def query_osv(packages: list[dict[str, str]]) -> list[dict[str, object]]:
    body = json.dumps({
        "queries": [
            {"package": {"ecosystem": "Maven", "name": item["name"]}, "version": item["version"]}
            for item in packages
        ]
    }).encode()
    request = urllib.request.Request(
        "https://api.osv.dev/v1/querybatch",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "OpenDrSai-v1.5.6-acceptance"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    rows = result.get("results", [])
    if len(rows) != len(packages):
        raise RuntimeError("osv_querybatch_result_count_mismatch")
    findings = []
    for package, row in zip(packages, rows):
        for vulnerability in row.get("vulns", []):
            findings.append({
                "package": package["name"],
                "version": package["version"],
                "id": vulnerability.get("id"),
                "modified": vulnerability.get("modified"),
            })
    return findings


def main() -> int:
    packages = dependencies()
    findings = query_osv(packages)
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "https://api.osv.dev/v1/querybatch",
        "ecosystem": "Maven",
        "configuration": "debugRuntimeClasspath",
        "packages_scanned": len(packages),
        "packages": packages,
        "findings": findings,
        "gates": {"all_runtime_dependencies_resolved": True, "zero_known_osv_vulnerabilities": not findings},
        "passed": not findings,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("packages_scanned", "findings", "passed")}, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
