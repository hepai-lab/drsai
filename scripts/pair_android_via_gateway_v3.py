"""Consume a live device-bound pairing grant through the installed Runtime Gateway.

The Runtime credential remains inside the Gateway process. The one-time payload is passed
directly to ADB and is never printed or persisted.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp


class GatewayClient:
    def __init__(self, root: str, token_path: Path) -> None:
        parsed = urlparse(root)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError("gateway_pairing_url_must_be_loopback")
        token = token_path.read_text(encoding="utf-8").strip()
        if not (32 <= len(token) <= 128):
            raise RuntimeError("gateway_instance_token_invalid")
        self.root = root.rstrip("/")
        self.headers = {"X-OpenDrSai-Gateway-Token": token}

    async def request(self, method: str, path: str) -> dict[str, Any]:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(
                method,
                self.root + path,
                headers=self.headers,
            ) as response:
                body = await response.json(content_type=None)
                if response.status >= 400:
                    detail = body.get("detail") if isinstance(body, dict) else None
                    code = detail.get("code") if isinstance(detail, dict) else "unknown"
                    raise RuntimeError(
                        f"gateway_pairing_request_failed:{response.status}:{code}"
                    )
                if not isinstance(body, dict):
                    raise RuntimeError("gateway_pairing_response_invalid")
                return body


async def pair(args: argparse.Namespace) -> dict[str, Any]:
    client = GatewayClient(
        args.gateway_url,
        args.state_root / "runtime" / "instance-token",
    )
    readiness = await client.request("GET", "/v1/mobile-pairing/status")
    if readiness.get("state") != "ready":
        raise RuntimeError(f"gateway_pairing_not_ready:{readiness.get('state')}")
    grant = await client.request("POST", "/v1/mobile-pairing/grants")
    grant_id = grant.get("grant_id")
    payload = grant.get("payload")
    if not isinstance(grant_id, str) or not isinstance(payload, str):
        raise RuntimeError("gateway_pairing_grant_invalid")
    launched = subprocess.run(
        [
            str(args.adb),
            "-s",
            args.device,
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            shlex.quote(payload),
            "-p",
            args.package,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if launched.returncode:
        await client.request("DELETE", f"/v1/mobile-pairing/grants/{grant_id}")
        raise RuntimeError("android_pairing_dispatch_failed")
    deadline = time.monotonic() + args.timeout_seconds
    current = grant
    while time.monotonic() < deadline:
        await asyncio.sleep(1)
        current = await client.request(
            "GET",
            f"/v1/mobile-pairing/grants/{grant_id}",
        )
        if current.get("status") in {"consumed", "expired", "revoked"}:
            break
    return {
        "schema_version": 1,
        "runtime_id": readiness.get("runtime_id"),
        "grant_id": grant_id,
        "status": current.get("status"),
        "device": args.device,
        "associated": current.get("status") == "consumed",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--state-root",
        type=Path,
        default=Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai"))),
    )
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument("--timeout-seconds", type=int, default=90)
    parser.add_argument(
        "--adb",
        type=Path,
        default=Path(os.getenv("LOCALAPPDATA", ""))
        / "Android/Sdk/platform-tools/adb.exe",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = asyncio.run(pair(args))
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["associated"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
