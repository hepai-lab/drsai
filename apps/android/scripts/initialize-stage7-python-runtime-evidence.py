"""Initialize honest, identity-bound Stage 7 evidence and an immutable manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPORTS = {
    "recovery-matrix.json": {"result": "pending", "scenarios": []},
    "side-effect-consistency.json": {"result": "pending", "duplicate_user_visible_side_effects": None, "audit_chain": []},
    "ui-critical-journey.json": {"result": "pending", "journeys": []},
    "device-matrix.json": {"result": "pending", "devices": []},
    "device-performance.json": {"result": "pending", "metrics": {
        "cold_start_p95_ms": None, "recovery_interactive_p95_ms": None,
        "foreground_pss_p95_mb": None, "peak_pss_mb": None,
    }},
    "security-scan.json": {"result": "pending", "scans": []},
    "android-security-boundaries.json": {"result": "pending", "checks": {}},
    "trusted-build-audit.json": {"result": "pending", "checks": {}},
    "upgrade-rollback.json": {"result": "pending", "journeys": []},
    "rollout-drill.json": {"result": "pending", "drills": []},
}
PROVENANCE_PENDING = {
    "runner": None, "acceptance_run_id": None, "package_version_code": None,
    "package_version_name": None, "apk_sha256": None, "started_at": None,
    "completed_at": None, "device_ids_sha256": [],
}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def write(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--variant", required=True)
    parser.add_argument("--version-code", type=int, required=True)
    parser.add_argument("--version-name", required=True)
    parser.add_argument("--acceptance-run-id", default=None)
    parser.add_argument("--build-id", default=None)
    args = parser.parse_args()
    repo, apk, output = args.repo.resolve(), args.apk.resolve(), args.output.resolve()
    if not apk.is_file():
        raise SystemExit("apk_missing")
    output.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    identity = {
        "acceptance_run_id": args.acceptance_run_id or str(uuid.uuid4()),
        "git_commit": git(repo, "rev-parse", "HEAD"),
        "git_dirty": bool(git(repo, "status", "--porcelain")),
        "build_id": args.build_id or str(uuid.uuid4()),
        "variant": args.variant,
        "version_code": args.version_code,
        "version_name": args.version_name,
        "apk_sha256": digest(apk),
    }
    known = {f"M{module:02d}-F{feature:02d}" for module in range(1, 9) for feature in range(1, 7)}
    features = [{
        "feature_id": feature_id,
        "requirement_id": feature_id,
        "mapping_version": 2,
        "status": "pending",
        "evidence": {"sources": [], "tests": {}, "reports": []},
    } for feature_id in sorted(known)]
    write(output / "feature-evidence.json", {
        "schema_version": 2, "generated_at": now, "identity": identity,
        "summary": {"total": 48, "passed": 0, "pending": 48},
        "features": features,
    })
    for name, content in REPORTS.items():
        write(output / name, {"schema_version": 2, "generated_at": now, "identity": identity,
                              **content, "provenance": dict(PROVENANCE_PENDING)})

    artifact_names = sorted(name for name in REPORTS if (output / name).is_file()) + ["feature-evidence.json"]
    for optional in ("cyclonedx-sbom.json", "mapping.txt", "rollback-instructions.md"):
        if (output / optional).is_file():
            artifact_names.append(optional)
    manifest = {
        "schema_version": 2, "generated_at": now, "identity": identity,
        "immutable": True,
        "source": {"git_commit": identity["git_commit"], "git_dirty": identity["git_dirty"]},
        "apk": {"path": str(apk), "sha256": identity["apk_sha256"]},
        "artifacts": [{"path": name, "sha256": digest(output / name)} for name in sorted(artifact_names)],
        "rollback_version": None,
        "result": "pending",
    }
    write(output / "release-manifest.json", manifest)
    print(json.dumps({"identity": identity, "reports": len(REPORTS) + 2}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
