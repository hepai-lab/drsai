"""Collect and scan Windows Runtime secret surfaces for Mobile V3.

Raw databases, logs, dumps, diagnostics, and one-time canaries remain on the
Windows endpoint.  The output contains only counts and clean/leaked status.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Iterable

from scan_remote_workspace_secret_canary import run as scan


def _link(files: Iterable[Path], destination: Path, *, limit: int = 200) -> int:
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for source in files:
        if count >= limit:
            raise RuntimeError("windows_secret_scan_file_limit_exceeded")
        if not source.is_file():
            continue
        target = destination / f"{count:04d}-{source.name}"
        try:
            os.link(source, target)
        except OSError:
            try:
                shutil.copy2(source, target)
            except OSError as exc:
                raise RuntimeError("windows_secret_scan_copy_failed") from exc
        count += 1
    return count


def _files(roots: Iterable[Path], patterns: tuple[str, ...]) -> list[Path]:
    found: dict[str, Path] = {}
    for root in roots:
        if not root.is_dir():
            continue
        for pattern in patterns:
            for path in root.rglob(pattern):
                if path.is_file():
                    found[str(path.resolve()).casefold()] = path
    return list(found.values())


def collect(
    *,
    state_root: Path,
    evidence_root: Path,
    output: Path,
    canary_environment: str,
) -> dict:
    raw = os.getenv(canary_environment)
    try:
        canary_values = json.loads(raw or "")
    except json.JSONDecodeError as exc:
        raise RuntimeError("windows_secret_canaries_invalid") from exc
    if (
        not isinstance(canary_values, list)
        or not canary_values
        or not all(isinstance(item, str) and len(item) >= 12 for item in canary_values)
    ):
        raise RuntimeError("windows_secret_canaries_invalid")

    source_root = Path(__file__).resolve().parents[1] / "cores/python/packages/drsai/src"
    if str(source_root) not in __import__("sys").path:
        __import__("sys").path.insert(0, str(source_root))
    from drsai.backend.runtime.security import redact_sensitive
    from drsai.relay.runtime_client import RuntimeCredential, RuntimeCredentialStore
    from drsai.relay.security import redact_secrets

    with tempfile.TemporaryDirectory(prefix="opendrsai-v3-windows-secret-") as raw_temp:
        temporary = Path(raw_temp)
        database = temporary / "database"
        logs = temporary / "logs"
        dumps = temporary / "dumps"
        diagnostics = temporary / "diagnostics"

        database_files = _files(
            (state_root / "runtime",),
            ("*.sqlite3", "*.sqlite3-wal", "*.sqlite3-shm", "*.dpapi"),
        )
        if not database_files:
            raise RuntimeError("windows_secret_scan_database_missing")
        _link(database_files, database)
        RuntimeCredentialStore(database / "canary-credential.dpapi").save(
            RuntimeCredential(
                "runtime-secret-scan",
                canary_values[0],
            )
        )

        log_files = _files(
            (state_root / "logs", evidence_root),
            ("*.log",),
        )
        _link(log_files, logs)
        safe_log = redact_secrets(
            "token=" + canary_values[0]
            + " command=" + canary_values[-1]
            + " message=" + canary_values[len(canary_values) // 2]
        )
        (logs / "redaction-canary.log").write_text(safe_log, encoding="utf-8")

        dump_roots = (
            Path(os.getenv("LOCALAPPDATA", "")) / "CrashDumps",
            Path(os.getenv("LOCALAPPDATA", "")) / "OpenDrSai",
            state_root / "logs",
        )
        dump_files = _files(dump_roots, ("*.dmp", "*.mdmp"))
        _link(dump_files, dumps)
        (dumps / "inventory.json").write_text(
            json.dumps({"dump_count": len(dump_files)}),
            encoding="utf-8",
        )

        safe_diagnostic = redact_sensitive(
            {
                "authorization": "Bearer " + canary_values[0],
                "token": canary_values[0],
                "command": "command=" + canary_values[-1],
                "status": "fixture",
            }
        )
        diagnostics.mkdir()
        (diagnostics / "runtime-diagnostic.json").write_text(
            json.dumps(safe_diagnostic, sort_keys=True),
            encoding="utf-8",
        )

        manifest = temporary / "manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "profile": "mobile-remote-workspace-v3-windows",
                    "artifacts": [
                        {"label": "windows_database", "path": str(database)},
                        {"label": "windows_logs", "path": str(logs)},
                        {"label": "windows_dump", "path": str(dumps)},
                        {"label": "diagnostics", "path": str(diagnostics)},
                    ],
                }
            ),
            encoding="utf-8",
        )
        result = scan(manifest, canary_environment)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_suffix(output.suffix + ".tmp")
    temporary_output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    temporary_output.replace(output)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--state-root",
        type=Path,
        default=Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai"))),
    )
    parser.add_argument(
        "--evidence-root",
        type=Path,
        default=Path("release/product-evidence/mobile-remote-workspace-v3"),
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--canary-env", default="DRSAI_SECRET_CANARIES")
    args = parser.parse_args()
    result = collect(
        state_root=args.state_root,
        evidence_root=args.evidence_root,
        output=args.output,
        canary_environment=args.canary_env,
    )
    print(
        json.dumps(
            {
                "passed": result["passed"],
                "matches": result["matches"],
                "sources": result["sources"],
            },
            indent=2,
        )
    )
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
