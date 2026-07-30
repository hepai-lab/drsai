from __future__ import annotations

import base64
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from drsai.owop.process_pty import LocalProcessPtyOperations, _WINDOWS_BACKGROUND_PROCESS_FLAGS


pytestmark = pytest.mark.skipif(os.name != "nt", reason="C05-F07 validates Windows Process and ConPTY")


def test_windows_background_processes_never_allocate_a_console() -> None:
    assert _WINDOWS_BACKGROUND_PROCESS_FLAGS & subprocess.CREATE_NEW_PROCESS_GROUP
    assert _WINDOWS_BACKGROUND_PROCESS_FLAGS & subprocess.CREATE_NO_WINDOW


def _bytes(result: dict, stream: str | None = None) -> bytes:
    return b"".join(
        base64.b64decode(item["content_base64"])
        for item in result["segments"]
        if stream is None or item["stream"] == stream
    )


def _wait_attach(attach, identity: str, needle: bytes, timeout: float = 10) -> dict:
    deadline = time.monotonic() + timeout
    latest = {}
    while time.monotonic() < deadline:
        latest = attach({identity: attach.identity, "after_offset": 0})
        if needle in _bytes(latest):
            return latest
        time.sleep(0.05)
    raise AssertionError(f"output did not contain {needle!r}: {_bytes(latest)!r}")


class _Attach:
    def __init__(self, function, identity: str):
        self.function = function
        self.identity = identity

    def __call__(self, params):
        return self.function(params)


def test_windows_process_lifecycle_and_tree_cleanup(tmp_path: Path):
    operations = LocalProcessPtyOperations(tmp_path)
    try:
        started = operations.process_start({
            "argv": [sys.executable, "-u", "-c",
                     "import sys; print('OUT', flush=True); print('ERR', file=sys.stderr, flush=True); print(sys.stdin.readline().strip(), flush=True)"],
            "cwd": ".", "max_output_bytes": 4096,
        })
        operations.process_write({"process_id": started["process_id"],
                                  "content_base64": base64.b64encode(b"INPUT\n").decode()})
        attach = _Attach(operations.process_attach, started["process_id"])
        result = _wait_attach(attach, "process_id", b"INPUT")
        assert b"OUT" in _bytes(result, "stdout")
        assert b"ERR" in _bytes(result, "stderr")
        deadline = time.monotonic() + 5
        while result["running"] and time.monotonic() < deadline:
            time.sleep(0.05)
            result = operations.process_attach({"process_id": started["process_id"], "after_offset": 0})
        assert result["exit_code"] == 0

        bounded = operations.process_start({
            "argv": [sys.executable, "-c", "import sys; sys.stdout.write('Z'*4096)"],
            "cwd": ".", "max_output_bytes": 1024,
        })
        bounded_attach = _Attach(operations.process_attach, bounded["process_id"])
        result = _wait_attach(bounded_attach, "process_id", b"Z" * 1024)
        assert result["truncated"] is True
        assert result["start_offset"] == 3072
        assert len(_bytes(result)) == 1024

        timed = operations.process_start({
            "argv": [sys.executable, "-c", "import time; time.sleep(30)"],
            "cwd": ".", "timeout_ms": 100,
        })
        deadline = time.monotonic() + 10
        timed_result = {}
        while time.monotonic() < deadline:
            timed_result = operations.process_attach({"process_id": timed["process_id"], "after_offset": 0})
            if not timed_result["running"]:
                break
            time.sleep(0.05)
        assert timed_result["timed_out"] is True
        assert timed_result["running"] is False

        marker = tmp_path / "orphan.txt"
        child_code = f"import time,pathlib; time.sleep(2); pathlib.Path({str(marker)!r}).write_text('orphan')"
        parent_code = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child_code!r}]); time.sleep(30)"
        tree = operations.process_start({"argv": [sys.executable, "-c", parent_code], "cwd": "."})
        time.sleep(0.5)
        operations.process_kill({"process_id": tree["process_id"], "tree": True})
        time.sleep(2.5)
        assert not marker.exists(), "process.kill(tree=true) left a live descendant"
    finally:
        operations.close()


def test_windows_real_conpty_write_resize_attach_kill_and_truncation(tmp_path: Path):
    repo_root = Path(__file__).resolve().parents[5]
    candidates = (
        repo_root / "apps" / "desktop" / "windows" / "node_modules" / "node-pty",
        repo_root / "apps" / "desktop" / "node_modules" / "node-pty",
    )
    node_pty = next((candidate for candidate in candidates if candidate.is_dir()), candidates[0])
    assert node_pty.is_dir(), "node-pty must be present in the Windows Desktop dependency tree"
    operations = LocalProcessPtyOperations(tmp_path, node_pty_module=node_pty)
    try:
        started = operations.pty_create({
            "argv": ["powershell.exe", "-NoLogo", "-NoProfile", "-NoExit"],
            "cwd": ".", "cols": 80, "rows": 24, "max_buffer_bytes": 1024,
        })
        resized = operations.pty_resize({"pty_id": started["pty_id"], "cols": 132, "rows": 43})
        assert resized == {"pty_id": started["pty_id"], "cols": 132, "rows": 43}
        command = b"Write-Output (('X' * 3000) + '_OWOP_CONPTY_END')\r"
        written = operations.pty_write({"pty_id": started["pty_id"],
                                        "content_base64": base64.b64encode(command).decode()})
        assert written["written"] == len(command)
        attach = _Attach(operations.pty_attach, started["pty_id"])
        result = _wait_attach(attach, "pty_id", b"OWOP_CONPTY_END", timeout=15)
        deadline = time.monotonic() + 3
        while not result["truncated"] and time.monotonic() < deadline:
            time.sleep(0.05)
            result = operations.pty_attach({"pty_id": started["pty_id"], "after_offset": 0})
        assert result["truncated"] is True
        assert result["next_offset"] - result["start_offset"] <= 1024
        cursor = result["next_offset"]
        assert operations.pty_attach({"pty_id": started["pty_id"], "after_offset": cursor})["segments"] == []
        operations.pty_kill({"pty_id": started["pty_id"]})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = operations.pty_attach({"pty_id": started["pty_id"], "after_offset": cursor})
            if not result["running"]:
                break
            time.sleep(0.05)
        assert result["running"] is False
    finally:
        operations.close()
