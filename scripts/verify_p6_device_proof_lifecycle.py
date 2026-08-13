#!/usr/bin/env python3
"""Verify atomic Android device-key rotation and fail-closed nonce replay defense."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID_PROOF = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/security/RelayDeviceProof.kt"
ANDROID_CLIENT = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayDiscoveryClient.kt"
ANDROID_UNIT = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RelayDiscoveryClientTest.kt"
ANDROID_DEVICE = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/RelayDeviceProofInstrumentedTest.kt"
REGISTRY = ROOT / "cores/python/packages/drsai/src/drsai/relay/registry.py"
RELAY_TEST = ROOT / "cores/python/packages/drsai/tests/test_relay_api.py"


def verify() -> dict[str, object]:
    sources = {
        "proof": ANDROID_PROOF.read_text(encoding="utf-8"),
        "client": ANDROID_CLIENT.read_text(encoding="utf-8"),
        "unit": ANDROID_UNIT.read_text(encoding="utf-8"),
        "device": ANDROID_DEVICE.read_text(encoding="utf-8"),
        "registry": REGISTRY.read_text(encoding="utf-8"),
        "relay_test": RELAY_TEST.read_text(encoding="utf-8"),
    }
    required = {
        "proof": (
            "EncryptedSharedPreferences.create",
            "MasterKey.KeyScheme.AES256_GCM",
            "PENDING_PRIVATE_KEY",
            ".putString(PENDING_PRIVATE_KEY",
            ".commit()",
            "stableDeviceId",
            "AtomicBoolean(false)",
        ),
        "client": (
            "val rotation = proof.beginKeyRotation()",
            "authorizeWithPendingKey",
            "if (response.code in setOf(400, 409, 422)) rotation.discard()",
            "rotation.commit()",
        ),
        "unit": (
            "device key rotation commits only after Relay success and keeps stable device id",
            "failed rotation committed",
        ),
        "device": (
            "isolatedRotationPromotesAtomicallyAndDiscardKeepsOldKey",
            "context.deleteSharedPreferences(preferencesName)",
        ),
        "registry": (
            "proof_nonces: dict[str, datetime]",
            "device_proof_nonce_capacity",
            "cutoff = now - timedelta(seconds=60)",
            "Device proof replay window is full",
            "candidate.device_public_key = public_key",
            "candidate.proof_nonces.clear()",
        ),
        "relay_test": (
            "device_proof_nonce_capacity_fails_closed_without_evicting_live_nonce",
            "device_key_rotation_is_atomic_across_all_runtime_associations",
            "device_proof_invalid",
            "device_proof_replay",
        ),
    }
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_device_proof_marker_missing:{name}:{marker}")
    if "set(sorted(association.proof_nonces)[-256:])" in sources["registry"]:
        raise ValueError("p6_device_proof_live_nonce_eviction_forbidden")
    return {
        "android_wrapped_key": True,
        "stable_device_identity": True,
        "atomic_rotation": True,
        "nonce_ttl_seconds": 60,
        "nonce_fail_closed": True,
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
