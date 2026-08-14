import json

import httpx
import pytest

from drsai_ui.ui_backend.backend.web.routes.releases import (
    _configured_release_channels,
    _release_labels,
    fetch_latest_release,
)


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
                "buildLabel": " Beta 3 ",
                "publishedAt": "2026-07-26T13:52:01.350Z",
                "runtime": {
                    "url": "https://download-opendrsai.ihep.ac.cn/releases/v1.5.3/windows/OpenDrSai-Windows-v1.5.3-x64.zip",
                    "sizeBytes": 233589539,
                    "sha256": "07b2b300df27811519eea9d9e9df744933f2b3986e816a2e4171a8e52f817e99",
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        release = await fetch_latest_release("windows", client, ("beta",))

    assert release["version"] == "1.5.3"
    assert release["buildLabel"] == "Beta 3"
    assert release["releaseLabel"] == "Beta 3"
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
        release = await fetch_latest_release("android", client, ("beta",))

    assert release["version"] == "1.5.3"
    assert release["download"]["file"] == "OpenDrSai-Android-v1.5.3.apk"
    assert release["download"]["sizeBytes"] == 3076779
    assert release["download"]["sha256"].startswith("74fcb63c")
    assert release["buildLabel"] is None
    assert release["releaseLabel"] == "Beta"


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
        release = await fetch_latest_release("macos", client, ("stable",))

    assert release["version"] == "1.5.1"
    assert release["channel"] == "stable"
    assert release["download"]["file"] == "OpenDrSai-macOS-v1.5.1-arm64.dmg"
    assert release["download"]["sizeBytes"] == 583030073
    assert release["program"]["file"] == "OpenDrSai-macOS-v1.5.1-arm64.zip"
    assert release["program"]["sizeBytes"] == 117994862
    assert release["program"]["sha256"].startswith("4f814613")


@pytest.mark.parametrize(
    ("version", "channel", "build_label", "expected"),
    [
        ("1.5.8", "beta", "Beta 3", ("Beta 3", "Beta 3")),
        ("1.5.8", "beta", None, (None, "Beta")),
        ("1.5.8", "beta", "Beta 4", ("Beta 4", "Beta 4")),
        ("1.5.8-beta.3", "beta", None, (None, None)),
        ("1.5.8-rc.1", "beta", "", (None, None)),
    ],
)
def test_release_labels_support_current_and_legacy_manifests(
    version: str,
    channel: str,
    build_label: str | None,
    expected: tuple[str | None, str | None],
) -> None:
    assert _release_labels(version, channel, build_label) == expected


@pytest.mark.asyncio
async def test_development_policy_falls_back_from_missing_beta_to_stable() -> None:
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        if request.url.path == "/channels/beta/latest-android.json":
            return httpx.Response(404, request=request)
        return httpx.Response(
            200,
            request=request,
            json={
                "version": "1.5.7",
                "channel": "stable",
                "apk": {
                    "url": "https://download-opendrsai.ihep.ac.cn/releases/v1.5.7/android/OpenDrSai-Android-v1.5.7.apk",
                    "sizeBytes": 3076779,
                    "sha256": "74fcb63c37ed5777196681b0b98d390ab74ba92c52b309e12c86778ba4051f8e",
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        release = await fetch_latest_release(
            "android", client, ("beta", "stable")
        )

    assert requested_paths == [
        "/channels/beta/latest-android.json",
        "/channels/stable/latest-android.json",
    ]
    assert release["channel"] == "stable"
    assert release["releaseLabel"] == "Stable"


@pytest.mark.asyncio
async def test_production_policy_requests_stable_only() -> None:
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        if request.method == "HEAD":
            return httpx.Response(
                200, request=request, headers={"content-length": "647168"}
            )
        return httpx.Response(
            200,
            request=request,
            json={
                "version": "1.5.8",
                "channel": "stable",
                "runtime": {
                    "url": "https://download-opendrsai.ihep.ac.cn/releases/v1.5.8/windows/OpenDrSai-Windows-v1.5.8-x64.zip",
                    "sizeBytes": 355495575,
                    "sha256": "e710fa6d0837ec7d6f5f8109d6c9d4801736b0452c2a844dd7c70748b6fd9ea1",
                },
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        release = await fetch_latest_release("windows", client, ("stable",))

    assert requested_paths[0] == "/channels/stable/latest-windows.json"
    assert not any("/beta/" in path for path in requested_paths)
    assert release["channel"] == "stable"


@pytest.mark.asyncio
async def test_invalid_beta_manifest_does_not_silently_fall_back() -> None:
    requested_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return httpx.Response(200, request=request, json={"version": "invalid"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(ValueError):
            await fetch_latest_release("android", client, ("beta", "stable"))

    assert requested_paths == ["/channels/beta/latest-android.json"]


def test_release_channel_configuration_supports_new_and_legacy_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENDRSAI_RELEASE_CHANNELS", "beta, stable, beta")
    assert _configured_release_channels() == ("beta", "stable")

    monkeypatch.delenv("OPENDRSAI_RELEASE_CHANNELS")
    monkeypatch.setenv("OPENDRSAI_RELEASE_CHANNEL", "stable")
    assert _configured_release_channels() == ("stable",)

    monkeypatch.delenv("OPENDRSAI_RELEASE_CHANNEL")
    monkeypatch.delenv("OPENDRSAI_MACOS_RELEASE_CHANNEL", raising=False)
    assert _configured_release_channels() == ("stable",)
