from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.security_boundary import (
    SignedWindowsPackageKeyPolicyLoader,
    SignedWindowsSecurityPackageCatalogLoader,
    SecurityEventJournal,
    WindowsPackageKeyPolicyError,
    WindowsSecurityPackageCatalogError,
)


BUILD_DIGEST = "sha256:" + "4" * 64


def _raw_public(key: Ed25519PrivateKey) -> bytes:
    return key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )


def _key_entry(
    key_id: str, key: Ed25519PrivateKey, *, revoked_at=None, reason="",
    not_before=50, not_after=250,
):
    return {
        "key_id": key_id,
        "public_key": base64.b64encode(_raw_public(key)).decode("ascii"),
        "not_before": not_before, "not_after": not_after,
        "revoked_at": revoked_at, "revocation_reason": reason,
    }


def _policy_payload(keys, *, version=1, emergency=False):
    return {
        "schema_version": "windows-package-catalog-key-policy/1",
        "policy_id": "opendrsai-package-keys", "version": version,
        "product": "OpenDrSai", "channel": "stable",
        "emergency_disable": emergency, "not_before": 0, "expires_at": 300,
        "keys": keys,
    }


def _write_signed(path: Path, payload, key: Ed25519PrivateKey, key_id: str) -> None:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    path.write_text(json.dumps({
        "payload": payload, "key_id": key_id,
        "signature": base64.b64encode(key.sign(canonical)).decode("ascii"),
    }), encoding="utf-8")


def _loader(database: Path, root: Path, root_key: Ed25519PrivateKey, *, clock=lambda: 100):
    return SignedWindowsPackageKeyPolicyLoader(
        database, root, trusted_root_keys={"offline-root": _raw_public(root_key)},
        expected_policy_id="opendrsai-package-keys", expected_product="OpenDrSai",
        expected_channel="stable", minimum_policy_version=1, clock=clock,
    )


def _catalog_payload(root: Path):
    pins = root / "security-observability-release-pins.json"
    return {
        "schema_version": "windows-security-package-catalog/1",
        "catalog_id": "opendrsai-windows-security-package", "version": 2,
        "product": "OpenDrSai", "channel": "stable", "runtime_build_digest": BUILD_DIGEST,
        "installation_metadata_filename": "windows-security-installation.json",
        "installation_metadata_id": "opendrsai-windows-security-installation",
        "installation_metadata_digest": "sha256:" + "5" * 64,
        "installation_metadata_minimum_version": 1,
        "release_pins_filename": pins.name,
        "release_pins_file_digest": "sha256:" + hashlib.sha256(pins.read_bytes()).hexdigest(),
        "service_name": "OpenDrSaiSecurityRuntime", "service_sid": "S-1-5-80-123456",
        "service_start_account": "LocalSystem", "service_start_type": "automatic",
        "service_sid_type": "unrestricted", "service_delayed_auto_start": False,
        "trusted_writer_sids": ["S-1-5-18"], "not_before": 50, "expires_at": 250,
    }


def test_verified_key_policy_drives_catalog_loader_and_rotation_overlap(tmp_path: Path) -> None:
    root = tmp_path / "installed"
    root.mkdir()
    (root / "security-observability-release-pins.json").write_text("{}\n", encoding="utf-8")
    root_key, old_key, new_key = (
        Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate(),
    )
    policy_path = root / "package-keys.json"
    policy_payload = _policy_payload([
        _key_entry("catalog-new", new_key), _key_entry("catalog-old", old_key),
    ])
    _write_signed(policy_path, policy_payload, root_key, "offline-root")
    policy = _loader(tmp_path / "policy.sqlite3", root, root_key).load(policy_path.name)
    assert set(policy.trusted_catalog_keys(now=100)) == {"catalog-new", "catalog-old"}

    catalog_path = root / "catalog.json"
    _write_signed(catalog_path, _catalog_payload(root), old_key, "catalog-old")
    catalog = SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy(
        tmp_path / "catalog.sqlite3", root, policy,
        expected_catalog_id="opendrsai-windows-security-package",
        expected_runtime_build_digest=BUILD_DIGEST, minimum_catalog_version=2,
        clock=lambda: 100,
    ).load(catalog_path.name)
    assert catalog.key_id == "catalog-old"


