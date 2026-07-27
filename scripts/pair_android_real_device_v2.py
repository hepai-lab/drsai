"""Create and consume a real ai-dev pairing grant without logging its code."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "cores/python/packages/drsai/src"
if str(SOURCE) not in sys.path:
    sys.path.insert(0, str(SOURCE))

from drsai.relay.mobile_pairing import MobilePairingGrant, MobilePairingService


def safe_report(
    readiness: dict[str, str],
    grant: MobilePairingGrant,
    *,
    device: str,
    dispatched: bool,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "runtime_id": readiness.get("runtime_id"),
        "environment": readiness.get("environment"),
        "grant_id": grant.grant_id,
        "grant_status": grant.status,
        "expires_at": grant.expires_at.isoformat(),
        "device": device,
        "deep_link_dispatched": dispatched,
        "associated": grant.status == "consumed",
    }


async def pair(args: argparse.Namespace) -> dict[str, Any]:
    service = MobilePairingService(args.state_root)
    readiness = service.readiness()
    if readiness.get("state") != "ready":
        raise RuntimeError(f"Runtime pairing is not ready: {readiness.get('state')}")
    grant = await service.create()
    if not grant.payload:
        raise RuntimeError("Relay did not return a pairing payload")
    launched = subprocess.run(
        [
            args.adb, "-s", args.device, "shell", "am", "start", "-W",
            "-a", "android.intent.action.VIEW",
            "-d", shlex.quote(grant.payload),
            "-p", args.package,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if launched.returncode:
        await service.revoke(grant.grant_id)
        raise RuntimeError("Android deep-link dispatch failed")
    deadline = time.monotonic() + args.timeout_seconds
    current = grant
    while time.monotonic() < deadline:
        await asyncio.sleep(1)
        current = await service.read(grant.grant_id)
        if current.status in {"consumed", "expired", "revoked"}:
            break
    return safe_report(readiness, current, device=args.device, dispatched=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--state-root",
        type=Path,
        default=Path(os.getenv("DRSAI_HOME", str(Path.home() / ".drsai"))),
    )
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.debug")
    parser.add_argument("--timeout-seconds", type=int, default=90)
    parser.add_argument(
        "--adb",
        default=str(
            Path(os.getenv("LOCALAPPDATA", "")) / "Android/Sdk/platform-tools/adb.exe"
        ),
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
