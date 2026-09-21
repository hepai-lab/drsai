"""Minimal asynchronous JSON-RPC 2.0 peer over newline-delimited streams."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol


class JsonRpcError(RuntimeError):
    """Base error for the fail-closed native transport."""


class JsonRpcProtocolError(JsonRpcError):
    """The peer emitted a malformed or unsupported protocol frame."""


class JsonRpcConnectionClosed(JsonRpcError):
    """The connection ended before an operation completed."""


class JsonRpcRemoteError(JsonRpcError):
    def __init__(self, code: int, message: str, data: object | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


class AsyncLineTransport(Protocol):
    async def readline(self) -> bytes: ...
    async def write_line(self, line: bytes) -> None: ...
    async def close(self) -> None: ...


@dataclass(frozen=True)
class JsonRpcNotification:
    method: str
    params: object | None
    generation: int


ServerRequestHandler = Callable[[str, object | None], Awaitable[object]]


def encode_frame(value: Mapping[str, object]) -> bytes:
    try:
        payload = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise JsonRpcProtocolError("JSON-RPC frame is not losslessly serializable") from exc
    if b"\n" in payload or b"\r" in payload:
        raise JsonRpcProtocolError("JSON-RPC frame contains an unexpected line break")
    return payload + b"\n"


def decode_frame(line: bytes, *, max_bytes: int = 8 * 1024 * 1024) -> dict[str, object]:
    if not line:
        raise JsonRpcConnectionClosed("JSON-RPC stream reached EOF")
    if len(line) > max_bytes:
        raise JsonRpcProtocolError("JSON-RPC frame exceeds the configured limit")
    if not line.endswith(b"\n"):
        raise JsonRpcProtocolError("JSON-RPC frame is not newline terminated")
    try:
        value = json.loads(line)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise JsonRpcProtocolError("JSON-RPC frame is malformed") from exc
    if not isinstance(value, dict) or value.get("jsonrpc") != "2.0":
        raise JsonRpcProtocolError("JSON-RPC frame has an invalid envelope")
    return value


class JsonRpcPeer:
    """Routes responses, notifications and server requests for one generation."""

    def __init__(
        self,
        transport: AsyncLineTransport,
        *,
        generation: int,
        max_frame_bytes: int = 8 * 1024 * 1024,
        server_request_handler: ServerRequestHandler | None = None,
    ):
        if generation < 1:
            raise ValueError("generation must be positive")
        self._transport = transport
        self.generation = generation
        self._max_frame_bytes = max_frame_bytes
        self._server_request_handler = server_request_handler
        self._next_request_id = 1
        self._pending: dict[int, asyncio.Future[object]] = {}
        self._notifications: asyncio.Queue[JsonRpcNotification | BaseException] = asyncio.Queue()
        self._reader_task: asyncio.Task[None] | None = None
        self._closed = False
        self._write_lock = asyncio.Lock()

    @property
    def closed(self) -> bool:
        return self._closed

    def start(self) -> None:
        if self._closed:
            raise JsonRpcConnectionClosed("JSON-RPC peer is closed")
        if self._reader_task is None:
            self._reader_task = asyncio.create_task(self._read_loop(), name=f"dsh-jsonrpc-{self.generation}")

    async def request(self, method: str, params: object | None = None, *, timeout: float = 30.0) -> object:
        if not method:
            raise ValueError("method must be non-empty")
        if self._closed:
            raise JsonRpcConnectionClosed("JSON-RPC peer is closed")
        self.start()
        request_id = self._next_request_id
        self._next_request_id += 1
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        frame: dict[str, object] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            frame["params"] = params
        try:
            await self._write(frame)
            return await asyncio.wait_for(future, timeout=timeout)
        except TimeoutError as exc:
            if not future.done():
                future.cancel()
            raise JsonRpcError(f"JSON-RPC request timed out: {method}") from exc
        finally:
            self._pending.pop(request_id, None)

    async def next_notification(self, *, timeout: float | None = None) -> JsonRpcNotification:
        self.start()
        item = await self._notifications.get() if timeout is None else await asyncio.wait_for(
            self._notifications.get(), timeout=timeout
        )
        if isinstance(item, BaseException):
            raise item
        return item

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        task = self._reader_task
        self._reader_task = None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        error = JsonRpcConnectionClosed("JSON-RPC peer closed")
        self._fail_pending(error)
        await self._notifications.put(error)
        await self._transport.close()

    async def _write(self, frame: Mapping[str, object]) -> None:
        encoded = encode_frame(frame)
        async with self._write_lock:
            if self._closed:
                raise JsonRpcConnectionClosed("JSON-RPC peer is closed")
            await self._transport.write_line(encoded)

    async def _read_loop(self) -> None:
        failure: BaseException | None = None
        try:
            while not self._closed:
                line = await self._transport.readline()
                frame = decode_frame(line, max_bytes=self._max_frame_bytes)
                await self._dispatch(frame)
        except asyncio.CancelledError:
            return
        except BaseException as exc:
            failure = exc
        finally:
            if failure is not None and not self._closed:
                self._closed = True
                error = failure if isinstance(failure, JsonRpcError) else JsonRpcConnectionClosed(
                    "JSON-RPC reader failed"
                )
                self._fail_pending(error)
                await self._notifications.put(error)

    async def _dispatch(self, frame: Mapping[str, object]) -> None:
        has_id = "id" in frame
        method = frame.get("method")
        if method is not None:
            if not isinstance(method, str) or not method:
                raise JsonRpcProtocolError("JSON-RPC method is invalid")
            if has_id:
                await self._handle_server_request(frame, method)
            else:
                await self._notifications.put(
                    JsonRpcNotification(method, frame.get("params"), self.generation)
                )
            return
        if not has_id:
            raise JsonRpcProtocolError("JSON-RPC frame is neither request nor response")
        request_id = frame["id"]
        if not isinstance(request_id, int) or request_id < 1:
            raise JsonRpcProtocolError("JSON-RPC response id is invalid")
        future = self._pending.get(request_id)
        if future is None:
            raise JsonRpcProtocolError("JSON-RPC response references an unknown request")
        if "result" in frame and "error" in frame:
            raise JsonRpcProtocolError("JSON-RPC response contains result and error")
        if "error" in frame:
            error = frame["error"]
            if not isinstance(error, dict) or not isinstance(error.get("code"), int) or not isinstance(error.get("message"), str):
                raise JsonRpcProtocolError("JSON-RPC error response is invalid")
            future.set_exception(JsonRpcRemoteError(error["code"], error["message"], error.get("data")))
        elif "result" in frame:
            future.set_result(frame["result"])
        else:
            raise JsonRpcProtocolError("JSON-RPC response has no result or error")

    async def _handle_server_request(self, frame: Mapping[str, object], method: str) -> None:
        request_id = frame["id"]
        if not isinstance(request_id, (int, str)):
            raise JsonRpcProtocolError("JSON-RPC server request id is invalid")
        if self._server_request_handler is None:
            await self._write({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": "Method not supported"},
            })
            return
        try:
            result = await self._server_request_handler(method, frame.get("params"))
        except Exception:
            await self._write({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32603, "message": "Server request handler failed"},
            })
        else:
            await self._write({"jsonrpc": "2.0", "id": request_id, "result": result})

    def _fail_pending(self, error: BaseException) -> None:
        for future in tuple(self._pending.values()):
            if not future.done():
                future.set_exception(error)

