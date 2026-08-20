from __future__ import annotations

import ctypes
import os
import sys
import time
import subprocess
from ctypes import wintypes
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import WindowsJobError, WindowsJobLauncher, WindowsJobLimits


pytestmark = pytest.mark.skipif(os.name != "nt", reason="Windows Job Object acceptance requires Windows")


def minimal_windows_environment(tmp_path: Path) -> dict[str, str]:
    return {
        "SystemRoot": os.environ["SystemRoot"],
        "TEMP": str(tmp_path),
        "TMP": str(tmp_path),
        "PYTHONIOENCODING": "utf-8",
    }


def pid_is_active(pid: int) -> bool:
    process_query_limited_information = 0x1000
    still_active = 259
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
    if not handle:
        return False
    try:
        exit_code = wintypes.DWORD()
        return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))) and exit_code.value == still_active
    finally:
        kernel32.CloseHandle(handle)


def test_named_job_can_be_reopened_collision_is_rejected_and_absence_proves_close() -> None:
    launcher = WindowsJobLauncher()
    name = launcher.reserve_name()
    handle = launcher._create_job(name)
    try:
        reopened = launcher.open_owned_job(name)
        assert reopened is not None
        launcher.kernel32.CloseHandle(wintypes.HANDLE(reopened))
        assert launcher.active_process_count(handle) == 0
        with pytest.raises(WindowsJobError) as collision:
            launcher._create_job(name)
        assert collision.value.code == "job_name_collision"
        assert launcher.verify_owned_job_empty(name) is True
    finally:
        launcher.kernel32.CloseHandle(wintypes.HANDLE(handle))
    assert launcher.open_owned_job(name) is None


def test_named_job_kill_on_close_survives_runtime_process_crash(tmp_path: Path) -> None:
    launcher = WindowsJobLauncher()
    name = launcher.reserve_name()
    helper_source = (
        "import subprocess,sys,time; "
        "from ctypes import wintypes; "
        "from drsai.backend.runtime.security_boundary import WindowsJobLauncher; "
        "j=WindowsJobLauncher(); h=j._create_job(sys.argv[1]); "
        "p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],"
        "creationflags=0x08000004,close_fds=True); "
        "ph=wintypes.HANDLE(int(p._handle)); "
        "assert j.kernel32.AssignProcessToJobObject(wintypes.HANDLE(h),ph); "
        "assert j.ntdll.NtResumeProcess(ph)==0; "
        "print(p.pid,flush=True); time.sleep(60)"
    )
    helper = subprocess.Popen(
        [sys.executable, "-c", helper_source, name], cwd=tmp_path,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    child_pid = 0
    try:
        line = helper.stdout.readline().strip() if helper.stdout else ""
        assert line.isdigit(), helper.stderr.read() if helper.stderr else "helper failed"
        child_pid = int(line)
        assert pid_is_active(child_pid)
        helper.kill()
        helper.wait(timeout=5)
        deadline = time.monotonic() + 5
        while pid_is_active(child_pid) and time.monotonic() < deadline:
            time.sleep(0.02)
        assert not pid_is_active(child_pid)
        assert launcher.open_owned_job(name) is None
        assert launcher.verify_owned_job_empty(name) is True
    finally:
        if helper.poll() is None:
            helper.kill()
            helper.wait(timeout=5)


def test_windows_job_launches_suspended_then_returns_output(tmp_path: Path) -> None:
    launcher = WindowsJobLauncher(WindowsJobLimits(active_process_limit=4))
    with launcher.launch(
        (sys.executable, "-c", "print('job-ok')"),
        cwd=tmp_path,
        environment=minimal_windows_environment(tmp_path),
    ) as process:
        result = process.communicate(timeout_seconds=10)
    assert result.status == "succeeded"
    assert result.exit_code == 0
    assert result.stdout.strip() == b"job-ok"


def test_windows_job_timeout_kills_descendant_process_tree(tmp_path: Path) -> None:
    launcher = WindowsJobLauncher(WindowsJobLimits(active_process_limit=4))
    child_program = "import time; time.sleep(30)"
    parent_program = (
        "import subprocess,sys,time; "
        f"p=subprocess.Popen([sys.executable,'-c',{child_program!r}]); "
        "print(p.pid,flush=True); time.sleep(30)"
    )
    started = time.monotonic()
    with launcher.launch(
        (sys.executable, "-c", parent_program),
        cwd=tmp_path,
        environment=minimal_windows_environment(tmp_path),
    ) as process:
        result = process.communicate(timeout_seconds=1)
    assert result.status == "timed_out"
    assert time.monotonic() - started < 8
    child_pid = int(result.stdout.strip())
    deadline = time.monotonic() + 3
    while pid_is_active(child_pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not pid_is_active(child_pid)


def test_windows_job_enforces_active_process_limit(tmp_path: Path) -> None:
    launcher = WindowsJobLauncher(WindowsJobLimits(active_process_limit=1))
    program = (
        "import subprocess,sys; "
        "\ntry: subprocess.run([sys.executable,'-c','print(1)'],check=True); print('escaped')"
        "\nexcept OSError: print('blocked')"
    )
    with launcher.launch(
        (sys.executable, "-c", program),
        cwd=tmp_path,
        environment=minimal_windows_environment(tmp_path),
    ) as process:
        result = process.communicate(timeout_seconds=10)
    # Windows may reject CreateProcess in the parent or terminate the job on
    # limit violation. Both are acceptable; creation must never succeed.
    assert b"escaped" not in result.stdout
    assert result.status in {"succeeded", "failed"}


def test_windows_job_child_receives_only_explicit_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPEN_DRSAI_SECRET_CANARY", "must-not-be-inherited")
    launcher = WindowsJobLauncher()
    program = "import os; print(os.getenv('OPEN_DRSAI_SECRET_CANARY','absent'))"
    with launcher.launch(
        (sys.executable, "-c", program),
        cwd=tmp_path,
        environment=minimal_windows_environment(tmp_path),
    ) as process:
        result = process.communicate(timeout_seconds=10)
    assert result.status == "succeeded"
    assert result.stdout.strip() == b"absent"
