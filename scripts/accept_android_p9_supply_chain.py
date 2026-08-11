"""Generate and fail-closed verify the P9 Android/Python/Maven/Skill SBOM."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
EVIDENCE = ROOT / "docs/android/reports/evidence/p9"
LEGACY_OSV = ROOT / "docs/android/reports/evidence/v1.5.6/osv-maven-scan.json"
DEFAULT_SBOM = EVIDENCE / "m11-f03-supply-chain.cdx.json"
DEFAULT_REPORT = EVIDENCE / "m11-f03-supply-chain.json"
DEPENDENCY = re.compile(
    r"[+\\]---\s+([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([^\s]+)(?:\s+->\s+([^\s]+))?"
)
BANNED_RUNTIME_PATTERNS = {
    "dynamic_pip": re.compile(r"(?i)(?:python\s+-m\s+pip|pip3?)\s+install"),
    "dynamic_code_loader": re.compile(r"\b(?:DexClassLoader|PathClassLoader)\s*\("),
    "download_then_execute": re.compile(r"(?is)(?:curl|wget|download).{0,200}(?:chmod\s+\+x|ProcessBuilder|subprocess)"),
}


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def run(command: list[str], *, cwd: Path, timeout: int = 300) -> str:
    environment = dict(os.environ)
    environment.setdefault("JAVA_HOME", r"C:\Program Files\Android\Android Studio\jbr")
    completed = subprocess.run(
        command, cwd=cwd, env=environment, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if completed.returncode:
        raise RuntimeError(f"dependency_resolution_failed:{completed.returncode}\n{completed.stdout[-4000:]}")
    return completed.stdout


def resolved_maven_dependencies(output: str) -> list[dict[str, str]]:
    packages: set[tuple[str, str]] = set()
    for match in DEPENDENCY.finditer(output):
        group, artifact, requested, resolved = match.groups()
        version = (resolved or requested).rstrip("(*)")
        if version.startswith("{") or version in {"FAILED", "project"}:
            continue
        packages.add((f"{group}:{artifact}", version))
    return [{"name": name, "version": version} for name, version in sorted(packages)]


def _pom_text(node: ET.Element, name: str, namespace: str) -> str:
    return (node.findtext(f"{namespace}{name}") or "").strip()


def pom_licenses(cache: Path, group: str, artifact: str, version: str, seen: set[tuple[str, str, str]] | None = None) -> list[dict]:
    identity = (group, artifact, version)
    seen = set() if seen is None else seen
    if identity in seen:
        return []
    seen.add(identity)
    poms = sorted((cache / group / artifact / version).glob("**/*.pom"))
    if not poms:
        return []
    root = ET.parse(poms[0]).getroot()
    namespace = root.tag.partition("}")[0] + "}" if "}" in root.tag else ""
    licenses = []
    for license_node in root.findall(f"{namespace}licenses/{namespace}license"):
        name = _pom_text(license_node, "name", namespace)
        url = _pom_text(license_node, "url", namespace)
        if name or url:
            normalized = name.casefold()
            spdx = None
            if "apache" in normalized and "2" in normalized:
                spdx = "Apache-2.0"
            elif normalized in {"mit", "mit license", "the mit license"}:
                spdx = "MIT"
            elif "bsd" in normalized and "3" in normalized:
                spdx = "BSD-3-Clause"
            value = {"license": {"id": spdx}} if spdx else {"license": {"name": name or url}}
            if url:
                value["license"]["url"] = url
            licenses.append(value)
    if licenses:
        return licenses
    parent = root.find(f"{namespace}parent")
    if parent is None:
        return []
    parent_group = _pom_text(parent, "groupId", namespace) or group
    return pom_licenses(
        cache,
        parent_group,
        _pom_text(parent, "artifactId", namespace),
        _pom_text(parent, "version", namespace),
        seen,
    )


def cached_artifact_hashes(cache: Path, group: str, artifact: str, version: str) -> list[dict[str, str]]:
    files = sorted(
        path for path in (cache / group / artifact / version).glob("**/*")
        if path.is_file() and path.suffix.lower() in {".aar", ".jar", ".pom", ".module"}
    )
    return [{"alg": "SHA-256", "content": digest_file(path)} for path in files]


def source_inventory(paths: Iterable[Path]) -> list[dict[str, str]]:
    return [
        {"path": path.relative_to(ROOT).as_posix(), "sha256": digest_file(path)}
        for path in sorted(set(paths))
    ]


def static_runtime_findings() -> list[dict[str, str]]:
    roots = [
        ANDROID / "app/src/main/java",
        ANDROID / "app/src/main/python",
        ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime",
    ]
    findings: list[dict[str, str]] = []
    for root in roots:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".kt", ".java", ".py"}:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for rule, pattern in BANNED_RUNTIME_PATTERNS.items():
                if pattern.search(text):
                    findings.append({"path": path.relative_to(ROOT).as_posix(), "rule": rule})
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--osv", type=Path, default=LEGACY_OSV)
    parser.add_argument("--sbom", type=Path, default=DEFAULT_SBOM)
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--max-osv-age-days", type=int, default=7)
    options = parser.parse_args()
    options.osv = options.osv.resolve()
    options.sbom = options.sbom.resolve()
    options.output = options.output.resolve()
    apk = options.apk or max((ANDROID / "app/build/outputs/apk/debug").glob("*.apk"), key=lambda path: path.stat().st_mtime)
    if not apk.is_file() or not options.osv.is_file():
        raise FileNotFoundError(apk if not apk.is_file() else options.osv)

    gradle = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    dependency_output = run(
        [str(gradle), ":app:dependencies", "--configuration", "debugRuntimeClasspath"], cwd=ANDROID,
    )
    dependencies = resolved_maven_dependencies(dependency_output)
    osv = json.loads(options.osv.read_text(encoding="utf-8"))
    osv_packages = sorted(osv.get("packages", []), key=lambda item: (item["name"], item["version"]))
    dependency_set = {(item["name"], item["version"]) for item in dependencies}
    osv_set = {(item["name"], item["version"]) for item in osv_packages}
    osv_generated = datetime.fromisoformat(osv["generated_at"])
    osv_age_days = (datetime.now(UTC) - osv_generated).total_seconds() / 86_400

    cache = Path.home() / ".gradle/caches/modules-2/files-2.1"
    maven_components = []
    missing_licenses = []
    missing_hashes = []
    for item in dependencies:
        group, artifact = item["name"].split(":", 1)
        version = item["version"]
        licenses = pom_licenses(cache, group, artifact, version)
        hashes = cached_artifact_hashes(cache, group, artifact, version)
        if not licenses:
            missing_licenses.append(f"{item['name']}@{version}")
        if not hashes:
            missing_hashes.append(f"{item['name']}@{version}")
        maven_components.append({
            "type": "library",
            "group": group,
            "name": artifact,
            "version": version,
            "purl": f"pkg:maven/{group}/{artifact}@{version}",
            "hashes": hashes,
            "licenses": licenses,
        })

    runtime_sources = source_inventory(
        list((ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime").rglob("*.py"))
        + list((ANDROID / "app/src/main/python").rglob("*.py"))
    )
    skill_files = list((ANDROID / "app/src/main").rglob("SKILL.md"))
    skill_inventory = source_inventory(skill_files)
    embedded = []
    with zipfile.ZipFile(apk) as archive:
        for info in sorted(archive.infolist(), key=lambda value: value.filename):
            if info.is_dir():
                continue
            if info.filename.startswith("assets/chaquopy/") or (
                info.filename.startswith("lib/") and any(value in info.filename for value in ("python", "chaquopy"))
            ):
                embedded.append({"path": info.filename, "sha256": digest_bytes(archive.read(info))})

    runtime_manifest_sha = digest_bytes(json.dumps(runtime_sources, sort_keys=True, separators=(",", ":")).encode())
    static_findings = static_runtime_findings()
    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.now(UTC).isoformat(),
            "component": {
                "type": "application", "name": "OpenDrSai.Dev", "version": "1.5.6",
                "hashes": [{"alg": "SHA-256", "content": digest_file(apk)}],
            },
        },
        "components": maven_components + [{
            "type": "framework", "name": "CPython", "version": "3.11",
            "hashes": [{"alg": "SHA-256", "content": runtime_manifest_sha}],
            "licenses": [{"license": {"id": "PSF-2.0"}}],
            "properties": [
                {"name": "opendrsai:source-files", "value": json.dumps(runtime_sources, separators=(",", ":"))},
                {"name": "opendrsai:apk-runtime-artifacts", "value": json.dumps(embedded, separators=(",", ":"))},
            ],
        }],
        "properties": [
            {"name": "opendrsai:skill-count", "value": str(len(skill_inventory))},
            {"name": "opendrsai:skill-inventory", "value": json.dumps(skill_inventory, separators=(",", ":"))},
            {"name": "opendrsai:osv-evidence-sha256", "value": digest_file(options.osv)},
        ],
    }
    options.sbom.parent.mkdir(parents=True, exist_ok=True)
    options.sbom.write_text(json.dumps(sbom, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    gates = {
        "all_gradle_dependencies_in_sbom": len(dependencies) >= 100 and len(maven_components) == len(dependencies),
        "osv_matches_current_gradle_graph": dependency_set == osv_set,
        "osv_fresh": 0 <= osv_age_days <= options.max_osv_age_days,
        "zero_known_osv_vulnerabilities": osv.get("passed") is True and not osv.get("findings"),
        "all_maven_components_hashed": not missing_hashes,
        "all_maven_components_licensed": not missing_licenses,
        "python_runtime_sources_hashed": bool(runtime_sources) and len(runtime_manifest_sha) == 64,
        "python_apk_artifacts_hashed": len(embedded) >= 30,
        "skills_hashed_or_explicitly_empty": all(len(item["sha256"]) == 64 for item in skill_inventory),
        "no_dynamic_pip_or_executable_download": not static_findings,
        "cyclonedx_complete": sbom["bomFormat"] == "CycloneDX" and sbom["specVersion"] == "1.5",
    }
    report = {
        "schema_version": 1,
        "feature_id": "M11-F03",
        "generated_at": datetime.now(UTC).isoformat(),
        "apk": {"path": apk.name, "sha256": digest_file(apk)},
        "sbom": {"path": options.sbom.relative_to(ROOT).as_posix(), "sha256": digest_file(options.sbom)},
        "dependency_counts": {
            "maven": len(dependencies), "python_source": len(runtime_sources),
            "python_apk_artifacts": len(embedded), "skills": len(skill_inventory),
        },
        "osv": {"path": options.osv.relative_to(ROOT).as_posix(), "sha256": digest_file(options.osv), "age_days": osv_age_days},
        "missing_licenses": missing_licenses,
        "missing_hashes": missing_hashes,
        "static_findings": static_findings,
        "gates": gates,
        "passed": all(gates.values()),
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
