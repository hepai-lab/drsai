"""Content-free diagnostic probe for a Runtime enrollment WSS handshake.

The probe reads the endpoint-local DPAPI credential, attaches with a unique
diagnostic instance, waits only for heartbeat_ack, and prints no runtime id,
token, URL, frame body, workspace path or user content.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import uuid4

import aiohttp

from drsai.relay.generated_contract import CAPABILITIES
from drsai.relay.runtime_client import RuntimeCredentialStore, resolve_runtime_version


def connection_url(raw_url: str, *, runtime_id: str, instance_id: str, version: str) -> str:
    parsed = urlparse(raw_url.strip())
    if parsed.scheme != "wss" or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("runtime_relay_probe_url_invalid")
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update({
        "runtime_id": runtime_id,
        "instance_id": instance_id,
        "version": version,
        "capabilities": ",".join(sorted(CAPABILITIES)),
    })
    return urlunparse(parsed._replace(query=urlencode(query)))


async def probe(state_root: Path, *, timeout: float = 10.0) -> dict[str, Any]:
    try:
        credential = RuntimeCredentialStore(state_root / "runtime/relay/credential.dpapi").load()
        raw_url = (state_root / "runtime/relay/relay-wss-url").read_text(encoding="utf-8").strip()
        url = connection_url(
            raw_url,
            runtime_id=credential.runtime_id,
            instance_id=f"diagnostic-{uuid4()}",
            version=resolve_runtime_version(),
        )
        headers = {"X-Runtime-Token": credential.registration_token}
    except (OSError, RuntimeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return {"status": "failed", "error_code": "local_configuration_error", "error_type": type(exc).__name__}
    try:
        # Keep the transport deadline slightly outside the explicit
        # heartbeat-ack deadline so the result identifies the failed phase.
        client_timeout = aiohttp.ClientTimeout(total=timeout + 5.0)
        async with aiohttp.ClientSession(headers=headers, timeout=client_timeout) as session:
            async with session.ws_connect(url, heartbeat=20) as socket:
                await socket.send_json({
                    "type": "heartbeat",
                    "timestamp": time.time(),
                    "capabilities": sorted(CAPABILITIES),
                })
                deadline = asyncio.get_running_loop().time() + timeout
                while asyncio.get_running_loop().time() < deadline:
                    try:
                        message = await asyncio.wait_for(
                            socket.receive(),
                            timeout=max(0.1, deadline - asyncio.get_running_loop().time()),
                        )
                    except (TimeoutError, asyncio.TimeoutError):
                        return {"status": "failed", "error_code": "heartbeat_ack_timeout"}
                    if message.type == aiohttp.WSMsgType.TEXT:
                        try:
                            value = json.loads(message.data)
                        except (TypeError, json.JSONDecodeError):
                            return {"status": "failed", "error_code": "invalid_text_frame"}
                        if isinstance(value, dict) and value.get("type") == "heartbeat_ack":
                            return {"status": "passed", "heartbeat_ack": True}
                        # Do not echo or otherwise process an unrelated frame.
                        continue
                    if message.type in {aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED}:
                        return {"status": "failed", "error_code": "closed_before_ack"}
                    if message.type == aiohttp.WSMsgType.ERROR:
                        return {"status": "failed", "error_code": "websocket_error"}
                return {"status": "failed", "error_code": "heartbeat_ack_timeout"}
    except aiohttp.WSServerHandshakeError as exc:
        return {
            "status": "failed",
            "error_code": "handshake_rejected",
            "http_status": int(exc.status),
            "error_type": type(exc).__name__,
        }
    except (aiohttp.ClientError, TimeoutError, asyncio.TimeoutError) as exc:
        return {"status": "failed", "error_code": "transport_error", "error_type": type(exc).__name__}
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        return {"status": "failed", "error_code": "local_configuration_error", "error_type": type(exc).__name__}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", type=Path, default=Path.home() / ".drsai-dev")
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    if args.timeout <= 0 or args.timeout > 30:
        raise SystemExit("runtime_relay_probe_timeout_invalid")
    result = asyncio.run(probe(args.state_root, timeout=args.timeout))
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
