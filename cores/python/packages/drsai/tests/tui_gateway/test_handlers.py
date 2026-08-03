"""Pytest tests for tui_gateway — boots the gateway as a subprocess and exercises RPC handlers."""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[6]
DRSAI_SRC = ROOT / "cores" / "python" / "packages" / "drsai" / "src"


def _gateway_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(DRSAI_SRC) if not existing else f"{DRSAI_SRC}{os.pathsep}{existing}"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    if extra:
        env.update(extra)
    return env


def _read_frame(proc, timeout: float = 10.0):
    start = time.time()
    while time.time() - start < timeout:
        raw = proc.stdout.readline()
        if not raw:
            stderr = proc.stderr.read() if proc.stderr else ""
            raise AssertionError(f"gateway stdout closed before frame; stderr:\n{stderr[-2000:]}")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            continue
    raise AssertionError("timed out waiting for gateway frame")


def _read_response(proc, rid: str, timeout: float = 10.0):
    """Read JSON-RPC frames until we find the response with the given id."""
    start = time.time()
    while time.time() - start < timeout:
        frame = _read_frame(proc, timeout=max(0.1, timeout - (time.time() - start)))
        # Skip event frames
        if "method" in frame and frame.get("method") == "event":
            continue
        if frame.get("id") == rid:
            return frame
    return None


@pytest.fixture
def gateway_proc(tmp_path: Path):
    """Start the gateway subprocess and tear it down at end of test."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "drsai.backend.tui_gateway.entry"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=_gateway_env({"DRSAI_HOME": str(tmp_path / "drsai-home")}),
    )

    # Wait for gateway.ready event
    frame = _read_frame(proc)
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


def _start_gateway(extra_env: dict[str, str] | None = None):
    temporary_home = tempfile.TemporaryDirectory(prefix="drsai-tui-test-")
    isolated_env = {"DRSAI_HOME": temporary_home.name, **(extra_env or {})}
    proc = subprocess.Popen(
        [sys.executable, "-m", "drsai.backend.tui_gateway.entry"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=_gateway_env(isolated_env),
    )
    frame = _read_frame(proc)
    assert frame.get("method") == "event"
    assert frame["params"]["type"] == "gateway.ready"
    proc._drsai_temporary_home = temporary_home
    return proc


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


def test_prompt_submit_streams_agent_events_without_external_model():
    """prompt.submit bridges TUI RPC to an agent session and streams events back."""
    proc = _start_gateway({"DRSAI_TUI_FAKE_AGENT": "1"})
    try:
        create_resp = _request(proc, "session.create", {"name": "pytest-fake-agent"})
        assert create_resp is not None and "result" in create_resp
        sid = create_resp["result"]["session_id"]

        resume_resp = _request(proc, "session.resume", {"session_id": sid}, rid="resume-fake")
        assert resume_resp is not None and "result" in resume_resp
        assert resume_resp["result"]["info"]["model"] == "fake"

        req = {
            "jsonrpc": "2.0",
            "id": "prompt-fake",
            "method": "prompt.submit",
            "params": {"session_id": sid, "text": "hello terminal backend"},
        }
        proc.stdin.write(json.dumps(req) + "\n")
        proc.stdin.flush()

        saw_response = False
        saw_delta = False
        saw_complete = False
        deadline = time.time() + 10
        while time.time() < deadline and not (saw_response and saw_delta and saw_complete):
            frame = _read_frame(proc, timeout=10)
            if frame.get("id") == "prompt-fake":
                saw_response = frame.get("result", {}).get("status") == "streaming"
            if frame.get("method") == "event":
                params = frame.get("params", {})
                event_type = params.get("type")
                payload = params.get("payload", {})
                if event_type == "message.delta":
                    saw_delta = "fake-agent: hello terminal backend" in payload.get("text", "")
                elif event_type == "message.complete":
                    saw_complete = True

        assert saw_response
        assert saw_delta
        assert saw_complete
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
