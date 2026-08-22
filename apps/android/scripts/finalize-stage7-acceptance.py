"""Regenerate feature evidence and the immutable manifest after external runs finish."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def run(command: list[str], accepted: set[int] = {0}) -> int:
    result = subprocess.run(command, check=False)
    if result.returncode not in accepted:
        raise SystemExit(result.returncode)
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--source-sbom", type=Path, required=True)
    parser.add_argument("--rollback-version", required=True)
    parser.add_argument("--android-junit", type=Path, action="append", default=[])
    parser.add_argument("--python-junit", type=Path, action="append", default=[])
    parser.add_argument("--junit-index", type=Path, action="append", default=[])
    parser.add_argument("--mapping", type=Path)
    args = parser.parse_args()
    repo, evidence = args.repo.resolve(), args.evidence.resolve()
    scripts = repo / "apps/android/scripts"
    identity_from = evidence / "release-manifest.json"
    feature = evidence / "feature-evidence.json"
    command = [sys.executable, str(scripts / "generate-stage7-feature-evidence.py"),
               "--repo", str(repo), "--evidence", str(evidence), "--identity-from", str(identity_from),
               "--output", str(feature)]
    for path in args.android_junit:
        command += ["--android-junit", str(path.resolve())]
    for path in args.python_junit:
        command += ["--python-junit", str(path.resolve())]
    for path in args.junit_index:
        command += ["--junit-index", str(path.resolve())]
    run(command, {0, 2})
    command = [sys.executable, str(scripts / "finalize-stage7-release-manifest.py"),
               "--evidence", str(evidence), "--identity-from", str(feature), "--apk", str(args.apk.resolve()),
               "--source-sbom", str(args.source_sbom.resolve()), "--rollback-version", args.rollback_version,
               "--output", str(identity_from)]
    if args.mapping:
        command += ["--mapping", str(args.mapping.resolve())]
    run(command)
    return run([sys.executable, str(scripts / "verify-stage7-python-runtime.py"),
                "--evidence", str(evidence), "--apk", str(args.apk.resolve()),
                "--output", str(evidence / "acceptance-verification.json")], {0, 2})


if __name__ == "__main__":
    raise SystemExit(main())
