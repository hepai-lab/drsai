#!/usr/bin/env python3
"""Verify P6 Android backup denial and Windows Runtime secret-at-rest boundary."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

from drsai.relay.device_identity import WindowsDpapiProtector
from drsai.relay.runtime_client import RuntimeCredential, RuntimeCredentialStore


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "apps/android/app/src/main/AndroidManifest.xml"
BACKUP_RULES = ROOT / "apps/android/app/src/main/res/xml/backup_rules.xml"
EXTRACTION_RULES = ROOT / "apps/android/app/src/main/res/xml/data_extraction_rules.xml"
TOKEN_STORE = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/data/LocalStore.kt"
DEVICE_PROOF = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/security/RelayDeviceProof.kt"
RUN_LEDGER = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteRunControlLedger.kt"
APPROVAL_LEDGER = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteApprovalDecisionLedger.kt"
RUNTIME_CREDENTIAL = ROOT / "cores/python/packages/drsai/src/drsai/relay/runtime_client.py"
ANDROID_DEVICE_TEST = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/RemoteSensitiveStorageInstrumentedTest.kt"

DOMAINS = (
    "root", "file", "database", "sharedpref", "external",
    "device_root", "device_file", "device_database", "device_sharedpref",
)


def verify() -> dict[str, object]:
    manifest = MANIFEST.read_text(encoding="utf-8")
    backup = BACKUP_RULES.read_text(encoding="utf-8")
    extraction = EXTRACTION_RULES.read_text(encoding="utf-8")
    sources = {
        "token": TOKEN_STORE.read_text(encoding="utf-8"),
        "proof": DEVICE_PROOF.read_text(encoding="utf-8"),
        "run": RUN_LEDGER.read_text(encoding="utf-8"),
        "approval": APPROVAL_LEDGER.read_text(encoding="utf-8"),
        "runtime": RUNTIME_CREDENTIAL.read_text(encoding="utf-8"),
        "device_test": ANDROID_DEVICE_TEST.read_text(encoding="utf-8"),
    }
    for marker in (
        'android:allowBackup="false"',
        'android:dataExtractionRules="@xml/data_extraction_rules"',
        'android:fullBackupContent="@xml/backup_rules"',
    ):
        if marker not in manifest:
            raise ValueError(f"p6_sensitive_storage_manifest_missing:{marker}")
    for domain in DOMAINS:
        marker = f'<exclude domain="{domain}" path="." />'
        if backup.count(marker) != 1 or extraction.count(marker) != 2:
            raise ValueError(f"p6_sensitive_storage_backup_domain_missing:{domain}")
    required = {
        "token": ("EncryptedSharedPreferences.create", "MasterKey.KeyScheme.AES256_GCM"),
        "proof": ("EncryptedSharedPreferences.create", "MasterKey.KeyScheme.AES256_GCM"),
        "run": ("EncryptedSharedPreferences.create", "never the user message", "MAX_RECORD_BYTES"),
        "approval": ("EncryptedSharedPreferences.create", "content-free ledger", "MAX_RECORD_BYTES"),
        "runtime": ("WindowsDpapiProtector", "temporary.chmod(0o600)", "temporary.replace(self.path)"),
        "device_test": (
            "InstrumentationRegistry.getInstrumentation()",
            "instrumentation.targetContext",
            'val prefix = "p6_sensitive_probe_"',
            "override fun getSharedPreferences",
            "actual credential/ledger files are",
            "p6_sensitive_storage_sources_empty",
            "assertFalse(bytes.containsSubsequence(canary))",
            "runs.clearSubject(subject)",
            "approvals.clearSubject(subject)",
            "redirectedNames.forEach(targetContext::deleteSharedPreferences)",
        ),
    }
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_sensitive_storage_marker_missing:{name}:{marker}")
    forbidden_ledger_fields = (
        '.put("message"', '.put("content"', '.put("tool_arguments"',
        '.put("response_body"', '.put("token"',
    )
    for name in ("run", "approval"):
        for marker in forbidden_ledger_fields:
            if marker in sources[name]:
                raise ValueError(f"p6_sensitive_storage_ledger_content_forbidden:{name}:{marker}")

    live_dpapi = os.name == "nt"
    if live_dpapi:
        canary = "p6-runtime-token-canary-4c83e81c"
        runtime_id = "runtime-sensitive-storage-canary"
        with tempfile.TemporaryDirectory(prefix="p6-dpapi-") as directory:
            path = Path(directory) / "credential.dpapi"
            store = RuntimeCredentialStore(path, WindowsDpapiProtector())
            expected = RuntimeCredential(runtime_id, canary)
            store.save(expected)
            ciphertext = path.read_bytes()
            if canary.encode() in ciphertext or runtime_id.encode() in ciphertext:
                raise ValueError("p6_sensitive_storage_dpapi_plaintext")
            if store.load() != expected:
                raise ValueError("p6_sensitive_storage_dpapi_roundtrip")
            path.write_bytes(ciphertext[:-1] + bytes([ciphertext[-1] ^ 1]))
            try:
                store.load()
            except Exception:
                pass
            else:
                raise ValueError("p6_sensitive_storage_dpapi_tamper_accepted")
    return {
        "android_backup_domains": len(DOMAINS),
        "android_secure_stores": 4,
        "content_free_ledgers": True,
        "windows_dpapi_live": live_dpapi,
        "windows_dpapi_tamper_rejected": live_dpapi,
        "passed": True,
    }


def main() -> int:
    try:
        result = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
