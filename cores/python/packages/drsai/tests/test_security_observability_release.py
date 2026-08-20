from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.security_boundary import (
    ApprovalSloPolicyError,
    SecurityObservabilityDeploymentError,
    SecurityObservabilityReleaseError,
    SecurityObservabilityReleaseTool,
)
from drsai.backend.runtime.security_boundary.security_observability_release import main


BUILD_DIGEST = "sha256:" + "9" * 64


def _release_input(*, enabled: bool = False) -> dict[str, object]:
    return {
        "schema_version": "security-observability-release-input/1",
        "manifest_filename": "security-observability.json",
        "release_key_id": "release-2026",
        "slo_policy_filename": "approval-slo.json",
        "slo_policy_key_id": "security-slo-2026",
        "policy_payload": {
            "schema_version": "approval-security-slo-policy/1",
            "policy_id": "production-approval-slo",
            "version": 7,
            "not_before": 100,
            "expires_at": 300,
            "thresholds": {
                "window_seconds": 300,
                "minimum_decisions": 20,
                "minimum_effects": 10,
                "max_timeout_ratio_basis_points": 500,
                "max_expired_grant_ratio_basis_points": 1000,
                "max_outcome_unknown_ratio_basis_points": 100,
                "max_adapter_failures": 1,
            },
        },
        "deployment_payload": {
            "manifest_id": "opendrsai-security-observability",
            "version": 5,
            "product": "OpenDrSai",
            "channel": "stable",
            "runtime_build_digest": BUILD_DIGEST,
            "enabled": enabled,
            "service_sid": "S-1-5-80-123456" if enabled else "",
            "pipe_instance_id": "0123456789abcdef0123456789abcdef" if enabled else "",
            "not_before": 100,
            "expires_at": 300,
        },
    }


def test_release_build_is_deterministic_and_jointly_verifies(tmp_path: Path) -> None:
    release_key = Ed25519PrivateKey.generate()
    slo_key = Ed25519PrivateKey.generate()
    first = tmp_path / "first"
    second = tmp_path / "second"
    pins = SecurityObservabilityReleaseTool.build(
        _release_input(enabled=True), first,
        release_private_key=release_key, slo_private_key=slo_key,
    )
    second_pins = SecurityObservabilityReleaseTool.build(
        _release_input(enabled=True), second,
        release_private_key=release_key, slo_private_key=slo_key,
    )
    for filename in (
        "approval-slo.json", "security-observability.json",
        "security-observability-release-pins.json",
    ):
        assert (first / filename).read_bytes() == (second / filename).read_bytes()
    assert pins == second_pins
    loaded = SecurityObservabilityReleaseTool.load_pins(
        first / "security-observability-release-pins.json",
    )
    verified = SecurityObservabilityReleaseTool.verify(
        first, loaded, release_public_key=release_key.public_key(),
        slo_public_key=slo_key.public_key(), clock=lambda: 200,
    )
    assert verified.deployment.digest == pins.manifest_digest
    assert verified.deployment.slo_policy_digest == pins.slo_policy_digest
    manifest = json.loads((first / "security-observability.json").read_text(encoding="utf-8"))
    assert manifest["payload"]["slo_policy_digest"] == pins.slo_policy_digest
    assert manifest["payload"]["slo_policy_minimum_version"] == 7


def test_release_never_overwrites_versioned_artifacts(tmp_path: Path) -> None:
    release_key = Ed25519PrivateKey.generate()
    slo_key = Ed25519PrivateKey.generate()
    root = tmp_path / "bundle"
    SecurityObservabilityReleaseTool.build(
        _release_input(), root, release_private_key=release_key, slo_private_key=slo_key,
    )
    before = {path.name: path.read_bytes() for path in root.iterdir()}
    with pytest.raises(SecurityObservabilityReleaseError) as exists:
        SecurityObservabilityReleaseTool.build(
            _release_input(), root, release_private_key=release_key, slo_private_key=slo_key,
        )
    assert exists.value.code == "security_observability_release_output_exists"
    assert {path.name: path.read_bytes() for path in root.iterdir()} == before


