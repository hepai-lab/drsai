"""Persistent Linux PTY sessions for the Remote SSH Gateway."""

from __future__ import annotations

import asyncio
import fcntl
import os
import pty
import signal
import struct
import termios
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable


@dataclass
class PtySession:
    id: str
    workspace_id: str
    cwd: str
    pid: int
    fd: int
    shell: str
    buffer: bytearray = field(default_factory=bytearray)
    listeners: set[Callable[[dict], Awaitable[None]]] = field(default_factory=set)
    reader: asyncio.Task | None = None
    exited: bool = False


class PtyManager:
    def __init__(self) -> None:
        self.sessions: dict[str, PtySession] = {}

    def create(self, workspace_id: str, root: Path, cwd: Path, cols: int, rows: int, shell: str | None = None) -> PtySession:
        chosen = shell if shell in {"/bin/bash", "/bin/zsh", "/bin/fish", "/bin/sh"} and Path(shell).exists() else os.environ.get("SHELL", "/bin/bash")
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(cwd); os.environ["TERM"] = "xterm-256color"; os.execv(chosen, [chosen, "-l"])
        session = PtySession(str(uuid.uuid4()), workspace_id, str(cwd), pid, fd, chosen)
        self.sessions[session.id] = session; self.resize(session.id, cols, rows)
        session.reader = asyncio.create_task(self._read(session))
        return session

    async def _read(self, session: PtySession) -> None:
        exit_code = 0
        try:
            while True:
                raw = await asyncio.to_thread(os.read, session.fd, 65536)
                if not raw: break
                session.buffer.extend(raw)
                if len(session.buffer) > 200000: del session.buffer[:-200000]
                await self._emit(session, {"type": "data", "id": session.id, "data": raw.decode("utf-8", "replace")})
        except OSError:
            pass
        finally:
            try: _, status = await asyncio.to_thread(os.waitpid, session.pid, 0); exit_code = os.waitstatus_to_exitcode(status)
            except (ChildProcessError, OSError): pass
            session.exited = True
            await self._emit(session, {"type": "exit", "id": session.id, "exitCode": exit_code})

    async def _emit(self, session: PtySession, message: dict) -> None:
        for listener in list(session.listeners):
            try: await listener(message)
            except Exception: session.listeners.discard(listener)

    def write(self, session_id: str, data: str) -> None:
        os.write(self.sessions[session_id].fd, data.encode())

    def resize(self, session_id: str, cols: int, rows: int) -> None:
        session = self.sessions[session_id]; packed = struct.pack("HHHH", max(20, min(cols, 500)), max(5, min(rows, 200)), 0, 0)
        fcntl.ioctl(session.fd, termios.TIOCSWINSZ, packed)

    def kill(self, session_id: str) -> None:
        session = self.sessions.pop(session_id); session.exited = True
        try: os.kill(session.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        try: os.close(session.fd)
        except OSError: pass


manager = PtyManager()
