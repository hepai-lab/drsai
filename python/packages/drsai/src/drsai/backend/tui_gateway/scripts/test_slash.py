#!/usr/bin/env python3
"""Test slash command execution through gateway RPC."""

import json
import subprocess
import sys
import time


def send_request(proc, method, params):
    """Send JSON-RPC request and wait for response."""
    req = {
        "jsonrpc": "2.0",
        "id": f"test-{int(time.time()*1000)}",
        "method": method,
        "params": params,
    }
    line = json.dumps(req) + "\n"
    proc.stdin.write(line)
    proc.stdin.flush()

    # Read response (may have events mixed in)
    rid = req["id"]
    while True:
        raw = proc.stdout.readline()
        if not raw:
            return None
        frame = json.loads(raw)
        # Skip event frames
        if "method" in frame and frame.get("method") == "event":
            print(f"[event] {frame.get('params', {}).get('type', '?')}", file=sys.stderr)
            continue
        # Check if this is our response
        if frame.get("id") == rid:
            return frame
    return None


def main():
    proc = subprocess.Popen(
        ["python", "-m", "drsai.backend.tui_gateway.entry"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    try:
        # Wait for gateway.ready
        raw = proc.stdout.readline()
        frame = json.loads(raw)
        assert frame.get("method") == "event"
        assert frame["params"]["type"] == "gateway.ready"
        print("✓ gateway ready")

        # Get or create a session
        resp = send_request(proc, "session.list", {"limit": 1})
        if resp and "result" in resp:
            sessions = resp["result"].get("sessions", [])
            if sessions:
                session_id = sessions[0].get("session_id") or sessions[0].get("thread_id")
                print(f"✓ using existing session: {session_id[:8]}")
            else:
                # Create new session
                resp = send_request(proc, "session.create", {"name": "slash-test"})
                session_id = resp["result"]["session_id"]
                print(f"✓ created session: {session_id[:8]}")
        else:
            print("✗ session.list failed")
            return 1

        # Test slash commands
        commands_to_test = [
            ("help", ""),
            ("model", ""),
            ("models", ""),
            ("commands.catalog", ""),
            ("complete.slash", "mod"),
        ]

        for method_prefix, cmd in commands_to_test:
            if method_prefix == "commands.catalog":
                resp = send_request(proc, "commands.catalog", {})
                if resp and "result" in resp:
                    pairs = resp["result"].get("pairs", [])
                    print(f"✓ commands.catalog → {len(pairs)} commands")
                else:
                    print(f"✗ commands.catalog failed: {resp}")
                    return 1
            elif method_prefix == "complete.slash":
                resp = send_request(proc, "complete.slash", {"prefix": cmd})
                if resp and "result" in resp:
                    items = resp["result"].get("items", [])
                    print(f"✓ complete.slash '{cmd}' → {len(items)} items")
                else:
                    print(f"✗ complete.slash failed: {resp}")
                    return 1
            else:
                # Slash command via slash.exec
                resp = send_request(proc, "slash.exec", {
                    "session_id": session_id,
                    "command": method_prefix,
                    "args": cmd,
                })
                if resp and "result" in resp:
                    output = resp["result"].get("output", "")
                    print(f"✓ slash.exec /{method_prefix} → {len(output)} chars")
                elif resp and "error" in resp:
                    print(f"✗ slash.exec /{method_prefix} → {resp['error']}")
                    return 1
                else:
                    print(f"✗ slash.exec /{method_prefix} failed: {resp}")
                    return 1

        print("\n✓ All slash command tests passed!")
        return 0

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
