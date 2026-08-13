"""Scan release/runtime artifacts for caller-supplied secret canaries.

Canaries are read only from an environment variable so they never appear in a
process command line or the machine-readable report. ZIP/APK members are
inspected after decompression in addition to scanning the container bytes.
"""
from __future__ import annotations

import argparse
import base64
from collections import deque
import json
import os
from urllib.parse import quote
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterable


CHUNK_SIZE = 1024 * 1024
V3_REQUIRED_SOURCES = {
    "android_apk",
    "android_logs",
    "android_room",
    "windows_database",
    "windows_logs",
    "windows_dump",
    "relay_logs",
    "relay_redis",
    "relay_postgres",
    "diagnostics",
}
P6_REQUIRED_SOURCES = {
    "android_apk",
    "android_logs",
    "android_room",
    "android_backup",
    "windows_database",
    "windows_dpapi",
    "windows_logs",
    "windows_dump",
    "relay_postgres",
    "relay_redis",
    "relay_logs",
}


@dataclass(frozen=True)
class ArtifactResult:
    label: str
    files_scanned: int
    archive_members_scanned: int
    bytes_scanned: int
    leaked: bool
    leak_locations: tuple[str, ...]


class _StreamingMultiPatternMatcher:
    """Aho-Corasick matcher with state preserved across fixed-size chunks."""

    def __init__(self, patterns: tuple[bytes, ...]) -> None:
        unique = tuple(dict.fromkeys(patterns))
        if not unique or any(not pattern for pattern in unique):
            raise ValueError("secret canary patterns must be non-empty")
        self._next: list[dict[int, int]] = [{}]
        self._fail = [0]
        self._match = [False]
        for pattern in unique:
            state = 0
            for value in pattern:
                state = self._next[state].setdefault(value, len(self._next))
                if state == len(self._next):
                    self._next.append({})
                    self._fail.append(0)
                    self._match.append(False)
            self._match[state] = True
        pending: deque[int] = deque(self._next[0].values())
        while pending:
            state = pending.popleft()
            for value, target in self._next[state].items():
                pending.append(target)
                fallback = self._fail[state]
                while fallback and value not in self._next[fallback]:
                    fallback = self._fail[fallback]
                self._fail[target] = self._next[fallback].get(value, 0)
                self._match[target] = self._match[target] or self._match[self._fail[target]]

    def contains(self, stream: BinaryIO) -> bool:
        state = 0
        while chunk := stream.read(CHUNK_SIZE):
            for value in chunk:
                while state and value not in self._next[state]:
                    state = self._fail[state]
                state = self._next[state].get(value, 0)
                if self._match[state]:
                    return True
        return False


def _contains_canary(stream: BinaryIO, canaries: tuple[bytes, ...]) -> bool:
    return _StreamingMultiPatternMatcher(canaries).contains(stream)


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
    bytes_scanned = 0
    for file in _files(path):
        files_scanned += 1
        bytes_scanned += file.stat().st_size
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
                    bytes_scanned += member.file_size
                    with archive.open(member) as stream:
                        if _contains_canary(stream, canaries):
                            leaks.append(f"{relative}!/{member.filename}")
    return ArtifactResult(
        label,
        files_scanned,
        members_scanned,
        bytes_scanned,
        bool(leaks),
        tuple(leaks),
    )


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
    artifacts = definition.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        raise ValueError("artifact manifest must contain a non-empty artifacts array")
    labels = [
        str(item.get("label", ""))
        for item in artifacts
        if isinstance(item, dict)
    ]
    if len(labels) != len(artifacts) or any(not label for label in labels):
        raise ValueError("every artifact must have a non-empty label")
    if len(set(labels)) != len(labels):
        raise ValueError("artifact labels must be unique")
    if definition.get("profile") == "mobile-remote-workspace-v3":
        missing = V3_REQUIRED_SOURCES - set(labels)
        if missing:
            raise ValueError(
                "mobile V3 secret sources missing: " + ",".join(sorted(missing))
            )
    if definition.get("profile") == "mobile-remote-workspace-p6":
        missing = P6_REQUIRED_SOURCES - set(labels)
        extra = set(labels) - P6_REQUIRED_SOURCES
        if missing or extra:
            raise ValueError(
                "mobile P6 secret source set invalid: missing="
                + ",".join(sorted(missing))
                + ";extra="
                + ",".join(sorted(extra))
            )
    results = [
        scan_artifact(str(item["label"]), Path(item["path"]).expanduser(), canaries)
        for item in artifacts
    ]
    matches = sum(len(item.leak_locations) for item in results)
    return {
        "schema_version": 1,
        "manifest_profile": definition.get("profile", "remote-workspace-v2"),
        "artifact_count": len(results),
        "passed": matches == 0,
        "matches": matches,
        "sources": [
            {
                "name": item.label,
                "status": "leaked" if item.leaked else "clean",
                "bytes_scanned": item.bytes_scanned,
                "files_scanned": item.files_scanned,
                "archive_members_scanned": item.archive_members_scanned,
            }
            for item in results
        ],
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
