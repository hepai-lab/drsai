"""Pair one authenticated Android device and emit sanitized V4 evidence."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from accept_mobile_remote_workspace_real_device_v2 import (  # noqa: E402
    GatewayPairingClient,
    capture_screenshot,
)
from accept_mobile_remote_workspace_two_device_v4 import _pair, phase  # noqa: E402


def _require_proof(value: Any) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise RuntimeError("v4_device_proof_invalid")
    try:
        bytes.fromhex(value)
    except ValueError as exc:
        raise RuntimeError("v4_device_proof_invalid") from exc
    return value


async def collect(args: argparse.Namespace) -> dict[str, Any]:
    proof = _require_proof(
        phase(args, args.device, "device-proof").get("device_proof_sha256")
    )
    pre = phase(args, args.device, "pre")
    if pre.get("target_visible") is not False:
        raise RuntimeError("v4_pre_pair_visibility_invalid")
    client = GatewayPairingClient(
        args.gateway_url,
        args.token_path,
        timeout_seconds=args.phase_timeout_seconds,
    )
    grant_id = await _pair(args, client, args.device)
    post = phase(args, args.device, "post")
    if not (
        post.get("target_visible") is True
        and post.get("runtime_status") == "online"
        and post.get("directory_ui_visible") is True
        and post.get("session_list_ui_visible") is True
    ):
        raise RuntimeError("v4_pair_catalog_invalid")
    pair = {
        "name": "pair_and_catalog",
        "status": "passed",
        **{
            key: post[key]
            for key in (
                "target_visible",
                "runtime_status",
                "runtime_generation",
                "workspace_count",
                "session_count",
                "conversation_item_count",
                "authenticated_opaque_pagination",
                "tampered_cursor_rejected",
                "directory_ui_visible",
                "session_list_ui_visible",
            )
            if key in post
        },
        **capture_screenshot(args, "pair-and-catalog"),
    }
    return {
        "schema_version": 1,
        "profile": "mobile-remote-workspace-v4",
        "passed": True,
        "devices": [{"device_proof_sha256": proof}],
        "grant_consumed_sha256": hashlib.sha256(grant_id.encode()).hexdigest(),
        "checks": [
            {
                "name": "pre_pair_invisible",
                "status": "passed",
                "target_visible": False,
                "catalog_count": pre.get("catalog_count"),
            },
            pair,
        ],
    }


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    state_root = Path.home() / ".drsai"
    parser.add_argument("--runtime-id", required=True)
    parser.add_argument("--base-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay/")
    parser.add_argument("--gateway-url", default="http://127.0.0.1:18642")
    parser.add_argument("--token-path", type=Path, default=state_root / "runtime/instance-token")
    parser.add_argument("--device", default="R5GYB3S8ACH")
    parser.add_argument("--package", default="ai.drsai.remote.acceptance")
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--phase-timeout-seconds", type=int, default=120)
    parser.add_argument("--pair-timeout-seconds", type=int, default=120)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = asyncio.run(collect(args))
    atomic_json(args.output, result)
    print(json.dumps({"passed": True, "device_count": 1}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
