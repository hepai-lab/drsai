#!/usr/bin/env python3
"""Fail-closed Android APK identity and signature inspection for P5 evidence."""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
from typing import Any
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SIGNER_POLICY = ROOT / "cores/protocol/relay/p5-android-release-signers.json"
PACKAGE_PATTERN = re.compile(
    r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'"
)
CERT_PATTERN = re.compile(r"Signer #1 certificate SHA-256 digest:\s*([0-9A-Fa-f]{64})")
DN_PATTERN = re.compile(r"Signer #1 certificate DN:\s*(.+)")
TARGET_PATTERN = re.compile(r'A:\s+android:targetPackage[^=]*="([^"]+)"')


class ApkVerificationError(RuntimeError):
    pass


def _sdk_root() -> Path:
    for value in (os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT")):
        if value and Path(value).is_dir():
            return Path(value)
    properties = ROOT / "apps/android/local.properties"
    if properties.is_file():
        for line in properties.read_text(encoding="utf-8").splitlines():
            if line.startswith("sdk.dir="):
                candidate = Path(line[8:].replace(r"\:", ":").replace(r"\\", "\\"))
                if candidate.is_dir():
                    return candidate
    fallback = Path.home() / "AppData/Local/Android/Sdk"
    if fallback.is_dir():
        return fallback
    raise ApkVerificationError("p5_android_sdk_missing")


def _tools() -> tuple[Path, Path]:
    directories = sorted(
        (path for path in (_sdk_root() / "build-tools").iterdir() if path.is_dir()),
        key=lambda path: tuple(int(part) if part.isdigit() else 0 for part in path.name.split(".")),
        reverse=True,
    )
    for directory in directories:
        aapt = directory / ("aapt.exe" if os.name == "nt" else "aapt")
        signer = directory / ("apksigner.bat" if os.name == "nt" else "apksigner")
        if aapt.is_file() and signer.is_file():
            return aapt, signer
    raise ApkVerificationError("p5_android_build_tools_missing")


def _run(command: list[str]) -> str:
    environment = dict(os.environ)
    java_home = environment.get("JAVA_HOME")
    if not java_home or not (Path(java_home) / ("bin/java.exe" if os.name == "nt" else "bin/java")).is_file():
        bundled = Path(r"C:\Program Files\Android\Android Studio\jbr") if os.name == "nt" \
            else Path("/opt/android-studio/jbr")
        if (bundled / ("bin/java.exe" if os.name == "nt" else "bin/java")).is_file():
            environment["JAVA_HOME"] = str(bundled)
    result = subprocess.run(
        command, cwd=ROOT, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120,
        env=environment,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise ApkVerificationError("p5_android_apk_tool_failed")
    return result.stdout


def inspect_android_apk(
    apk: Path, *, expected_package: str, expected_target_package: str | None = None,
) -> dict[str, Any]:
    if not apk.is_file() or apk.stat().st_size <= 0:
        raise ApkVerificationError("p5_android_apk_missing")
    try:
        with zipfile.ZipFile(apk) as archive:
            if "AndroidManifest.xml" not in archive.namelist() or archive.testzip() is not None:
                raise ApkVerificationError("p5_android_apk_zip_invalid")
    except (OSError, zipfile.BadZipFile) as exc:
        raise ApkVerificationError("p5_android_apk_zip_invalid") from exc

    aapt, signer = _tools()
    badging = _run([str(aapt), "dump", "badging", str(apk.resolve())])
    package_match = PACKAGE_PATTERN.search(badging)
    if package_match is None:
        raise ApkVerificationError("p5_android_apk_metadata_invalid")
    package_name, version_code, version_name = package_match.groups()
    if package_name != expected_package:
        raise ApkVerificationError("p5_android_apk_package_mismatch")

    signature = _run([str(signer), "verify", "--print-certs", str(apk.resolve())])
    cert_match = CERT_PATTERN.search(signature)
    dn_match = DN_PATTERN.search(signature)
    if cert_match is None or dn_match is None:
        raise ApkVerificationError("p5_android_apk_signature_invalid")
    target_package = None
    if expected_target_package is not None:
        tree = _run([str(aapt), "dump", "xmltree", str(apk.resolve()), "AndroidManifest.xml"])
        target_match = TARGET_PATTERN.search(tree)
        if target_match is None or target_match.group(1) != expected_target_package:
            raise ApkVerificationError("p5_android_test_target_mismatch")
        target_package = target_match.group(1)
    return {
        "package_name": package_name,
        "version_code": int(version_code),
        "version_name": version_name,
        "signing_cert_sha256": cert_match.group(1).lower(),
        "signer_dn": dn_match.group(1).strip(),
        "target_package": target_package,
    }


def release_signer_policy_sha256() -> str:
    import hashlib
    return hashlib.sha256(SIGNER_POLICY.read_bytes()).hexdigest()


def release_signer_is_trusted(cert_sha256: object, signer_dn: object) -> bool:
    import json
    if not isinstance(cert_sha256, str) or not isinstance(signer_dn, str) \
            or re.search(r"(?:^|,)\s*CN=Android Debug(?:,|$)", signer_dn, re.IGNORECASE):
        return False
    try:
        value = json.loads(SIGNER_POLICY.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    if not isinstance(value, dict) or set(value) != {
        "schema_version", "status", "allowed_cert_sha256",
    } or value.get("schema_version") != "p5-android-release-signers/1" \
            or value.get("status") != "active":
        return False
    allowed = value.get("allowed_cert_sha256")
    return isinstance(allowed, list) and bool(allowed) \
        and len(allowed) == len(set(allowed)) \
        and all(isinstance(item, str) and re.fullmatch(r"[0-9a-f]{64}", item)
                for item in allowed) \
        and cert_sha256 in allowed
