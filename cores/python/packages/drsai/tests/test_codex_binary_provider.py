from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.binary_provider import (
    CodexArtifactStore,
    CodexBinaryProvider,
    CodexPlatformLauncher,
    verify_codex_compatibility,
    load_trusted_publishers,
)
from drsai.backend.codex_adapter.artifact_cli import install_artifact


def _digest(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def _artifact(root: Path, private_key: Ed25519PrivateKey, version: str, *, publisher: str = "opendrsai-release") -> Path:
    root.mkdir(parents=True)
    binary = root / ("codex.cmd" if os.name == "nt" else "codex")
    if os.name == "nt":
        binary.write_text(f"@echo off\r\necho codex-cli {version}\r\n", encoding="utf-8")
    else:
        binary.write_text(f"#!/bin/sh\necho codex-cli {version}\n", encoding="utf-8")
        binary.chmod(0o755)
    schema = root / "app-server.schema.json"
    schema.write_text(json.dumps({"version": version, "api": "stable"}), encoding="utf-8")
    manifest = {
        "version": version,
        "platform": "windows-x86_64" if os.name == "nt" else "linux-x86_64",
        "executable": binary.name,
        "binary_digest": _digest(binary),
        "schema": schema.name,
        "schema_digest": _digest(schema),
        "publisher": publisher,
    }
    payload = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    manifest["signature"] = base64.b64encode(private_key.sign(payload)).decode()
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return root


@pytest.fixture
def trust():
    private = Ed25519PrivateKey.generate()
    public = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return private, {"opendrsai-release": public}


def test_product_uses_only_signed_managed_binary_and_development_override_is_marked(tmp_path: Path, trust):
    private, publishers = trust
    artifact = _artifact(tmp_path / "artifact", private, "0.142.5")
    store = CodexArtifactStore(tmp_path / "managed", publishers)
    installed = store.install(artifact)
    malicious = tmp_path / "codex.exe"
    malicious.write_text("malicious", encoding="utf-8")

    product = CodexBinaryProvider(store, mode="product", environ={"CODEX_BIN": str(malicious), "PATH": str(tmp_path)}).resolve()
    assert product == installed
    assert product.source == "managed" and product.release_safe is True
    assert product.path != malicious
    assert verify_codex_compatibility(product) == "0.142.5"

    development = CodexBinaryProvider(store, mode="development", environ={"CODEX_BIN": str(malicious)}).resolve()
    assert development.path == malicious
    assert development.source == "CODEX_BIN" and development.release_safe is False
    with pytest.raises(RuntimeExecutionError, match="not release-compatible") as caught:
        verify_codex_compatibility(development)
    assert caught.value.code == "codex_development_override_unverified"


def test_windows_and_linux_launch_providers_share_one_contract(tmp_path: Path):
    windows = tmp_path / "codex.cmd"
    linux = tmp_path / "codex"
    windows.write_text("@echo off\n")
    linux.write_text("#!/bin/sh\n")
    windows_command = CodexPlatformLauncher.command(
        windows, ["app-server", "--listen", "stdio://"], platform="windows",
        comspec="C:/Windows/System32/cmd.exe",
    )
    linux_command = CodexPlatformLauncher.command(
        linux, ["app-server", "--listen", "stdio://"], platform="linux",
    )
    assert windows_command[:4] == ["C:/Windows/System32/cmd.exe", "/d", "/s", "/c"]
    assert "app-server" in windows_command[-1]
    assert linux_command == [str(linux), "app-server", "--listen", "stdio://"]
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexPlatformLauncher.command(linux, [], platform="macos")
    assert caught.value.code == "codex_platform_unsupported"


def test_development_provider_reports_cli_version(tmp_path: Path):
    executable = tmp_path / ("codex.cmd" if os.name == "nt" else "codex")
    if os.name == "nt":
        executable.write_text("@echo off\r\necho codex-cli 0.144.5\r\n", encoding="utf-8")
    else:
        executable.write_text("#!/bin/sh\necho codex-cli 0.144.5\n", encoding="utf-8")
        executable.chmod(0o755)
    provider = CodexBinaryProvider(
        CodexArtifactStore(tmp_path / "managed", {}),
        mode="development",
        environ={"CODEX_BIN": str(executable)},
    )
    binary = provider.resolve()
    assert binary.version == "0.144.5"
    assert binary.source == "CODEX_BIN" and binary.release_safe is False


def test_signature_digest_publisher_platform_and_schema_tampering_are_rejected(tmp_path: Path, trust):
    private, publishers = trust

    unknown = _artifact(tmp_path / "unknown", private, "1.0.0", publisher="unknown")
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexArtifactStore(tmp_path / "managed-unknown", publishers).install(unknown)
    assert caught.value.code == "codex_artifact_publisher_unknown"

    wrong_key = Ed25519PrivateKey.generate()
    bad_signature = _artifact(tmp_path / "bad-signature", wrong_key, "1.0.1")
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexArtifactStore(tmp_path / "managed-signature", publishers).install(bad_signature)
    assert caught.value.code == "codex_artifact_signature_invalid"

    tampered = _artifact(tmp_path / "tampered", private, "1.0.2")
    (tampered / ("codex.cmd" if os.name == "nt" else "codex")).write_text("tampered", encoding="utf-8")
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexArtifactStore(tmp_path / "managed-tampered", publishers).install(tampered)
    assert caught.value.code == "codex_artifact_digest_mismatch"

    schema = _artifact(tmp_path / "schema", private, "1.0.3")
    (schema / "app-server.schema.json").write_text("tampered", encoding="utf-8")
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexArtifactStore(tmp_path / "managed-schema", publishers).install(schema)
    assert caught.value.code == "codex_schema_digest_mismatch"

    platform = _artifact(tmp_path / "platform", private, "1.0.4")
    manifest = json.loads((platform / "manifest.json").read_text())
    manifest["platform"] = "alien-platform"
    payload = json.dumps({k: v for k, v in manifest.items() if k != "signature"}, sort_keys=True,
                         separators=(",", ":"), ensure_ascii=False).encode()
    manifest["signature"] = base64.b64encode(private.sign(payload)).decode()
    (platform / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(RuntimeExecutionError) as caught:
        CodexArtifactStore(tmp_path / "managed-platform", publishers).install(platform)
    assert caught.value.code == "codex_artifact_platform_mismatch"


def test_versions_are_immutable_and_pointer_switch_is_atomic(tmp_path: Path, trust):
    private, publishers = trust
    store = CodexArtifactStore(tmp_path / "managed", publishers)
    one = store.install(_artifact(tmp_path / "one", private, "1.0.0"))
    assert one.version == "1.0.0"

    def interrupted():
        raise RuntimeError("power loss before pointer switch")

    with pytest.raises(RuntimeError):
        store.install(_artifact(tmp_path / "two", private, "2.0.0"), before_switch=interrupted)
    assert store.resolve().version == "1.0.0"
    assert (store.versions / "2.0.0").is_dir()

    store.install(tmp_path / "two")
    assert store.resolve().version == "2.0.0"
    assert store.resolve("1.0.0").version == "1.0.0"
    assert json.loads((store.root / "previous.json").read_text())["version"] == "1.0.0"


def test_release_installer_materializes_trust_store_and_managed_artifact(tmp_path: Path, trust):
    private, publishers = trust
    artifact = _artifact(tmp_path / "artifact", private, "4.5.6")
    trust_store = tmp_path / "trusted-publishers.json"
    trust_store.write_text(json.dumps({
        "opendrsai-release": base64.b64encode(publishers["opendrsai-release"]).decode("ascii"),
    }), encoding="utf-8")
    assert load_trusted_publishers(trust_store) == publishers

    state_root = tmp_path / "drsai-home"
    result = install_artifact(artifact, trust_store, state_root)
    assert result["version"] == "4.5.6"
    assert result["release_safe"] is True and result["source"] == "managed"
    codex_root = state_root / "runtime" / "codex"
    assert (codex_root / "trusted-publishers.json").read_bytes() == trust_store.read_bytes()
    installed = CodexArtifactStore(codex_root / "artifacts", load_trusted_publishers(codex_root / "trusted-publishers.json")).resolve()
    assert installed.version == "4.5.6" and installed.path.is_file()


def test_release_installer_rejects_untrusted_artifact_without_partial_pointer(tmp_path: Path, trust):
    private, _ = trust
    artifact = _artifact(tmp_path / "artifact", private, "4.5.7")
    wrong_public = Ed25519PrivateKey.generate().public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    )
    trust_store = tmp_path / "trusted-publishers.json"
    trust_store.write_text(json.dumps({"opendrsai-release": base64.b64encode(wrong_public).decode("ascii")}), encoding="utf-8")
    state_root = tmp_path / "drsai-home"
    with pytest.raises(RuntimeExecutionError) as caught:
        install_artifact(artifact, trust_store, state_root)
    assert caught.value.code == "codex_artifact_signature_invalid"
    assert not (state_root / "runtime" / "codex" / "artifacts" / "current.json").exists()


def test_compatibility_resolves_schema_from_artifact_root_for_nested_official_layout(tmp_path: Path, trust):
    private, publishers = trust
    root = tmp_path / "official-layout"
    binary = root / "vendor" / "bin" / ("codex.cmd" if os.name == "nt" else "codex")
    binary.parent.mkdir(parents=True)
    binary.write_text("@echo off\r\necho codex-cli 5.6.7\r\n" if os.name == "nt" else "#!/bin/sh\necho codex-cli 5.6.7\n", encoding="utf-8")
    if os.name != "nt":
        binary.chmod(0o755)
    schema = root / "app-server-schema" / "protocol.json"
    schema.parent.mkdir(parents=True)
    schema.write_text('{"api":"stable"}', encoding="utf-8")
    manifest = {
        "version": "5.6.7", "platform": "windows-x86_64" if os.name == "nt" else "linux-x86_64",
        "executable": binary.relative_to(root).as_posix(), "binary_digest": _digest(binary),
        "schema": schema.relative_to(root).as_posix(), "schema_digest": _digest(schema),
        "publisher": "opendrsai-release",
    }
    manifest["signature"] = base64.b64encode(private.sign(json.dumps(
        manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
    ).encode())).decode()
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    installed = CodexArtifactStore(tmp_path / "managed-nested", publishers).install(root)
    assert verify_codex_compatibility(installed) == "5.6.7"


def test_cli_manifest_and_schema_must_match_and_windows_launchers_are_actionable(tmp_path: Path, trust):
    private, publishers = trust
    store = CodexArtifactStore(tmp_path / "managed", publishers)
    binary = store.install(_artifact(tmp_path / "artifact", private, "3.2.1"))
    assert verify_codex_compatibility(binary) == "3.2.1"

    installed_binary = binary.path
    installed_binary.write_text("@echo off\r\necho codex-cli 9.9.9\r\n" if os.name == "nt" else "#!/bin/sh\necho codex-cli 9.9.9\n")
    if os.name != "nt":
        installed_binary.chmod(0o755)
    with pytest.raises(RuntimeExecutionError) as caught:
        verify_codex_compatibility(binary)
    assert caught.value.code == "codex_binary_version_mismatch"

    if os.name == "nt":
        command = CodexPlatformLauncher.command(Path("C:/tools/codex.cmd"), ["app-server"])
        assert command[0].casefold().endswith("cmd.exe") and command[1:4] == ["/d", "/s", "/c"]
        with patch("os.access", return_value=False):
            with pytest.raises(RuntimeExecutionError) as caught:
                CodexPlatformLauncher.command(Path("C:/Program Files/WindowsApps/OpenAI/codex.exe"), ["app-server"])
        assert caught.value.code == "codex_windowsapps_alias_inaccessible"
