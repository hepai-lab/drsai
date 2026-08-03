"""Verify Python rollout flags, APK sizes, and ABI policy across Android variants."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def inspect_apk(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        abis = sorted({name.split("/")[1] for name in archive.namelist() if name.startswith("lib/")})
    return {"path": str(path), "bytes": path.stat().st_size, "abis": abis}


def flag(repo: Path, variant: str) -> bool:
    path = repo / f"apps/android/app/build/generated/source/buildConfig/{variant}/ai/drsai/remote/BuildConfig.java"
    match = re.search(r"PYTHON_LOCAL_RUNTIME_ENABLED\s*=\s*(true|false)", path.read_text(encoding="utf-8"))
    if match is None:
        raise ValueError(f"python_flag_missing:{variant}")
    return match.group(1) == "true"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--debug", type=Path, required=True)
    parser.add_argument("--acceptance", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    variants = {
        "debug": {**inspect_apk(args.debug.resolve()), "python_enabled": flag(repo, "debug")},
        "acceptance": {**inspect_apk(args.acceptance.resolve()), "python_enabled": flag(repo, "acceptance")},
        "release": {**inspect_apk(args.release.resolve()), "python_enabled": flag(repo, "release")},
    }
    checks = {
        "debug_dual_abi": variants["debug"]["abis"] == ["arm64-v8a", "x86_64"],
        "acceptance_dual_abi": variants["acceptance"]["abis"] == ["arm64-v8a", "x86_64"],
        "acceptance_python_enabled": variants["acceptance"]["python_enabled"] is True,
        "release_arm64_only": variants["release"]["abis"] == ["arm64-v8a"],
        "release_python_default_off": variants["release"]["python_enabled"] is False,
        "acceptance_under_90_mib": variants["acceptance"]["bytes"] <= 90 * 1024 * 1024,
    }
    result = {
        "schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
        "variants": variants, "checks": checks,
        "result": "passed" if all(checks.values()) else "failed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result["result"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