def test_revoked_key_cannot_sign_catalog_or_reactivate_in_later_policy(tmp_path: Path) -> None:
    root = tmp_path / "installed"
    root.mkdir()
    (root / "security-observability-release-pins.json").write_text("{}\n", encoding="utf-8")
    root_key, old_key, new_key = (
        Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate(),
    )
    path, database = root / "package-keys.json", tmp_path / "policy.sqlite3"
    version_one = _policy_payload([
        _key_entry("catalog-new", new_key), _key_entry("catalog-old", old_key),
    ])
    _write_signed(path, version_one, root_key, "offline-root")
    loader = _loader(database, root, root_key)
    loader.load(path.name)
    version_two = _policy_payload([
        _key_entry("catalog-new", new_key),
        _key_entry("catalog-old", old_key, revoked_at=100, reason="key_compromise"),
    ], version=2)
    _write_signed(path, version_two, root_key, "offline-root")
    revoked = loader.load(path.name)
    assert set(revoked.trusted_catalog_keys(now=100)) == {"catalog-new"}
    assert any(
        event.event_type == "windows_package.catalog_key_revoked"
        for event in SecurityEventJournal(database).list()
    )

    catalog_path = root / "catalog.json"
    _write_signed(catalog_path, _catalog_payload(root), old_key, "catalog-old")
    catalog_loader = SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy(
        tmp_path / "catalog.sqlite3", root, revoked,
        expected_catalog_id="opendrsai-windows-security-package",
        expected_runtime_build_digest=BUILD_DIGEST, minimum_catalog_version=2,
        clock=lambda: 100,
    )
    with pytest.raises(WindowsSecurityPackageCatalogError) as old_signature:
        catalog_loader.load(catalog_path.name)
    assert old_signature.value.code == "windows_package_catalog_key_untrusted"

    reactivated = _policy_payload([
        _key_entry("catalog-new", new_key), _key_entry("catalog-old", old_key),
    ], version=3)
    _write_signed(path, reactivated, root_key, "offline-root")
    with pytest.raises(WindowsPackageKeyPolicyError) as denied:
        loader.load(path.name)
    assert denied.value.code == "windows_package_key_policy_key_reactivated"


def test_key_removal_substitution_lifetime_expansion_and_policy_rollback_fail(tmp_path: Path) -> None:
    root = tmp_path / "installed"
    root.mkdir()
    root_key, catalog_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    path, database = root / "package-keys.json", tmp_path / "policy.sqlite3"
    version_one = _policy_payload([_key_entry("catalog-key", catalog_key)])
    _write_signed(path, version_one, root_key, "offline-root")
    loader = _loader(database, root, root_key)
    loader.load(path.name)

    for payload, code in (
        (_policy_payload([], version=2), "windows_package_key_policy_keys_invalid"),
        (_policy_payload([_key_entry("other-key", catalog_key)], version=2),
         "windows_package_key_policy_key_removed"),
        (_policy_payload([_key_entry("catalog-key", Ed25519PrivateKey.generate())], version=2),
         "windows_package_key_policy_key_redefined"),
        (_policy_payload([_key_entry("catalog-key", catalog_key, not_after=275)], version=2),
         "windows_package_key_policy_key_redefined"),
    ):
        _write_signed(path, payload, root_key, "offline-root")
        with pytest.raises(WindowsPackageKeyPolicyError) as rejected:
            loader.load(path.name)
        assert rejected.value.code == code

    _write_signed(path, version_one, root_key, "offline-root")
    assert loader.load(path.name).version == 1
    version_two = _policy_payload([_key_entry("catalog-key", catalog_key)], version=2)
    _write_signed(path, version_two, root_key, "offline-root")
    loader.load(path.name)
    _write_signed(path, version_one, root_key, "offline-root")
    with pytest.raises(WindowsPackageKeyPolicyError) as rollback:
        loader.load(path.name)
    assert rollback.value.code == "windows_package_key_policy_version_rollback"


