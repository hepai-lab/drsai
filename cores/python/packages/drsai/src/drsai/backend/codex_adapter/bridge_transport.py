"""Authenticated TCP transport for a host-owned Codex App Server.

The transport is intentionally JSONL-compatible after a one-line handshake so
the existing Codex JSON-RPC mapper remains the only semantic adapter.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import time
import secrets
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlparse

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.codex_adapter.stable_contract import CLIENT_METHODS, validate_client_method
from drsai.backend.codex_adapter.jsonl_frames import CODEX_JSONL_FRAME_LIMIT, read_jsonl_frame, parse_jsonl_object
from drsai.backend.codex_adapter.binary_provider import CodexBinary


MAX_BRIDGE_LINE_BYTES = CODEX_JSONL_FRAME_LIMIT
ALLOWED_CLIENT_METHODS = CLIENT_METHODS
BRIDGE_PROTOCOL = "opendrsai-codex-bridge/2"
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


class BridgeReplayGuard:
    def __init__(self, *, maximum_nonces: int = 4096, ttl_seconds: float = 300) -> None:
        self.maximum_nonces, self.ttl_seconds = maximum_nonces, ttl_seconds
        self._seen: OrderedDict[str, float] = OrderedDict()

    def consume(self, nonce: str) -> bool:
        now = time.monotonic()
        while self._seen and now - next(iter(self._seen.values())) > self.ttl_seconds:
            self._seen.popitem(last=False)
        if nonce in self._seen:
            return False
        self._seen[nonce] = now
        while len(self._seen) > self.maximum_nonces:
            self._seen.popitem(last=False)
        return True


def validate_bridge_bind_host(host: str, *, development: bool = False) -> None:
    if host not in _LOOPBACK_HOSTS and not development:
        raise ValueError("Product Codex Bridge must listen on loopback and be reached through an SSH tunnel.")


def token_not_expired(token: str, *, now: float | None = None) -> bool:
    parts = token.split(".", 2)
    if len(parts) != 3 or parts[0] != "v1":
        return False
    try:
        expires_at = int(parts[1])
    except ValueError:
        return False
    return expires_at >= int(time.time() if now is None else now) and len(parts[2]) >= 32


def issue_bridge_token(*, lifetime_seconds: int = 300, now: float | None = None) -> str:
    lifetime = max(30, min(900, int(lifetime_seconds)))
    return f"v1.{int(time.time() if now is None else now) + lifetime}.{secrets.token_urlsafe(32)}"


def validate_client_message(message: Mapping[str, Any]) -> None:
    """Reject capabilities that OpenDrSai's Codex Adapter never needs."""
    if "method" not in message:
        if "id" not in message or not ({"result", "error"} & message.keys()):
            raise ValueError("Bridge response must contain an id and result/error.")
        return
    method = message.get("method")
    if not isinstance(method, str) or method not in ALLOWED_CLIENT_METHODS:
        raise ValueError(f"Codex Bridge method is not allowed: {method!r}")
    params = message.get("params", {})
    validate_client_method(method, dict(params) if isinstance(params, Mapping) else params)


@dataclass
class RemoteCodexProcess:
    reader: asyncio.StreamReader
    writer: asyncio.StreamWriter
    returncode: int | None = None
    identity: Mapping[str, Any] | None = None

    @property
    def stdin(self) -> asyncio.StreamWriter:
        return self.writer

    @property
    def stdout(self) -> asyncio.StreamReader:
        return self.reader


