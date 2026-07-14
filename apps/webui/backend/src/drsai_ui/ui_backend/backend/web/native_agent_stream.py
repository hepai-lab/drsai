"""Bridge the existing WebSocket run manager to a stable Native SSE contract."""
from __future__ import annotations

import asyncio
import json
from typing import Any


def _sse(data: Any, event: str | None = None) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {payload}\n\n"


class NativeSseAdapter:
    """Convert runtime WebSocket messages without exposing private agent config."""

    def __init__(self) -> None:
        self._chunk_sources: set[str] = set()

    def encode(self, message: dict[str, Any]) -> tuple[list[str], bool]:
        message_type = str(message.get("type") or "")
        data = message.get("data") if isinstance(message.get("data"), dict) else {}
        if message_type == "message_chunk":
            content = data.get("content")
            if not isinstance(content, str) or not content:
                return [], False
            source = str(data.get("source") or "assistant")
            self._chunk_sources.add(source)
            return [_sse({"choices": [{"delta": {"content": content}}]})], False
        if message_type == "message":
            source = str(data.get("source") or "assistant")
            content = data.get("content")
            if source in {"user", "system"} or source in self._chunk_sources or not isinstance(content, str):
                return [], False
            return [_sse({"choices": [{"delta": {"content": content}}]})], False
        if message_type == "message_log":
            content = data.get("content") or data.get("title")
            if not isinstance(content, str) or not content:
                return [], False
            return [_sse({
                "title": str(data.get("title") or "Agent status"),
                "content": content,
                "level": str(data.get("send_level") or "INFO"),
                "content_type": str(data.get("content_type") or "log"),
            }, "agent.log")], False
        if message_type == "tool_call_summary":
            content = data.get("content") or data.get("summary") or data.get("result")
            if not isinstance(content, str) or not content:
                return [], False
            return [_sse({"tool_event": {
                "id": str(data.get("id") or "tool-result"),
                "kind": "tool_result",
                "title": str(data.get("title") or "Tool result"),
                "status": "completed",
                "content": content,
            }})], False
        if message_type == "message_files":
            files = data.get("files") if isinstance(data.get("files"), list) else [data]
            public_files = []
            for item in files:
                if not isinstance(item, dict):
                    continue
                path = item.get("path") or item.get("name")
                if not isinstance(path, str) or not path:
                    continue
                public_files.append({
                    "action": str(item.get("action") or "artifact"),
                    "path": path,
                    "name": str(item.get("name") or path.rsplit("/", 1)[-1]),
                })
            return ([_sse({"file_events": public_files})] if public_files else []), False
        if message_type == "input_request":
            return [_sse({
                "type": "input_request",
                "input_type": str(message.get("input_type") or "text_input"),
                "prompt": str(message.get("prompt") or data.get("content") or "Input required"),
            }, "agent.input_request")], False
        if message_type in {"result", "completion"}:
            status = str(message.get("status") or "complete")
            if status == "error":
                error = _public_error_message(message)
                return [_sse({"error": {"message": error, "code": "agent_execution_failed", "retryable": False}})], True
            return [_sse("[DONE]")], True
        if message_type == "error":
            return [_sse({"error": {
                "message": str(message.get("error") or "Agent execution failed."),
                "code": "agent_execution_failed",
                "retryable": False,
            }})], True
        return [], False


class NativeStreamSocket:
    """Minimal WebSocket-compatible queue consumed by StreamingResponse."""

    def __init__(self, max_queue: int = 256) -> None:
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=max_queue)

    async def accept(self) -> None:
        return None

    async def send_json(self, message: dict[str, Any]) -> None:
        await self.queue.put(message)


def _public_error_message(message: dict[str, Any]) -> str:
    data = message.get("data")
    if isinstance(data, dict):
        task_result = data.get("task_result")
        if isinstance(task_result, dict):
            stop_reason = task_result.get("stop_reason")
            if isinstance(stop_reason, str) and stop_reason:
                return stop_reason[:500]
    return "Agent execution failed."
