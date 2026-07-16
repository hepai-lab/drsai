"""Install a release-signed Codex artifact into an OpenDrSai Runtime home."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

from drsai.backend.codex_adapter.binary_provider import CodexArtifactStore, load_trusted_publishers


def install_artifact(artifact: Path, trust_store: Path, state_root: Path) -> dict[str, object]:
    codex_root = Path(state_root) / "runtime" / "codex"
    codex_root.mkdir(parents=True, exist_ok=True)
    publishers = load_trusted_publishers(trust_store)
    installed = CodexArtifactStore(codex_root / "artifacts", publishers).install(artifact)
    descriptor, temporary = tempfile.mkstemp(prefix=".trusted-publishers-", dir=codex_root)
    try:
        with os.fdopen(descriptor, "wb") as target, Path(trust_store).open("rb") as source:
            shutil.copyfileobj(source, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, codex_root / "trusted-publishers.json")
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {
        "version": installed.version,
        "source": installed.source,
        "release_safe": installed.release_safe,
        "executable": str(installed.path.relative_to(state_root)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--trust-store", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(install_artifact(args.artifact, args.trust_store, args.state_root), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
