from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from .registry import RelayRegistryError


@dataclass
class _Connection:
    socket: WebSocket
    generation: str
    pending: dict[str, asyncio.Future[Any]]


class RuntimeChannelHub:
    """Routes Relay control requests over Runtime-initiated WebSockets."""

    def __init__(self, *, request_timeout: float = 30.0) -> None:
        self.request_timeout = request_timeout
        self._connections: dict[str, _Connection] = {}
        self._lock = asyncio.Lock()

    async def attach(self, runtime_id: str, socket: WebSocket) -> str:
        generation = uuid4().hex
        async with self._lock:
            previous = self._connections.get(runtime_id)
            if previous is not None:
                self._fail_pending(previous, "runtime_connection_replaced")
            self._connections[runtime_id] = _Connection(socket, generation, {})
        return generation

    async def detach(self, runtime_id: str, generation: str) -> None:
        async with self._lock:
            current = self._connections.get(runtime_id)
            if current is None or current.generation != generation:
                return
            self._connections.pop(runtime_id, None)
            self._fail_pending(current, "runtime_disconnected")

    async def is_current(self, runtime_id: str, generation: str) -> bool:
        async with self._lock:
            current = self._connections.get(runtime_id)
            return current is not None and current.generation == generation

    async def request(self, runtime_id: str, operation: str, arguments: dict[str, Any]) -> Any:
        async with self._lock:
            connection = self._connections.get(runtime_id)
            if connection is None:
                raise RelayRegistryError("runtime_unavailable", "Runtime control channel is unavailable",
                                         retryable=True, source="runtime")
            request_id = uuid4().hex
            future = asyncio.get_running_loop().create_future()
            connection.pending[request_id] = future
            socket = connection.socket
        try:
            await socket.send_json({
                "type": "runtime.request",
                "request_id": request_id,
                "operation": operation,
                "arguments": arguments,
            })
            return await asyncio.wait_for(future, timeout=self.request_timeout)
        except TimeoutError as exc:
            raise RelayRegistryError("runtime_timeout", "Runtime response timed out", retryable=True,
                                     source="runtime") from exc
        finally:
            connection.pending.pop(request_id, None)

    def accept_response(self, runtime_id: str, message: dict[str, Any]) -> None:
        connection = self._connections.get(runtime_id)
        request_id = str(message.get("request_id") or "")
        future = connection.pending.get(request_id) if connection else None
        if future is None or future.done():
            return
        if message.get("ok") is True:
            future.set_result(message.get("result"))
            return
        error = message.get("error") if isinstance(message.get("error"), dict) else {}
        future.set_exception(RelayRegistryError(
            str(error.get("code") or "runtime_request_failed"),
            str(error.get("message") or "Runtime request failed"),
            retryable=bool(error.get("retryable", False)),
            source="runtime",
        ))

    @staticmethod
    def _fail_pending(connection: _Connection, code: str) -> None:
        for future in tuple(connection.pending.values()):
            if not future.done():
                future.set_exception(RelayRegistryError(code, "Runtime control channel disconnected",
                                                        retryable=True, source="runtime"))
