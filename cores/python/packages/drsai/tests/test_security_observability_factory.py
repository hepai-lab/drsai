from __future__ import annotations

import base64
import json
from dataclasses import FrozenInstanceError
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.security_boundary import (
    ApprovalSecuritySloMonitor,
    ApprovalSecuritySloThresholds,
    ApprovalSloPolicyError,
    HostSecurityObservabilityConfig,
    SecurityObservabilityRuntimeFactory,
    SecurityMetricsTransportError,
)


class _NativeApi:
    backend_id = "windows-authenticated-named-pipe"
    backend_version = "1"


def _signed_policy(root: Path):
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    payload = {
        "schema_version": "approval-security-slo-policy/1",
        "policy_id": "production-approval-slo",
        "version": 3,
        "not_before": 50,
        "expires_at": 200,
        "thresholds": {
            "window_seconds": 300,
            "minimum_decisions": 10,
            "minimum_effects": 10,
            "max_timeout_ratio_basis_points": 500,
            "max_expired_grant_ratio_basis_points": 1000,
            "max_outcome_unknown_ratio_basis_points": 100,
            "max_adapter_failures": 1,
        },
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    envelope = {
        "payload": payload, "key_id": "release-key",
        "signature": base64.b64encode(private_key.sign(canonical)).decode(),
    }
    (root / "approval-slo.json").write_text(json.dumps(envelope), encoding="utf-8")
    return public_key


def _config(root: Path, public_key: bytes, **kwargs):
    values = {
        "trusted_policy_root": root,
        "policy_filename": "approval-slo.json",
        "trusted_public_keys": (("release-key", public_key),),
        "expected_policy_id": "production-approval-slo",
        "minimum_policy_version": 3,
    }
    values.update(kwargs)
    return HostSecurityObservabilityConfig(**values)


def test_factory_builds_signed_monitor_and_exporter_with_transport_off_by_default(tmp_path: Path) -> None:
    root = tmp_path / "trusted-policy"
    root.mkdir()
    public_key = _signed_policy(root)
    config = _config(root, public_key)
    runtime = SecurityObservabilityRuntimeFactory(
        tmp_path / "security.sqlite3", config, clock=lambda: 100,
    ).build()
    assert runtime.policy.version == 3
    assert runtime.monitor.policy_digest == runtime.policy.digest
    assert runtime.transport is None
    assert "security_approval_slo_policy_accepted_total 1" in runtime.exporter.render(now=100)
    with pytest.raises(FrozenInstanceError):
        config.pipe_enabled = True  # type: ignore[misc]


def test_direct_factory_cannot_enable_transport_without_installer_bootstrap(tmp_path: Path) -> None:
    root = tmp_path / "trusted-policy"
    root.mkdir()
    public_key = _signed_policy(root)
    config = _config(
        root, public_key,
        pipe_enabled=True,
        pipe_instance_id="0123456789abcdef0123456789abcdef",
        host_service_sid="S-1-5-80-12345",
    )
    with pytest.raises(SecurityMetricsTransportError) as rejected:
        SecurityObservabilityRuntimeFactory(
            tmp_path / "security.sqlite3", config,
            native_pipe_api=_NativeApi(), clock=lambda: 100,
        )
    assert rejected.value.code == "security_observability_bootstrap_required"


def test_factory_rejects_workspace_policy_root_and_signature_tamper(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    root = workspace / "policy"
    root.mkdir(parents=True)
    public_key = _signed_policy(root)
    config = _config(root, public_key, workspace_roots=(workspace,))
    with pytest.raises(ApprovalSloPolicyError) as workspace_rejected:
        SecurityObservabilityRuntimeFactory(
            tmp_path / "security.sqlite3", config, clock=lambda: 100,
        ).build()
    assert workspace_rejected.value.code == "approval_slo_policy_root_untrusted"

    safe_root = tmp_path / "trusted-policy"
    safe_root.mkdir()
    public_key = _signed_policy(safe_root)
    envelope = json.loads((safe_root / "approval-slo.json").read_text(encoding="utf-8"))
    envelope["payload"]["thresholds"]["max_adapter_failures"] = 999
    (safe_root / "approval-slo.json").write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(ApprovalSloPolicyError) as tampered:
        SecurityObservabilityRuntimeFactory(
            tmp_path / "tampered.sqlite3", _config(safe_root, public_key), clock=lambda: 100,
        ).build()
    assert tampered.value.code == "approval_slo_policy_signature_invalid"


def test_factory_config_and_monitor_reject_client_shaped_partial_authority(tmp_path: Path) -> None:
    root = tmp_path / "trusted-policy"
    root.mkdir()
    public_key = _signed_policy(root)
    with pytest.raises(ValueError):
        _config(root, public_key, host_service_sid="S-1-5-18")
    with pytest.raises(ValueError):
        _config(root, public_key, trusted_public_keys=())
    with pytest.raises(ValueError):
        ApprovalSecuritySloMonitor.from_signed_policy(
            tmp_path / "security.sqlite3",
            SimpleNamespace(
                digest="sha256:" + "0" * 64,
                thresholds=ApprovalSecuritySloThresholds(),
            ),
        )


def test_untrusted_pipe_backend_cannot_be_reached_through_direct_config(tmp_path: Path) -> None:
    root = tmp_path / "trusted-policy"
    root.mkdir()
    public_key = _signed_policy(root)
    config = _config(
        root, public_key, pipe_enabled=True,
        pipe_instance_id="0123456789abcdef0123456789abcdef",
        host_service_sid="S-1-5-80-12345",
    )
    database = tmp_path / "security.sqlite3"
    with pytest.raises(SecurityMetricsTransportError) as rejected:
        SecurityObservabilityRuntimeFactory(
            database, config, native_pipe_api=_NativeApi(), clock=lambda: 100,
        )
    assert rejected.value.code == "security_observability_bootstrap_required"
    assert not database.exists()