class RemoteCodexSupervisor:
    """Supervisor-compatible connection to the host Codex Bridge."""

    def __init__(self, bridge_url: str, token: str, *, connect_timeout: float = 10.0,
                 expected_host_id: str | None = None):
        parsed = urlparse(bridge_url)
        if parsed.scheme != "tcp" or not parsed.hostname or not parsed.port:
            raise ValueError("OPENDRSAI_CODEX_BRIDGE_URL must be tcp://host:port.")
        if not token_not_expired(token):
            raise ValueError("OPENDRSAI_CODEX_BRIDGE_TOKEN must be a non-expired short-lived token.")
        if parsed.hostname not in _LOOPBACK_HOSTS:
            raise ValueError("Codex Bridge client must connect through a loopback SSH tunnel.")
        self.host, self.port, self.token = parsed.hostname, parsed.port, token
        self.expected_host_id = expected_host_id
        self.connect_timeout = connect_timeout
        self.generation = 0
        self.binary = None
        self._process: RemoteCodexProcess | None = None

    async def start(self) -> RemoteCodexProcess:
        if self._process and self._process.returncode is None and not self._process.writer.is_closing():
            return self._process
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port, limit=MAX_BRIDGE_LINE_BYTES + 1), timeout=self.connect_timeout,
            )
            nonce = hmac.digest(self.token.encode(), f"{time.time_ns()}:{id(self)}".encode(), "sha256").hex()
            writer.write((json.dumps({"op": "authenticate", "token": self.token, "nonce": nonce,
                                      "adapterProtocol": BRIDGE_PROTOCOL,
                                      **({"hostId": self.expected_host_id} if self.expected_host_id else {})}) + "\n").encode())
            await writer.drain()
            response = await asyncio.wait_for(read_jsonl_frame(reader, source="Host Codex Bridge"), timeout=self.connect_timeout)
            message = await parse_jsonl_object(response, source="Host Codex Bridge")
            required = {"codexVersion", "schemaDigest", "binaryDigest", "adapterProtocol", "hostId", "nonce"}
            if (not isinstance(message, Mapping) or message.get("op") != "ready"
                    or not required.issubset(message) or message.get("nonce") != nonce
                    or message.get("adapterProtocol") != BRIDGE_PROTOCOL):
                raise RuntimeExecutionError("codex_bridge_auth_failed", "Host Codex Bridge authentication failed.")
            host_id = str(message.get("hostId") or "")
            if self.expected_host_id and host_id != self.expected_host_id:
                raise RuntimeExecutionError("codex_bridge_host_mismatch", "Host Codex Bridge identity changed.")
            self.expected_host_id = host_id
        except (OSError, asyncio.TimeoutError, json.JSONDecodeError) as exc:
            raise RuntimeExecutionError(
                "codex_bridge_unavailable", "Host Codex Bridge is unavailable.", retryable=True,
            ) from exc
        self.generation += 1
        self.binary = CodexBinary(
            path=__import__("pathlib").Path(f"bridge://{host_id}"), version=str(message["codexVersion"]),
            schema_digest=str(message["schemaDigest"]), source="remote-bridge", release_safe=True,
            manifest={"binary_digest": str(message["binaryDigest"]), "host_id": host_id,
                      "adapter_protocol": BRIDGE_PROTOCOL},
        )
        self._process = RemoteCodexProcess(reader, writer, identity=dict(message))
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
            "version": self.binary.version if connected and self.binary else None,
            "identity": ({"host_id": self.expected_host_id, "codex_version": self.binary.version,
                          "schema_digest": self.binary.schema_digest,
                          "binary_digest": self.binary.manifest.get("binary_digest")}
                         if connected and self.binary else None),
        }


async def authenticate_bridge(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, expected_token: str,
    *, identity: Mapping[str, str] | None = None, replay_guard: BridgeReplayGuard | None = None,
) -> bool:
    try:
        raw = await asyncio.wait_for(reader.readline(), timeout=10)
        if not raw or len(raw) > 4096:
            return False
        message = json.loads(raw)
        supplied = message.get("token") if isinstance(message, Mapping) and message.get("op") == "authenticate" else ""
        nonce = message.get("nonce") if isinstance(message, Mapping) else ""
        if (not isinstance(supplied, str) or not hmac.compare_digest(supplied, expected_token)
                or not token_not_expired(supplied) or not isinstance(nonce, str) or len(nonce) < 32
                or message.get("adapterProtocol") != BRIDGE_PROTOCOL
                or not (replay_guard or BridgeReplayGuard()).consume(nonce)):
            return False
        proof = dict(identity or {})
        required = {"codexVersion", "schemaDigest", "binaryDigest", "hostId"}
        if not required.issubset(proof) or any(not str(proof[key]) for key in required):
            return False
        requested_host = message.get("hostId")
        if requested_host and not hmac.compare_digest(str(requested_host), str(proof["hostId"])):
            return False
        writer.write((json.dumps({"op": "ready", **proof, "adapterProtocol": BRIDGE_PROTOCOL,
                                  "nonce": nonce}, separators=(",", ":")) + "\n").encode())
        await writer.drain()
        return True
    except (asyncio.TimeoutError, json.JSONDecodeError, OSError):
        return False
