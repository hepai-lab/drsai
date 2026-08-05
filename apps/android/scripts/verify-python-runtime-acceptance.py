"""Evaluate every prototype hard gate and emit a signed-off-style No-Go/Go report."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    features = load(evidence / "feature-evidence.json")
    dependencies = load(evidence / "dependency-compatibility.json")
    parity = load(evidence / "cross-runtime-parity.json")
    security = load(evidence / "security-scan.json")
    performance = load(evidence / "device-performance.json")
    stress = load(evidence / "host-stress.json")
    builds = load(evidence / "build-variants.json")
    apk_bytes = args.apk.stat().st_size if args.apk.is_file() else None
    summary = features.get("summary", {})
    metrics = performance.get("metrics", {})
    performance_environment = performance.get("environment", {})

    gates = [
        ("function_40_of_40", summary.get("passed") == 40),
        ("cross_runtime_exact_parity", parity.get("result") == "passed" and parity.get("match_percent") == 100),
        ("dependency_lock_and_sbom", dependencies.get("result") == "passed"),
        ("host_stress_500_50_20", stress.get("result") == "passed" and stress.get("duplicate_side_effects") == 0),
        ("apk_under_90_mib", apk_bytes is not None and apk_bytes <= 90 * 1024 * 1024),
        ("variant_flags_and_abis", builds.get("result") == "passed"),
        ("three_source_secret_scan", security.get("result") == "passed"),
        ("cold_start_p95_under_3s", isinstance(metrics.get("cold_start_p95_ms"), (int, float)) and metrics["cold_start_p95_ms"] <= 3000),
        ("foreground_pss_p95_under_220mb", isinstance(metrics.get("foreground_pss_p95_mb"), (int, float)) and metrics["foreground_pss_p95_mb"] <= 220),
        ("peak_pss_under_320mb", isinstance(metrics.get("peak_pss_mb"), (int, float)) and metrics["peak_pss_mb"] <= 320),
        ("storage_under_220mb", isinstance(metrics.get("storage_mb"), (int, float)) and metrics["storage_mb"] <= 220),
        ("zero_anr", metrics.get("anr") == 0),
        ("runtime_release_verified", metrics.get("runtime_release_verified") is True),
        (
            "samsung_arm64_physical_device_verified",
            performance_environment.get("physical_samsung_arm64_verified") is True,
        ),
    ]
    blockers = [name for name, passed in gates if not passed]
    decision = "GO" if not blockers else "NO_GO"
    generated = datetime.now(timezone.utc).isoformat()
    verification = {
        "schema_version": 1, "generated_at": generated, "decision": decision,
        "gates": [{"id": name, "status": "passed" if passed else "failed"} for name, passed in gates],
        "blockers": blockers, "apk_bytes": apk_bytes,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(verification, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    markdown = [
        "# Android Shared Python Runtime Go/No-Go",
        "",
        f"- Decision: **{decision.replace('_', ' ')}**",
        f"- Generated: `{generated}`",
        f"- APK bytes: `{apk_bytes}`",
        "",
        "## Hard gates",
        "",
        *[f"- [{'x' if passed else ' '}] `{name}`" for name, passed in gates],
        "",
        "## Blockers",
        "",
        *([f"- `{name}`" for name in blockers] or ["- None"]),
        "",
        "Beta rollout remains disabled until every hard gate passes.",
    ]
    (args.output.parent / "go-no-go.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
    return 0 if decision == "GO" else 2


if __name__ == "__main__":
    raise SystemExit(main())
