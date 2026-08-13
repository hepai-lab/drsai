from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from p5_legacy_rollback import build_rollback_artifact


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a deterministic, self-verifying P5 Legacy rollback bundle")
    parser.add_argument("output", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).parents[1])
    parser.add_argument("--source-revision")
    args = parser.parse_args()
    revision = args.source_revision
    if revision is None:
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=args.repo_root, check=True,
            capture_output=True, text=True,
        ).stdout.strip()
    manifest = build_rollback_artifact(args.repo_root, args.output, source_revision=revision)
    print(json.dumps({
        "schema_version": manifest["schema_version"],
        "files": len(manifest["files"]),
        "content_sha256": manifest["content_sha256"],
    }, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
