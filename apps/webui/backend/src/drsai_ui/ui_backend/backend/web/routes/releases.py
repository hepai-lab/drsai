import os
import re
import ssl
from pathlib import PurePosixPath
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Response

router = APIRouter()

CDN_ORIGIN = "https://download-opendrsai.ihep.ac.cn"
RELEASE_CHANNEL = os.getenv("OPENDRSAI_RELEASE_CHANNEL", "beta")
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
TRUSTASIA_INTERMEDIATE = (
    Path(__file__).resolve().parent / "certs" / "TrustAsiaOVTLSRSACA2024.pem"
)
TRUSTASIA_CROSS_CERTIFICATE = (
    Path(__file__).resolve().parent / "certs" / "TrustAsiaTLSRSARootCA-cross.pem"
)


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


async def _fetch_json(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    response = await client.get(url)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Release manifest must be a JSON object")
    return payload


async def _windows_release(
    client: httpx.AsyncClient, manifest: dict[str, Any]
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

    return {
        "platform": "windows",
        "version": version,
        "channel": str(manifest.get("channel") or RELEASE_CHANNEL),
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


def _android_release(manifest: dict[str, Any]) -> dict[str, Any]:
    version = _validated_version(manifest.get("version"))
    apk = manifest.get("apk")
    if not isinstance(apk, dict):
        raise ValueError("Android manifest is missing APK metadata")
    apk_url = str(apk.get("url"))
    apk_name = _asset_name(apk_url)
    apk_size = int(apk.get("sizeBytes"))
    if apk_size < 1:
        raise ValueError("Android APK size must be positive")
    return {
        "platform": "android",
        "version": version,
        "channel": str(manifest.get("channel") or RELEASE_CHANNEL),
        "publishedAt": manifest.get("publishedAt"),
        "download": {
            "url": apk_url,
            "file": apk_name,
            "sizeBytes": apk_size,
            "sha256": _validated_sha256(apk.get("sha256")),
        },
    }


async def fetch_latest_release(
    platform: Literal["windows", "android"],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    manifest_url = (
        f"{CDN_ORIGIN}/channels/{RELEASE_CHANNEL}/latest-{platform}.json"
    )
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
        manifest = await _fetch_json(active_client, manifest_url)
        if platform == "windows":
            return await _windows_release(active_client, manifest)
        return _android_release(manifest)
    finally:
        if owns_client:
            await active_client.aclose()


@router.get("/latest/{platform}")
async def latest_release(
    platform: Literal["windows", "android"], response: Response
) -> dict[str, Any]:
    try:
        release = await fetch_latest_release(platform)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=502, detail="Latest release metadata is unavailable"
        ) from exc
    response.headers["Cache-Control"] = "public, max-age=30"
    return release
