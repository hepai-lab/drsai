from __future__ import annotations

import os
import re
import ssl
from pathlib import PurePosixPath
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
import yaml
from fastapi import APIRouter, HTTPException, Response

router = APIRouter()

CDN_ORIGIN = "https://download-opendrsai.ihep.ac.cn"
SUPPORTED_RELEASE_CHANNELS = ("beta", "stable")
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
TRUSTASIA_INTERMEDIATE = (
    Path(__file__).resolve().parent / "certs" / "TrustAsiaOVTLSRSACA2024.pem"
)
TRUSTASIA_CROSS_CERTIFICATE = (
    Path(__file__).resolve().parent / "certs" / "TrustAsiaTLSRSARootCA-cross.pem"
)


def _configured_release_channels() -> tuple[str, ...]:
    configured = os.getenv("OPENDRSAI_RELEASE_CHANNELS")
    if configured is None:
        # Preserve explicit legacy single-channel deployments. A fresh
        # development deployment prefers beta and falls back to stable.
        configured = os.getenv("OPENDRSAI_RELEASE_CHANNEL")
    if configured is None:
        configured = os.getenv("OPENDRSAI_MACOS_RELEASE_CHANNEL")
    if configured is None:
        configured = "beta,stable"

    channels: list[str] = []
    for raw_channel in configured.split(","):
        channel = raw_channel.strip().lower()
        if not channel:
            continue
        if channel not in SUPPORTED_RELEASE_CHANNELS:
            raise ValueError(f"Unsupported OpenDrSai release channel: {channel}")
        if channel not in channels:
            channels.append(channel)
    if not channels:
        raise ValueError("At least one OpenDrSai release channel is required")
    return tuple(channels)


RELEASE_CHANNELS = _configured_release_channels()


