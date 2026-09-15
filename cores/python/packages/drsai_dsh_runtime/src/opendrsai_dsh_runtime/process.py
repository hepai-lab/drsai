"""Managed Harness subprocess with generation fencing and bounded diagnostics."""

from __future__ import annotations

import asyncio
import os
import subprocess
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from .jsonrpc import AsyncLineTransport, JsonRpcConnectionClosed, JsonRpcPeer, ServerRequestHandler


_PASSTHROUGH_ENV = frozenset({
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "WINDIR",
})
_MANAGED_ENV = frozenset({
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "DSH_CORDIS_CONFIG",
    "DSH_CWD",
    "DSH_SESSION_ROOT",
})
_SECRET_ENV = frozenset({"DEEPSEEK_API_KEY"})


class HarnessProcessError(RuntimeError):
    """A secret-free process lifecycle failure."""


def build_harness_environment(
    *,
    inherited: Mapping[str, str],
    managed: Mapping[str, str],
) -> dict[str, str]:
    unknown = set(managed) - _MANAGED_ENV
    if unknown:
        raise ValueError(f"Unsupported managed environment keys: {', '.join(sorted(unknown))}")
    result = {key: value for key, value in inherited.items() if key.upper() in _PASSTHROUGH_ENV}
    for key, value in managed.items():
        if not isinstance(value, str) or not value or "\0" in value or "\n" in value or "\r" in value:
            raise ValueError(f"Managed environment value is invalid: {key}")
        result[key] = value
    return result


@dataclass(frozen=True)
class HarnessProcessSpec:
    argv: tuple[str, ...]
    cwd: Path
    environment: Mapping[str, str]

    @classmethod
    def create(
        cls,
        argv: Sequence[str],
        *,
        cwd: Path,
        inherited_environment: Mapping[str, str],
        managed_environment: Mapping[str, str],
    ) -> "HarnessProcessSpec":
        command = tuple(argv)
        if not command or not all(isinstance(part, str) and part and "\0" not in part for part in command):
            raise ValueError("Harness argv must contain non-empty strings")
        root = cwd.expanduser().resolve(strict=False)
        if not root.is_absolute() or not root.is_dir():
            raise ValueError("Harness cwd must be an existing absolute directory")
        return cls(
            command,
            root,
            build_harness_environment(inherited=inherited_environment, managed=managed_environment),
        )


class _SubprocessLineTransport(AsyncLineTransport):
    def __init__(self, process: asyncio.subprocess.Process):
        if process.stdout is None or process.stdin is None:
            raise HarnessProcessError("Harness process streams are unavailable")
        self._process = process
        self._stdout = process.stdout
        self._stdin = process.stdin
        self._closed = False

    async def readline(self) -> bytes:
        return await self._stdout.readline()

    async def write_line(self, line: bytes) -> None:
        if self._closed or self._stdin.is_closing():
            raise JsonRpcConnectionClosed("Harness stdin is closed")
        self._stdin.write(line)
        await self._stdin.drain()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if not self._stdin.is_closing():
            self._stdin.close()
            try:
                await self._stdin.wait_closed()
            except (BrokenPipeError, ConnectionResetError):
                pass


class BoundedDiagnosticTail:
    def __init__(self, *, max_bytes: int = 64 * 1024):
        if max_bytes < 1024:
            raise ValueError("Diagnostic tail limit is too small")
        self.max_bytes = max_bytes
        self._lines: deque[str] = deque()
        self._bytes = 0

    def append(self, text: str) -> None:
        encoded_size = len(text.encode("utf-8", errors="replace"))
        if encoded_size > self.max_bytes:
            encoded = text.encode("utf-8", errors="replace")[-self.max_bytes :]
            text = encoded.decode("utf-8", errors="replace")
            encoded_size = len(text.encode("utf-8"))
        self._lines.append(text)
        self._bytes += encoded_size
        while self._lines and self._bytes > self.max_bytes:
            removed = self._lines.popleft()
            self._bytes -= len(removed.encode("utf-8", errors="replace"))

    def text(self) -> str:
        return "".join(self._lines)


