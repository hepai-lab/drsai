"""Execute model Provider release gates and bind results to source state."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs" / "model-provider-delivery-manifest.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="include the complete Python suite")
    parser.add_argument("--require-clean", action="store_true", help="fail if any manifest source path is dirty")
    parser.add_argument("--output", type=Path, default=ROOT / "build" / "acceptance" / "model-provider-release-readiness.json")
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    watched_paths = manifest["ownedPaths"] + manifest["sharedPaths"]
    if args.full:
        watched_paths = watched_paths + ["cores/python/packages/drsai/src", "cores/python/packages/drsai/tests", "apps/android/scripts", "scripts"]
    source_files = resolve_source_files(watched_paths)
    fingerprint_before = source_fingerprint(source_files)
    missing = [path for path in manifest["ownedPaths"] + manifest["sharedPaths"] if not (ROOT / path).exists()]
    if missing:
        raise SystemExit(f"Delivery manifest paths are missing: {missing}")

    commands = quick_commands()
    if args.full:
        commands.append(("python-full", [sys.executable, "-m", "pytest", "cores/python/packages/drsai/tests", "-q"], ROOT, 600))
    receipts = [run_gate(name, command, cwd, timeout) for name, command, cwd, timeout in commands]
    source_files_after = resolve_source_files(watched_paths)
    fingerprint_after = source_fingerprint(source_files_after)
    source_changed_during_run = fingerprint_before != fingerprint_after
    dirty = dirty_manifest_paths(manifest["ownedPaths"] + manifest["sharedPaths"])
    gates_passed = all(item["exitCode"] == 0 for item in receipts) and not source_changed_during_run
    external_evidence = external_release_evidence()
    release_ready = gates_passed and not dirty and all(external_evidence.values())
    passed = gates_passed and (not args.require_clean or release_ready)
    evidence = {
        "schemaVersion": 1,
        "testId": "model-provider-release-readiness",
        "passed": passed,
        "localGatesPassed": gates_passed,
        "releaseReady": release_ready,
        "commit": git("rev-parse", "HEAD").strip(),
        "sourceFingerprintSha256": fingerprint_after,
        "sourceFingerprintBeforeSha256": fingerprint_before,
        "sourceChangedDuringRun": source_changed_during_run,
        "sourceFileCount": len(source_files_after),
        "manifestPath": str(MANIFEST.relative_to(ROOT)).replace("\\", "/"),
        "worktreeCleanForManifest": not dirty,
        "dirtyManifestPaths": dirty,
        "requireClean": args.require_clean,
        "fullPythonSuiteIncluded": args.full,
        "commands": receipts,
        "externalEvidence": external_evidence,
        "pendingReleaseRequirements": [name for name, available in external_evidence.items() if not available] + (["clean-reviewed-commit"] if dirty else []),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Model Provider local gates {'passed' if gates_passed else 'failed'}; release ready: {release_ready}; {len(receipts)} gates; evidence: {args.output}")
    if dirty:
        print(f"Manifest worktree has {len(dirty)} dirty paths; use reviewed commits before --require-clean release verification.")
    return 0 if passed else 1


def quick_commands() -> list[tuple[str, list[str], Path, int]]:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    return [
        ("python-model-provider", [sys.executable, "-m", "pytest", "cores/python/packages/drsai/tests", "-k", "model_provider", "-q"], ROOT, 180),
        ("provider-local-matrix", [sys.executable, "scripts/verify_model_provider_compatibility.py", "--local", "--require-all", "--output", "build/acceptance/model-provider-local-deterministic.json"], ROOT, 60),
        ("windows-provider-contract", [npm, "run", "verify:model-provider-config"], ROOT / "apps/desktop/windows", 60),
        ("windows-provider-ui-e2e", [npm, "run", "verify:model-provider-ui-e2e"], ROOT / "apps/desktop/windows", 120),
        ("windows-typecheck", [npm, "run", "typecheck"], ROOT / "apps/desktop/windows", 180),
        ("macos-provider-contract", [npm, "run", "verify:model-provider-macos-contract"], ROOT / "apps/desktop/macos", 60),
    ]


def run_gate(name: str, command: list[str], cwd: Path, timeout: int) -> dict[str, object]:
    started = time.monotonic()
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    output = (result.stdout + result.stderr).replace(str(ROOT), "<repo>")
    return {
        "name": name,
        "command": [Path(command[0]).name, *command[1:]],
        "exitCode": result.returncode,
        "durationMs": round((time.monotonic() - started) * 1000),
        "outputSha256": hashlib.sha256(output.encode()).hexdigest(),
        "outputTail": output[-1200:],
    }


def resolve_source_files(paths: list[str]) -> list[Path]:
    files: set[Path] = set()
    for value in paths:
        path = ROOT / value
        if path.is_file():
            files.add(path)
        elif path.is_dir():
            files.update(item for item in path.rglob("*") if item.is_file() and "__pycache__" not in item.parts)
    return sorted(files)


def source_fingerprint(files: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in files:
        relative = str(path.relative_to(ROOT)).replace("\\", "/")
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def dirty_manifest_paths(paths: list[str]) -> list[str]:
    result = subprocess.run(["git", "status", "--porcelain=v1", "--", *paths], cwd=ROOT, capture_output=True, text=True, check=True)
    return sorted(line[3:].replace("\\", "/") for line in result.stdout.splitlines() if len(line) >= 4)


def external_release_evidence() -> dict[str, bool]:
    checks = {
        "signed-macos-model-provider-gate": [ROOT / "apps/desktop/macos/build/acceptance/model-provider-release-gate.json"],
        "real-provider-compatibility-matrix": [
            ROOT / "build/acceptance/model-provider-real-opt-in.json",
            ROOT / "apps/desktop/macos/build/acceptance/model-provider-real-opt-in.json",
        ],
    }
    result: dict[str, bool] = {}
    for name, paths in checks.items():
        result[name] = False
        for path in paths:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                if name == "real-provider-compatibility-matrix":
                    available = valid_real_provider_evidence(payload)
                else:
                    available = payload.get("passed") is True
                if available:
                    result[name] = True
                    break
            except (OSError, ValueError, TypeError):
                continue
    return result


def valid_real_provider_evidence(payload: object) -> bool:
    if not isinstance(payload, dict) or payload.get("passed") is not True or payload.get("kind") != "hepai-platform":
        return False
    if payload.get("schemaVersion") != 3 or payload.get("providerId") != "hepai":
        return False
    if payload.get("authentication") != "oidc-safe-storage" or payload.get("secretMaterialRecorded") is not False:
        return False
    results = payload.get("results")
    return isinstance(results, list) and bool(results) and all(
        isinstance(row, dict) and row.get("passed") is True and row.get("statusCode") == 200
        and row.get("sawData") is True and row.get("sawDone") is True for row in results
    )


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


if __name__ == "__main__":
    raise SystemExit(main())
