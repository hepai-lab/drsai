"""Runtime-owned Codex App Server process supervision."""

from __future__ import annotations

import asyncio
import os
import re
import subprocess
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Sequence

from drsai.backend.agent_runtime import RuntimeExecutionError
from drsai.backend.codex_adapter.binary_provider import (
    CodexBinary,
    CodexBinaryProvider,
    CodexPlatformLauncher,
    verify_codex_compatibility,
)


_SECRET_PATTERNS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+"),
    re.compile(r"(?i)((?:api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|authorization[_-]?code)\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
)


def redact_secrets(value: str, explicit_secrets: Sequence[str] = ()) -> str:
    result = value
    for secret in explicit_secrets:
        if secret:
            result = result.replace(secret, "[REDACTED]")
    for pattern in _SECRET_PATTERNS:
        if pattern.groups:
            result = pattern.sub(lambda match: f"{match.group(1)}[REDACTED]", result)
        else:
            result = pattern.sub("Bearer [REDACTED]", result)
    return result


@dataclass(frozen=True)
class CodexRestartPolicy:
    base_delay: float = 0.25
    max_delay: float = 30.0
    failure_window: float = 120.0
    max_failures: int = 5
    startup_grace: float = 0.15


class CodexAppServerProcess:
    """Maintains the single Codex App Server process owned by one Runtime."""

    def __init__(
        self,
        binary_provider: CodexBinaryProvider,
        *,
        policy: CodexRestartPolicy | None = None,
        arguments: Sequence[str] = ("app-server", "--listen", "stdio://"),
        command_factory: Callable[[CodexBinary, Sequence[str]], Sequence[str]] | None = None,
        verify_binary: bool = True,
        stderr_limit: int = 64 * 1024,
        explicit_secrets: Sequence[str] = (),
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.binary_provider = binary_provider
        self.policy = policy or CodexRestartPolicy()
        self.arguments = tuple(arguments)
        self.command_factory = command_factory or (lambda binary, args: CodexPlatformLauncher.command(binary.path, args))
        self.verify_binary = verify_binary
        self.stderr_limit = stderr_limit
        self.explicit_secrets = tuple(explicit_secrets)
        self.clock = clock
        self.sleep = sleep
        self.process: asyncio.subprocess.Process | None = None
        self.binary: CodexBinary | None = None
        self.generation = 0
        self.start_count = 0
        self._failures: deque[float] = deque()
        self._lock = asyncio.Lock()
        self._closed = False
        self._stderr = ""
        self._stderr_task: asyncio.Task | None = None
        self._wait_task: asyncio.Task | None = None
        self._temporary_files: set[Path] = set()
        self._failed_generations: set[int] = set()
        self._controlled_generations: set[int] = set()
        self._job_handles: dict[int, int] = {}

    async def start(self) -> asyncio.subprocess.Process:
        async with self._lock:
            if self._closed:
                raise RuntimeExecutionError("codex_app_server_closed", "Codex App Server supervisor is closed.")
            if self.process and self.process.returncode is None:
                return self.process
            self._observe_dead_process()
            now = self.clock()
            self._trim_failures(now)
            if len(self._failures) >= self.policy.max_failures:
                raise RuntimeExecutionError(
                    "codex_app_server_restart_exhausted",
                    "Codex App Server exceeded its restart failure window.",
                    retryable=False,
                    detail={"failures": len(self._failures), "window_seconds": self.policy.failure_window},
                )
            if self._failures:
                delay = min(self.policy.max_delay, self.policy.base_delay * (2 ** (len(self._failures) - 1)))
                await self.sleep(delay)
            binary = self.binary_provider.resolve()
            if self.verify_binary:
                verify_codex_compatibility(binary)
            command = list(self.command_factory(binary, self.arguments))
            try:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                )
            except (OSError, ValueError) as exc:
                self._record_failure()
                raise RuntimeExecutionError(
                    "codex_app_server_start_failed", "Codex App Server could not start.", retryable=True,
                    detail={"reason": type(exc).__name__},
                ) from exc
            self.process = process
            self.binary = binary
            self.generation += 1
            self.start_count += 1
            job_handle = self._create_windows_job(process)
            if job_handle:
                self._job_handles[self.generation] = job_handle
            self._stderr_task = asyncio.create_task(self._drain_stderr(process, self.generation))
            self._wait_task = asyncio.create_task(self._wait_for_exit(process, self.generation))
            if self.policy.startup_grace:
                await self.sleep(self.policy.startup_grace)
                # Windows can publish a very short-lived child's exit a few event-loop
                # turns after the grace timer fires.  Give the already-running waiter a
                # small bounded settle window so an immediately crashing app-server is
                # never returned to callers as healthy under scheduler load.
                if process.returncode is None and self._wait_task:
                    settle = min(0.05, max(0.01, self.policy.startup_grace))
                    try:
                        await asyncio.wait_for(asyncio.shield(self._wait_task), timeout=settle)
                    except asyncio.TimeoutError:
                        pass
            if process.returncode is not None:
                self._record_process_failure(self.generation)
                await self._release_process_streams(process)
                raise RuntimeExecutionError(
                    "codex_app_server_exited_early", "Codex App Server exited during startup.", retryable=True,
                    detail={"exit_code": process.returncode, "stderr": self.stderr},
                )
            return process

    async def restart(self) -> asyncio.subprocess.Process:
        await self.stop(record_failure=False)
        return await self.start()

    async def stop(self, *, record_failure: bool = False) -> None:
        async with self._lock:
            process = self.process
            if not process or process.returncode is not None:
                if record_failure:
                    self._record_failure()
                return
            self._controlled_generations.add(self.generation)
            await self._terminate(process)
            await self._release_process_streams(process)
            if record_failure:
                self._record_failure()

    async def close(self) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            process = self.process
            if process and process.returncode is None:
                self._controlled_generations.add(self.generation)
                await self._terminate(process)
            if process:
                await self._release_process_streams(process)
            tasks = [task for task in (self._stderr_task, self._wait_task) if task and task is not asyncio.current_task()]
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            self._stderr_task = None
            self._wait_task = None
            for path in tuple(self._temporary_files):
                path.unlink(missing_ok=True)
            self._temporary_files.clear()

    def register_temporary_file(self, path: Path) -> None:
        self._temporary_files.add(Path(path))

    async def health(self) -> dict[str, object]:
        process = self.process
        running = bool(process and process.returncode is None)
        self._trim_failures(self.clock())
        return {
            "available": running,
            "reason": "available" if running else ("closed" if self._closed else "not_running"),
            "pid": process.pid if running else None,
            "generation": self.generation,
            "start_count": self.start_count,
            "recent_failures": len(self._failures),
            "version": self.binary.version if self.binary else None,
            "release_safe": self.binary.release_safe if self.binary else None,
            "stderr": self.stderr,
        }

    @property
    def stderr(self) -> str:
        return redact_secrets(self._stderr, self.explicit_secrets)

    def _record_failure(self) -> None:
        now = self.clock()
        self._failures.append(now)
        self._trim_failures(now)

    def _record_process_failure(self, generation: int) -> None:
        if generation in self._failed_generations or generation in self._controlled_generations:
            return
        self._failed_generations.add(generation)
        self._record_failure()

    def _trim_failures(self, now: float) -> None:
        while self._failures and now - self._failures[0] > self.policy.failure_window:
            self._failures.popleft()

    def _observe_dead_process(self) -> None:
        if self.process and self.process.returncode is not None:
            self.process = None

    async def _drain_stderr(self, process: asyncio.subprocess.Process, generation: int) -> None:
        assert process.stderr
        while True:
            chunk = await process.stderr.read(8192)
            if not chunk:
                return
            if generation != self.generation:
                return
            text = chunk.decode("utf-8", errors="replace")
            self._stderr = (self._stderr + text)[-self.stderr_limit:]

    async def _wait_for_exit(self, process: asyncio.subprocess.Process, generation: int) -> None:
        await process.wait()
        handle = self._job_handles.pop(generation, None)
        if handle and os.name == "nt":
            import ctypes
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(handle)
        if not self._closed and generation == self.generation:
            self._record_process_failure(generation)

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        job_handle = self._job_handles.get(self.generation) if process is self.process else None
        if os.name == "nt" and job_handle:
            import ctypes
            ctypes.WinDLL("kernel32", use_last_error=True).TerminateJobObject(job_handle, 1)
        elif os.name == "nt":
            try:
                killer = await asyncio.create_subprocess_exec(
                    "taskkill", "/PID", str(process.pid), "/T", "/F",
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                )
                await asyncio.wait_for(killer.wait(), timeout=5)
            except (OSError, asyncio.TimeoutError):
                process.kill()
        else:
            process.kill()
        waiter = self._wait_task if process is self.process and self._wait_task else None
        try:
            if waiter:
                await asyncio.wait_for(asyncio.shield(waiter), timeout=10)
            else:
                await asyncio.wait_for(process.wait(), timeout=10)
        except asyncio.TimeoutError:
            process.kill()
            if waiter:
                await waiter
            else:
                await process.wait()

    @staticmethod
    def _create_windows_job(process: asyncio.subprocess.Process) -> int | None:
        if os.name != "nt":
            return None
        import ctypes
        try:
            popen = process._transport.get_extra_info("subprocess")  # type: ignore[attr-defined]
            process_handle = int(popen._handle)
        except (AttributeError, TypeError, ValueError):
            return None
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            return None
        if not kernel32.AssignProcessToJobObject(handle, process_handle):
            kernel32.CloseHandle(handle)
            return None
        return int(handle)

    @staticmethod
    async def _release_process_streams(process: asyncio.subprocess.Process) -> None:
        if process.stdin:
            process.stdin.close()
            try:
                await process.stdin.wait_closed()
            except (BrokenPipeError, ConnectionResetError):
                pass
        if process.stdout:
            while await process.stdout.read(8192):
                pass
