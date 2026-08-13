from __future__ import annotations

from pathlib import Path
import json
import zipfile

import pytest

import p5_android_apk as apk


def fixture_apk(tmp_path: Path) -> Path:
    path = tmp_path / "fixture.apk"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("AndroidManifest.xml", b"binary-manifest")
        archive.writestr("classes.dex", b"dex")
    return path


def install_tools(monkeypatch: pytest.MonkeyPatch, *, package: str = "ai.drsai.remote",
                  target: str = "ai.drsai.remote", cert: str = "a" * 64) -> None:
    monkeypatch.setattr(apk, "_tools", lambda: (Path("aapt"), Path("apksigner")))

    def run(command: list[str]) -> str:
        if "badging" in command:
            return f"package: name='{package}' versionCode='10506' versionName='1.5.6'\n"
        if "--print-certs" in command:
            return (f"Signer #1 certificate DN: CN=OpenDrSai Test Release\n"
                    f"Signer #1 certificate SHA-256 digest: {cert}\n")
        if "xmltree" in command:
            return f'A: android:targetPackage(0x01010021)="{target}" (Raw: "{target}")\n'
        raise AssertionError(command)

    monkeypatch.setattr(apk, "_run", run)


def test_release_apk_identity_and_signature_are_extracted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    install_tools(monkeypatch)
    assert apk.inspect_android_apk(
        fixture_apk(tmp_path), expected_package="ai.drsai.remote"
    ) == {
        "package_name": "ai.drsai.remote", "version_code": 10506,
        "version_name": "1.5.6", "signing_cert_sha256": "a" * 64,
        "signer_dn": "CN=OpenDrSai Test Release",
        "target_package": None,
    }


def test_release_test_apk_must_target_app_and_share_valid_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    install_tools(monkeypatch, package="ai.drsai.remote.test")
    result = apk.inspect_android_apk(
        fixture_apk(tmp_path), expected_package="ai.drsai.remote.test",
        expected_target_package="ai.drsai.remote",
    )
    assert result["target_package"] == "ai.drsai.remote"


@pytest.mark.parametrize(
    ("package", "target", "cert", "error"),
    [
        ("malicious.app", "ai.drsai.remote", "a" * 64, "package_mismatch"),
        ("ai.drsai.remote.test", "malicious.app", "a" * 64, "test_target_mismatch"),
        ("ai.drsai.remote", "ai.drsai.remote", "bad", "signature_invalid"),
    ],
)
def test_wrong_package_target_or_signature_fails_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
    package: str, target: str, cert: str, error: str,
) -> None:
    install_tools(monkeypatch, package=package, target=target, cert=cert)
    expected_package = "ai.drsai.remote.test" if "target" in error else "ai.drsai.remote"
    with pytest.raises(apk.ApkVerificationError, match=error):
        apk.inspect_android_apk(
            fixture_apk(tmp_path), expected_package=expected_package,
            expected_target_package="ai.drsai.remote" if "target" in error else None,
        )


def test_arbitrary_non_apk_bytes_fail_before_external_tools(tmp_path: Path) -> None:
    path = tmp_path / "fake.apk"
    path.write_bytes(b"not-an-apk")
    with pytest.raises(apk.ApkVerificationError, match="zip_invalid"):
        apk.inspect_android_apk(path, expected_package="ai.drsai.remote")


def test_release_signer_requires_active_repository_allowlist(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    policy = tmp_path / "signers.json"
    monkeypatch.setattr(apk, "SIGNER_POLICY", policy)
    cert = "a" * 64

    policy.write_text(json.dumps({
        "schema_version": "p5-android-release-signers/1",
        "status": "not_configured", "allowed_cert_sha256": [],
    }))
    assert apk.release_signer_is_trusted(cert, "CN=OpenDrSai Release") is False

    policy.write_text(json.dumps({
        "schema_version": "p5-android-release-signers/1",
        "status": "active", "allowed_cert_sha256": [cert],
    }))
    assert apk.release_signer_is_trusted(cert, "CN=OpenDrSai Release") is True
    assert apk.release_signer_is_trusted("b" * 64, "CN=OpenDrSai Release") is False
    assert apk.release_signer_is_trusted(cert, "CN=Android Debug,O=Android") is False


@pytest.mark.parametrize("value", [
    {},
    {"schema_version": "p5-android-release-signers/1", "status": "active",
     "allowed_cert_sha256": ["bad"]},
    {"schema_version": "p5-android-release-signers/1", "status": "active",
     "allowed_cert_sha256": ["a" * 64, "a" * 64]},
])
def test_malformed_release_signer_policy_fails_closed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, value: dict,
) -> None:
    policy = tmp_path / "signers.json"
    policy.write_text(json.dumps(value))
    monkeypatch.setattr(apk, "SIGNER_POLICY", policy)
    assert apk.release_signer_is_trusted("a" * 64, "CN=OpenDrSai Release") is False
