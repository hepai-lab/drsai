"""Authenticated TCP transport for a host-owned Codex App Server.

The transport is intentionally JSONL-compatible after a one-line handshake so
the existing Codex JSON-RPC mapper remains the only semantic adapter.
"""

from __future__ import annotations

import asyncio
import hmac
import json
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlparse

from drsai.backend.runtime.agent import RuntimeExecutionError


MAX_BRIDGE_LINE_BYTES = 4 * 1024 * 1024
ALLOWED_CLIENT_METHODS = frozenset({
    "initialize", "initialized", "model/list", "account/read", "account/login/start",
    "account/login/cancel", "account/logout", "thread/start", "thread/read", "thread/resume",
    "thread/archive", "thread/unarchive", "turn/start", "turn/interrupt",
})


def validate_client_message(message: Mapping[str, Any]) -> None:
    """Reject capabilities that OpenDrSai's Codex Adapter never needs."""
    if "method" not in message:
        if "id" not in message or not ({"result", "error"} & message.keys()):
            raise ValueError("Bridge response must contain an id and result/error.")
        return
    method = message.get("method")
    if not isinstance(method, str) or method not in ALLOWED_CLIENT_METHODS:
        raise ValueError(f"Codex Bridge method is not allowed: {method!r}")


@dataclass
class RemoteCodexProcess:
    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    returncode: int | None = None

    @property
    def stdin(self) -> asyncio.StreamWriter:
        return self.writer

    @property
    def stdout(self) -> asyncio.StreamReader:
        return self.reader


class RemoteCodexSupervisor:
    """Supervisor-compatible connection to the host Codex Bridge."""

    def __init__(self, bridge_url: str, token: str, *, connect_timeout: float = 10.0):
        parsed = urlparse(bridge_url)
        if parsed.scheme != "tcp" or not parsed.hostname or not parsed.port:
            raise ValueError("OPENDRSAI_CODEX_BRIDGE_URL must be tcp://host:port.")
        if not token:
            raise ValueError("OPENDRSAI_CODEX_BRIDGE_TOKEN is required.")
        self.host, self.port, self.token = parsed.hostname, parsed.port, token
        self.connect_timeout = connect_timeout
        self.generation = 0
        self.binary = None
        self._process: RemoteCodexProcess | None = None

    async def start(self) -> RemoteCodexProcess:
        if self._process and self._process.returncode is None and not self._process.writer.is_closing():
            return self._process
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=self.connect_timeout,
            )
            writer.write((json.dumps({"op": "authenticate", "token": self.token}) + "\n").encode())
            await writer.drain()
            response = await asyncio.wait_for(reader.readline(), timeout=self.connect_timeout)
            message = json.loads(response)
            if not isinstance(message, Mapping) or message.get("op") != "ready":
                raise RuntimeExecutionError("codex_bridge_auth_failed", "Host Codex Bridge authentication failed.")
        except (OSError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeExecutionError(
                "codex_bridge_unavailable", "Host Codex Bridge is unavailable.", retryable=True,
            ) from exc
        self.generation += 1
        self._process = RemoteCodexProcess(reader, writer)
        return self._process

    async def restart(self) -> RemoteCodexProcess:
        await self.stop()
        return await self.start()

    async def stop(self, *, record_failure: bool = False) -> None:
        del record_failure
        if self._process:
            self._process.returncode = 0
            self._process.writer.close()
            await self._process.writer.wait_closed()
            self._process = None

    async def close(self) -> None:
        await self.stop()

    async def health(self) -> dict[str, object]:
        connected = bool(self._process and self._process.returncode is None and not self._process.writer.is_closing())
        return {
            "state": "ready" if connected else "stopped",
            "available": True,
            "reason": "ready" if connected else "bridge_not_connected",
            "transport": "host_bridge",
            "release_safe": True,
            "generation": self.generation,
        }


async def authenticate_bridge(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, expected_token: str) -> bool:
    try:
        raw = await asyncio.wait_for(reader.readline(), timeout=10)
        if not raw or len(raw) > 4096:
            return False
        message = json.loads(raw)
        supplied = message.get("token") if isinstance(message, Mapping) and message.get("op") == "authenticate" else ""
        if not isinstance(supplied, str) or not hmac.compare_digest(supplied, expected_token):
            return False
        writer.write(b'{"op":"ready"}\n')
        await writer.drain()
        return True
    except (asyncio.TimeoutError, json.JSONDecodeError, OSError):
        return False
