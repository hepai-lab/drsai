import json

import httpx
import pytest

from drsai_ui.ui_backend.backend.web.routes.releases import fetch_latest_release


@pytest.mark.asyncio
async def test_fetch_latest_windows_release_normalizes_manifest() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(200, headers={"content-length": "647168"})
        return httpx.Response(
            200,
            json={
                "version": "1.5.3",
                "channel": "beta",
                "publishedAt": "2026-07-26T13:52:01.350Z",
                "runtime": {
                    "url": "https://download-opendrsai.ihep.ac.cn/releases/v1.5.3/windows/OpenDrSai-Windows-v1.5.3-x64.zip",
                    "sizeBytes": 233589539,
                    "sha256": "07b2b300df27811519eea9d9e9df744933f2b3986e816a2e4171a8e52f817e99",
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        release = await fetch_latest_release("windows", client)

    assert release["version"] == "1.5.3"
    assert release["download"]["file"] == "OpenDrSai-Windows-Installer-x64.msi"
    assert release["download"]["sizeBytes"] == 647168
    assert release["program"]["file"] == "OpenDrSai-Windows-v1.5.3-x64.zip"
    assert release["program"]["sha256"].startswith("07b2b300")


@pytest.mark.asyncio
async def test_fetch_latest_android_release_normalizes_manifest() -> None:
    manifest = {
        "version": "1.5.3",
        "channel": "beta",
        "apk": {
            "url": "https://download-opendrsai.ihep.ac.cn/releases/v1.5.3/android/OpenDrSai-Android-v1.5.3.apk",
            "sizeBytes": 3076779,
            "sha256": "74fcb63c37ed5777196681b0b98d390ab74ba92c52b309e12c86778ba4051f8e",
        },
    }

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps(manifest))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        release = await fetch_latest_release("android", client)

    assert release["version"] == "1.5.3"
    assert release["download"]["file"] == "OpenDrSai-Android-v1.5.3.apk"
    assert release["download"]["sizeBytes"] == 3076779
    assert release["download"]["sha256"].startswith("74fcb63c")


@pytest.mark.asyncio
async def test_fetch_latest_macos_release_normalizes_manifest() -> None:
    manifest = """\
version: 1.5.1
files:
  - url: OpenDrSai-macOS-v1.5.1-arm64.zip
    size: 117994862
releaseDate: '2026-07-29T02:54:45.192Z'
opendrsaiRuntimeSha256: 4f814613e02cadcf6c1c4687ad5f4908f0eb703e3dde9f592cd3336c3ebd0679
"""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(200, headers={"content-length": "583030073"})
        return httpx.Response(200, text=manifest)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        release = await fetch_latest_release("macos", client)

    assert release["version"] == "1.5.1"
    assert release["channel"] == "stable"
    assert release["download"]["file"] == "OpenDrSai-macOS-v1.5.1-arm64.dmg"
    assert release["download"]["sizeBytes"] == 583030073
    assert release["program"]["file"] == "OpenDrSai-macOS-v1.5.1-arm64.zip"
    assert release["program"]["sizeBytes"] == 117994862
    assert release["program"]["sha256"].startswith("4f814613")
