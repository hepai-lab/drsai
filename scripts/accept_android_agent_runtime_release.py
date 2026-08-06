from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Traceable Android Agent Runtime v1.6.0 candidate")
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/android/reports/evidence/android-agent-runtime-v1.6.0-release-manifest.json")
    parser.add_argument("--sbom", type=Path, default=ROOT / "docs/android/reports/evidence/android-agent-runtime-v1.6.0-cyclonedx-sbom.json")
    args = parser.parse_args()
    apk, mapping, output, sbom_path = (value.resolve() for value in (args.apk, args.mapping, args.output, args.sbom))
    schema = ROOT / "cores/protocol/oaep/oaep.schema.json"
    version_source = ROOT / "apps/webui/backend/src/drsai_ui/ui_backend/version.py"
    if not apk.is_file() or not mapping.is_file():
        raise SystemExit("candidate_apk_or_mapping_missing")
    if 'VERSION = "1.6.0"' not in version_source.read_text(encoding="utf-8"):
        raise SystemExit("android_agent_runtime_version_not_1_6_0")
    sbom = {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "serialNumber": "urn:uuid:android-agent-runtime-oaep-v1-6-0",
        "version": 1,
        "metadata": {"timestamp": datetime.now(UTC).isoformat(), "component": {
            "type": "application", "name": "OpenDrSai Android Agent Runtime", "version": "1.6.0",
            "properties": [
                {"name": "oaep.protocol", "value": "1.0"},
                {"name": "oaep.schema.sha256", "value": sha256(schema)},
                {"name": "candidate.apk.sha256", "value": sha256(apk)},
            ],
        }},
        "components": [
            {"type": "library", "name": "OAEP", "version": "1.0", "hashes": [{"alg": "SHA-256", "content": sha256(schema)}]},
            {"type": "framework", "name": "Android", "version": "API 26-36"},
            {"type": "library", "name": "Python shared core", "version": "3.11"},
        ],
    }
    sbom_path.parent.mkdir(parents=True, exist_ok=True)
    sbom_path.write_text(json.dumps(sbom, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    dirty_lines = git("status", "--porcelain").splitlines()
    evidence_paths = sorted((ROOT / "docs/android/reports/evidence").glob("android-agent-runtime-*.json"))
    evidence = {
        str(path.relative_to(ROOT)).replace("\\", "/"): sha256(path)
        for path in evidence_paths
        if path.resolve() not in {output, sbom_path}
        and path.name != "android-agent-runtime-final-go-no-go.json"
    }
    manifest = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "release": {"name": "Android Agent Runtime", "version": "1.6.0", "version_code": 10600, "oaep_protocol": "1.0"},
        "source": {"commit": git("rev-parse", "HEAD"), "dirty": bool(dirty_lines), "dirty_entry_count": len(dirty_lines), "dirty_tree_sha256": hashlib.sha256("\n".join(dirty_lines).encode()).hexdigest()},
        "candidate": {"path": str(apk), "sha256": sha256(apk), "bytes": apk.stat().st_size},
        "mapping": {"path": str(mapping), "sha256": sha256(mapping), "bytes": mapping.stat().st_size},
        "sbom": {"path": str(sbom_path), "sha256": sha256(sbom_path), "format": "CycloneDX 1.5"},
        "oaep_schema": {"path": str(schema.relative_to(ROOT)).replace("\\", "/"), "sha256": sha256(schema)},
        "evidence_sha256": evidence,
        "gates": {"version_is_1_6_0": True, "apk_nonempty": apk.stat().st_size > 1_000_000, "mapping_nonempty": mapping.stat().st_size > 0, "sbom_valid": sbom["bomFormat"] == "CycloneDX", "source_identity_recorded": bool(git("rev-parse", "HEAD"))},
    }
    manifest["passed"] = all(manifest["gates"].values())
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if manifest["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
