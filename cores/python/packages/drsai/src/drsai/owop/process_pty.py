"""Runtime-owned local Process and PTY lifecycle for OWOP."""

from __future__ import annotations

import base64
import binascii
import json
import os
import subprocess
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping

from drsai.backend.workspace_paths import WorkspacePathError, relative_parts
from drsai.owop.protocol import OWOPError


class _OutputBuffer:
    """Byte-bounded, cursor-addressable output segments."""

    def __init__(self, limit: int):
        self.limit = limit
        self.start_offset = 0
        self.end_offset = 0
        self._segments: deque[dict[str, Any]] = deque()
        self._size = 0
        self._lock = threading.RLock()

    def append(self, data: bytes, stream: str) -> None:
        if not data:
            return
        with self._lock:
            self._segments.append({"offset": self.end_offset, "stream": stream, "data": data})
            self.end_offset += len(data)
            self._size += len(data)
            while self._size > self.limit and self._segments:
                excess = self._size - self.limit
                first = self._segments[0]
                if len(first["data"]) <= excess:
                    removed = self._segments.popleft()
                    self._size -= len(removed["data"])
                else:
                    first["data"] = first["data"][excess:]
                    first["offset"] += excess
                    self._size -= excess
            self.start_offset = self._segments[0]["offset"] if self._segments else self.end_offset

    def read(self, after_offset: int) -> dict[str, Any]:
        with self._lock:
            actual = max(after_offset, self.start_offset)
            segments = []
            for item in self._segments:
                end = item["offset"] + len(item["data"])
                if end <= actual:
                    continue
                cut = max(0, actual - item["offset"])
                segments.append({
                    "offset": item["offset"] + cut,
                    "stream": item["stream"],
                    "content_base64": base64.b64encode(item["data"][cut:]).decode("ascii"),
                })
            return {"segments": segments, "start_offset": self.start_offset,
                    "next_offset": self.end_offset, "truncated": after_offset < self.start_offset}


@dataclass
class _ProcessSession:
    process_id: str
    process: subprocess.Popen
    output: _OutputBuffer
    timeout_ms: int | None
    exit_code: int | None = None
    timed_out: bool = False
    job_handle: int | None = None


@dataclass
class _PtySession:
    pty_id: str
    pid: int
    output: _OutputBuffer
    exit_code: int | None = None
    signal: int | None = None


