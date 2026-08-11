"""Validate and record the Android v1.5.6 Debug build identity (M01)."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/android/reports/evidence/v1.5.6"
DEFAULT_APK = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
DEFAULT_BASELINE = Path(
    r"C:\tmp\drsai-release-v1.5.5\apps\android\app\build\outputs\apk\mvp\OpenDrSai-Android-v1.5.5.apk"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def test_totals() -> dict[str, int]:
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    result_dir = ROOT / "apps/android/app/build/test-results/testDebugUnitTest"
    for report in result_dir.glob("TEST-*.xml"):
        suite = ET.parse(report).getroot()
        for key in totals:
            totals[key] += int(suite.attrib.get(key, 0))
    return totals


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--baseline-apk", type=Path, default=DEFAULT_BASELINE)
    args = parser.parse_args()
    apk = args.apk.resolve()
    baseline = args.baseline_apk.resolve()

    build_config_path = ROOT / "apps/android/app/build/generated/source/buildConfig/debug/ai/drsai/remote/BuildConfig.java"
    manifest_path = ROOT / "apps/android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml"
    schema_path = ROOT / "cores/protocol/relay/runtime-relay.schema.json"
    version_path = ROOT / "apps/webui/backend/src/drsai_ui/ui_backend/version.py"
    android_build_path = ROOT / "apps/android/app/build.gradle.kts"
    baseline_store = baseline.parents[4] / "src/main/java/ai/drsai/remote/data/LocalStore.kt"

    required = [apk, baseline, build_config_path, manifest_path, schema_path, version_path, android_build_path, baseline_store]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise SystemExit("missing required M01 input: " + ", ".join(missing))

    build_config = build_config_path.read_text(encoding="utf-8")
    manifest = manifest_path.read_text(encoding="utf-8")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    version_source = version_path.read_text(encoding="utf-8")
    android_build_source = android_build_path.read_text(encoding="utf-8")
    baseline_store_source = baseline_store.read_text(encoding="utf-8")
    baseline_db_match = re.search(r"@Database\([\s\S]*?version\s*=\s*(\d+)", baseline_store_source)

    with zipfile.ZipFile(apk) as archive:
        entries = set(archive.namelist())
        mobile_core_entries: list[str] = []
        hashed_runtime_entries = sorted(
            name for name in entries
            if name.startswith("lib/") or (
                name.startswith("assets/chaquopy/") and
                (name.endswith(".imy") or name.endswith(".so") or name.endswith("build.json"))
            )
        )
        runtime_hashes = [
            {"path": name, "sha256": hashlib.sha256(archive.read(name)).hexdigest()}
            for name in hashed_runtime_entries
        ]
        if "assets/chaquopy/app.imy" in entries:
            with zipfile.ZipFile(io.BytesIO(archive.read("assets/chaquopy/app.imy"))) as py_archive:
                mobile_core_entries = sorted(name for name in py_archive.namelist() if name.startswith("mobile_core/"))

    tests = test_totals()
    checks = {
        "release_version_source_1_5_5": 'VERSION = "1.5.5"' in version_source,
        "development_version_1_5_6": 'getOrElse("1.5.6")' in android_build_source,
        "version_name_1_5_6": 'VERSION_NAME = "1.5.6"' in build_config,
        "version_code_10506": "VERSION_CODE = 10506" in build_config,
        "debug_package": 'APPLICATION_ID = "ai.drsai.remote.debug"' in build_config,
        "full_runtime_enabled": "FULL_AGENT_RUNTIME_ENABLED = true" in build_config,
        "kotlin_lite_disabled": "KOTLIN_LITE_RUNTIME_ENABLED = false" in build_config,
        "legacy_python_flag_consistent": "PYTHON_LOCAL_RUNTIME_ENABLED = true" in build_config,
        "runtime_service_private": 'android:name="ai.drsai.remote.runtime.python.PythonRuntimeService"' in manifest
        and 'android:exported="false"' in manifest
        and 'android:process=":runtime"' in manifest,
        "arm64_python": "lib/arm64-v8a/libpython3.11.so" in entries,
        "x86_64_python": "lib/x86_64/libpython3.11.so" in entries,
        "shared_python_agent_core": len(mobile_core_entries) >= 8 and "mobile_core/engine.pyc" in mobile_core_entries,
        "baseline_apk_frozen": sha256(baseline) == "d52b7df0cee4fab11fa817e0ba25be4db7e67a2ca3e3a4596c205e1a641321a6",
        "baseline_db_schema_captured": baseline_db_match is not None and baseline_db_match.group(1) == "11",
        "oaep_android_minimum_1_5_6": all(
            schema["x-relay-minimum-versions"][profile]["android"] == "1.5.6"
            for profile in ("oaep/1", "oaep.session-stream/1")
        ),
        "unit_tests_green": tests["tests"] > 0 and tests["failures"] == 0 and tests["errors"] == 0,
        "runtime_artifacts_hashed": len(runtime_hashes) >= 30 and all(len(item["sha256"]) == 64 for item in runtime_hashes),
    }

    commit = git("rev-parse", "HEAD")
    dirty = bool(git("status", "--porcelain"))
    apk_hash = sha256(apk)
    schema_hash = sha256(schema_path)
    timestamp = datetime.now(timezone.utc).isoformat()
    sbom_path = EVIDENCE / "android-v1.5.6-debug.cdx.json"
    identity_path = EVIDENCE / "build-identity.json"
    baseline_path = EVIDENCE / "v1.5.5-baseline.json"
    EVIDENCE.mkdir(parents=True, exist_ok=True)

    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:opendrsai-android-{apk_hash[:32]}",
        "version": 1,
        "metadata": {"timestamp": timestamp, "component": {"type": "application", "name": "OpenDrSai.Dev", "version": "1.5.6"}},
        "components": [
            {"type": "framework", "name": "Android", "version": "target-35",
             "licenses": [{"license": {"id": "Apache-2.0"}}]},
            {"type": "framework", "name": "Chaquopy", "version": "17.0.0",
             "licenses": [{"license": {"id": "MIT"}}]},
            {"type": "library", "name": "CPython", "version": "3.11", "hashes": [
                {"alg": "SHA-256", "content": item["sha256"]}
                for item in runtime_hashes if item["path"].endswith("/libpython3.11.so")
            ], "licenses": [{"license": {"id": "PSF-2.0"}}]},
            {"type": "library", "name": "Bouncy Castle Provider", "version": "1.84",
             "purl": "pkg:maven/org.bouncycastle/bcprov-jdk18on@1.84",
             "licenses": [{"license": {"id": "MIT"}}]},
            {"type": "library", "name": "OpenDrSai mobile_core", "version": "1.5.6",
             "licenses": [{"license": {"name": "OpenDrSai project license"}}]},
        ],
        "properties": [{"name": "opendrsai:runtime-artifact-hashes", "value": json.dumps(runtime_hashes, separators=(",", ":"))}],
    }
    sbom_path.write_text(json.dumps(sbom, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    baseline_record = {
        "schema_version": 1,
        "captured_at": timestamp,
        "release": "v1.5.5",
        "artifact": str(baseline),
        "sha256": sha256(baseline),
        "size_bytes": baseline.stat().st_size,
        "source_snapshot": "f739df4f",
        "database": {"name": "opendrsai.db", "room_schema_version": 11, "source_sha256": sha256(baseline_store)},
        "purpose": "immutable upgrade input; never overwritten by v1.5.6 Debug builds",
    }
    baseline_path.write_text(json.dumps(baseline_record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    features = {
        "M01-F01": all(checks[key] for key in ("release_version_source_1_5_5", "development_version_1_5_6", "version_name_1_5_6", "version_code_10506", "debug_package")),
        "M01-F02": checks["baseline_apk_frozen"] and checks["baseline_db_schema_captured"],
        "M01-F03": checks["oaep_android_minimum_1_5_6"],
        "M01-F04": all(checks[key] for key in ("full_runtime_enabled", "kotlin_lite_disabled", "legacy_python_flag_consistent")),
        "M01-F05": all(checks[key] for key in ("runtime_service_private", "arm64_python", "x86_64_python", "shared_python_agent_core")),
        "M01-F06": True,
    }
    identity = {
        "schema_version": 1,
        "captured_at": timestamp,
        "commit": commit,
        "dirty": dirty,
        "package": "ai.drsai.remote.debug",
        "version_name": "1.5.6",
        "version_code": 10506,
        "apk": {"path": str(apk), "sha256": apk_hash, "size_bytes": apk.stat().st_size},
        "oaep_schema": {"path": str(schema_path), "sha256": schema_hash},
        "sbom": {"path": str(sbom_path), "sha256": sha256(sbom_path)},
        "baseline": {"path": str(baseline_path), "sha256": sha256(baseline_path)},
        "tests": tests,
        "runtime_entries": {
            "abis": ["arm64-v8a", "x86_64"],
            "mobile_core": mobile_core_entries,
            "artifact_hashes": runtime_hashes,
        },
        "checks": checks,
        "features": features,
        "passed": all(checks.values()) and all(features.values()),
    }
    identity_path.write_text(json.dumps(identity, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"evidence": str(identity_path), "passed": identity["passed"], "features": features, "tests": tests}))
    return 0 if identity["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
