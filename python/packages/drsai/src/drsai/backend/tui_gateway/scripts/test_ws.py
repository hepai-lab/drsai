#!/usr/bin/env python3
"""Test WebSocket attach mode for the gateway."""

import asyncio
import json
import os
import subprocess
import sys
import time

import websockets


async def test_websocket():
    """Connect to gateway via WebSocket and run a few RPCs."""
    # Start gateway with WebSocket enabled
    env = os.environ.copy()
    env["DRSAI_TUI_ENABLE_WS"] = "1"
    env["DRSAI_TUI_WS_PORT"] = "9876"  # Fixed port for testing

    proc = subprocess.Popen(
        ["python", "-m", "drsai.backend.tui_gateway.entry"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
    )

    try:
        # Read gateway.ready from stdio to confirm it started
        raw = proc.stdout.readline()
        frame = json.loads(raw)
        assert frame.get("method") == "event"
        assert frame["params"]["type"] == "gateway.ready"
        ws_url = frame["params"]["payload"]["skin"].get("ws_attach_url")
        print(f"✓ gateway ready, WebSocket URL: {ws_url}")

        # Give the WS server a moment to fully start
        await asyncio.sleep(0.5)

        # Connect via WebSocket
        async with websockets.connect(ws_url) as ws:
            print("✓ WebSocket connected")

            # Wait for the duplicate gateway.ready event from WS
            ready_event = await ws.recv()
            frame = json.loads(ready_event.strip())
            assert frame["params"]["type"] == "gateway.ready"
            print("✓ received gateway.ready via WebSocket")

            # Send ping RPC
            req = {
                "jsonrpc": "2.0",
                "id": "ws-ping-1",
                "method": "ping",
                "params": {"test": "hello"},
            }
            await ws.send(json.dumps(req))
            resp_raw = await ws.recv()
            resp = json.loads(resp_raw.strip())
            assert resp.get("id") == "ws-ping-1"
            assert "result" in resp
            print(f"✓ ping → {resp['result']}")

            # Send session.list RPC
            req2 = {
                "jsonrpc": "2.0",
                "id": "ws-list-1",
                "method": "session.list",
                "params": {"limit": 3},
            }
            await ws.send(json.dumps(req2))
            resp_raw2 = await ws.recv()
            resp2 = json.loads(resp_raw2.strip())
            assert resp2.get("id") == "ws-list-1"
            assert "result" in resp2
            sessions = resp2["result"].get("sessions", [])
            print(f"✓ session.list → {len(sessions)} sessions")

        print("\n✓ All WebSocket tests passed!")
        return 0

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(asyncio.run(test_websocket()))
