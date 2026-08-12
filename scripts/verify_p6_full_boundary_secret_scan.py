#!/usr/bin/env python3
"""Content-free local gate for the P6 eleven-source secret-scan pipeline."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

from assemble_remote_workspace_secret_scan_p5 import BOUNDARY_SOURCES, assemble
from p5_secret_canary import canary_set_sha256, derive_canaries
from scan_remote_workspace_secret_canary import (
    P6_REQUIRED_SOURCES,
    canary_variants,
    run,
    scan_artifact,
)


def _boundary_report(boundary: str, environment_id: str, run_id: str) -> dict:
    value = {
        "schema_version": "p5-secret/1",
        "boundary": boundary,
        "environment_id": environment_id,
        "canary_run_id": run_id,
        "canary_set_sha256": canary_set_sha256(derive_canaries(run_id)),
        "passed": True,
        "matches": 0,
        "raw_artifacts_exported": False,
        "sources": [
            {
                "name": name,
                "status": "clean",
                "bytes_scanned": 32,
                "files_scanned": 1,
            }
            for name in sorted(BOUNDARY_SOURCES[boundary])
        ],
    }
    if boundary == "android":
        value.update({
            "artifact_sha256": "a" * 64,
            "storage_assertions": {
                "android_logs": "sha256_only",
                "android_room": "sha256_only",
                "android_backup": "keystore_encrypted_only",
            },
        })
    return value


def verify() -> dict[str, object]:
    environment_id = "p6-local-isolated"
    run_id = "p6-local-canary-0001"
    values = derive_canaries(run_id)
    variants = canary_variants(values)
    previous = os.environ.get("DRSAI_P6_SECRET_CANARIES")
    try:
        os.environ["DRSAI_P6_SECRET_CANARIES"] = json.dumps(values)
        with tempfile.TemporaryDirectory(prefix="opendrsai-p6-secret-") as raw:
            root = Path(raw)
            clean = root / "clean.bin"
            clean.write_bytes(b"sha256-only-content-free-evidence")
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({
                "profile": "mobile-remote-workspace-p6",
                "artifacts": [
                    {"label": name, "path": str(clean)}
                    for name in sorted(P6_REQUIRED_SOURCES)
                ],
            }), encoding="utf-8")
            report = run(manifest, "DRSAI_P6_SECRET_CANARIES")
            encoded = json.dumps(report, sort_keys=True)
            if not report.get("passed") or report.get("matches") != 0:
                raise RuntimeError("p6_secret_clean_scan_failed")
            if "results" in report or str(root) in encoded \
                    or any(value in encoded for value in values):
                raise RuntimeError("p6_secret_report_exposed_raw_data")

            detected = 0
            for index, variant in enumerate(variants):
                leaked = root / f"encoded-{index}.bin"
                leaked.write_bytes(b"prefix:" + variant + b":suffix")
                if not scan_artifact("encoded", leaked, variants).leaked:
                    raise RuntimeError("p6_secret_encoding_not_detected")
                detected += 1

            empty = root / "empty"
            empty.mkdir()
            try:
                scan_artifact("empty", empty, variants)
            except ValueError:
                pass
            else:
                raise RuntimeError("p6_secret_empty_source_accepted")

            report_paths: dict[str, Path] = {}
            for boundary in ("android", "windows", "relay"):
                path = root / f"{boundary}.json"
                path.write_text(
                    json.dumps(_boundary_report(boundary, environment_id, run_id)),
                    encoding="utf-8",
                )
                report_paths[boundary] = path
            assembled = assemble(
                report_paths,
                environment_id=environment_id,
                canary_run_id=run_id,
            )
            if len(assembled.get("sources", [])) != 11:
                raise RuntimeError("p6_secret_source_coverage_invalid")
    finally:
        if previous is None:
            os.environ.pop("DRSAI_P6_SECRET_CANARIES", None)
        else:
            os.environ["DRSAI_P6_SECRET_CANARIES"] = previous
    return {
        "passed": True,
        "source_count": 11,
        "encoding_mode_count": 6,
        "encoding_variant_count": len(variants),
        "encoding_variants_detected": detected,
        "raw_artifacts_exported": False,
        "missing_or_empty_source_fail_closed": True,
    }


def main() -> int:
    print(json.dumps(verify(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