def _asset_name(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "download-opendrsai.ihep.ac.cn":
        raise ValueError("Release asset must use the trusted OpenDrSai CDN")
    name = PurePosixPath(parsed.path).name
    if not name:
        raise ValueError("Release asset URL has no filename")
    return name


def _validated_version(value: Any) -> str:
    version = str(value)
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("Release manifest contains an invalid version")
    return version


def _validated_sha256(value: Any) -> str:
    sha256 = str(value).lower()
    if not SHA256_PATTERN.fullmatch(sha256):
        raise ValueError("Release manifest contains an invalid SHA-256")
    return sha256


def _release_labels(
    version: str, channel: str, build_label: Any
) -> tuple[str | None, str | None]:
    normalized_build_label = str(build_label or "").strip() or None
    if normalized_build_label:
        return normalized_build_label, normalized_build_label
    # Older manifests sometimes encoded the prerelease label in the version.
    # In that case the version already communicates the channel and must not
    # be followed by another generic "Beta" label.
    if "-" in version:
        return None, None
    normalized_channel = channel.strip().lower()
    if normalized_channel == "beta":
        return None, "Beta"
    if normalized_channel == "stable":
        return None, "Stable"
    return None, channel.strip() or None


def _manifest_channel(manifest: dict[str, Any], selected_channel: str) -> str:
    channel = str(manifest.get("channel") or selected_channel).strip().lower()
    if channel != selected_channel:
        raise ValueError(
            f"Release manifest channel {channel!r} does not match "
            f"requested channel {selected_channel!r}"
        )
    return channel


def _manifest_url(
    platform: Literal["windows", "android", "macos"], channel: str
) -> str:
    if platform == "macos":
        return f"{CDN_ORIGIN}/channels/{channel}/macos/arm64/latest-mac.yml"
    return f"{CDN_ORIGIN}/channels/{channel}/latest-{platform}.json"


async def _fetch_json(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    response = await client.get(url)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Release manifest must be a JSON object")
    return payload


async def _fetch_yaml(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    response = await client.get(url)
    response.raise_for_status()
    payload = yaml.safe_load(response.text)
    if not isinstance(payload, dict):
        raise ValueError("Release manifest must be a YAML object")
    return payload


async def _windows_release(
    client: httpx.AsyncClient, manifest: dict[str, Any], selected_channel: str
) -> dict[str, Any]:
    version = _validated_version(manifest.get("version"))
    runtime = manifest.get("runtime")
    if not isinstance(runtime, dict):
        raise ValueError("Windows manifest is missing runtime metadata")
    runtime_url = str(runtime.get("url"))
    runtime_name = _asset_name(runtime_url)
    runtime_size = int(runtime.get("sizeBytes"))
    if runtime_size < 1:
        raise ValueError("Windows runtime size must be positive")

    installer_name = "OpenDrSai-Windows-Installer-x64.msi"
    installer_url = (
        f"{CDN_ORIGIN}/releases/v{version}/windows/{installer_name}"
    )
    installer_size: int | None = None
    try:
        installer_response = await client.head(installer_url)
        installer_response.raise_for_status()
        content_length = installer_response.headers.get("content-length")
        if content_length and int(content_length) > 0:
            installer_size = int(content_length)
    except (httpx.HTTPError, ValueError):
        pass

    channel = _manifest_channel(manifest, selected_channel)
    build_label, release_label = _release_labels(
        version, channel, manifest.get("buildLabel")
    )
    return {
        "platform": "windows",
        "version": version,
        "channel": channel,
        "buildLabel": build_label,
        "releaseLabel": release_label,
        "publishedAt": manifest.get("publishedAt"),
        "download": {
            "url": installer_url,
            "file": installer_name,
            "sizeBytes": installer_size,
        },
        "program": {
            "url": runtime_url,
            "file": runtime_name,
            "sizeBytes": runtime_size,
            "sha256": _validated_sha256(runtime.get("sha256")),
        },
    }


def _android_release(
    manifest: dict[str, Any], selected_channel: str
) -> dict[str, Any]:
    version = _validated_version(manifest.get("version"))
    apk = manifest.get("apk")
    if not isinstance(apk, dict):
        raise ValueError("Android manifest is missing APK metadata")
    apk_url = str(apk.get("url"))
    apk_name = _asset_name(apk_url)
    apk_size = int(apk.get("sizeBytes"))
    if apk_size < 1:
        raise ValueError("Android APK size must be positive")
    channel = _manifest_channel(manifest, selected_channel)
    build_label, release_label = _release_labels(
        version, channel, manifest.get("buildLabel")
    )
    return {
        "platform": "android",
        "version": version,
        "channel": channel,
        "buildLabel": build_label,
        "releaseLabel": release_label,
        "publishedAt": manifest.get("publishedAt"),
        "download": {
            "url": apk_url,
            "file": apk_name,
            "sizeBytes": apk_size,
            "sha256": _validated_sha256(apk.get("sha256")),
        },
    }


async def _macos_release(
    client: httpx.AsyncClient, manifest: dict[str, Any], selected_channel: str
) -> dict[str, Any]:
    version = _validated_version(manifest.get("version"))
    files = manifest.get("files")
    if not isinstance(files, list) or not files or not isinstance(files[0], dict):
        raise ValueError("macOS manifest is missing application metadata")
    application = files[0]
    application_name = PurePosixPath(str(application.get("url"))).name
    if not application_name:
        raise ValueError("macOS application URL has no filename")
    application_size = int(application.get("size"))
    if application_size < 1:
        raise ValueError("macOS application size must be positive")

    installer_name = f"OpenDrSai-macOS-v{version}-arm64.dmg"
    installer_url = f"{CDN_ORIGIN}/releases/v{version}/macos/{installer_name}"
    installer_response = await client.head(installer_url)
    installer_response.raise_for_status()
    installer_size = int(installer_response.headers.get("content-length", "0"))
    if installer_size < 1:
        raise ValueError("macOS installer size must be positive")

    application_url = f"{CDN_ORIGIN}/releases/v{version}/macos/{application_name}"
    channel = _manifest_channel(manifest, selected_channel)
    build_label, release_label = _release_labels(
        version, channel, manifest.get("buildLabel")
    )
    return {
        "platform": "macos",
        "version": version,
        "channel": channel,
        "buildLabel": build_label,
        "releaseLabel": release_label,
        "publishedAt": manifest.get("releaseDate"),
        "download": {
            "url": installer_url,
            "file": installer_name,
            "sizeBytes": installer_size,
        },
        "program": {
            "url": application_url,
            "file": application_name,
            "sizeBytes": application_size,
            "sha256": _validated_sha256(manifest.get("opendrsaiRuntimeSha256")),
        },
    }


async def fetch_latest_release(
    platform: Literal["windows", "android", "macos"],
    client: httpx.AsyncClient | None = None,
    channels: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    selected_channels = RELEASE_CHANNELS if channels is None else channels
    if not selected_channels:
        raise ValueError("At least one release channel is required")
    owns_client = client is None
    ssl_context = ssl.create_default_context()
    ssl_context.load_verify_locations(cafile=TRUSTASIA_INTERMEDIATE)
    ssl_context.load_verify_locations(cafile=TRUSTASIA_CROSS_CERTIFICATE)
    active_client = client or httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(8.0),
        # Release metadata comes from one fixed public CDN. Do not inherit
        # deployment-wide HTTP(S) proxy variables, whose private CA may not be
        # present in the WebUI runtime trust store.
        trust_env=False,
        verify=ssl_context,
    )
    try:
        for index, channel in enumerate(selected_channels):
            if channel not in SUPPORTED_RELEASE_CHANNELS:
                raise ValueError(f"Unsupported OpenDrSai release channel: {channel}")
            manifest_url = _manifest_url(platform, channel)
            try:
                manifest = (
                    await _fetch_yaml(active_client, manifest_url)
                    if platform == "macos"
                    else await _fetch_json(active_client, manifest_url)
                )
            except httpx.HTTPStatusError as exc:
                has_fallback = index + 1 < len(selected_channels)
                if exc.response.status_code == 404 and has_fallback:
                    continue
                raise

            if platform == "windows":
                return await _windows_release(active_client, manifest, channel)
            if platform == "android":
                return _android_release(manifest, channel)
            return await _macos_release(active_client, manifest, channel)
        raise ValueError("Latest release metadata is unavailable")
    finally:
        if owns_client:
            await active_client.aclose()


@router.get("/latest/{platform}")
async def latest_release(
    platform: Literal["windows", "android", "macos"], response: Response
) -> dict[str, Any]:
    try:
        release = await fetch_latest_release(platform)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=502, detail="Latest release metadata is unavailable"
        ) from exc
    response.headers["Cache-Control"] = "public, max-age=30"
    return release
