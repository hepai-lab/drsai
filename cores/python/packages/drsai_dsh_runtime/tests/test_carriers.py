from __future__ import annotations

import base64
import hashlib
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from opendrsai_dsh_runtime.carriers import CarrierReleaseError, CarrierReleaseManager


def signed_manifest(private_key, *, release_id, content, profile_id="dsh-sdk/test-production", platform="linux"):
    payload = {
        "schema_version": 1,
        "release_id": release_id,
        "platform": platform,
        "architecture": "x86_64",
        "profile_id": profile_id,
        "artifact": {
            "path": "bin/dsh-runtime",
            "sha256": hashlib.sha256(content).hexdigest(),
            "size": len(content),
        },
    }
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")).encode()
    return {**payload, "signature": {
        "algorithm": "ed25519",
        "key_id": "release-test",
        "value": base64.b64encode(private_key.sign(encoded)).decode("ascii"),
    }}


def write_source(root, content):
    path = root / "bin" / "dsh-runtime"
    path.parent.mkdir(parents=True)
    path.write_bytes(content)


@pytest.mark.asyncio
async def test_signed_side_by_side_install_canary_activation_and_rollback(tmp_path) -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    manager = CarrierReleaseManager(
        tmp_path / "installed",
        trusted_keys={"release-test": public_key},
        platform_name="linux",
        architecture="x86_64",
    )
    source1, source2 = tmp_path / "source1", tmp_path / "source2"
    content1, content2 = b"carrier-one", b"carrier-two"
    write_source(source1, content1)
    write_source(source2, content2)
    manifest1 = signed_manifest(private_key, release_id="release-1", content=content1)
    manifest2 = signed_manifest(private_key, release_id="release-2", content=content2)

    installed1 = manager.install(source1, manifest1)
    installed2 = manager.install(source2, manifest2)
    assert installed1["executable"] != installed2["executable"]
    assert manager.install(source1, manifest1)["artifact_sha256"] == installed1["artifact_sha256"]

    async def accepted_canary(executable, manifest):
        return {
            "accepted": executable.read_bytes() in {content1, content2},
            "profile_id": manifest.profile_id,
            "control": "1",
            "oaep": "1.0",
        }

    first = await manager.canary_and_activate("release-1", canary=accepted_canary)
    assert first["release_id"] == "release-1"
    second = await manager.canary_and_activate("release-2", canary=accepted_canary)
    assert second["previous_release_id"] == "release-1"
    assert manager.resolve_active()["release_id"] == "release-2"

    rolled_back = manager.rollback()
    assert rolled_back["release_id"] == "release-1"
    assert manager.resolve_active()["release_id"] == "release-1"
    assert (tmp_path / "installed" / "releases" / "release-2" / "bin" / "dsh-runtime").is_file()


@pytest.mark.asyncio
async def test_failed_canary_never_moves_active_pointer(tmp_path) -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    manager = CarrierReleaseManager(
        tmp_path / "installed", trusted_keys={"release-test": public_key},
        platform_name="linux", architecture="x86_64",
    )
    source = tmp_path / "source"
    content = b"candidate"
    write_source(source, content)
    manager.install(source, signed_manifest(private_key, release_id="candidate", content=content))

    async def rejected_canary(_executable, _manifest):
        return {"accepted": False, "reason": "probe_failed"}

    with pytest.raises(CarrierReleaseError, match="canary"):
        await manager.canary_and_activate("candidate", canary=rejected_canary)
    assert manager.resolve_active() is None


def test_signature_digest_platform_and_path_are_fail_closed(tmp_path) -> None:
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    manager = CarrierReleaseManager(
        tmp_path / "installed", trusted_keys={"release-test": public_key},
        platform_name="linux", architecture="x86_64",
    )
    source = tmp_path / "source"
    content = b"carrier"
    write_source(source, content)
    manifest = signed_manifest(private_key, release_id="release", content=content)

    tampered = {**manifest, "profile_id": "forged"}
    with pytest.raises(CarrierReleaseError, match="signature"):
        manager.install(source, tampered)
    wrong_platform = signed_manifest(private_key, release_id="wrong-platform", content=content, platform="windows")
    with pytest.raises(CarrierReleaseError, match="platform"):
        manager.install(source, wrong_platform)
    unsafe = signed_manifest(private_key, release_id="unsafe", content=content)
    unsafe["artifact"] = {**unsafe["artifact"], "path": "../escape"}
    with pytest.raises(CarrierReleaseError):
        manager.install(source, unsafe)

    source.joinpath("bin/dsh-runtime").write_bytes(b"tampered")
    with pytest.raises(CarrierReleaseError, match="size|digest"):
        manager.install(source, manifest)
