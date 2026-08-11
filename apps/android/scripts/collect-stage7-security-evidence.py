"""Scan APK, captured logcat, and exported app data with fail-closed Stage 7 output."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "bearer": re.compile(rb"(?i)authorization\s*[:=]\s*bearer\s+[a-z0-9._~-]{12,}"),
    "api_key": re.compile(rb"(?i)(?:api[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?[a-z0-9._~-]{16,}"),
    "jwt": re.compile(rb"eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}"),
}
SENSITIVE_RUNTIME_KEYS = re.compile(rb'(?i)"(?:checkpoint|receipt|pythonStateJson)"')
PLAINTEXT_CONTENT = re.compile(rb'(?i)"(?:input|content|uri|path)"\s*:\s*"(?!\[REDACTED\])[^"\r\n]{8,}"')


def load_identity(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    identity = value.get("identity")
    if not isinstance(identity, dict):
        raise ValueError("identity_missing")
    return identity


def scan_bytes(source: str, data: bytes) -> list[dict]:
    findings = [{"source": source, "rule": name} for name, pattern in PATTERNS.items() if pattern.search(data)]
    if source.startswith("app_data") and SENSITIVE_RUNTIME_KEYS.search(data) and PLAINTEXT_CONTENT.search(data):
        findings.append({"source": source, "rule": "checkpoint_receipt_plaintext_content"})
    return findings


def scan_path(label: str, path: Path) -> tuple[str, list[dict], int]:
    if not path.exists():
        return "not_executed", [], 0
    if label == "apk" and path.is_file():
        findings, scanned = [], 0
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.is_dir() or info.file_size > 32 * 1024 * 1024:
                    continue
                scanned += 1
                findings.extend(scan_bytes(f"apk:{info.filename}", archive.read(info)))
        return ("passed" if not findings and scanned else "failed"), findings, scanned
    files = [path] if path.is_file() else [item for item in path.rglob("*") if item.is_file()]
    findings, scanned = [], 0
    for item in files:
        if item.stat().st_size > 32 * 1024 * 1024:
            continue
        scanned += 1
        findings.extend(scan_bytes(f"{label}:{item.name}", item.read_bytes()))
    return ("passed" if not findings else "failed"), findings, scanned


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--identity-from", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--logcat", type=Path, required=True)
    parser.add_argument("--app-data", type=Path)
    parser.add_argument("--device-run", type=Path, required=True)
    parser.add_argument("--adb", type=Path)
    parser.add_argument("--serial")
    parser.add_argument("--package")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    identity = load_identity(args.identity_from)
    device_run = json.loads(args.device_run.read_text(encoding="utf-8"))
    if device_run.get("identity") != identity or device_run.get("result") != "passed":
        raise ValueError("device_run_not_passed_or_identity_mismatch")
    provenance = device_run.get("provenance", {})
    if not provenance.get("runner") or not provenance.get("device_ids_sha256"):
        raise ValueError("device_run_provenance_missing")
    scans, findings = [], []
    for label, path in (("apk", args.apk), ("logcat", args.logcat)):
        status, found, count = scan_path(label, path.resolve())
        scans.append({"source": label, "status": status, "files_scanned": count})
        findings.extend(found)
    if args.app_data:
        status, found, count = scan_path("app_data", args.app_data.resolve())
    else:
        if not args.adb or not args.serial or not args.package:
            raise ValueError("app_data_source_missing")
        completed = subprocess.run(
            [str(args.adb.resolve()), "-s", args.serial, "exec-out", "run-as", args.package, "tar", "-cf", "-", "."],
            capture_output=True, timeout=120,
        )
        if completed.returncode:
            raise RuntimeError(f"app_data_stream_failed:{completed.stderr.decode(errors='replace')[-500:]}")
        found = scan_bytes("app_data:stream.tar", completed.stdout)
        status, count = ("passed" if not found else "failed"), 1
    scans.append({"source": "app_data", "status": status, "files_scanned": count, "mode": "streamed_no_raw_persistence"})
    findings.extend(found)
    result = "passed" if all(item["status"] == "passed" for item in scans) and not findings else (
        "failed" if findings else "pending"
    )
    value = {
        "schema_version": 2, "generated_at": datetime.now(timezone.utc).isoformat(),
        "identity": identity, "provenance": provenance, "scans": scans,
        "checkpoint_receipt_scan": True, "findings": findings, "result": result,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if result == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