def test_emergency_disable_tamper_and_wrong_root_fail_closed(tmp_path: Path) -> None:
    root = tmp_path / "installed"
    root.mkdir()
    root_key, catalog_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    path = root / "package-keys.json"
    payload = _policy_payload([_key_entry("catalog-key", catalog_key)], emergency=True)
    _write_signed(path, payload, root_key, "offline-root")
    policy = _loader(tmp_path / "disabled.sqlite3", root, root_key).load(path.name)
    assert policy.trusted_catalog_keys(now=100) == {}
    with pytest.raises(WindowsSecurityPackageCatalogError) as disabled:
        SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy(
            tmp_path / "catalog.sqlite3", root, policy,
            expected_catalog_id="opendrsai-windows-security-package",
            expected_runtime_build_digest=BUILD_DIGEST, minimum_catalog_version=1,
            clock=lambda: 100,
        )
    assert disabled.value.code == "windows_package_catalog_keys_disabled"
    assert any(
        event.event_type == "windows_package.catalog_keys_emergency_disabled"
        for event in SecurityEventJournal(tmp_path / "disabled.sqlite3").list()
    )

    envelope = json.loads(path.read_text(encoding="utf-8"))
    envelope["payload"]["emergency_disable"] = False
    path.write_text(json.dumps(envelope), encoding="utf-8")
    with pytest.raises(WindowsPackageKeyPolicyError) as tamper:
        _loader(tmp_path / "tamper.sqlite3", root, root_key).load(path.name)
    assert tamper.value.code == "windows_package_key_policy_signature_invalid"

    _write_signed(path, payload, root_key, "offline-root")
    with pytest.raises(WindowsPackageKeyPolicyError) as wrong_root:
        _loader(
            tmp_path / "root.sqlite3", root, Ed25519PrivateKey.generate(),
        ).load(path.name)
    assert wrong_root.value.code == "windows_package_key_policy_signature_invalid"


def test_cached_catalog_loader_rechecks_key_retirement_and_policy_expiry(tmp_path: Path) -> None:
    root = tmp_path / "installed"
    root.mkdir()
    (root / "security-observability-release-pins.json").write_text("{}\n", encoding="utf-8")
    root_key, catalog_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    policy_path = root / "package-keys.json"
    payload = _policy_payload([_key_entry("catalog-key", catalog_key, not_after=150)])
    _write_signed(policy_path, payload, root_key, "offline-root")
    now = {"value": 100.0}
    policy = _loader(
        tmp_path / "policy.sqlite3", root, root_key, clock=lambda: now["value"],
    ).load(policy_path.name)
    catalog_path = root / "catalog.json"
    _write_signed(catalog_path, _catalog_payload(root), catalog_key, "catalog-key")
    catalog_loader = SignedWindowsSecurityPackageCatalogLoader.from_verified_key_policy(
        tmp_path / "catalog.sqlite3", root, policy,
        expected_catalog_id="opendrsai-windows-security-package",
        expected_runtime_build_digest=BUILD_DIGEST, minimum_catalog_version=2,
        clock=lambda: now["value"],
    )
    now["value"] = 151
    with pytest.raises(WindowsSecurityPackageCatalogError) as retired:
        catalog_loader.load(catalog_path.name)
    assert retired.value.code == "windows_package_catalog_key_inactive"


def test_revocation_reason_and_key_id_are_safe_audit_codes(tmp_path: Path) -> None:
    root = tmp_path / "installed"
    root.mkdir()
    root_key, catalog_key = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    path = root / "package-keys.json"
    for entry in (
        _key_entry("bad\nkey", catalog_key),
        _key_entry("catalog-key", catalog_key, revoked_at=100, reason="secret: value\n"),
    ):
        _write_signed(path, _policy_payload([entry]), root_key, "offline-root")
        with pytest.raises(WindowsPackageKeyPolicyError) as invalid:
            _loader(tmp_path / f"{hash(entry['key_id'])}.sqlite3", root, root_key).load(path.name)
        assert invalid.value.code == "windows_package_key_policy_keys_invalid"
