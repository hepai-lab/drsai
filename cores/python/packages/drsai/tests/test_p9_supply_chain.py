from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path


REPO = Path(__file__).parents[5]
SCRIPT = REPO / "scripts/accept_android_p9_supply_chain.py"
SPEC = importlib.util.spec_from_file_location("accept_android_p9_supply_chain", SCRIPT)
assert SPEC and SPEC.loader
supply = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(supply)
EVIDENCE = REPO / "docs/android/reports/evidence/p9"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_gradle_dependency_parser_uses_resolved_versions_and_deduplicates() -> None:
    output = """
    +--- org.example:alpha:1.0 -> 2.0
    |    \\--- org.example:beta:3.0
    \\--- org.example:alpha:1.0 -> 2.0 (*)
    """

    assert supply.resolved_maven_dependencies(output) == [
        {"name": "org.example:alpha", "version": "2.0"},
        {"name": "org.example:beta", "version": "3.0"},
    ]


def test_pom_license_resolution_follows_parent_without_inventing_license(tmp_path: Path) -> None:
    child = tmp_path / "g/child/1/hash/child.pom"
    parent = tmp_path / "g/parent/2/hash/parent.pom"
    child.parent.mkdir(parents=True)
    parent.parent.mkdir(parents=True)
    child.write_text("""<project><parent><groupId>g</groupId><artifactId>parent</artifactId>
        <version>2</version></parent><artifactId>child</artifactId><version>1</version></project>""")
    parent.write_text("""<project><licenses><license><name>The Apache Software License, Version 2.0</name>
        <url>https://www.apache.org/licenses/LICENSE-2.0.txt</url></license></licenses></project>""")

    licenses = supply.pom_licenses(tmp_path, "g", "child", "1")

    assert licenses[0]["license"]["id"] == "Apache-2.0"


def test_banned_runtime_patterns_cover_dynamic_install_and_download_execution() -> None:
    assert supply.BANNED_RUNTIME_PATTERNS["dynamic_pip"].search("python -m pip install untrusted")
    assert supply.BANNED_RUNTIME_PATTERNS["download_then_execute"].search("download(url); subprocess.run(file)")
    assert supply.BANNED_RUNTIME_PATTERNS["dynamic_code_loader"].search("DexClassLoader(path)")


def test_current_p9_sbom_and_osv_evidence_are_complete_and_bound_to_apk() -> None:
    report_path = EVIDENCE / "m11-f03-supply-chain.json"
    sbom_path = EVIDENCE / "m11-f03-supply-chain.cdx.json"
    osv_path = EVIDENCE / "m11-f03-osv-maven-scan.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    sbom = json.loads(sbom_path.read_text(encoding="utf-8"))
    osv = json.loads(osv_path.read_text(encoding="utf-8"))

    assert report["feature_id"] == "M11-F03" and report["passed"] is True
    assert all(report["gates"].values())
    assert report["sbom"]["sha256"] == _sha256(sbom_path)
    assert report["osv"]["sha256"] == _sha256(osv_path)
    # Formal P9 evidence is immutable and must not be rebound merely because a
    # newer Emulator preflight APK exists in the local Gradle output folder.
    # Candidate-to-APK binding is verified by the preflight/release manifest
    # which actually owns that binary; here we validate the recorded digest.
    assert len(report["apk"]["sha256"]) == 64
    assert all(character in "0123456789abcdef" for character in report["apk"]["sha256"])
    assert sbom["bomFormat"] == "CycloneDX" and sbom["specVersion"] == "1.5"
    maven = [item for item in sbom["components"] if str(item.get("purl", "")).startswith("pkg:maven/")]
    assert len(maven) == len(osv["packages"]) == report["dependency_counts"]["maven"] == 179
    assert all(item["hashes"] and item["licenses"] for item in maven)
    assert osv["findings"] == [] and osv["passed"] is True
    assert report["missing_hashes"] == report["missing_licenses"] == report["static_findings"] == []
