"""Launch a primary-token worker suspended, assign it to a Job, then resume."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from .windows_job import WindowsJobError, WindowsJobLauncher, WindowsJobLimits
from .windows_token import RestrictedTokenEvidence, WindowsRestrictedTokenFactory, WindowsTokenError


@dataclass(frozen=True)
class WindowsRestrictedWorkerResult:
    pid: int
    exit_code: int | None
    status: str
    token_evidence: RestrictedTokenEvidence
    process_tree_empty_verified: bool = False


class WindowsRestrictedWorkerLauncher:
    def __init__(self, limits: WindowsJobLimits | None = None):
        if os.name != "nt":
            raise WindowsTokenError("windows_worker_unsupported", "Restricted worker requires Windows.")
        self.job = WindowsJobLauncher(limits)
        self.tokens = WindowsRestrictedTokenFactory()

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: str | Path,
        environment: Mapping[str, str],
        timeout_seconds: float,
    ) -> WindowsRestrictedWorkerResult:
        if not argv or not str(argv[0]).strip() or timeout_seconds <= 0:
            raise WindowsTokenError("windows_worker_request_invalid", "Worker argv and timeout are required.")
        directory = Path(cwd)
        if not directory.is_dir():
            raise WindowsTokenError("windows_worker_cwd_invalid", "Worker directory does not exist.")
        try:
            import pywintypes
            import win32event
            import win32process
        except ImportError as error:
            raise WindowsTokenError("windows_worker_api_unavailable", "PyWin32 process APIs are unavailable.") from error

        token = self.tokens.create()
        job_handle = self.job._create_job()
        process_handle = thread_handle = None
        try:
            startup = win32process.STARTUPINFO()
            command_line = subprocess.list2cmdline([str(value) for value in argv])
            flags = win32process.CREATE_SUSPENDED | win32process.CREATE_NO_WINDOW | win32process.CREATE_UNICODE_ENVIRONMENT
            try:
                process_handle, thread_handle, pid, _thread_id = win32process.CreateProcessAsUser(
                    pywintypes.HANDLE(token.handle), str(argv[0]), command_line,
                    None, None, False, flags,
                    {str(key): str(value) for key, value in environment.items()}, str(directory), startup,
                )
            except pywintypes.error as error:
                raise WindowsTokenError(
                    "windows_worker_create_failed",
                    f"CreateProcessAsUser failed: {getattr(error, 'winerror', error.args[0])}",
                ) from error
            if not self.job.kernel32.AssignProcessToJobObject(job_handle, int(process_handle)):
                raise WindowsJobError(
                    "job_assign_failed", f"AssignProcessToJobObject failed: {__import__('ctypes').get_last_error()}",
                )
            if win32process.ResumeThread(thread_handle) == -1:
                raise WindowsTokenError("windows_worker_resume_failed", "ResumeThread failed.")
            wait = win32event.WaitForSingleObject(process_handle, int(timeout_seconds * 1000))
            if wait == win32event.WAIT_TIMEOUT:
                if not self.job.terminate_and_verify_empty(job_handle):
                    raise WindowsJobError("job_not_empty", "Restricted worker Job did not become empty.")
                win32event.WaitForSingleObject(process_handle, 5000)
                return WindowsRestrictedWorkerResult(
                    int(pid), win32process.GetExitCodeProcess(process_handle), "timed_out", token.evidence, True,
                )
            exit_code = int(win32process.GetExitCodeProcess(process_handle))
            if not self.job.terminate_and_verify_empty(job_handle):
                raise WindowsJobError("job_not_empty", "Restricted worker Job did not become empty.")
            return WindowsRestrictedWorkerResult(
                int(pid), exit_code, "succeeded" if exit_code == 0 else "failed", token.evidence, True,
            )
        finally:
            if thread_handle is not None:
                thread_handle.Close()
            if process_handle is not None:
                process_handle.Close()
            if job_handle:
                self.job.kernel32.CloseHandle(job_handle)
            token.close()