class LocalProcessPtyOperations:
    """Own child processes and the node-pty/ConPTY provider for a Runtime."""

    def __init__(self, workspace_root: Path, *, node_pty_module: Path | None = None,
                 cwd_resolver: Callable[[str], Path] | None = None):
        self.workspace_root = Path(workspace_root).resolve(strict=True)
        self.node_pty_module = Path(node_pty_module) if node_pty_module else None
        self.cwd_resolver = cwd_resolver
        self._processes: dict[str, _ProcessSession] = {}
        self._ptys: dict[str, _PtySession] = {}
        self._provider: subprocess.Popen | None = None
        self._provider_requests: dict[str, tuple[threading.Event, dict[str, Any]]] = {}
        self._lock = threading.RLock()

    def handlers(self) -> dict[str, Any]:
        return {
            "process.start": self.process_start, "process.write": self.process_write,
            "process.attach": self.process_attach, "process.kill": self.process_kill,
            "pty.create": self.pty_create, "pty.write": self.pty_write,
            "pty.resize": self.pty_resize, "pty.attach": self.pty_attach, "pty.kill": self.pty_kill,
        }

    def process_start(self, params: Mapping[str, Any]) -> dict[str, Any]:
        argv = [str(value) for value in params["argv"]]
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        try:
            process = subprocess.Popen(
                argv, cwd=self._cwd(str(params["cwd"])), stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=False, creationflags=creationflags,
            )
        except OSError as exc:
            raise OWOPError("process_start_failed", "Process could not start.", "operation", details={"error": str(exc)}) from exc
        process_id = f"process-{uuid.uuid4()}"
        session = _ProcessSession(process_id, process,
            _OutputBuffer(int(params.get("max_output_bytes") or 4 * 1024 * 1024)),
            int(params["timeout_ms"]) if params.get("timeout_ms") else None,
            job_handle=self._create_job(process))
        with self._lock:
            self._processes[process_id] = session
        threading.Thread(target=self._read_pipe, args=(session, process.stdout, "stdout"), daemon=True).start()
        threading.Thread(target=self._read_pipe, args=(session, process.stderr, "stderr"), daemon=True).start()
        threading.Thread(target=self._wait_process, args=(session,), daemon=True).start()
        if session.timeout_ms:
            threading.Thread(target=self._timeout_process, args=(session,), daemon=True).start()
        return {"process_id": process_id, "pid": process.pid}

    def process_write(self, params: Mapping[str, Any]) -> dict[str, Any]:
        session = self._get_process(str(params["process_id"]))
        content = self._decode(str(params["content_base64"]))
        if session.process.stdin is None or session.process.poll() is not None:
            raise OWOPError("process_not_running", "Process is not running.", "operation")
        try:
            session.process.stdin.write(content)
            session.process.stdin.flush()
        except OSError as exc:
            raise OWOPError("process_write_failed", "Process input failed.", "operation") from exc
        return {"process_id": session.process_id, "written": len(content)}

    def process_attach(self, params: Mapping[str, Any]) -> dict[str, Any]:
        session = self._get_process(str(params["process_id"]))
        result = session.output.read(int(params["after_offset"]))
        result.update({"process_id": session.process_id, "running": session.process.poll() is None,
                       "exit_code": session.exit_code, "timed_out": session.timed_out})
        return result

    def process_kill(self, params: Mapping[str, Any]) -> dict[str, Any]:
        session = self._get_process(str(params["process_id"]))
        self._terminate(session.process, tree=bool(params.get("tree", True)), job_handle=session.job_handle)
        return {"process_id": session.process_id, "killed": True}

    def pty_create(self, params: Mapping[str, Any]) -> dict[str, Any]:
        result = self._provider_call("create", {
            "argv": [str(value) for value in params["argv"]], "cwd": str(self._cwd(str(params["cwd"]))),
            "cols": int(params["cols"]), "rows": int(params["rows"]),
        })
        session = _PtySession(str(result["pty_id"]), int(result["pid"]),
                              _OutputBuffer(int(params.get("max_buffer_bytes") or 1024 * 1024)))
        with self._lock:
            self._ptys[session.pty_id] = session
        self._provider_call("activate", {"pty_id": session.pty_id})
        return {"pty_id": session.pty_id, "pid": session.pid,
                "cols": int(params["cols"]), "rows": int(params["rows"])}

    def pty_write(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._get_pty(str(params["pty_id"]))
        self._decode(str(params["content_base64"]))
        return {"pty_id": str(params["pty_id"]), **self._provider_call("write", params)}

    def pty_resize(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._get_pty(str(params["pty_id"]))
        return {"pty_id": str(params["pty_id"]), **self._provider_call("resize", params)}

    def pty_attach(self, params: Mapping[str, Any]) -> dict[str, Any]:
        session = self._get_pty(str(params["pty_id"]))
        result = session.output.read(int(params["after_offset"]))
        result.update({"pty_id": session.pty_id, "running": session.exit_code is None,
                       "exit_code": session.exit_code, "signal": session.signal})
        return result

    def pty_kill(self, params: Mapping[str, Any]) -> dict[str, Any]:
        self._get_pty(str(params["pty_id"]))
        return {"pty_id": str(params["pty_id"]), **self._provider_call("kill", params)}

    def close(self) -> None:
        with self._lock:
            processes = list(self._processes.values())
        for session in processes:
            if session.process.poll() is None:
                self._terminate(session.process, tree=True, job_handle=session.job_handle)
        if self._provider and self._provider.poll() is None:
            try:
                self._provider_call("close", {}, timeout=5)
            except OWOPError:
                self._terminate(self._provider, tree=True)
        if self._provider:
            try:
                self._provider.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._terminate(self._provider, tree=True)

    def _cwd(self, relative: str) -> Path:
        try:
            relative_parts(relative)
            candidate = self.cwd_resolver(relative) if self.cwd_resolver else (self.workspace_root / relative).resolve(strict=True)
        except (WorkspacePathError, FileNotFoundError, PermissionError) as exc:
            code = exc.code if isinstance(exc, WorkspacePathError) else "workspace_path_unavailable"
            raise OWOPError(code, str(exc), "operation", details={"path": relative}) from exc
        root = os.path.normcase(str(self.workspace_root))
        try:
            if os.path.commonpath([root, os.path.normcase(str(candidate))]) != root:
                raise ValueError
        except ValueError as exc:
            raise OWOPError("workspace_escape_rejected", "Process cwd escapes Workspace root.", "operation") from exc
        if not candidate.is_dir():
            raise OWOPError("workspace_path_invalid", "Process cwd is not a directory.", "operation")
        return candidate

    @staticmethod
    def _decode(value: str) -> bytes:
        try:
            return base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise OWOPError("owop_content_invalid", "Process content is not valid base64.", "operation") from exc

    def _get_process(self, process_id: str) -> _ProcessSession:
        with self._lock:
            session = self._processes.get(process_id)
        if session is None:
            raise OWOPError("process_not_found", "Process session does not exist.", "operation")
        return session

    def _get_pty(self, pty_id: str) -> _PtySession:
        with self._lock:
            session = self._ptys.get(pty_id)
        if session is None:
            raise OWOPError("pty_not_found", "PTY session does not exist.", "operation")
        return session

    @staticmethod
    def _read_pipe(session: _ProcessSession, pipe: BinaryIO | None, stream: str) -> None:
        if pipe is None:
            return
        while True:
            data = pipe.read(65536)
            if not data:
                return
            session.output.append(data, stream)

    @staticmethod
    def _wait_process(session: _ProcessSession) -> None:
        session.exit_code = session.process.wait()
        if os.name == "nt" and session.job_handle:
            import ctypes
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(session.job_handle)
            session.job_handle = None

    def _timeout_process(self, session: _ProcessSession) -> None:
        assert session.timeout_ms is not None
        time.sleep(session.timeout_ms / 1000)
        if session.process.poll() is None:
            session.timed_out = True
            self._terminate(session.process, tree=True, job_handle=session.job_handle)

    @staticmethod
    def _create_job(process: subprocess.Popen) -> int | None:
        if os.name != "nt":
            return None
        import ctypes
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            return None
        if not kernel32.AssignProcessToJobObject(handle, int(process._handle)):  # type: ignore[attr-defined]
            kernel32.CloseHandle(handle)
            return None
        return int(handle)

    @staticmethod
    def _terminate(process: subprocess.Popen, *, tree: bool, job_handle: int | None = None) -> None:
        if process.poll() is not None:
            return
        if os.name == "nt" and tree and job_handle:
            import ctypes
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.TerminateJobObject(job_handle, 1)
        elif os.name == "nt" and tree:
            try:
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               capture_output=True, check=False, timeout=5)
            except subprocess.TimeoutExpired:
                pass
            if process.poll() is None:
                process.kill()
        else:
            process.kill()

    def _start_provider(self) -> None:
        if self._provider and self._provider.poll() is None:
            return
        env = dict(os.environ)
        if self.node_pty_module:
            env["OWOP_NODE_PTY_MODULE"] = str(self.node_pty_module)
        try:
            self._provider = subprocess.Popen(
                ["node", str(Path(__file__).with_name("node_pty_provider.cjs"))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                env=env, text=True, encoding="utf-8", errors="replace", bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        except OSError as exc:
            raise OWOPError("pty_provider_unavailable", "PTY provider could not start.", "operation") from exc
        threading.Thread(target=self._read_provider, daemon=True).start()

    def _provider_call(self, method: str, params: Mapping[str, Any], *, timeout: float = 10) -> dict[str, Any]:
        with self._lock:
            self._start_provider()
            assert self._provider and self._provider.stdin
            request_id = str(uuid.uuid4())
            ready, holder = threading.Event(), {}
            self._provider_requests[request_id] = (ready, holder)
            try:
                self._provider.stdin.write(json.dumps({"requestId": request_id, "method": method,
                                                       "params": dict(params)}, separators=(",", ":")) + "\n")
                self._provider.stdin.flush()
            except OSError as exc:
                self._provider_requests.pop(request_id, None)
                raise OWOPError("pty_provider_disconnected", "PTY provider disconnected.", "operation") from exc
        if not ready.wait(timeout):
            with self._lock:
                self._provider_requests.pop(request_id, None)
            raise OWOPError("pty_provider_timeout", "PTY provider did not respond.", "operation")
        if holder.get("error"):
            error = holder["error"]
            raise OWOPError(str(error.get("code", "pty_provider_error")),
                            str(error.get("message", "PTY provider failed.")), "operation")
        return dict(holder.get("result") or {})

    def _read_provider(self) -> None:
        assert self._provider and self._provider.stdout
        for line in self._provider.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("kind") == "response":
                with self._lock:
                    waiting = self._provider_requests.pop(str(message.get("requestId")), None)
                if waiting:
                    waiting[1].update(message)
                    waiting[0].set()
            elif message.get("kind") == "event":
                with self._lock:
                    session = self._ptys.get(str(message.get("id")))
                if session and message.get("event") == "data":
                    session.output.append(base64.b64decode(str(message["content_base64"])), "pty")
                elif session and message.get("event") == "exit":
                    session.exit_code = int(message.get("exit_code") or 0)
                    session.signal = message.get("signal")
        with self._lock:
            waiting = list(self._provider_requests.values())
            self._provider_requests.clear()
        for ready, holder in waiting:
            holder["error"] = {"code": "pty_provider_disconnected", "message": "PTY provider exited."}
            ready.set()
