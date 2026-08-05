"""Verify the clean-checkout candidate identity before feature evidence is generated."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo, apk = args.repo.resolve(), args.apk.resolve()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    dirty = bool(subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], text=True).strip())
    checks = {
        "clean_checkout": not dirty and identity.get("git_dirty") is False,
        "commit_bound": identity.get("git_commit") == commit,
        "acceptance_variant": identity.get("variant") == "acceptance",
        "apk_hash_bound": apk.is_file() and digest(apk) == identity.get("apk_sha256"),
        "candidate_builder_present": (repo / "apps/android/scripts/build-stage7-runtime-candidate.ps1").is_file(),
        "schema_present": (repo / "cores/protocol/android-runtime/stage7-evidence.schema.json").is_file(),
    }
    value = {"schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(),
             "identity": identity, "checks": checks, "result": "passed" if all(checks.values()) else "failed"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    return 0 if value["result"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
