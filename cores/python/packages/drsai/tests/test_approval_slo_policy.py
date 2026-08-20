from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.security_boundary import (
    ApprovalSecuritySloMonitor,
    ApprovalSloPolicyError,
    HostLocalSecurityMetricsExporter,
    SecurityEventJournal,
    SecurityMetricsCollector,
    SignedApprovalSloPolicyLoader,
)


def _payload(*, version: int = 1, expires_at: float = 200, timeout_bp: int = 500):
    return {
        "schema_version": "approval-security-slo-policy/1",
        "policy_id": "production-approval-slo",
        "version": version,
        "not_before": 50,
        "expires_at": expires_at,
        "thresholds": {
            "window_seconds": 300,
            "minimum_decisions": 10,
            "minimum_effects": 10,
            "max_timeout_ratio_basis_points": timeout_bp,
            "max_expired_grant_ratio_basis_points": 1000,
            "max_outcome_unknown_ratio_basis_points": 100,
            "max_adapter_failures": 1,
        },
    }


def _write_policy(root: Path, private_key, payload, *, key_id: str = "release-key") -> None:
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode("utf-8")
    envelope = {
        "payload": payload,
        "key_id": key_id,
        "signature": base64.b64encode(private_key.sign(canonical)).decode("ascii"),
    }
    (root / "approval-slo.json").write_text(json.dumps(envelope), encoding="utf-8")


def _loader(database: Path, root: Path, public_key: bytes, **kwargs):
    return SignedApprovalSloPolicyLoader(
        database, root, trusted_public_keys={"release-key": public_key},
        expected_policy_id="production-approval-slo", minimum_version=kwargs.pop("minimum_version", 1),
        clock=lambda: 100, **kwargs,
    )


def test_signed_slo_policy_is_pinned_deduplicated_and_binds_monitor(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    root = tmp_path / "trusted-policy"
    root.mkdir()
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    _write_policy(root, private_key, _payload())
    loader = _loader(database, root, public_key)

    policy = loader.load("approval-slo.json")
    assert policy.version == 1
    assert policy.thresholds.max_timeout_ratio_basis_points == 500
    assert policy.digest.startswith("sha256:")
    monitor = ApprovalSecuritySloMonitor.from_signed_policy(database, policy, clock=lambda: 100)
    assert monitor.policy_digest == policy.digest
    SecurityEventJournal(database).append("approval.adapter_failed", "adapter-private", {
        "adapter_kind": "codex", "failure_category": "protocol",
    }, now=99)
    evaluation = monitor.evaluate()
    adapter_alert = next(
        event for event in evaluation.emitted_events
        if event.payload["alert_type"] == "adapter_failures"
    )
    assert adapter_alert.payload["policy_digest"] == policy.digest
    assert loader.load("approval-slo.json") == policy
    events = [
        event for event in SecurityEventJournal(database).list()
        if event.event_type == "approval_slo.policy_accepted"
    ]
    assert len(events) == 1
    assert events[0].payload["version"] == 1
    assert "security_approval_slo_policy_accepted_total 1" in (
        HostLocalSecurityMetricsExporter(SecurityMetricsCollector(database)).render(now=100)
    )


def test_policy_rejects_tamper_untrusted_key_expiry_and_path_escape(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    root = tmp_path / "trusted-policy"
    root.mkdir()
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    payload = _payload()
    _write_policy(root, private_key, payload)
    loader = _loader(database, root, public_key)
    envelope = json.loads((root / "approval-slo.json").read_text(encoding="utf-8"))
    envelope["payload"]["thresholds"]["max_timeout_ratio_basis_points"] = 9999
    (root / "approval-slo.json").write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(ApprovalSloPolicyError) as tampered:
        loader.load("approval-slo.json")
    assert tampered.value.code == "approval_slo_policy_signature_invalid"

    _write_policy(root, private_key, _payload(), key_id="attacker-key")
    with pytest.raises(ApprovalSloPolicyError) as untrusted:
        loader.load("approval-slo.json")
    assert untrusted.value.code == "approval_slo_policy_key_untrusted"

    _write_policy(root, private_key, _payload(expires_at=100))
    with pytest.raises(ApprovalSloPolicyError) as expired:
        loader.load("approval-slo.json")
    assert expired.value.code == "approval_slo_policy_not_current"
    with pytest.raises(ApprovalSloPolicyError) as escaped:
        loader.load("../approval-slo.json")
    assert escaped.value.code == "approval_slo_policy_path_invalid"


def test_policy_version_pin_persistent_rollback_and_redefinition_are_rejected(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    root = tmp_path / "trusted-policy"
    root.mkdir()
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    _write_policy(root, private_key, _payload(version=1))
    with pytest.raises(ApprovalSloPolicyError) as pinned:
        _loader(database, root, public_key, minimum_version=2).load("approval-slo.json")
    assert pinned.value.code == "approval_slo_policy_version_rollback"

    loader = _loader(database, root, public_key)
    _write_policy(root, private_key, _payload(version=2))
    loader.load("approval-slo.json")
    _write_policy(root, private_key, _payload(version=1))
    with pytest.raises(ApprovalSloPolicyError) as rollback:
        loader.load("approval-slo.json")
    assert rollback.value.code == "approval_slo_policy_version_rollback"

    _write_policy(root, private_key, _payload(version=2, timeout_bp=600))
    with pytest.raises(ApprovalSloPolicyError) as redefined:
        loader.load("approval-slo.json")
    assert redefined.value.code == "approval_slo_policy_version_redefined"


def test_policy_root_cannot_be_inside_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    policy_root = workspace / "policy"
    policy_root.mkdir(parents=True)
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    with pytest.raises(ApprovalSloPolicyError) as rejected:
        _loader(
            tmp_path / "security.sqlite3", policy_root, public_key,
            forbidden_roots=(workspace,),
        )
    assert rejected.value.code == "approval_slo_policy_root_untrusted"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("minimum_decisions", True),
        ("max_adapter_failures", 1.5),
        ("window_seconds", float("nan")),
    ],
)
def test_policy_rejects_signed_threshold_type_confusion(
    tmp_path: Path, field: str, value,
) -> None:
    database = tmp_path / "security.sqlite3"
    root = tmp_path / "trusted-policy"
    root.mkdir()
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    payload = _payload()
    payload["thresholds"][field] = value
    _write_policy(root, private_key, payload)
    with pytest.raises(ApprovalSloPolicyError) as rejected:
        _loader(database, root, public_key).load("approval-slo.json")
    assert rejected.value.code == "approval_slo_policy_invalid"


def test_policy_rejects_oversized_signed_envelope_before_json_parse(tmp_path: Path) -> None:
    root = tmp_path / "trusted-policy"
    root.mkdir()
    (root / "approval-slo.json").write_text(" " * (64 * 1024 + 1), encoding="utf-8")
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    with pytest.raises(ApprovalSloPolicyError) as rejected:
        _loader(tmp_path / "security.sqlite3", root, public_key).load("approval-slo.json")
    assert rejected.value.code == "approval_slo_policy_too_large"
