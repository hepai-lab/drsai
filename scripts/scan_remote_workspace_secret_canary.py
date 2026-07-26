"""Scan release/runtime artifacts for caller-supplied secret canaries.

Canaries are read only from an environment variable so they never appear in a
process command line or the machine-readable report. ZIP/APK members are
inspected after decompression in addition to scanning the container bytes.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from urllib.parse import quote
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import BinaryIO, Iterable


CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class ArtifactResult:
    label: str
    files_scanned: int
    archive_members_scanned: int
    leaked: bool
    leak_locations: tuple[str, ...]


def _contains_canary(stream: BinaryIO, canaries: tuple[bytes, ...]) -> bool:
    overlap = max(map(len, canaries), default=1) - 1
    tail = b""
    while chunk := stream.read(CHUNK_SIZE):
        window = tail + chunk
        if any(canary in window for canary in canaries):
            return True
        tail = window[-overlap:] if overlap else b""
    return False


def _files(path: Path) -> Iterable[Path]:
    if not path.exists():
        raise FileNotFoundError(f"artifact does not exist: {path}")
    if path.is_file():
        yield path
    elif path.is_dir():
        files = tuple(item for item in path.rglob("*") if item.is_file())
        if not files:
            raise ValueError(f"artifact directory is empty: {path}")
        yield from files
    else:
        raise ValueError(f"artifact is not a regular file or directory: {path}")


def scan_artifact(label: str, path: Path, canaries: tuple[bytes, ...]) -> ArtifactResult:
    leaks: list[str] = []
    files_scanned = 0
    members_scanned = 0
    for file in _files(path):
        files_scanned += 1
        relative = file.name if path.is_file() else file.relative_to(path).as_posix()
        with file.open("rb") as stream:
            if _contains_canary(stream, canaries):
                leaks.append(relative)
        if zipfile.is_zipfile(file):
            with zipfile.ZipFile(file) as archive:
                for member in archive.infolist():
                    if member.is_dir():
                        continue
                    members_scanned += 1
                    with archive.open(member) as stream:
                        if _contains_canary(stream, canaries):
                            leaks.append(f"{relative}!/{member.filename}")
    return ArtifactResult(label, files_scanned, members_scanned, bool(leaks), tuple(leaks))


def load_canaries(environment_name: str) -> tuple[bytes, ...]:
    raw = os.getenv(environment_name)
    if not raw:
        raise ValueError(f"{environment_name} is required")
    values = json.loads(raw)
    if (
        not isinstance(values, list)
        or not values
        or not all(isinstance(item, str) and len(item) >= 12 for item in values)
    ):
        raise ValueError(f"{environment_name} must be a non-empty JSON string array")
    return canary_variants(values)


def canary_variants(values: Iterable[str]) -> tuple[bytes, ...]:
    """Return stable plain and commonly serialized encodings for each canary."""
    variants: set[bytes] = set()
    for value in values:
        raw = value.encode("utf-8")
        variants.update({
            raw,
            value.casefold().encode("utf-8"),
            quote(value, safe="").encode("ascii"),
            base64.b64encode(raw),
            base64.urlsafe_b64encode(raw).rstrip(b"="),
            raw.hex().encode("ascii"),
        })
    return tuple(sorted(variants))


def run(manifest: Path, environment_name: str) -> dict:
    definition = json.loads(manifest.read_text(encoding="utf-8"))
    canaries = load_canaries(environment_name)
    results = [
        scan_artifact(str(item["label"]), Path(item["path"]).expanduser(), canaries)
        for item in definition["artifacts"]
    ]
    return {
        "schema_version": 1,
        "manifest_profile": definition.get("profile", "remote-workspace-v2"),
        "artifact_count": len(results),
        "passed": not any(item.leaked for item in results),
        "results": [asdict(item) for item in results],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--canary-env", default="DRSAI_SECRET_CANARIES")
    args = parser.parse_args()
    try:
        report = run(args.manifest, args.canary_env)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        raise SystemExit(f"secret canary scan configuration failed: {error}") from error
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
