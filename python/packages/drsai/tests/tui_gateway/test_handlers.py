"""Pytest tests for tui_gateway — boots the gateway as a subprocess and exercises RPC handlers."""

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest


def _read_response(proc, rid: str, timeout: float = 10.0):
    """Read JSON-RPC frames until we find the response with the given id."""
    start = time.time()
    while time.time() - start < timeout:
        raw = proc.stdout.readline()
        if not raw:
            return None
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            continue
        # Skip event frames
        if "method" in frame and frame.get("method") == "event":
            continue
        if frame.get("id") == rid:
            return frame
    return None


@pytest.fixture
def gateway_proc():
    """Start the gateway subprocess and tear it down at end of test."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "drsai.backend.tui_gateway.entry"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    # Wait for gateway.ready event
    raw = proc.stdout.readline()
    frame = json.loads(raw)
    assert frame.get("method") == "event"
    assert frame["params"]["type"] == "gateway.ready"

    yield proc

    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def _request(proc, method: str, params: dict, rid: str | None = None):
    """Send a JSON-RPC request and wait for the response."""
    rid = rid or f"test-{int(time.time() * 1000)}"
    req = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    return _read_response(proc, rid)


# ── Smoke tests ──────────────────────────────────────────────────────


def test_gateway_boots(gateway_proc):
    """Gateway emits gateway.ready and can handle a ping."""
    resp = _request(gateway_proc, "ping", {"echo": "hi"})
    assert resp is not None
    assert "result" in resp
    assert resp["result"]["echo"] == {"echo": "hi"}


def test_session_list(gateway_proc):
    """session.list returns a sessions array."""
    resp = _request(gateway_proc, "session.list", {"limit": 5})
    assert resp is not None
    assert "result" in resp
    assert isinstance(resp["result"].get("sessions"), list)
    assert "user_id" in resp["result"]


def test_commands_catalog(gateway_proc):
    """commands.catalog returns the full command registry."""
    resp = _request(gateway_proc, "commands.catalog", {})
    assert resp is not None
    assert "result" in resp
    result = resp["result"]
    assert "pairs" in result
    assert "categories" in result
    assert len(result["pairs"]) >= 30  # At least 30 commands registered


def test_complete_slash(gateway_proc):
    """complete.slash returns autocomplete suggestions."""
    resp = _request(gateway_proc, "complete.slash", {"prefix": "mod"})
    assert resp is not None
    assert "result" in resp
    items = resp["result"].get("items", [])
    # /model, /models, /model_global should match
    assert len(items) >= 2
    texts = [item["text"] for item in items]
    assert "/model" in texts


def test_model_options(gateway_proc):
    """model.options returns available models for the UI picker."""
    resp = _request(gateway_proc, "model.options", {})
    assert resp is not None
    assert "result" in resp
    result = resp["result"]
    assert "models" in result
    assert "current" in result
    assert isinstance(result["models"], list)


def test_unknown_method(gateway_proc):
    """Unknown methods return -32601 error."""
    resp = _request(gateway_proc, "nonexistent.method", {})
    assert resp is not None
    assert "error" in resp
    assert resp["error"]["code"] == -32601


def test_session_create_and_resolve(gateway_proc):
    """session.create creates a session and we can resolve it."""
    create_resp = _request(gateway_proc, "session.create", {"name": "pytest-session"})
    assert create_resp is not None
    assert "result" in create_resp
    sid = create_resp["result"]["session_id"]
    assert len(sid) > 8

    # Search for it
    search_resp = _request(gateway_proc, "session.search", {"query": "pytest", "limit": 10})
    assert search_resp is not None
    assert "result" in search_resp
    found = any(s.get("session_id") == sid for s in search_resp["result"]["sessions"])
    assert found, f"Created session {sid} not found in search"
