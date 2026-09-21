from __future__ import annotations

from pathlib import Path
import hashlib
import json

import opendrsai_dsh_runtime.discovery as discovery


def test_missing_installation_is_visible_but_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(discovery, "_distribution_version", lambda _name: None)
    status = discovery.discover_dsh_installation(environ={}, system="Windows", machine="AMD64")
    assert status.state == "not_installed"
    assert not status.installed and not status.available
    assert status.action == "install"


def test_windows_wheel_is_reported_as_unsupported_not_available(monkeypatch) -> None:
    monkeypatch.setattr(discovery, "_distribution_version", lambda _name: "0.1.0-rc.5")
    status = discovery.discover_dsh_installation(environ={}, system="Windows", machine="AMD64")
    assert status.installed
    assert not status.available
    assert status.state == "unsupported_platform"
    assert status.action == "use_remote_or_wsl"


def test_explicit_absolute_carrier_requires_probe(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(discovery, "_distribution_version", lambda _name: None)
    carrier = tmp_path / "dsh-runtime"
    carrier.write_bytes(b"fixture")
    status = discovery.discover_dsh_installation(
        environ={"OPENDRSAI_DSH_RUNTIME_BIN": str(carrier)},
        system="Linux",
        machine="x86_64",
    )
    assert status.installed and not status.available
    assert status.state == "installed_unverified"
    assert status.carrier == str(carrier)
    assert status.action == "probe"


def test_relative_explicit_carrier_fails_closed(monkeypatch) -> None:
    monkeypatch.setattr(discovery, "_distribution_version", lambda _name: None)
    status = discovery.discover_dsh_installation(
        environ={"OPENDRSAI_DSH_RUNTIME_BIN": "dsh-runtime"},
        system="Linux",
        machine="x86_64",
    )
    assert status.state == "misconfigured"
    assert status.reason == "explicit_carrier_must_be_absolute"


def test_signed_managed_active_carrier_is_resolved_without_launching(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(discovery, "_distribution_version", lambda _name: None)
    root = tmp_path / "managed"
    release = root / "releases" / "release-1"
    executable = release / "bin" / "dsh-runtime"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"signed-carrier")
    (release / "release.json").write_text(json.dumps({
        "release_id": "release-1",
        "executable": str(executable),
        "artifact_sha256": hashlib.sha256(b"signed-carrier").hexdigest(),
    }), encoding="utf-8")
    (root / "active.json").write_text(json.dumps({"release_id": "release-1"}), encoding="utf-8")

    status = discovery.discover_dsh_installation(
        environ={"OPENDRSAI_DSH_CARRIER_ROOT": str(root)},
        system="Windows",
        machine="AMD64",
    )
    assert status.state == "installed_unverified"
    assert status.carrier == str(executable.resolve())
    assert status.action == "probe"

    executable.write_bytes(b"tampered")
    status = discovery.discover_dsh_installation(
        environ={"OPENDRSAI_DSH_CARRIER_ROOT": str(root)}, system="Windows", machine="AMD64",
    )
    assert status.state == "misconfigured"
    assert status.reason == "managed_carrier_digest_mismatch"
