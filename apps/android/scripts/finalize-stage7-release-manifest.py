"""Finalize the immutable Stage 7 manifest after every report has been generated."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

EXCLUDED = {"release-manifest.json", "acceptance-verification.json", "go-no-go.md"}


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--source-sbom", type=Path, required=True)
    parser.add_argument("--mapping", type=Path)
    parser.add_argument("--rollback-version", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence, apk = args.evidence.resolve(), args.apk.resolve()
    identity = json.loads(args.identity_from.read_text(encoding="utf-8"))["identity"]
    if digest(apk) != identity.get("apk_sha256"):
        raise SystemExit("manifest_apk_identity_mismatch")
    if not args.source_sbom.is_file():
        raise SystemExit("manifest_sbom_missing")
    artifacts = []
    for path in sorted(item for item in evidence.rglob("*") if item.is_file() and item.name not in EXCLUDED):
        artifacts.append({"path": path.relative_to(evidence).as_posix(), "sha256": digest(path), "bytes": path.stat().st_size})
    external = [{"kind": "sbom", "path": str(args.source_sbom.resolve()), "sha256": digest(args.source_sbom.resolve())}]
    mapping_status = {"status": "not_applicable", "reason": "acceptance_variant_not_minified"}
    if args.mapping:
        if not args.mapping.is_file():
            raise SystemExit("manifest_mapping_missing")
        external.append({"kind": "mapping", "path": str(args.mapping.resolve()), "sha256": digest(args.mapping.resolve())})
        mapping_status = {"status": "included"}
    value = {
        "schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(), "identity": identity,
        "immutable": True, "source": {"git_commit": identity["git_commit"], "git_dirty": identity["git_dirty"]},
        "apk": {"path": str(apk), "sha256": identity["apk_sha256"]},
        "artifacts": artifacts, "external_artifacts": external,
        "mapping": mapping_status, "rollback_version": args.rollback_version, "result": "passed",
    }
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
