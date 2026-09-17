"""Side-effect-free discovery of local DeepSeek Harness installations."""

from __future__ import annotations

import os
import platform
import hashlib
import json
from dataclasses import asdict, dataclass
from importlib import metadata
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class DshInstallationStatus:
    state: str
    installed: bool
    available: bool
    sdk_version: str | None
    runtime_version: str | None
    carrier: str | None
    platform: str
    architecture: str
    reason: str
    action: str | None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _distribution_version(name: str) -> str | None:
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def _explicit_carrier(environ: Mapping[str, str]) -> tuple[str | None, str | None]:
    raw = environ.get("OPENDRSAI_DSH_RUNTIME_BIN", "").strip()
    if not raw:
        return None, None
    path = Path(raw)
    if not path.is_absolute():
        return None, "explicit_carrier_must_be_absolute"
    if not path.is_file():
        return None, "explicit_carrier_not_found"
    return str(path), None


def _managed_carrier(environ: Mapping[str, str]) -> tuple[str | None, str | None]:
    configured = environ.get("OPENDRSAI_DSH_CARRIER_ROOT", "").strip()
    root = Path(configured).expanduser() if configured else Path.home() / ".drsai" / "dsh-runtime"
    try:
        root = root.resolve(strict=False)
        active = json.loads((root / "active.json").read_text(encoding="utf-8"))
        release_id = active.get("release_id")
        if not isinstance(release_id, str) or not release_id or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for character in release_id):
            return None, "managed_carrier_pointer_invalid"
        release_root = (root / "releases" / release_id).resolve(strict=False)
        release_root.relative_to(root / "releases")
        release = json.loads((release_root / "release.json").read_text(encoding="utf-8"))
        executable = Path(release.get("executable", "")).resolve(strict=False)
        executable.relative_to(release_root)
        digest = release.get("artifact_sha256")
        if not executable.is_file() or not isinstance(digest, str) or len(digest) != 64:
            return None, "managed_carrier_release_invalid"
        hasher = hashlib.sha256()
        with executable.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(chunk)
        actual = hasher.hexdigest()
        if actual != digest:
            return None, "managed_carrier_digest_mismatch"
        return str(executable), None
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None, "managed_carrier_metadata_invalid"


def discover_dsh_installation(
    *,
    environ: Mapping[str, str] | None = None,
    system: str | None = None,
    machine: str | None = None,
) -> DshInstallationStatus:
    """Report installation facts without importing or launching third-party code.

    Discovery never marks an installation usable merely because a package or
    executable exists. A later probe must match a production-ready protocol
    profile before `available` can become true.
    """

    env = os.environ if environ is None else environ
    os_name = (system or platform.system()).lower()
    architecture = (machine or platform.machine()).lower()
    sdk_version = _distribution_version("deepseek-harness-sdk")
    runtime_version = _distribution_version("deepseek-harness-runtime-bin")
    carrier, carrier_error = _explicit_carrier(env)
    if carrier is None and carrier_error is None:
        carrier, carrier_error = _managed_carrier(env)
    installed = bool(sdk_version or runtime_version or carrier)

    if carrier_error:
        return DshInstallationStatus(
            "misconfigured",
            installed,
            False,
            sdk_version,
            runtime_version,
            None,
            os_name,
            architecture,
            carrier_error,
            "choose_runtime_binary",
        )
    if not installed:
        return DshInstallationStatus(
            "not_installed",
            False,
            False,
            None,
            None,
            None,
            os_name,
            architecture,
            "deepseek_harness_not_installed",
            "install",
        )
    if os_name == "windows" and carrier is None:
        return DshInstallationStatus(
            "unsupported_platform",
            True,
            False,
            sdk_version,
            runtime_version,
            None,
            os_name,
            architecture,
            "official_runtime_carrier_unavailable_on_windows",
            "use_remote_or_wsl",
        )
    return DshInstallationStatus(
        "installed_unverified",
        True,
        False,
        sdk_version,
        runtime_version,
        carrier or "python-runtime-wheel",
        os_name,
        architecture,
        "runtime_probe_required",
        "probe",
    )
