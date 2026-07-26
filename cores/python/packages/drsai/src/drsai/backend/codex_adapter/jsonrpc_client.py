"""Stable Codex App Server JSONL client owned by the Codex Adapter."""

from __future__ import annotations

import asyncio
import inspect
import json
from collections import defaultdict
from typing import Any, Awaitable, Callable, Mapping

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.app_server_process import CodexAppServerProcess


MessageHandler = Callable[[Mapping[str, Any]], Awaitable[Any] | Any]


class CodexJSONRPCClient:
    def __init__(self, supervisor: CodexAppServerProcess, *, request_timeout: float = 15.0):
        self.supervisor = supervisor
        self.request_timeout = request_timeout
        self._process: asyncio.subprocess.Process | None = None
        self._generation = 0
        self._next_id = 1
        self._pending: dict[int, tuple[int, asyncio.Future]] = {}
        self._reader_task: asyncio.Task | None = None
        self._write_lock = asyncio.Lock()
        self._connect_lock = asyncio.Lock()
        self._state = "new"
        self._notification_handlers: dict[str, list[MessageHandler]] = defaultdict(list)
        self._route_handlers: dict[tuple[str | None, str | None], list[MessageHandler]] = defaultdict(list)
        self._server_handlers: dict[str, MessageHandler] = {}
        self.unknown_notifications: list[dict[str, Any]] = []

    async def connect(self, *, client_version: str = "1.0.0") -> Mapping[str, Any]:
        async with self._connect_lock:
            if self._state == "ready" and self._process and self._process.returncode is None:
                return {"already_initialized": True, "generation": self._generation}
            if self._state == "closed":
                raise RuntimeExecutionError("codex_connection_closed", "Codex JSON-RPC client is closed.")
            process = await (self.supervisor.restart() if self._state == "failed" else self.supervisor.start())
            self._process = process
            self._generation = self.supervisor.generation
            self._state = "initializing"
            self._reader_task = asyncio.create_task(self._read_loop(process, self._generation))
            result = await self._request(
                "initialize",
                {"clientInfo": {"name": "opendrsai", "title": "OpenDrSai", "version": client_version}},
                timeout=self.request_timeout,
                allow_before_ready=True,
            )
            if isinstance(result, Mapping) and (
                result.get("experimentalApi") is True
                or (isinstance(result.get("capabilities"), Mapping) and result["capabilities"].get("experimentalApi") is True)
            ):
                await self._fail_connection("codex_experimental_api_rejected", "Codex App Server enabled experimentalApi.")
                raise RuntimeExecutionError("codex_experimental_api_rejected", "Production Codex Adapter requires the stable App Server API.")
            await self.notify("initialized", {}, allow_before_ready=True)
            self._state = "ready"
            return result if isinstance(result, Mapping) else {"result": result}

    async def request(self, method: str, params: Mapping[str, Any] | None = None, *, timeout: float | None = None) -> Any:
        if method == "initialize":
            raise RuntimeExecutionError("codex_initialize_duplicate", "Codex App Server can only be initialized by connect().")
        if self._state != "ready":
            raise RuntimeExecutionError("codex_not_initialized", "Codex App Server is not initialized.")
        return await self._request(method, params or {}, timeout=timeout)

    async def _request(
        self, method: str, params: Mapping[str, Any], *, timeout: float | None = None,
        allow_before_ready: bool = False,
    ) -> Any:
        if not allow_before_ready and self._state != "ready":
            raise RuntimeExecutionError("codex_not_initialized", "Codex App Server is not initialized.")
        process = self._require_process()
        request_id = self._next_id
        self._next_id += 1
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = (self._generation, future)
        try:
            await self._write({"method": method, "id": request_id, "params": dict(params)}, process)
            return await asyncio.wait_for(asyncio.shield(future), timeout=timeout or self.request_timeout)
        except asyncio.TimeoutError as exc:
            self._pending.pop(request_id, None)
            future.cancel()
            raise RuntimeExecutionError(
                "codex_request_timeout", f"Codex request timed out: {method}", retryable=True,
                detail={"method": method, "request_id": request_id},
            ) from exc
        except BaseException:
            self._pending.pop(request_id, None)
            if not future.done():
                future.cancel()
            raise

    async def notify(self, method: str, params: Mapping[str, Any] | None = None, *, allow_before_ready: bool = False) -> None:
        if not allow_before_ready and self._state != "ready":
            raise RuntimeExecutionError("codex_not_initialized", "Codex App Server is not initialized.")
        await self._write({"method": method, "params": dict(params or {})}, self._require_process())

    def on_notification(self, method: str, handler: MessageHandler) -> Callable[[], None]:
        self._notification_handlers[method].append(handler)
        return lambda: self._notification_handlers[method].remove(handler)

    def on_route(self, handler: MessageHandler, *, thread_id: str | None = None, turn_id: str | None = None) -> Callable[[], None]:
        key = (thread_id, turn_id)
        self._route_handlers[key].append(handler)
        return lambda: self._route_handlers[key].remove(handler)

    def handle_server_request(self, method: str, handler: MessageHandler) -> None:
        self._server_handlers[method] = handler

    async def close(self) -> None:
        if self._state == "closed":
            return
        self._state = "closed"
        await self._reject_pending("codex_connection_closed", "Codex JSON-RPC client closed.")
        if self._reader_task and self._reader_task is not asyncio.current_task():
            self._reader_task.cancel()
            await asyncio.gather(self._reader_task, return_exceptions=True)
        self._reader_task = None
        await self.supervisor.close()

    async def reconnect(self) -> Mapping[str, Any]:
        """Perform a controlled generation rotation without racing the stdout reader."""
        if self._state == "closed":
            raise RuntimeExecutionError("codex_connection_closed", "Codex JSON-RPC client is closed.")
        await self._reject_pending("codex_reconnecting", "Codex JSON-RPC connection is restarting.")
        if self._reader_task and self._reader_task is not asyncio.current_task():
            self._reader_task.cancel()
            await asyncio.gather(self._reader_task, return_exceptions=True)
        self._reader_task = None
        await self.supervisor.stop(record_failure=False)
        self._process = None
        self._state = "new"
        return await self.connect()

    async def _write(self, message: Mapping[str, Any], process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None or process.stdin is None:
            raise RuntimeExecutionError("codex_connection_eof", "Codex App Server connection is closed.", retryable=True)
        payload = json.dumps(dict(message), separators=(",", ":"), ensure_ascii=False).encode("utf-8") + b"\n"
        async with self._write_lock:
            try:
                process.stdin.write(payload)
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as exc:
                raise RuntimeExecutionError("codex_connection_eof", "Codex App Server connection is closed.", retryable=True) from exc

    async def _read_loop(self, process: asyncio.subprocess.Process, generation: int) -> None:
        assert process.stdout
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                if generation != self._generation:
                    continue
                try:
                    message = json.loads(line)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    await self._fail_connection("codex_json_invalid", "Codex App Server emitted invalid JSON.")
                    return
                if not isinstance(message, Mapping):
                    await self._fail_connection("codex_message_invalid", "Codex App Server emitted a non-object message.")
                    return
                await self._handle_message(message, generation)
        except asyncio.CancelledError:
            raise
        except Exception:
            await self._fail_connection("codex_reader_failed", "Codex App Server reader failed.")
            return
        if generation == self._generation and self._state != "closed":
            await self._fail_connection("codex_connection_eof", "Codex App Server closed its output.")

    async def _handle_message(self, message: Mapping[str, Any], generation: int) -> None:
        if generation != self._generation:
            return
        if "id" in message and "method" not in message:
            try:
                request_id = int(message["id"])
            except (TypeError, ValueError):
                return
            pending = self._pending.pop(request_id, None)
            if not pending or pending[0] != generation:
                return
            future = pending[1]
            if "error" in message:
                error = message.get("error") if isinstance(message.get("error"), Mapping) else {}
                future.set_exception(RuntimeExecutionError(
                    "codex_jsonrpc_error", str(error.get("message", "Codex request failed.")),
                    detail={"jsonrpc_code": error.get("code"), "data": error.get("data")},
                ))
            else:
                future.set_result(message.get("result"))
            return
        if "id" in message and "method" in message:
            asyncio.create_task(self._handle_server_request(message, generation))
            return
        method = message.get("method")
        if not isinstance(method, str):
            return
        params = message.get("params") if isinstance(message.get("params"), Mapping) else {}
        handlers = list(self._notification_handlers.get(method, ()))
        thread_id, turn_id = self._route_ids(params)
        handlers.extend(self._route_handlers.get((thread_id, turn_id), ()))
        handlers.extend(self._route_handlers.get((thread_id, None), ()))
        if not handlers:
            self.unknown_notifications.append({"method": method, "params": self._safe_summary(params)})
            self.unknown_notifications[:] = self.unknown_notifications[-100:]
        for handler in handlers:
            await self._call(handler, message)

    async def _handle_server_request(self, message: Mapping[str, Any], generation: int) -> None:
        method, request_id = str(message["method"]), message["id"]
        handler = self._server_handlers.get(method)
        try:
            if handler is None:
                response = {"id": request_id, "error": {"code": -32601, "message": "Method not supported by OpenDrSai."}}
            else:
                result = await self._call(handler, message)
                response = {"id": request_id, "result": result}
        except Exception as exc:
            response = {"id": request_id, "error": {"code": -32000, "message": type(exc).__name__}}
        if generation == self._generation and self._state != "closed":
            try:
                await self._write(response, self._require_process())
            except RuntimeExecutionError:
                pass

    async def _fail_connection(self, code: str, message: str) -> None:
        if self._state != "closed":
            self._state = "failed"
        await self._reject_pending(code, message)

    async def _reject_pending(self, code: str, message: str) -> None:
        pending, self._pending = self._pending, {}
        for _, future in pending.values():
            if not future.done():
                future.set_exception(RuntimeExecutionError(code, message, retryable=True))

    def _require_process(self) -> asyncio.subprocess.Process:
        if not self._process:
            raise RuntimeExecutionError("codex_connection_missing", "Codex App Server process is missing.")
        return self._process

    @staticmethod
    async def _call(handler: MessageHandler, message: Mapping[str, Any]) -> Any:
        result = handler(message)
        return await result if inspect.isawaitable(result) else result

    @staticmethod
    def _route_ids(params: Mapping[str, Any]) -> tuple[str | None, str | None]:
        thread = params.get("thread") if isinstance(params.get("thread"), Mapping) else {}
        turn = params.get("turn") if isinstance(params.get("turn"), Mapping) else {}
        return (
            str(params.get("threadId") or thread.get("id")) if params.get("threadId") or thread.get("id") else None,
            str(params.get("turnId") or turn.get("id")) if params.get("turnId") or turn.get("id") else None,
        )

    @staticmethod
    def _safe_summary(params: Mapping[str, Any]) -> dict[str, Any]:
        allowed = {"threadId", "turnId", "itemId", "type", "status"}
        return {key: value for key, value in params.items() if key in allowed and isinstance(value, (str, int, float, bool, type(None)))}
