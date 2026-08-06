from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import zipfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android"
MARKER = "STAGE8_OAEP_SECURITY"
GENERIC_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "bearer": re.compile(rb"(?i)authorization\s*[:=]\s*bearer\s+[a-z0-9._~-]{12,}"),
    "api_key": re.compile(rb"(?i)(?:api[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?[a-z0-9._~-]{16,}"),
    "jwt": re.compile(rb"eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}"),
}


def run(command: list[str], *, timeout: int = 240, binary: bool = False):
    return subprocess.run(
        command, check=True, timeout=timeout, capture_output=True,
        text=not binary, encoding=None if binary else "utf-8",
        errors=None if binary else "replace", creationflags=subprocess.CREATE_NO_WINDOW,
    ).stdout


def variants(value: str) -> tuple[bytes, ...]:
    raw = value.encode()
    return raw, base64.b64encode(raw), base64.urlsafe_b64encode(raw).rstrip(b"=")


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 8 OAEP security gate")
    parser.add_argument("--serial", required=True)
    parser.add_argument(
        "--output",
        default=str(ROOT / "docs/android/reports/evidence/android-agent-runtime-security.json"),
    )
    args = parser.parse_args()
    sdk = Path(os.environ.get("ANDROID_HOME", Path.home() / "AppData/Local/Android/Sdk"))
    adb = sdk / "platform-tools/adb.exe"
    base = [str(adb), "-s", args.serial]
    app_apk = next((ANDROID / "app/build/outputs/apk/debug").glob("OpenDrSai-Android-*.apk"))
    test_apk = next((ANDROID / "app/build/outputs/apk/androidTest/debug").glob("*.apk"))
    token = "stage8-token-" + secrets.token_urlsafe(24)
    absolute_path = f"C:\\Users\\stage8-{secrets.token_hex(8)}\\secret.txt"
    private_text = "stage8-private-" + secrets.token_urlsafe(24)
    canaries = variants(token) + variants(absolute_path) + variants(private_text)

    run(base + ["install", "-r", "-t", str(app_apk)], timeout=180)
    run(base + ["install", "-r", "-t", str(test_apk)], timeout=180)
    run(base + ["logcat", "-c"], timeout=30)
    security_classes = ",".join((
        "ai.drsai.remote.AndroidOaepStage8SecurityTest",
        "ai.drsai.remote.FullRuntimeToolRegistryInstrumentedTest",
        "ai.drsai.remote.AndroidOaepStage8StressTest",
    ))
    output = run(base + [
        "shell", "am", "instrument", "-w", "-r",
        "-e", "class", security_classes,
        "-e", "tokenCanary", token,
        "-e", "pathCanary", absolute_path,
        "-e", "privateCanary", private_text,
        "ai.drsai.remote.debug.test/androidx.test.runner.AndroidJUnitRunner",
    ], timeout=180)
    if "OK (5 tests)" not in output:
        raise RuntimeError("stage8_security_instrumentation_failed:\n" + output[-4000:])
    external = subprocess.run(
        base + [
            "shell", "am", "startservice", "-n",
            "ai.drsai.remote.debug/ai.drsai.remote.runtime.python.PythonRuntimeService",
        ],
        timeout=30, capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    external_output = external.stdout + external.stderr
    external_service_rejected = external.returncode != 0 and "not exported" in external_output.lower()
    logcat = run(base + ["logcat", "-d", "-v", "threadtime"], timeout=60).encode()
    app_data = run(base + [
        "exec-out", "run-as", "ai.drsai.remote.debug", "tar", "-cf", "-", ".",
    ], timeout=120, binary=True)
    dynamic_findings = {
        source: sum(1 for canary in canaries if canary in blob)
        for source, blob in {"apk": app_apk.read_bytes(), "logcat": logcat, "app_data": app_data}.items()
    }
    generic_findings: list[dict[str, str]] = []
    with zipfile.ZipFile(app_apk) as archive:
        for info in archive.infolist():
            if info.is_dir() or info.file_size > 32 * 1024 * 1024:
                continue
            data = archive.read(info)
            for rule, pattern in GENERIC_PATTERNS.items():
                if pattern.search(data):
                    generic_findings.append({"entry": info.filename, "rule": rule})
    marker = re.findall(rf"{MARKER}:\s*(\{{.*\}})", logcat.decode(errors="replace"))
    if not marker:
        raise RuntimeError("stage8_security_marker_missing")
    device_checks = json.loads(marker[-1])
    evidence_dir = ROOT / "docs/android/reports/evidence/v1.5.6"
    osv_path = evidence_dir / "osv-maven-scan.json"
    sbom_path = evidence_dir / "android-v1.5.6-debug.cdx.json"
    osv = json.loads(osv_path.read_text(encoding="utf-8")) if osv_path.is_file() else {}
    sbom = json.loads(sbom_path.read_text(encoding="utf-8")) if sbom_path.is_file() else {}
    components = sbom.get("components", [])
    runtime_hash_property = next(
        (item.get("value", "") for item in sbom.get("properties", [])
         if item.get("name") == "opendrsai:runtime-artifact-hashes"),
        "",
    )
    supply_chain_green = (
        osv.get("passed") is True
        and len(osv.get("packages", [])) >= 100
        and components
        and all(component.get("licenses") for component in components)
        and len(json.loads(runtime_hash_property or "[]")) >= 30
    )
    gates = {
        "oaep_no_token_or_absolute_path": device_checks.get("oaep_token_findings") == 0
        and device_checks.get("oaep_absolute_path_findings") == 0,
        "checkpoint_receipt_no_token": device_checks.get("checkpoint_receipt_token_findings") == 0,
        "cross_account_isolation": device_checks.get("cross_account_reads") == 0,
        "dynamic_canary_absent_from_apk_logcat_app_data": all(value == 0 for value in dynamic_findings.values()),
        "apk_generic_secret_scan": not generic_findings,
        "external_runtime_service_rejected": external_service_rejected,
        "supply_chain_sbom_hashes_licenses_osv": supply_chain_green,
    }
    features = {
        "M09-F01": external_service_rejected,
        "M09-F02": device_checks.get("oaep_token_findings") == 0
        and device_checks.get("oaep_absolute_path_findings") == 0,
        "M09-F03": "forgedSafCapabilityStillFailsClosedWithoutPersistedGrant" in output,
        "M09-F04": gates["dynamic_canary_absent_from_apk_logcat_app_data"]
        and gates["oaep_no_token_or_absolute_path"],
        "M09-F05": "five_hundred_runs_fifty_tools_and_twenty_recoveries_remain_consistent" in output,
        "M09-F06": supply_chain_green,
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "serial": args.serial,
        "apk": app_apk.name,
        "apk_sha256": hashlib.sha256(app_apk.read_bytes()).hexdigest(),
        "package": "ai.drsai.remote.debug",
        "version": "1.5.6",
        "dynamic_findings": dynamic_findings,
        "generic_apk_findings": generic_findings,
        "device_checks": device_checks,
        "gates": gates,
        "features": features,
        "passed": all(features.values()),
        "status": "passed" if all(features.values()) else "awaiting_supply_chain_gate",
    }
    path = Path(args.output).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    # Security behavior can pass independently while the supply-chain scan remains a
    # separate release gate.
    return 0 if all(features[key] for key in ("M09-F01", "M09-F02", "M09-F03", "M09-F04", "M09-F05")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
