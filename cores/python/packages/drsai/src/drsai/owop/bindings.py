"""Local OWOP bindings with identical semantic envelopes."""

from __future__ import annotations

import asyncio
import json
import secrets
import struct
from typing import Any, Mapping, Protocol

from drsai.owop.protocol import Handler, OWOPProtocol


MAX_IPC_FRAME = 16 * 1024 * 1024


class WorkspaceOperationsClient(Protocol):
    async def execute(self, request: Mapping[str, Any]) -> dict[str, Any]: ...
    async def close(self) -> None: ...


class InProcessWorkspaceOperationsClient:
    def __init__(self, protocol: OWOPProtocol, handlers: Mapping[str, Handler]):
        self.protocol = protocol
        self.handlers = dict(handlers)
        self._closed = False

    async def execute(self, request: Mapping[str, Any]) -> dict[str, Any]:
        if self._closed:
            raise RuntimeError("InProcess OWOP Binding is closed")
        normalized = {**dict(request), "binding": {"kind": "in_process"}}
        return await self.protocol.dispatch(normalized, self.handlers)

    async def close(self) -> None:
        self._closed = True


class LocalIPCWorkspaceOperationsServer:
    """Authenticated, length-framed loopback IPC endpoint owned by one Runtime."""

    def __init__(self, protocol: OWOPProtocol, handlers: Mapping[str, Handler]):
        self.protocol = protocol
        self.handlers = dict(handlers)
        self.token = secrets.token_urlsafe(32)
        self._server: asyncio.AbstractServer | None = None

    @property
    def address(self) -> tuple[str, int]:
        if self._server is None or not self._server.sockets:
            raise RuntimeError("Local IPC server is not started")
        host, port = self._server.sockets[0].getsockname()[:2]
        return str(host), int(port)

    async def start(self) -> None:
        if self._server is None:
            self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)

    async def close(self) -> None:
        if self._server is None:
            return
        self._server.close()
        await self._server.wait_closed()
        self._server = None

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            message = await _read_frame(reader)
            if not isinstance(message, dict) or not secrets.compare_digest(str(message.get("token") or ""), self.token):
                response = {
                    "version": self.protocol.version,
                    "request_id": "invalid",
                    "correlation_id": "ipc",
                    "ok": False,
                    "error": {
                        "code": "owop_ipc_unauthorized",
                        "message": "Local IPC authentication failed.",
                        "correlation_id": "ipc",
                        "retryable": False,
                        "details": {},
                    },
                }
            else:
                request = message.get("request")
                if not isinstance(request, dict):
                    request = {}
                request = {**request, "binding": {"kind": "local_ipc", "endpoint": f"127.0.0.1:{self.address[1]}"}}
                response = await self.protocol.dispatch(request, self.handlers)
            await _write_frame(writer, response)
        except (EOFError, ValueError, json.JSONDecodeError):
            pass
        finally:
            writer.close()
            await writer.wait_closed()


class LocalIPCWorkspaceOperationsClient:
    def __init__(self, protocol: OWOPProtocol, host: str, port: int, token: str):
        if host != "127.0.0.1":
            raise ValueError("Local IPC OWOP Binding must use IPv4 loopback")
        self.protocol = protocol
        self.host = host
        self.port = port
        self.token = token
        self._closed = False

    async def execute(self, request: Mapping[str, Any]) -> dict[str, Any]:
        if self._closed:
            raise RuntimeError("Local IPC OWOP Binding is closed")
        reader, writer = await asyncio.open_connection(self.host, self.port)
        await _write_frame(writer, {"token": self.token, "request": dict(request)})
        try:
            response = await _read_frame(reader)
        finally:
            writer.close()
            await writer.wait_closed()
        if not isinstance(response, dict):
            raise RuntimeError("Local IPC returned an invalid OWOP response")
        return response

    async def close(self) -> None:
        self._closed = True


async def _read_frame(reader: asyncio.StreamReader) -> Any:
    header = await reader.readexactly(4)
    length = struct.unpack(">I", header)[0]
    if length <= 0 or length > MAX_IPC_FRAME:
        raise ValueError("OWOP IPC frame size is invalid")
    payload = await reader.readexactly(length)
    return json.loads(payload)


async def _write_frame(writer: asyncio.StreamWriter, value: Any) -> None:
    payload = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_IPC_FRAME:
        raise ValueError("OWOP IPC frame exceeds its limit")
    writer.write(struct.pack(">I", len(payload)) + payload)
    await writer.drain()
