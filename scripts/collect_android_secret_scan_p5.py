"""Collect a P5 Android endpoint attestation without exporting raw artifacts."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


REPORT_PATTERNS = (
    r"P5_ANDROID_SECRET_REPORT=(\{[^\r\n]+\})",
    r"INSTRUMENTATION_STATUS: p5AndroidSecretReport=(\{[^\r\n]+\})",
)


def collect(args: argparse.Namespace) -> dict:
    command = [args.adb, "-s", args.device, "shell", "am", "instrument", "-w", "-r",
               "-e", "class", "ai.drsai.remote.P5ReleaseSecretScanTest",
               f"{args.test_package}/{args.runner}"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout, check=False)
    output = result.stdout + "\n" + result.stderr
    matches = [match for pattern in REPORT_PATTERNS for match in re.findall(pattern, output)]
    if result.returncode or "FAILURES!!!" in output or not matches:
        raise RuntimeError("p5_android_endpoint_scan_failed")
    try:
        endpoint = json.loads(matches[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("p5_android_endpoint_report_invalid") from exc
    if endpoint.get("schema_version") != "p5-android-endpoint/1" or endpoint.get("passed") is not True \
            or endpoint.get("matches") != 0 or endpoint.get("debuggable") is not False \
            or endpoint.get("backup_disabled") is not True:
        raise RuntimeError("p5_android_endpoint_report_invalid")
    if endpoint.get("physical") is not True and not args.allow_non_physical:
        raise RuntimeError("p5_android_physical_device_required")
    sources = endpoint.get("sources")
    artifact_sha256 = endpoint.get("artifact_sha256")
    if not isinstance(artifact_sha256, str) or len(artifact_sha256) != 64 \
            or any(ch not in "0123456789abcdef" for ch in artifact_sha256):
        raise RuntimeError("p5_android_endpoint_artifact_invalid")
    expected = {"android_apk", "android_logs", "android_room", "android_backup"}
    if not isinstance(sources, list) or {row.get("name") for row in sources if isinstance(row, dict)} != expected:
        raise RuntimeError("p5_android_endpoint_sources_invalid")
    if any(row.get("status") != "clean" or int(row.get("bytes_scanned", 0)) <= 0
           or int(row.get("files_scanned", 0)) <= 0 for row in sources):
        raise RuntimeError("p5_android_endpoint_source_not_clean")
    report = {
        "schema_version": "p5-secret/1", "boundary": "android",
        "environment_id": args.environment_id, "canary_run_id": args.canary_run_id,
        "passed": True, "matches": 0, "raw_artifacts_exported": False,
        "artifact_sha256": artifact_sha256, "sources": sources,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", required=True)
    parser.add_argument("--adb", default=str(Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"))
    parser.add_argument("--test-package", default="ai.drsai.remote.test")
    parser.add_argument("--runner", default="androidx.test.runner.AndroidJUnitRunner")
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--canary-run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--allow-non-physical", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    print(json.dumps(collect(args), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