class ManagedHarnessProcess:
    def __init__(
        self,
        process: asyncio.subprocess.Process,
        peer: JsonRpcPeer,
        *,
        generation: int,
        stderr_task: asyncio.Task[None],
        diagnostic_tail: BoundedDiagnosticTail,
    ):
        self.process = process
        self.peer = peer
        self.generation = generation
        self._stderr_task = stderr_task
        self.diagnostic_tail = diagnostic_tail
        self._closed = False

    @property
    def returncode(self) -> int | None:
        return self.process.returncode

    async def wait(self) -> int:
        returncode = await self.process.wait()
        await asyncio.gather(self._stderr_task, return_exceptions=True)
        return returncode

    async def close(self, *, graceful_timeout: float = 5.0, terminate_timeout: float = 2.0) -> None:
        if self._closed:
            return
        self._closed = True
        await self.peer.close()
        if self.process.returncode is None:
            try:
                await asyncio.wait_for(self.process.wait(), timeout=graceful_timeout)
            except TimeoutError:
                self.process.terminate()
                try:
                    await asyncio.wait_for(self.process.wait(), timeout=terminate_timeout)
                except TimeoutError:
                    self.process.kill()
                    await self.process.wait()
        self._stderr_task.cancel()
        await asyncio.gather(self._stderr_task, return_exceptions=True)


class HarnessProcessSupervisor:
    """Owns exact child argv; never uses a shell or an ambient latest binary."""

    def __init__(self, spec: HarnessProcessSpec, *, max_stderr_bytes: int = 64 * 1024):
        self.spec = spec
        self._generation = 0
        self._active: ManagedHarnessProcess | None = None
        self._max_stderr_bytes = max_stderr_bytes

    @property
    def generation(self) -> int:
        return self._generation

    async def start(
        self,
        *,
        server_request_handler: ServerRequestHandler | None = None,
    ) -> ManagedHarnessProcess:
        if self._active is not None and self._active.returncode is None:
            return self._active
        self._generation += 1
        kwargs: dict[str, object] = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            process = await asyncio.create_subprocess_exec(
                *self.spec.argv,
                cwd=str(self.spec.cwd),
                env=dict(self.spec.environment),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **kwargs,
            )
        except (OSError, ValueError) as exc:
            raise HarnessProcessError("Harness process could not be started") from exc
        transport = _SubprocessLineTransport(process)
        peer = JsonRpcPeer(
            transport,
            generation=self._generation,
            server_request_handler=server_request_handler,
        )
        tail = BoundedDiagnosticTail(max_bytes=self._max_stderr_bytes)
        stderr_task = asyncio.create_task(
            self._capture_stderr(process, tail), name=f"dsh-stderr-{self._generation}"
        )
        managed = ManagedHarnessProcess(
            process,
            peer,
            generation=self._generation,
            stderr_task=stderr_task,
            diagnostic_tail=tail,
        )
        self._active = managed
        return managed

    async def restart(
        self,
        *,
        server_request_handler: ServerRequestHandler | None = None,
    ) -> ManagedHarnessProcess:
        if self._active is not None:
            await self._active.close()
            self._active = None
        return await self.start(server_request_handler=server_request_handler)

    async def close(self) -> None:
        if self._active is None:
            return
        await self._active.close()
        self._active = None

    async def _capture_stderr(
        self,
        process: asyncio.subprocess.Process,
        tail: BoundedDiagnosticTail,
    ) -> None:
        if process.stderr is None:
            return
        secrets = [
            value for key, value in self.spec.environment.items()
            if key in _SECRET_ENV and len(value) >= 4
        ]
        workspace = str(self.spec.cwd)
        while True:
            line = await process.stderr.readline()
            if not line:
                return
            text = line.decode("utf-8", errors="replace")
            for secret in secrets:
                text = text.replace(secret, "<redacted>")
            text = text.replace(workspace, "<workspace>")
            tail.append(text)