def test_policy_tamper_cross_splice_and_wrong_key_fail_joint_verification(tmp_path: Path) -> None:
    release_key = Ed25519PrivateKey.generate()
    slo_key = Ed25519PrivateKey.generate()
    root = tmp_path / "bundle"
    pins = SecurityObservabilityReleaseTool.build(
        _release_input(), root, release_private_key=release_key, slo_private_key=slo_key,
    )
    policy_path = root / "approval-slo.json"
    envelope = json.loads(policy_path.read_text(encoding="utf-8"))
    envelope["payload"]["thresholds"]["max_adapter_failures"] = 999
    policy_path.write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(ApprovalSloPolicyError) as tamper:
        SecurityObservabilityReleaseTool.verify(
            root, pins, release_public_key=release_key.public_key(),
            slo_public_key=slo_key.public_key(), clock=lambda: 200,
        )
    assert tamper.value.code == "approval_slo_policy_signature_invalid"

    other = tmp_path / "other"
    other_input = _release_input()
    other_input["policy_payload"]["version"] = 8
    other_input["policy_payload"]["thresholds"]["max_adapter_failures"] = 2
    SecurityObservabilityReleaseTool.build(
        other_input, other, release_private_key=release_key, slo_private_key=slo_key,
    )
    policy_path.write_bytes((other / "approval-slo.json").read_bytes())
    with pytest.raises(ApprovalSloPolicyError) as splice:
        SecurityObservabilityReleaseTool.verify(
            root, pins, release_public_key=release_key.public_key(),
            slo_public_key=slo_key.public_key(), clock=lambda: 200,
        )
    assert splice.value.code == "approval_slo_policy_digest_mismatch"

    with pytest.raises(SecurityObservabilityReleaseError) as wrong_key:
        SecurityObservabilityReleaseTool.verify(
            root, pins, release_public_key=Ed25519PrivateKey.generate().public_key(),
            slo_public_key=slo_key.public_key(), clock=lambda: 200,
        )
    assert wrong_key.value.code == "security_observability_release_key_mismatch"


def test_invalid_release_input_leaves_no_partial_artifacts(tmp_path: Path) -> None:
    release_input = _release_input()
    release_input["deployment_payload"]["enabled"] = False
    release_input["deployment_payload"]["service_sid"] = "S-1-5-18"
    root = tmp_path / "bundle"
    with pytest.raises(SecurityObservabilityDeploymentError) as invalid:
        SecurityObservabilityReleaseTool.build(
            release_input, root,
            release_private_key=Ed25519PrivateKey.generate(),
            slo_private_key=Ed25519PrivateKey.generate(),
        )
    assert invalid.value.code == "security_observability_manifest_disabled_identity"
    assert root.exists()
    assert list(root.iterdir()) == []


def test_pins_cannot_redirect_verifier_or_weaken_minimum_version(tmp_path: Path) -> None:
    release_key = Ed25519PrivateKey.generate()
    slo_key = Ed25519PrivateKey.generate()
    root = tmp_path / "bundle"
    SecurityObservabilityReleaseTool.build(
        _release_input(), root, release_private_key=release_key, slo_private_key=slo_key,
    )
    pins_path = root / "security-observability-release-pins.json"
    raw = json.loads(pins_path.read_text(encoding="utf-8"))
    raw["manifest_filename"] = "../security-observability.json"
    pins_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(SecurityObservabilityReleaseError):
        SecurityObservabilityReleaseTool.load_pins(pins_path)
    raw["manifest_filename"] = "security-observability.json"
    raw["minimum_manifest_version"] = 0
    pins_path.write_text(json.dumps(raw), encoding="utf-8")
    with pytest.raises(SecurityObservabilityReleaseError) as invalid:
        SecurityObservabilityReleaseTool.load_pins(pins_path)
    assert invalid.value.code == "security_observability_release_pins_invalid"


def test_console_build_and_verify_use_pem_key_files(tmp_path: Path) -> None:
    release_key = Ed25519PrivateKey.generate()
    slo_key = Ed25519PrivateKey.generate()
    input_path = tmp_path / "release-input.json"
    input_path.write_text(json.dumps(_release_input()), encoding="utf-8")
    release_private = tmp_path / "release-private.pem"
    slo_private = tmp_path / "slo-private.pem"
    release_public = tmp_path / "release-public.pem"
    slo_public = tmp_path / "slo-public.pem"
    release_private.write_bytes(release_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    slo_private.write_bytes(slo_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    release_public.write_bytes(release_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
    ))
    slo_public.write_bytes(slo_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
    ))
    root = tmp_path / "bundle"
    assert main([
        "build", "--input", str(input_path), "--output-root", str(root),
        "--release-private-key", str(release_private), "--slo-private-key", str(slo_private),
    ]) == 0
    assert main([
        "verify", "--bundle-root", str(root),
        "--pins", str(root / "security-observability-release-pins.json"),
        "--release-public-key", str(release_public), "--slo-public-key", str(slo_public),
        "--now", "200",
    ]) == 0
